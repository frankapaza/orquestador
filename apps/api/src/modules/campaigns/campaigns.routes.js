import { z } from 'zod'
import { sql } from '../../lib/db.js'
import { enqueueCampaign, campaignQueue } from '../../workers/campaign.queue.js'

const campaignBase = z.object({
  name: z.string().min(2),
  channel: z.enum(['email', 'whatsapp', 'sms']).default('email'),
  // Email
  subject: z.string().optional(),
  from_name: z.string().optional(),
  reply_to: z.string().email().optional(),
  html_content: z.string().optional(),
  text_content: z.string().optional(),
  strategy: z.enum(['smtp_own', 'mailchimp', 'sendgrid', 'brevo']).default('smtp_own'),
  // WhatsApp / SMS
  content_text: z.string().optional(),
  media_url: z.string().url().optional().or(z.literal('')),
  media_caption: z.string().optional(),
  // Común
  list_id: z.string().uuid(),
  scheduled_at: z.string().datetime().optional(),
  settings: z.object({
    delay_min_ms: z.number().default(2000),
    delay_max_ms: z.number().default(15000),
    rotate_accounts: z.boolean().default(true),
    track_opens: z.boolean().default(true),
    track_clicks: z.boolean().default(true),
    integration_id: z.string().uuid().optional(),
    media_type: z.string().optional(),
    send_to_all: z.boolean().default(true),  // enviar a todos los teléfonos/correos del contacto
  }).default({}),
})

// El email requiere asunto/remitente/HTML; WhatsApp/SMS requieren el mensaje.
const campaignSchema = campaignBase.refine(
  d => d.channel === 'email'
    ? !!(d.subject && d.from_name && d.html_content)
    : !!(d.content_text && d.content_text.trim()),
  { message: 'Faltan campos requeridos para el canal seleccionado' },
)

