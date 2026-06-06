import { z } from 'zod'
import { sql } from '../../lib/db.js'
import { parseFile } from './import.service.js'
import { pickEmailAccount } from '../sending/smtp.sender.js'
import nodemailer from 'nodemailer'

const listSchema = z.object({
  name: z.string().min(2),
  description: z.string().optional(),
})

const contactSchema = z.object({
  email:      z.string().email().optional().or(z.literal('')),
  phone:      z.string().min(6).optional(),
  first_name: z.string().optional(),
  last_name:  z.string().optional(),
  metadata:   z.record(z.any()).optional().default({}),
}).refine(d => d.email || d.phone, { message: 'Debe ingresar al menos email o teléfono' })

const bulkImportSchema = z.object({
  contacts: z.array(contactSchema).min(1).max(50000),
})

export async function contactsRoutes(fastify) {
  const auth = { onRequest: [fastify.authenticate] }

  // --- Listas ---

  fastify.get('/lists', auth, async (req) => {
    return sql`SELECT * FROM contact_lists WHERE client_id = ${req.user.sub} ORDER BY created_at DESC`
  })

  fastify.post('/lists', auth, async (req, reply) => {
    const body = listSchema.parse(req.body)
    const [list] = await sql`
      INSERT INTO contact_lists (client_id, name, description)
      VALUES (${req.user.sub}, ${body.name}, ${body.description ?? null})
      RETURNING *
    `
    return reply.code(201).send(list)
  })

  fastify.delete('/lists/:id', auth, async (req, reply) => {
    const [list] = await sql`
      DELETE FROM contact_lists WHERE id = ${req.params.id} AND client_id = ${req.user.sub}
      RETURNING id
    `
    if (!list) return reply.code(404).send({ error: 'Lista no encontrada' })
    return { deleted: true }
  })

  // --- Contactos ---

  fastify.get('/lists/:listId/contacts', auth, async (req, reply) => {
    const { page = 1, limit = 50 } = req.query
    const offset = (page - 1) * limit

    const [list] = await sql`SELECT id FROM contact_lists WHERE id = ${req.params.listId} AND client_id = ${req.user.sub}`
    if (!list) return reply.code(404).send({ error: 'Lista no encontrada' })

    const contacts = await sql`
      SELECT * FROM contacts WHERE list_id = ${req.params.listId}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `
    const [{ count }] = await sql`SELECT COUNT(*) FROM contacts WHERE list_id = ${req.params.listId}`

    return { contacts, total: parseInt(count), page: parseInt(page), limit: parseInt(limit) }
  })

  fastify.post('/lists/:listId/contacts', auth, async (req, reply) => {
    const [list] = await sql`SELECT id FROM contact_lists WHERE id = ${req.params.listId} AND client_id = ${req.user.sub}`
    if (!list) return reply.code(404).send({ error: 'Lista no encontrada' })

    const body = contactSchema.parse(req.body)
    const [contact] = await sql`
      INSERT INTO contacts (client_id, list_id, email, phone, first_name, last_name, metadata)
      VALUES (
        ${req.user.sub}, ${req.params.listId},
        ${body.email || null}, ${body.phone || null},
        ${body.first_name ?? null}, ${body.last_name ?? null},
        ${sql.json(body.metadata)}
      )
      ON CONFLICT DO NOTHING
      RETURNING *
    `
    await sql`UPDATE contact_lists SET total_count = (SELECT COUNT(*) FROM contacts WHERE list_id = ${req.params.listId}) WHERE id = ${req.params.listId}`
    return reply.code(201).send(contact)
  })

  // Importacion por archivo CSV / Excel
  fastify.post('/lists/:listId/contacts/import', auth, async (req, reply) => {
    const [list] = await sql`SELECT id FROM contact_lists WHERE id = ${req.params.listId} AND client_id = ${req.user.sub}`
    if (!list) return reply.code(404).send({ error: 'Lista no encontrada' })

    const file = await req.file()
    if (!file) return reply.code(400).send({ error: 'No se recibio archivo' })

    const filename = file.filename ?? 'file.csv'
    const ext = filename.split('.').pop().toLowerCase()
    if (!['csv', 'xlsx', 'xls'].includes(ext)) {
      return reply.code(400).send({ error: 'Formato no soportado. Use .csv, .xlsx o .xls' })
    }

    const chunks = []
    for await (const chunk of file.file) chunks.push(chunk)
    const buffer = Buffer.concat(chunks)

    if (buffer.length === 0) return reply.code(400).send({ error: 'El archivo esta vacio' })
    if (buffer.length > 10 * 1024 * 1024) return reply.code(400).send({ error: 'El archivo supera el limite de 10MB' })

    let parsed
    try {
      parsed = parseFile(buffer, filename)
    } catch (err) {
      return reply.code(422).send({ error: err.message })
    }

    if (parsed.contacts.length === 0) {
      return reply.code(422).send({
        error: 'No se encontraron contactos validos',
        skipped: parsed.skipped,
      })
    }

    // Insercion por lotes de 1000 para no saturar el query
    const BATCH = 1000
    let inserted = 0
    for (let i = 0; i < parsed.contacts.length; i += BATCH) {
      const batch = parsed.contacts.slice(i, i + BATCH).map(c => ({
        client_id:  req.user.sub,
        list_id:    req.params.listId,
        email:      c.email,
        first_name: c.first_name,
        last_name:  c.last_name,
        metadata:   c.metadata,
      }))

      await sql`
        INSERT INTO contacts ${sql(batch, 'client_id', 'list_id', 'email', 'first_name', 'last_name', 'metadata')}
        ON CONFLICT (list_id, email) DO UPDATE SET
          first_name = EXCLUDED.first_name,
          last_name  = EXCLUDED.last_name,
          metadata   = EXCLUDED.metadata
      `
      inserted += batch.length
    }

    await sql`
      UPDATE contact_lists
      SET total_count = (SELECT COUNT(*) FROM contacts WHERE list_id = ${req.params.listId})
      WHERE id = ${req.params.listId}
    `

    return {
      imported: inserted,
      skipped:  parsed.skipped.length,
      total_in_file: parsed.total,
      skipped_detail: parsed.skipped.slice(0, 20),
    }
  })

  // Importacion masiva via JSON
  fastify.post('/lists/:listId/contacts/bulk', auth, async (req, reply) => {
    const [list] = await sql`SELECT id FROM contact_lists WHERE id = ${req.params.listId} AND client_id = ${req.user.sub}`
    if (!list) return reply.code(404).send({ error: 'Lista no encontrada' })

    const { contacts } = bulkImportSchema.parse(req.body)
    const rows = contacts.map(c => ({
      client_id:  req.user.sub,
      list_id:    req.params.listId,
      email:      c.email,
      first_name: c.first_name ?? null,
      last_name:  c.last_name ?? null,
      metadata:   c.metadata ?? {},
    }))

    await sql`
      INSERT INTO contacts ${sql(rows, 'client_id', 'list_id', 'email', 'first_name', 'last_name', 'metadata')}
      ON CONFLICT (list_id, email) DO UPDATE SET
        first_name = EXCLUDED.first_name,
        last_name  = EXCLUDED.last_name
    `
    await sql`UPDATE contact_lists SET total_count = (SELECT COUNT(*) FROM contacts WHERE list_id = ${req.params.listId}) WHERE id = ${req.params.listId}`
    return { imported: contacts.length }
  })

  // Enviar email individual a un contacto
  fastify.post('/contacts/:id/send-email', auth, async (req, reply) => {
    const body = z.object({
      subject:      z.string().min(1),
      from_name:    z.string().min(1),
      html_content: z.string().min(1),
      text_content: z.string().optional(),
      reply_to:     z.string().email().optional(),
      cc:           z.array(z.string().email()).optional(),
      bcc:          z.array(z.string().email()).optional(),
    }).parse(req.body)

    const [contact] = await sql`
      SELECT * FROM contacts WHERE id = ${req.params.id} AND client_id = ${req.user.sub}
    `
    if (!contact) return reply.code(404).send({ error: 'Contacto no encontrado' })
    if (!contact.email) return reply.code(400).send({ error: 'Este contacto no tiene email registrado' })

    const account = await pickEmailAccount(req.user.sub)
    if (!account) return reply.code(400).send({ error: 'No hay cuentas SMTP activas con cuota disponible' })

    const transporter = nodemailer.createTransport({
      host:   account.smtp_host,
      port:   account.smtp_port,
      secure: account.smtp_port === 465,
      auth:   { user: account.smtp_user, pass: account.smtp_pass },
      tls:    { rejectUnauthorized: false },
    })

    // Interpolar variables del contacto
    const interpolate = t => (t ?? '')
      .replace(/\{\{first_name\}\}/g, contact.first_name ?? '')
      .replace(/\{\{last_name\}\}/g,  contact.last_name  ?? '')
      .replace(/\{\{email\}\}/g,      contact.email      ?? '')

    const info = await transporter.sendMail({
      from:    `"${body.from_name}" <${account.email}>`,
      to:      contact.email,
      replyTo: body.reply_to ?? account.email,
      cc:      body.cc?.join(', ')  ?? undefined,
      bcc:     body.bcc?.join(', ') ?? undefined,
      subject: interpolate(body.subject),
      html:    interpolate(body.html_content),
      text:    body.text_content ? interpolate(body.text_content) : undefined,
    })

    await sql`UPDATE email_accounts SET sent_today = sent_today + 1, last_used_at = now() WHERE id = ${account.id}`

    return { ok: true, message_id: info.messageId, to: contact.email }
  })

  // Vista 360° de un contacto — toda la actividad en todos los canales
  fastify.get('/contacts/:id/360', auth, async (req, reply) => {
    const clientId = req.user.sub

    // Info del contacto + sus listas
    const contacts = await sql`
      SELECT c.*, cl.id AS list_id, cl.name AS list_name
      FROM contacts c
      JOIN contact_lists cl ON cl.id = c.list_id
      WHERE c.id = ${req.params.id} AND c.client_id = ${clientId}
    `
    if (!contacts.length) return reply.code(404).send({ error: 'Contacto no encontrado' })

    const phones = await sql`SELECT * FROM contact_phones WHERE contact_id = ${req.params.id} ORDER BY is_primary DESC, created_at`
    const emails = await sql`SELECT * FROM contact_emails WHERE contact_id = ${req.params.id} ORDER BY is_primary DESC, created_at`

    const contact = {
      ...contacts[0],
      phones,
      emails,
      lists: contacts.map(c => ({ id: c.list_id, name: c.list_name })),
    }

    // Estadísticas email
    const [emailStats] = await sql`
      SELECT
        COUNT(*)                                       AS total_sent,
        COUNT(*) FILTER (WHERE status = 'sent')        AS delivered,
        COUNT(*) FILTER (WHERE status = 'failed')      AS failed
      FROM campaign_jobs
      WHERE contact_id = ${req.params.id}
    `

    // Aperturas y clicks del contacto
    const [trackStats] = await sql`
      SELECT
        COUNT(*) FILTER (WHERE event_type = 'open')  AS opens,
        COUNT(*) FILTER (WHERE event_type = 'click') AS clicks
      FROM tracking_events
      WHERE recipient_email = ${contact.email ?? ''} AND campaign_id IN (
        SELECT campaign_id FROM campaign_jobs WHERE contact_id = ${req.params.id}
      )
    `

    // Estadísticas mensajes (WA + SMS)
    const [msgStats] = await sql`
      SELECT
        COUNT(*)                                              AS total,
        COUNT(*) FILTER (WHERE direction = 'outbound')        AS sent,
        COUNT(*) FILTER (WHERE direction = 'inbound')         AS received,
        COUNT(*) FILTER (WHERE channel = 'whatsapp')          AS whatsapp,
        COUNT(*) FILTER (WHERE channel = 'sms')               AS sms
      FROM messages
      WHERE client_id = ${clientId}
        AND (from_number = ${contact.phone ?? ''} OR to_number = ${contact.phone ?? ''})
    `

    // Timeline: emails + eventos + mensajes (cronológico)
    const emailEvents = contact.email ? await sql`
      SELECT
        'email' AS channel,
        CASE cj.status WHEN 'sent' THEN 'outbound' ELSE 'outbound' END AS direction,
        'email_sent' AS event_type,
        cj.sent_at AS created_at,
        camp.name AS reference,
        camp.subject AS body,
        cj.status
      FROM campaign_jobs cj
      JOIN campaigns camp ON camp.id = cj.campaign_id
      WHERE cj.contact_id = ${req.params.id}
        AND cj.sent_at IS NOT NULL
    ` : []

    const trackEvents = contact.email ? await sql`
      SELECT
        'email' AS channel,
        'inbound' AS direction,
        te.event_type,
        te.created_at,
        camp.name AS reference,
        CASE te.event_type
          WHEN 'open'  THEN 'Abrió el correo'
          WHEN 'click' THEN 'Hizo clic en un enlace'
          WHEN 'unsub' THEN 'Se desuscribió'
          ELSE te.event_type
        END AS body,
        'tracked' AS status
      FROM tracking_events te
      JOIN campaigns camp ON camp.id = te.campaign_id
      WHERE te.recipient_email = ${contact.email}
        AND te.campaign_id IN (
          SELECT campaign_id FROM campaign_jobs WHERE contact_id = ${req.params.id}
        )
      ORDER BY te.created_at DESC
      LIMIT 50
    ` : []

    const msgEvents = contact.phone ? await sql`
      SELECT
        channel,
        direction,
        CASE direction WHEN 'inbound' THEN 'msg_received' ELSE 'msg_sent' END AS event_type,
        created_at,
        NULL AS reference,
        body,
        status
      FROM messages
      WHERE client_id = ${clientId}
        AND (from_number = ${contact.phone} OR to_number = ${contact.phone})
      ORDER BY created_at DESC
      LIMIT 100
    ` : []

    // Unir y ordenar cronológicamente
    const timeline = [...emailEvents, ...trackEvents, ...msgEvents]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))

    return {
      contact,
      stats: {
        email:    { ...emailStats, ...trackStats },
        messages: msgStats,
      },
      timeline,
    }
  })

  // Buscar contactos por nombre, email o teléfono (busca en tablas múltiples)
  fastify.get('/contacts/search', auth, async (req) => {
    const { q = '', limit = 20 } = req.query
    const term = `%${q}%`
    return sql`
      SELECT DISTINCT ON (c.id)
        c.id, c.first_name, c.last_name, c.email, c.phone,
        cl.name AS list_name
      FROM contacts c
      JOIN contact_lists cl ON cl.id = c.list_id
      LEFT JOIN contact_phones cp ON cp.contact_id = c.id
      LEFT JOIN contact_emails ce ON ce.contact_id = c.id
      WHERE c.client_id = ${req.user.sub}
        AND (
          c.first_name ILIKE ${term} OR
          c.last_name  ILIKE ${term} OR
          c.email      ILIKE ${term} OR
          c.phone      ILIKE ${term} OR
          cp.phone     ILIKE ${term} OR
          ce.email     ILIKE ${term}
        )
      ORDER BY c.id, c.first_name
      LIMIT ${limit}
    `
  })

  // Buscar info de un contacto por número de teléfono (busca en contact_phones también)
  fastify.get('/contacts/by-phone/:phone', auth, async (req) => {
    const phone = decodeURIComponent(req.params.phone)
    const contacts = await sql`
      SELECT DISTINCT ON (c.id)
        c.id, c.first_name, c.last_name, c.email, c.phone,
        c.metadata, c.is_subscribed, c.created_at,
        cl.id AS list_id, cl.name AS list_name
      FROM contacts c
      JOIN contact_lists cl ON cl.id = c.list_id
      LEFT JOIN contact_phones cp ON cp.contact_id = c.id
      WHERE c.client_id = ${req.user.sub}
        AND (c.phone = ${phone} OR cp.phone = ${phone})
      ORDER BY c.id, cl.created_at
    `
    if (!contacts.length) return null
    const base = contacts[0]
    const phones = await sql`SELECT * FROM contact_phones WHERE contact_id = ${base.id} ORDER BY is_primary DESC, created_at`
    const emails = await sql`SELECT * FROM contact_emails WHERE contact_id = ${base.id} ORDER BY is_primary DESC, created_at`
    return {
      id:            base.id,
      first_name:    base.first_name,
      last_name:     base.last_name,
      email:         base.email,
      phone:         base.phone,
      metadata:      base.metadata,
      is_subscribed: base.is_subscribed,
      phones,
      emails,
      lists: contacts.map(c => ({ id: c.list_id, name: c.list_name })),
    }
  })

  // ── Múltiples teléfonos ────────────────────────────────────────────────────

  fastify.post('/contacts/:id/phones', auth, async (req, reply) => {
    const { phone, label = 'Principal' } = z.object({
      phone: z.string().min(6),
      label: z.string().optional().default('Principal'),
    }).parse(req.body)

    const [contact] = await sql`SELECT id FROM contacts WHERE id = ${req.params.id} AND client_id = ${req.user.sub}`
    if (!contact) return reply.code(404).send({ error: 'Contacto no encontrado' })

    const existing = await sql`SELECT COUNT(*) FROM contact_phones WHERE contact_id = ${req.params.id}`
    const isFirst  = parseInt(existing[0].count) === 0

    const [cp] = await sql`
      INSERT INTO contact_phones (contact_id, client_id, phone, label, is_primary)
      VALUES (${req.params.id}, ${req.user.sub}, ${phone}, ${label}, ${isFirst})
      ON CONFLICT (contact_id, phone) DO NOTHING
      RETURNING *
    `
    if (isFirst) await sql`UPDATE contacts SET phone = ${phone} WHERE id = ${req.params.id}`
    return reply.code(201).send(cp)
  })

  fastify.delete('/contacts/:id/phones/:phoneId', auth, async (req, reply) => {
    const [cp] = await sql`
      SELECT * FROM contact_phones WHERE id = ${req.params.phoneId} AND contact_id = ${req.params.id} AND client_id = ${req.user.sub}
    `
    if (!cp) return reply.code(404).send({ error: 'Teléfono no encontrado' })

    await sql`DELETE FROM contact_phones WHERE id = ${req.params.phoneId}`

    if (cp.is_primary) {
      const [next] = await sql`SELECT id, phone FROM contact_phones WHERE contact_id = ${req.params.id} ORDER BY created_at LIMIT 1`
      if (next) {
        await sql`UPDATE contact_phones SET is_primary = true WHERE id = ${next.id}`
        await sql`UPDATE contacts SET phone = ${next.phone} WHERE id = ${req.params.id}`
      } else {
        await sql`UPDATE contacts SET phone = null WHERE id = ${req.params.id}`
      }
    }
    return { deleted: true }
  })

  fastify.patch('/contacts/:id/phones/:phoneId/primary', auth, async (req, reply) => {
    const [cp] = await sql`
      SELECT * FROM contact_phones WHERE id = ${req.params.phoneId} AND contact_id = ${req.params.id} AND client_id = ${req.user.sub}
    `
    if (!cp) return reply.code(404).send({ error: 'Teléfono no encontrado' })

    await sql`UPDATE contact_phones SET is_primary = false WHERE contact_id = ${req.params.id}`
    await sql`UPDATE contact_phones SET is_primary = true  WHERE id = ${req.params.phoneId}`
    await sql`UPDATE contacts SET phone = ${cp.phone} WHERE id = ${req.params.id}`
    return { ok: true }
  })

  // ── Múltiples emails ───────────────────────────────────────────────────────

  fastify.post('/contacts/:id/emails', auth, async (req, reply) => {
    const { email, label = 'Principal' } = z.object({
      email: z.string().email(),
      label: z.string().optional().default('Principal'),
    }).parse(req.body)

    const [contact] = await sql`SELECT id FROM contacts WHERE id = ${req.params.id} AND client_id = ${req.user.sub}`
    if (!contact) return reply.code(404).send({ error: 'Contacto no encontrado' })

    const existing = await sql`SELECT COUNT(*) FROM contact_emails WHERE contact_id = ${req.params.id}`
    const isFirst  = parseInt(existing[0].count) === 0

    const [ce] = await sql`
      INSERT INTO contact_emails (contact_id, client_id, email, label, is_primary)
      VALUES (${req.params.id}, ${req.user.sub}, ${email}, ${label}, ${isFirst})
      ON CONFLICT (contact_id, email) DO NOTHING
      RETURNING *
    `
    if (isFirst) await sql`UPDATE contacts SET email = ${email} WHERE id = ${req.params.id}`
    return reply.code(201).send(ce)
  })

  fastify.delete('/contacts/:id/emails/:emailId', auth, async (req, reply) => {
    const [ce] = await sql`
      SELECT * FROM contact_emails WHERE id = ${req.params.emailId} AND contact_id = ${req.params.id} AND client_id = ${req.user.sub}
    `
    if (!ce) return reply.code(404).send({ error: 'Email no encontrado' })

    await sql`DELETE FROM contact_emails WHERE id = ${req.params.emailId}`

    if (ce.is_primary) {
      const [next] = await sql`SELECT id, email FROM contact_emails WHERE contact_id = ${req.params.id} ORDER BY created_at LIMIT 1`
      if (next) {
        await sql`UPDATE contact_emails SET is_primary = true WHERE id = ${next.id}`
        await sql`UPDATE contacts SET email = ${next.email} WHERE id = ${req.params.id}`
      } else {
        await sql`UPDATE contacts SET email = null WHERE id = ${req.params.id}`
      }
    }
    return { deleted: true }
  })

  fastify.patch('/contacts/:id/emails/:emailId/primary', auth, async (req, reply) => {
    const [ce] = await sql`
      SELECT * FROM contact_emails WHERE id = ${req.params.emailId} AND contact_id = ${req.params.id} AND client_id = ${req.user.sub}
    `
    if (!ce) return reply.code(404).send({ error: 'Email no encontrado' })

    await sql`UPDATE contact_emails SET is_primary = false WHERE contact_id = ${req.params.id}`
    await sql`UPDATE contact_emails SET is_primary = true  WHERE id = ${req.params.emailId}`
    await sql`UPDATE contacts SET email = ${ce.email} WHERE id = ${req.params.id}`
    return { ok: true }
  })

  fastify.delete('/lists/:listId/contacts/:contactId', auth, async (req, reply) => {
    const [contact] = await sql`
      DELETE FROM contacts
      WHERE id = ${req.params.contactId} AND list_id = ${req.params.listId} AND client_id = ${req.user.sub}
      RETURNING id
    `
    if (!contact) return reply.code(404).send({ error: 'Contacto no encontrado' })
    return { deleted: true }
  })
}
