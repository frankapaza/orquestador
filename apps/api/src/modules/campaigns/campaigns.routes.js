import { z } from 'zod'
import { sql } from '../../lib/db.js'
import { enqueueCampaign, campaignQueue } from '../../workers/campaign.queue.js'
import { parseFilePhone } from '../contacts/import.service.js'
import { upsertContactsByPhone } from '../contacts/phone-import.service.js'
import { extractVars } from '../assistants/assistant.vars.js'

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
  // WhatsApp IA
  assistant_id: z.string().uuid().optional().nullable(),
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
    wa_account_ids: z.array(z.string().uuid()).optional(),  // pool de números para campaña IA
  }).default({}),
})

// email: asunto/remitente/HTML. WhatsApp/SMS manual: mensaje. WhatsApp IA: asistente (sin mensaje).
const campaignSchema = campaignBase.refine(
  d => {
    if (d.assistant_id) return d.channel === 'whatsapp'
    if (d.channel === 'email') return !!(d.subject && d.from_name && d.html_content)
    return !!(d.content_text && d.content_text.trim())
  },
  { message: 'Faltan campos requeridos para el tipo de campaña' },
)

export async function campaignsRoutes(fastify) {
  const auth = { onRequest: [fastify.authenticate] }

  // Subir Excel de destinatarios (por teléfono) → crea una lista reutilizable.
  // Query: ?assistant_id=<uuid opcional>&name=<nombre base>
  fastify.post('/campaigns/import-recipients', auth, async (req, reply) => {
    const file = await req.file()
    if (!file) return reply.code(400).send({ error: 'No se recibió archivo' })

    const filename = file.filename ?? 'file.xlsx'
    const ext = filename.split('.').pop().toLowerCase()
    if (!['csv', 'xlsx', 'xls'].includes(ext)) {
      return reply.code(400).send({ error: 'Formato no soportado. Use .csv, .xlsx o .xls' })
    }

    const chunks = []
    for await (const chunk of file.file) chunks.push(chunk)
    const buffer = Buffer.concat(chunks)
    if (buffer.length === 0) return reply.code(400).send({ error: 'El archivo está vacío' })
    if (buffer.length > 10 * 1024 * 1024) return reply.code(400).send({ error: 'El archivo supera el límite de 10MB' })

    let parsed
    try {
      parsed = parseFilePhone(buffer, filename)
    } catch (err) {
      return reply.code(422).send({ error: err.message })
    }
    if (parsed.contacts.length === 0) {
      return reply.code(422).send({ error: 'No se encontraron destinatarios válidos', skipped: parsed.skipped.slice(0, 20) })
    }

    const baseName = String(req.query.name ?? 'Campaña').slice(0, 200)
    const [list] = await sql`
      INSERT INTO contact_lists (client_id, name, description, source)
      VALUES (${req.user.sub}, ${baseName + ' — destinatarios'}, 'Generada desde campaña', 'campaign')
      RETURNING *
    `

    const BATCH = 1000
    let imported = 0
    for (let i = 0; i < parsed.contacts.length; i += BATCH) {
      imported += await upsertContactsByPhone(req.user.sub, list.id, parsed.contacts.slice(i, i + BATCH))
    }
    await sql`
      UPDATE contact_lists SET total_count = (SELECT COUNT(*) FROM contacts WHERE list_id = ${list.id})
      WHERE id = ${list.id}
    `

    // Variables del asistente que NO vienen como columna en el Excel.
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    let variables_faltantes = []
    if (req.query.assistant_id && UUID_RE.test(req.query.assistant_id)) {
      const [asst] = await sql`SELECT * FROM wa_assistants WHERE id = ${req.query.assistant_id} AND client_id = ${req.user.sub}`
      if (asst) {
        const cols = new Set(parsed.columns.map(c => c.toUpperCase()))
        variables_faltantes = extractVars(asst).filter(v => !cols.has(v))
      }
    }

    return { list_id: list.id, list_name: list.name, total: imported, columns: parsed.columns, variables_faltantes }
  })

  // Genera una campaña SMS de seguimiento para los no-entregados de una campaña
  // WhatsApp IA: crea una lista con esos contactos y devuelve el número wa.me del
  // asistente. El front abre el wizard SMS con esta lista y arma el link {{link}}.
  fastify.post('/campaigns/:id/sms-followup', auth, async (req, reply) => {
    const [campaign] = await sql`
      SELECT * FROM campaigns WHERE id = ${req.params.id} AND client_id = ${req.user.sub}
    `
    if (!campaign) return reply.code(404).send({ error: 'Campaña no encontrada' })
    if (campaign.channel !== 'whatsapp' || !campaign.assistant_id) {
      return reply.code(400).send({ error: 'Solo aplica a campañas de WhatsApp IA' })
    }

    // No entregados: jobs 'sent' cuyo saludo no está delivered/read.
    const undelivered = await sql`
      SELECT cj.contact_id, cj.phone_number, c.first_name, c.last_name, c.metadata
      FROM campaign_jobs cj
      JOIN contacts c ON c.id = cj.contact_id
      LEFT JOIN messages m ON m.external_id = cj.message_id AND m.client_id = ${req.user.sub} AND m.direction = 'outbound'
      WHERE cj.campaign_id = ${campaign.id}
        AND cj.channel = 'whatsapp' AND cj.status = 'sent'
        AND cj.phone_number IS NOT NULL AND cj.phone_number <> ''
        AND COALESCE(m.status, 'sent') NOT IN ('delivered', 'read')
    `
    if (!undelivered.length) {
      return reply.code(400).send({ error: 'No hay destinatarios sin entregar en esta campaña' })
    }

    // Número wa.me: el WhatsApp del asistente (conectado; del pool si lo hay).
    // Se resuelve ANTES de crear la lista: sin número no se puede armar el link,
    // así que fallamos temprano y no dejamos una lista huérfana.
    const wanted = campaign.settings?.wa_account_ids ?? []
    const [acc] = await sql`
      SELECT phone_number FROM whatsapp_accounts
      WHERE client_id = ${req.user.sub} AND assistant_id = ${campaign.assistant_id}
        ${wanted.length ? sql`AND id IN ${sql(wanted)}` : sql``}
      ORDER BY is_connected DESC, created_at ASC
      LIMIT 1
    `
    const wameNumber = acc?.phone_number ? String(acc.phone_number).replace(/\D/g, '') : null
    if (!wameNumber) {
      return reply.code(400).send({ error: 'El asistente no tiene un número de WhatsApp vinculado para armar el link wa.me' })
    }

    // Lista nueva con esos contactos (nombre + metadata para las variables del SMS).
    const [list] = await sql`
      INSERT INTO contact_lists (client_id, name, description, source)
      VALUES (${req.user.sub}, ${campaign.name + ' — no entregados'}, 'Seguimiento SMS con link wa.me', 'campaign')
      RETURNING *
    `
    const rows = undelivered.map(u => ({
      phone:      u.phone_number,
      first_name: u.first_name,
      last_name:  u.last_name,
      metadata:   u.metadata && typeof u.metadata === 'object' ? u.metadata : {},
    }))
    const imported = await upsertContactsByPhone(req.user.sub, list.id, rows)
    await sql`
      UPDATE contact_lists SET total_count = (SELECT COUNT(*) FROM contacts WHERE list_id = ${list.id})
      WHERE id = ${list.id}
    `

    return { list_id: list.id, total: imported, wame_number: wameNumber }
  })

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

    // Campaña IA: los números elegidos deben existir y tener ese asistente vinculado.
    if (body.assistant_id) {
      const [asst] = await sql`
        SELECT id, greeting FROM wa_assistants
        WHERE id = ${body.assistant_id} AND client_id = ${req.user.sub}
      `
      if (!asst) return reply.code(404).send({ error: 'Asistente no encontrado' })
      if (!asst.greeting || !asst.greeting.trim()) {
        return reply.code(400).send({ error: 'El asistente no tiene saludo configurado; la campaña IA no tendría mensaje de apertura' })
      }

      const wanted = [...new Set(body.settings?.wa_account_ids ?? [])]
      if (!wanted.length) return reply.code(400).send({ error: 'Selecciona al menos un número de WhatsApp para la campaña IA' })
      const linked = await sql`
        SELECT id FROM whatsapp_accounts
        WHERE client_id = ${req.user.sub} AND assistant_id = ${body.assistant_id} AND id IN ${sql(wanted)}
      `
      if (linked.length !== wanted.length) {
        return reply.code(400).send({ error: 'Todos los números deben tener el asistente seleccionado vinculado' })
      }
    }

    // subject/from_name son NOT NULL; en WhatsApp/SMS se rellenan con el nombre de la campaña.
    const subject  = body.channel === 'email' ? body.subject   : (body.subject   || body.name)
    const fromName = body.channel === 'email' ? body.from_name : (body.from_name || body.name)

    // Si tiene fecha programada, nace como 'scheduled' para que el cron la arranque
    // a su hora. Sin fecha, queda 'draft' (se envía con "Enviar ahora").
    const status = body.scheduled_at ? 'scheduled' : 'draft'

    const [campaign] = await sql`
      INSERT INTO campaigns (
        client_id, name, channel, subject, from_name, reply_to, html_content, text_content,
        content_text, media_url, media_caption, list_id, strategy, scheduled_at, settings,
        total_recipients, assistant_id, status
      )
      VALUES (
        ${req.user.sub}, ${body.name}, ${body.channel}, ${subject}, ${fromName},
        ${body.reply_to ?? null}, ${body.html_content ?? null}, ${body.text_content ?? null},
        ${body.content_text ?? null}, ${body.media_url || null}, ${body.media_caption ?? null},
        ${body.list_id}, ${body.strategy}, ${body.scheduled_at ?? null},
        ${sql.json(body.settings)}, ${list.total_count}, ${body.assistant_id ?? null}, ${status}
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

    // "undelivered" = enviado pero el saludo no llegó (sin delivered/read).
    const whereStatus =
      statusFilter === 'undelivered'
        ? sql`AND cj.status = 'sent' AND COALESCE(m.status, 'sent') NOT IN ('delivered', 'read')`
        : statusFilter
          ? sql`AND cj.status = ${statusFilter}`
          : sql``

    const jobs = await sql`
      SELECT cj.id, cj.recipient_email, cj.phone_number, cj.status, cj.sent_at, cj.error_message,
             c.first_name, c.last_name, m.status AS delivery_status
      FROM campaign_jobs cj
      JOIN contacts c ON c.id = cj.contact_id
      LEFT JOIN messages m ON m.external_id = cj.message_id AND m.client_id = ${req.user.sub} AND m.direction = 'outbound'
      WHERE cj.campaign_id = ${req.params.id} ${whereStatus}
      ORDER BY cj.sent_at DESC NULLS LAST, cj.created_at
      LIMIT ${limit} OFFSET ${offset}
    `

    const [{ count }] = await sql`
      SELECT COUNT(*)
      FROM campaign_jobs cj
      LEFT JOIN messages m ON m.external_id = cj.message_id AND m.client_id = ${req.user.sub} AND m.direction = 'outbound'
      WHERE cj.campaign_id = ${req.params.id} ${whereStatus}
    `

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