export async function campaignsRoutes(fastify) {
  const auth = { onRequest: [fastify.authenticate] }

  fastify.get('/campaigns', auth, async (req) => {
    return sql`
      SELECT c.*, cl.name as list_name
      FROM campaigns c
      JOIN contact_lists cl ON cl.id = c.list_id
      WHERE c.client_id = ${req.user.sub}
      ORDER BY c.created_at DESC
    `
  })

  fastify.get('/campaigns/:id', auth, async (req, reply) => {
    const [campaign] = await sql`
      SELECT c.*, cl.name as list_name
      FROM campaigns c
      JOIN contact_lists cl ON cl.id = c.list_id
      WHERE c.id = ${req.params.id} AND c.client_id = ${req.user.sub}
    `
    if (!campaign) return reply.code(404).send({ error: 'Campana no encontrada' })
    return campaign
  })

  fastify.post('/campaigns', auth, async (req, reply) => {
    const body = campaignSchema.parse(req.body)

    const [list] = await sql`SELECT id, total_count FROM contact_lists WHERE id = ${body.list_id} AND client_id = ${req.user.sub}`
    if (!list) return reply.code(404).send({ error: 'Lista no encontrada' })

    // subject/from_name son NOT NULL; en WhatsApp/SMS se rellenan con el nombre de la campaña.
    const subject  = body.channel === 'email' ? body.subject   : (body.subject   || body.name)
    const fromName = body.channel === 'email' ? body.from_name : (body.from_name || body.name)

    const [campaign] = await sql`
      INSERT INTO campaigns (
        client_id, name, channel, subject, from_name, reply_to, html_content, text_content,
        content_text, media_url, media_caption, list_id, strategy, scheduled_at, settings, total_recipients
      )
      VALUES (
        ${req.user.sub}, ${body.name}, ${body.channel}, ${subject}, ${fromName},
        ${body.reply_to ?? null}, ${body.html_content ?? null}, ${body.text_content ?? null},
        ${body.content_text ?? null}, ${body.media_url || null}, ${body.media_caption ?? null},
        ${body.list_id}, ${body.strategy}, ${body.scheduled_at ?? null},
        ${sql.json(body.settings)}, ${list.total_count}
      )
      RETURNING *
    `
    return reply.code(201).send(campaign)
  })

  fastify.patch('/campaigns/:id', auth, async (req, reply) => {
    const [existing] = await sql`SELECT status FROM campaigns WHERE id = ${req.params.id} AND client_id = ${req.user.sub}`
    if (!existing) return reply.code(404).send({ error: 'Campana no encontrada' })
    if (!['draft', 'scheduled'].includes(existing.status)) {
      return reply.code(400).send({ error: 'Solo se pueden editar campanas en borrador o programadas' })
    }

    const body = campaignBase.partial().parse(req.body)
    const [campaign] = await sql`
      UPDATE campaigns SET name = COALESCE(${body.name ?? null}, name),
        subject = COALESCE(${body.subject ?? null}, subject),
        html_content = COALESCE(${body.html_content ?? null}, html_content),
        updated_at = now()
      WHERE id = ${req.params.id} AND client_id = ${req.user.sub}
      RETURNING *
    `
    return campaign
  })

  // Enviar campana
  fastify.post('/campaigns/:id/send', auth, async (req, reply) => {
    const [campaign] = await sql`
      SELECT * FROM campaigns WHERE id = ${req.params.id} AND client_id = ${req.user.sub}
    `
    if (!campaign) return reply.code(404).send({ error: 'Campana no encontrada' })
    if (!['draft', 'scheduled'].includes(campaign.status)) {
      return reply.code(400).send({ error: 'La campana ya fue enviada o esta en proceso' })
    }

    await sql`UPDATE campaigns SET status = 'sending', started_at = now() WHERE id = ${campaign.id}`
    await enqueueCampaign(campaign)

    return { message: 'Campana encolada para envio', campaign_id: campaign.id }
  })

  // Duplicar campaña (Reenviar)
  fastify.post('/campaigns/:id/duplicate', auth, async (req, reply) => {
    const [original] = await sql`
      SELECT * FROM campaigns WHERE id = ${req.params.id} AND client_id = ${req.user.sub}
    `
    if (!original) return reply.code(404).send({ error: 'Campaña no encontrada' })

    const [copy] = await sql`
      INSERT INTO campaigns
        (client_id, name, subject, from_name, reply_to, html_content, text_content,
         list_id, strategy, channel, content_text, media_url, media_caption, settings)
      VALUES
        (${req.user.sub},
         ${original.name + ' (Reenvío)'},
         ${original.subject}, ${original.from_name}, ${original.reply_to ?? null},
         ${original.html_content ?? null}, ${original.text_content ?? null},
         ${original.list_id}, ${original.strategy},
         ${original.channel ?? 'email'},
         ${original.content_text ?? null}, ${original.media_url ?? null},
         ${original.media_caption ?? null},
         ${sql.json(original.settings ?? {})})
      RETURNING *
    `
    return reply.code(201).send(copy)
  })

  // Pausar campana
  fastify.post('/campaigns/:id/pause', auth, async (req, reply) => {
    const [campaign] = await sql`
      UPDATE campaigns SET status = 'paused'
      WHERE id = ${req.params.id} AND client_id = ${req.user.sub} AND status = 'sending'
      RETURNING id, status
    `
    if (!campaign) return reply.code(400).send({ error: 'La campana no esta en envio' })
    return campaign
  })

  // Reanudar campana pausada
  fastify.post('/campaigns/:id/resume', auth, async (req, reply) => {
    const [campaign] = await sql`
      UPDATE campaigns SET status = 'sending'
      WHERE id = ${req.params.id} AND client_id = ${req.user.sub} AND status = 'paused'
      RETURNING *
    `
    if (!campaign) return reply.code(400).send({ error: 'La campana no esta pausada' })

    const pendingJobs = await sql`
      SELECT contact_id FROM campaign_jobs
      WHERE campaign_id = ${campaign.id} AND status = 'pending'
    `

    if (pendingJobs.length > 0) {
      const settings = campaign.settings ?? {}
      const delayMin = settings.delay_min_ms ?? 2000
      const delayMax = settings.delay_max_ms ?? 15000

      const jobs = pendingJobs.map((j, index) => ({
        name: 'send-email',
        data: { campaign_id: campaign.id, contact_id: j.contact_id },
        opts: {
          delay:            index * Math.floor(Math.random() * (delayMax - delayMin) + delayMin),
          attempts:         3,
          backoff:          { type: 'exponential', delay: 5000 },
          removeOnComplete: { count: 1000 },
          removeOnFail:     { count: 500 },
        },
      }))
      await campaignQueue.addBulk(jobs)
    }

    return { resumed: true, requeued: pendingJobs.length }
  })

  // Jobs paginados de una campana
  fastify.get('/campaigns/:id/jobs', auth, async (req, reply) => {
    const [campaign] = await sql`
      SELECT id FROM campaigns WHERE id = ${req.params.id} AND client_id = ${req.user.sub}
    `
    if (!campaign) return reply.code(404).send({ error: 'Campana no encontrada' })

    const page   = Math.max(1, parseInt(req.query.page ?? 1))
    const limit  = 50
    const offset = (page - 1) * limit
    const statusFilter = req.query.status ?? null

    const jobs = statusFilter
      ? await sql`
          SELECT cj.id, cj.recipient_email, cj.status, cj.sent_at, cj.error_message,
                 c.first_name, c.last_name
          FROM campaign_jobs cj
          JOIN contacts c ON c.id = cj.contact_id
          WHERE cj.campaign_id = ${req.params.id} AND cj.status = ${statusFilter}
          ORDER BY cj.sent_at DESC NULLS LAST, cj.created_at
          LIMIT ${limit} OFFSET ${offset}
        `
      : await sql`
          SELECT cj.id, cj.recipient_email, cj.status, cj.sent_at, cj.error_message,
                 c.first_name, c.last_name
          FROM campaign_jobs cj
          JOIN contacts c ON c.id = cj.contact_id
          WHERE cj.campaign_id = ${req.params.id}
          ORDER BY cj.sent_at DESC NULLS LAST, cj.created_at
          LIMIT ${limit} OFFSET ${offset}
        `

    const [{ count }] = statusFilter
      ? await sql`SELECT COUNT(*) FROM campaign_jobs WHERE campaign_id = ${req.params.id} AND status = ${statusFilter}`
      : await sql`SELECT COUNT(*) FROM campaign_jobs WHERE campaign_id = ${req.params.id}`

    return { jobs, total: parseInt(count), page, limit, pages: Math.ceil(parseInt(count) / limit) }
  })

  // Exportar jobs a CSV
  fastify.get('/campaigns/:id/export', auth, async (req, reply) => {
    const [campaign] = await sql`
      SELECT * FROM campaigns WHERE id = ${req.params.id} AND client_id = ${req.user.sub}
    `
    if (!campaign) return reply.code(404).send({ error: 'Campana no encontrada' })

    const jobs = await sql`
      SELECT cj.recipient_email AS email, c.first_name, c.last_name, cj.status, cj.sent_at, cj.error_message
      FROM campaign_jobs cj
      JOIN contacts c ON c.id = cj.contact_id
      WHERE cj.campaign_id = ${req.params.id}
      ORDER BY cj.sent_at DESC NULLS LAST
    `

    const header = 'email,nombre,apellido,estado,enviado_at,error\n'
    const rows = jobs.map(j =>
      `"${j.email}","${j.first_name ?? ''}","${j.last_name ?? ''}","${j.status}","${j.sent_at ?? ''}","${(j.error_message ?? '').replace(/"/g, '""')}"`
    ).join('\n')

    reply.header('Content-Type', 'text/csv; charset=utf-8')
    reply.header('Content-Disposition', `attachment; filename="campana-${campaign.name.replace(/[^a-z0-9]/gi, '_')}.csv"`)
    return header + rows
  })

  // Estadisticas detalladas
  fastify.get('/campaigns/:id/stats', auth, async (req, reply) => {
    const [campaign] = await sql`SELECT * FROM campaigns WHERE id = ${req.params.id} AND client_id = ${req.user.sub}`
    if (!campaign) return reply.code(404).send({ error: 'Campana no encontrada' })

    const jobStats = await sql`
      SELECT status, COUNT(*) as count FROM campaign_jobs
      WHERE campaign_id = ${req.params.id}
      GROUP BY status
    `

    const recentEvents = await sql`
      SELECT event_type, COUNT(*) as count FROM tracking_events
      WHERE campaign_id = ${req.params.id}
      GROUP BY event_type
    `

    return { campaign, job_stats: jobStats, event_stats: recentEvents }
  })
}
