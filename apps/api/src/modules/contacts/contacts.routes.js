import { z } from 'zod'
import { sql } from '../../lib/db.js'
import { parseFile } from './import.service.js'
import { pickEmailAccount } from '../sending/smtp.sender.js'
import { splitPhone, fullPhone } from '../../lib/phone.js'
import nodemailer from 'nodemailer'

// Convierte el HTML de un correo a texto plano corto para mostrar en el timeline.
function emailSnippet(html) {
  const txt = String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ').trim()
  // Cap generoso: suficiente para "Ver más" sin mandar correos gigantes al timeline.
  return txt.length > 4000 ? txt.slice(0, 4000) + '…' : txt
}

const listSchema = z.object({
  name: z.string().min(2),
  description: z.string().optional(),
})

const contactSchema = z.object({
  email:         z.string().email().optional().or(z.literal('')),
  phone:         z.string().min(4).optional(),       // número nacional (sin código)
  phone_dial:    z.string().optional(),              // '+51'
  phone_country: z.string().length(2).optional(),    // 'PE'
  first_name:    z.string().optional(),
  last_name:     z.string().optional(),
  metadata:      z.record(z.any()).optional().default({}),
}).refine(d => d.email || d.phone, { message: 'Debe ingresar al menos email o teléfono' })

const bulkImportSchema = z.object({
  contacts: z.array(contactSchema).min(1).max(50000),
})

// Upsert de contactos deduplicando por email usando contact_emails como fuente única
// (ya no existe contacts.email). Reimportar el mismo correo actualiza, no duplica.
async function upsertContactsByEmail(clientId, listId, rows) {
  // Dedup dentro del propio lote por email (la última fila gana)
  const map = new Map()
  for (const r of rows) if (r.email) map.set(r.email, r)
  const deduped = [...map.values()]
  if (!deduped.length) return 0

  const emails = deduped.map(r => r.email)
  const existing = await sql`
    SELECT ce.email, ce.contact_id
    FROM contact_emails ce
    JOIN contacts c ON c.id = ce.contact_id
    WHERE c.list_id = ${listId} AND ce.email IN ${sql(emails)}
  `
  const byEmail = new Map(existing.map(e => [e.email, e.contact_id]))

  const toUpdate = deduped.filter(r => byEmail.has(r.email))
  const toInsert = deduped.filter(r => !byEmail.has(r.email))

  // Actualizar los contactos que ya existían (por email)
  for (const r of toUpdate) {
    await sql`
      UPDATE contacts
      SET first_name = ${r.first_name ?? null}, last_name = ${r.last_name ?? null},
          metadata = ${sql.json(r.metadata ?? {})}
      WHERE id = ${byEmail.get(r.email)}
    `
  }

  // Insertar contactos nuevos + su correo principal en contact_emails
  if (toInsert.length) {
    const inserted = await sql`
      INSERT INTO contacts ${sql(toInsert.map(r => ({
        client_id:  clientId,
        list_id:    listId,
        first_name: r.first_name ?? null,
        last_name:  r.last_name ?? null,
        metadata:   r.metadata ?? {},
      })), 'client_id', 'list_id', 'first_name', 'last_name', 'metadata')}
      RETURNING id
    `
    const emailRows = inserted.map((c, i) => ({
      contact_id: c.id, client_id: clientId, email: toInsert[i].email,
      label: 'Principal', is_primary: true,
    }))
    await sql`
      INSERT INTO contact_emails ${sql(emailRows, 'contact_id', 'client_id', 'email', 'label', 'is_primary')}
      ON CONFLICT (contact_id, email) DO NOTHING
    `
  }
  return deduped.length
}

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

    // Teléfono y correo viven en contact_phones/contact_emails; traemos los principales.
    const contacts = await sql`
      SELECT c.*, cp.phone, cp.phone_dial, cp.phone_country, ce.email
      FROM contacts c
      LEFT JOIN contact_phones cp ON cp.contact_id = c.id AND cp.is_primary = true
      LEFT JOIN contact_emails ce ON ce.contact_id = c.id AND ce.is_primary = true
      WHERE c.list_id = ${req.params.listId}
      ORDER BY c.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `
    const [{ count }] = await sql`SELECT COUNT(*) FROM contacts WHERE list_id = ${req.params.listId}`

    return { contacts, total: parseInt(count), page: parseInt(page), limit: parseInt(limit) }
  })

  fastify.post('/lists/:listId/contacts', auth, async (req, reply) => {
    const [list] = await sql`SELECT id FROM contact_lists WHERE id = ${req.params.listId} AND client_id = ${req.user.sub}`
    if (!list) return reply.code(404).send({ error: 'Lista no encontrada' })

    const body = contactSchema.parse(req.body)
    // Teléfono y correo van SEPARADOS a sus propias tablas (fuente única). contacts no los guarda.
    const sp = splitPhone(body.phone, { country: body.phone_country, dial: body.phone_dial })
    const [contact] = await sql`
      INSERT INTO contacts (client_id, list_id, first_name, last_name, metadata)
      VALUES (
        ${req.user.sub}, ${req.params.listId},
        ${body.first_name ?? null}, ${body.last_name ?? null},
        ${sql.json(body.metadata)}
      )
      RETURNING *
    `
    // El teléfono se registra en contact_phones como Principal.
    if (contact && sp.national) {
      await sql`
        INSERT INTO contact_phones (contact_id, client_id, phone, phone_dial, phone_country, label, is_primary)
        VALUES (${contact.id}, ${req.user.sub}, ${sp.national}, ${sp.dial || null}, ${sp.country || null}, 'Móvil', true)
        ON CONFLICT (contact_id, phone) DO NOTHING
      `
    }
    // El correo se registra en contact_emails como Principal.
    if (contact && body.email) {
      await sql`
        INSERT INTO contact_emails (contact_id, client_id, email, label, is_primary)
        VALUES (${contact.id}, ${req.user.sub}, ${body.email}, 'Principal', true)
        ON CONFLICT (contact_id, email) DO NOTHING
      `
    }
    await sql`UPDATE contact_lists SET total_count = (SELECT COUNT(*) FROM contacts WHERE list_id = ${req.params.listId}) WHERE id = ${req.params.listId}`
    // Devolvemos el contacto con su correo/teléfono principal (para la UI), aunque no vivan en contacts.
    return reply.code(201).send({ ...contact, email: body.email || null, phone: sp.national || null, phone_dial: sp.dial || null, phone_country: sp.country || null })
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

    // Insercion por lotes de 1000, deduplicando por email vía contact_emails
    const BATCH = 1000
    let inserted = 0
    for (let i = 0; i < parsed.contacts.length; i += BATCH) {
      const batch = parsed.contacts.slice(i, i + BATCH)
      inserted += await upsertContactsByEmail(req.user.sub, req.params.listId, batch)
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
    const imported = await upsertContactsByEmail(req.user.sub, req.params.listId, contacts)
    await sql`UPDATE contact_lists SET total_count = (SELECT COUNT(*) FROM contacts WHERE list_id = ${req.params.listId}) WHERE id = ${req.params.listId}`
    return { imported }
  })

  // Enviar email individual a un contacto
  fastify.post('/contacts/:id/send-email', auth, async (req, reply) => {
    const body = z.object({
      subject:      z.string().min(1),
      from_name:    z.string().min(1),
      html_content: z.string().min(1),
      text_content: z.string().optional(),
      to:           z.string().email().optional(),   // correo destino específico (uno de los del contacto)
      account_id:   z.string().uuid().optional(),     // cuenta emisora elegida; si no, se auto-selecciona
      reply_to:     z.string().email().optional(),
      cc:           z.array(z.string().email()).optional(),
      bcc:          z.array(z.string().email()).optional(),
    }).parse(req.body)

    const [contact] = await sql`
      SELECT c.*, ce.email
      FROM contacts c
      LEFT JOIN contact_emails ce ON ce.contact_id = c.id AND ce.is_primary = true
      WHERE c.id = ${req.params.id} AND c.client_id = ${req.user.sub}
    `
    if (!contact) return reply.code(404).send({ error: 'Contacto no encontrado' })
    // Destino: el correo indicado (validado contra los del contacto) o el principal.
    let recipient = contact.email
    if (body.to) {
      const [owned] = await sql`SELECT 1 FROM contact_emails WHERE contact_id = ${req.params.id} AND email = ${body.to}`
      recipient = owned ? body.to : contact.email
    }
    if (!recipient) return reply.code(400).send({ error: 'Este contacto no tiene email registrado' })

    // Cuenta emisora: la elegida (validada contra el cliente) o, si no, auto-selección.
    let account = null
    if (body.account_id) {
      const [acc] = await sql`
        SELECT ea.*
        FROM email_accounts ea
        JOIN domains d ON d.id = ea.domain_id
        WHERE ea.id = ${body.account_id} AND d.client_id = ${req.user.sub} AND ea.is_active = true
      `
      account = acc ?? null
    }
    if (!account) account = await pickEmailAccount(req.user.sub)
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
      .replace(/\{\{email\}\}/g,      recipient          ?? '')

    const info = await transporter.sendMail({
      from:    `"${body.from_name}" <${account.email}>`,
      to:      recipient,
      replyTo: body.reply_to ?? account.email,
      cc:      body.cc?.join(', ')  ?? undefined,
      bcc:     body.bcc?.join(', ') ?? undefined,
      subject: interpolate(body.subject),
      html:    interpolate(body.html_content),
      text:    body.text_content ? interpolate(body.text_content) : undefined,
    })

    await sql`UPDATE email_accounts SET sent_today = sent_today + 1, last_used_at = now() WHERE id = ${account.id}`

    // Registra el envío individual para que aparezca en la vista 360° del contacto.
    await sql`
      INSERT INTO transactional_emails
        (client_id, contact_id, email_account_id, from_email, from_name, recipient_email, subject, body, status, message_id, sent_at)
      VALUES
        (${req.user.sub}, ${req.params.id}, ${account.id}, ${account.email}, ${body.from_name}, ${recipient},
         ${interpolate(body.subject)}, ${interpolate(body.html_content)}, 'sent', ${info.messageId}, now())
    `

    return { ok: true, message_id: info.messageId, to: recipient }
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

    // Los principales salen de contact_phones / contact_emails (fuente única).
    const primaryPhone = phones.find(p => p.is_primary) ?? phones[0] ?? null
    const primaryEmail = emails.find(e => e.is_primary) ?? emails[0] ?? null
    const contact = {
      ...contacts[0],
      phone:      primaryPhone?.phone ?? null,
      phone_dial: primaryPhone?.phone_dial ?? null,
      email:      primaryEmail?.email ?? null,
      phones,
      emails,
      lists: contacts.map(c => ({ id: c.list_id, name: c.list_name })),
    }
    // Números completos (E.164) de TODOS los teléfonos del contacto, para emparejar mensajes.
    const phoneNumbers = phones.map(fullPhone).filter(Boolean)
    const hasPhones    = phoneNumbers.length > 0
    // TODOS los correos del contacto, para emparejar actividad de email.
    const emailAddrs = [...new Set(emails.map(e => e.email).filter(Boolean))]
    const hasEmails  = emailAddrs.length > 0

    // Estadísticas email (campañas + correos individuales)
    const [emailStats] = await sql`
      SELECT
        COUNT(*)                                       AS total_sent,
        COUNT(*) FILTER (WHERE status = 'sent')        AS delivered,
        COUNT(*) FILTER (WHERE status = 'failed')      AS failed
      FROM campaign_jobs
      WHERE contact_id = ${req.params.id}
    `
    const [txEmailStats] = await sql`
      SELECT
        COUNT(*)                                       AS total_sent,
        COUNT(*) FILTER (WHERE status = 'sent')        AS delivered,
        COUNT(*) FILTER (WHERE status = 'failed')      AS failed
      FROM transactional_emails
      WHERE client_id = ${clientId}
        AND (
          contact_id = ${req.params.id}
          ${hasEmails ? sql`OR recipient_email IN ${sql(emailAddrs)}` : sql``}
        )
    `

    // Aperturas y clicks del contacto (de cualquiera de sus correos)
    const [trackStats] = hasEmails ? await sql`
      SELECT
        COUNT(*) FILTER (WHERE event_type = 'open')  AS opens,
        COUNT(*) FILTER (WHERE event_type = 'click') AS clicks
      FROM tracking_events
      WHERE recipient_email IN ${sql(emailAddrs)} AND campaign_id IN (
        SELECT campaign_id FROM campaign_jobs WHERE contact_id = ${req.params.id}
      )
    ` : [{ opens: 0, clicks: 0 }]

    // Estadísticas mensajes (WA + SMS) — de TODOS los teléfonos del contacto
    const [msgStats] = hasPhones ? await sql`
      SELECT
        COUNT(*)                                              AS total,
        COUNT(*) FILTER (WHERE direction = 'outbound')        AS sent,
        COUNT(*) FILTER (WHERE direction = 'inbound')         AS received,
        COUNT(*) FILTER (WHERE channel = 'whatsapp')          AS whatsapp,
        COUNT(*) FILTER (WHERE channel = 'sms')               AS sms
      FROM messages
      WHERE client_id = ${clientId}
        AND (from_number IN ${sql(phoneNumbers)} OR to_number IN ${sql(phoneNumbers)})
    ` : [{ total: 0, sent: 0, received: 0, whatsapp: 0, sms: 0 }]

    // Timeline: emails + eventos + mensajes (cronológico)
    const emailEvents = hasEmails ? await sql`
      SELECT
        'email' AS channel,
        'outbound' AS direction,
        'email_sent' AS event_type,
        cj.sent_at AS created_at,
        camp.name AS reference,
        camp.subject AS body,
        cj.status,
        cj.recipient_email AS email
      FROM campaign_jobs cj
      JOIN campaigns camp ON camp.id = cj.campaign_id
      WHERE cj.contact_id = ${req.params.id}
        AND cj.sent_at IS NOT NULL
    ` : []

    // Correos individuales (transaccionales) — por contacto o por cualquiera de sus correos.
    const txEmailEvents = await sql`
      SELECT
        'email' AS channel,
        'outbound' AS direction,
        'email_sent' AS event_type,
        te.sent_at AS created_at,
        'Correo individual' AS reference,
        te.body,
        te.subject,
        te.status,
        te.recipient_email AS email,
        te.from_email,
        te.from_name
      FROM transactional_emails te
      WHERE te.client_id = ${clientId}
        AND te.sent_at IS NOT NULL
        AND (
          te.contact_id = ${req.params.id}
          ${hasEmails ? sql`OR te.recipient_email IN ${sql(emailAddrs)}` : sql``}
        )
      ORDER BY te.sent_at DESC
      LIMIT 50
    `

    // Respuestas entrantes de correo (IMAP) — por contacto o por su correo remitente.
    const inboundEmailEvents = await sql`
      SELECT
        'email' AS channel,
        'inbound' AS direction,
        'email_received' AS event_type,
        ei.received_at AS created_at,
        'Respuesta de correo' AS reference,
        COALESCE(NULLIF(ei.body_html, ''), NULLIF(ei.body_text, ''), ei.subject) AS body,
        'received' AS status,
        ei.from_email AS email,
        ei.from_name,
        ei.to_email,
        ei.subject
      FROM email_inbound ei
      WHERE ei.client_id = ${clientId}
        AND (
          ei.contact_id = ${req.params.id}
          ${hasEmails ? sql`OR ei.from_email IN ${sql(emailAddrs)}` : sql``}
        )
      ORDER BY ei.received_at DESC
      LIMIT 50
    `

    const trackEvents = hasEmails ? await sql`
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
        'tracked' AS status,
        te.recipient_email AS email
      FROM tracking_events te
      JOIN campaigns camp ON camp.id = te.campaign_id
      WHERE te.recipient_email IN ${sql(emailAddrs)}
        AND te.campaign_id IN (
          SELECT campaign_id FROM campaign_jobs WHERE contact_id = ${req.params.id}
        )
      ORDER BY te.created_at DESC
      LIMIT 50
    ` : []

    const msgEvents = hasPhones ? await sql`
      SELECT
        m.channel,
        m.direction,
        CASE m.direction WHEN 'inbound' THEN 'msg_received' ELSE 'msg_sent' END AS event_type,
        m.created_at,
        camp.name AS reference,
        m.body,
        m.status,
        m.from_number,
        m.to_number,
        m.campaign_id,
        conv.account_id                            AS account_id,
        conv.account_type                          AS account_type,
        COALESCE(wa.name, sa.name)                 AS account_name,
        COALESCE(wa.phone_number, sa.phone_number) AS account_phone
      FROM messages m
      LEFT JOIN campaigns        camp ON camp.id = m.campaign_id
      LEFT JOIN conversations    conv ON conv.id = m.conversation_id
      LEFT JOIN whatsapp_accounts wa  ON wa.id = conv.account_id AND conv.account_type = 'whatsapp'
      LEFT JOIN sms_accounts      sa  ON sa.id = conv.account_id AND conv.account_type = 'sms'
      WHERE m.client_id = ${clientId}
        AND (m.from_number IN ${sql(phoneNumbers)} OR m.to_number IN ${sql(phoneNumbers)})
      ORDER BY m.created_at DESC
      LIMIT 100
    ` : []

    // Unir y ordenar cronológicamente
    const timeline = [...emailEvents, ...txEmailEvents, ...inboundEmailEvents, ...trackEvents, ...msgEvents]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))

    return {
      contact,
      stats: {
        email: {
          total_sent: Number(emailStats.total_sent) + Number(txEmailStats.total_sent),
          delivered:  Number(emailStats.delivered)  + Number(txEmailStats.delivered),
          failed:     Number(emailStats.failed)     + Number(txEmailStats.failed),
          ...trackStats,
        },
        messages: msgStats,
      },
      timeline,
    }
  })

  // Buscar contactos por nombre, email o teléfono (busca en tablas múltiples)
  fastify.get('/contacts/search', auth, async (req) => {
    const { q = '', limit = 20 } = req.query
    const term = `%${q}%`
    // Para teléfonos: comparar solo dígitos, ignorando espacios/+/guiones del término y del número.
    const digits     = q.replace(/\D/g, '')
    const digitsTerm = digits ? `%${digits}%` : null
    const phoneDigitsMatch = digitsTerm
      ? sql`OR regexp_replace(COALESCE(cp.phone_dial,'') || COALESCE(cp.phone,''), '[^0-9]', '', 'g') ILIKE ${digitsTerm}`
      : sql``
    return sql`
      SELECT DISTINCT ON (c.id)
        c.id, c.first_name, c.last_name,
        pe.email,
        pp.phone, pp.phone_dial,
        (
          SELECT json_agg(json_build_object(
            'phone', p.phone, 'phone_dial', p.phone_dial, 'phone_country', p.phone_country,
            'label', p.label, 'is_primary', p.is_primary
          ) ORDER BY p.is_primary DESC, p.created_at)
          FROM contact_phones p WHERE p.contact_id = c.id
        ) AS phones,
        cl.name AS list_name
      FROM contacts c
      JOIN contact_lists cl ON cl.id = c.list_id
      LEFT JOIN contact_phones cp ON cp.contact_id = c.id
      LEFT JOIN contact_phones pp ON pp.contact_id = c.id AND pp.is_primary = true
      LEFT JOIN contact_emails ce ON ce.contact_id = c.id
      LEFT JOIN contact_emails pe ON pe.contact_id = c.id AND pe.is_primary = true
      WHERE c.client_id = ${req.user.sub}
        AND (
          c.first_name ILIKE ${term} OR
          c.last_name  ILIKE ${term} OR
          (COALESCE(c.first_name,'') || ' ' || COALESCE(c.last_name,'')) ILIKE ${term} OR
          (cp.phone_dial || cp.phone) ILIKE ${term} OR
          cp.phone ILIKE ${term} OR
          ce.email ILIKE ${term}
          ${phoneDigitsMatch}
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
        c.id, c.first_name, c.last_name,
        pe.email,
        pp.phone, pp.phone_dial,
        c.metadata, c.is_subscribed, c.created_at,
        cl.id AS list_id, cl.name AS list_name
      FROM contacts c
      JOIN contact_lists cl ON cl.id = c.list_id
      LEFT JOIN contact_phones cp ON cp.contact_id = c.id
      LEFT JOIN contact_phones pp ON pp.contact_id = c.id AND pp.is_primary = true
      LEFT JOIN contact_emails pe ON pe.contact_id = c.id AND pe.is_primary = true
      WHERE c.client_id = ${req.user.sub}
        AND (cp.phone_dial || cp.phone) = ${phone}
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
    const body = z.object({
      phone:         z.string().min(4),
      phone_dial:    z.string().optional(),
      phone_country: z.string().length(2).optional(),
      label:         z.string().optional().default('Móvil'),
    }).parse(req.body)
    const sp = splitPhone(body.phone, { country: body.phone_country, dial: body.phone_dial })

    const [contact] = await sql`SELECT id FROM contacts WHERE id = ${req.params.id} AND client_id = ${req.user.sub}`
    if (!contact) return reply.code(404).send({ error: 'Contacto no encontrado' })

    const existing = await sql`SELECT COUNT(*) FROM contact_phones WHERE contact_id = ${req.params.id}`
    const isFirst  = parseInt(existing[0].count) === 0
    // "Principal" es EXCLUSIVO: si lo eligen (o es el primer teléfono) pasa a ser el principal y
    // reemplaza al anterior. "Principal" no se guarda como etiqueta; el principal lo define is_primary.
    const wantsPrimary = body.label === 'Principal'
    const makePrimary  = wantsPrimary || isFirst
    const storedLabel  = wantsPrimary ? 'Móvil' : body.label

    if (makePrimary) {
      await sql`UPDATE contact_phones SET is_primary = false WHERE contact_id = ${req.params.id}`
    }
    const [cp] = await sql`
      INSERT INTO contact_phones (contact_id, client_id, phone, phone_dial, phone_country, label, is_primary)
      VALUES (${req.params.id}, ${req.user.sub}, ${sp.national || null}, ${sp.dial || null}, ${sp.country || null}, ${storedLabel}, ${makePrimary})
      ON CONFLICT (contact_id, phone) DO NOTHING
      RETURNING *
    `
    return reply.code(201).send(cp)
  })

  fastify.delete('/contacts/:id/phones/:phoneId', auth, async (req, reply) => {
    const [cp] = await sql`
      SELECT * FROM contact_phones WHERE id = ${req.params.phoneId} AND contact_id = ${req.params.id} AND client_id = ${req.user.sub}
    `
    if (!cp) return reply.code(404).send({ error: 'Teléfono no encontrado' })

    await sql`DELETE FROM contact_phones WHERE id = ${req.params.phoneId}`

    // Si era el principal, el más antiguo restante toma el relevo.
    if (cp.is_primary) {
      const [next] = await sql`SELECT id FROM contact_phones WHERE contact_id = ${req.params.id} ORDER BY created_at LIMIT 1`
      if (next) await sql`UPDATE contact_phones SET is_primary = true WHERE id = ${next.id}`
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
    // "Principal" es EXCLUSIVO (igual que en teléfonos): reemplaza al principal actual.
    const wantsPrimary = label === 'Principal'
    const makePrimary  = wantsPrimary || isFirst
    const storedLabel  = wantsPrimary ? 'Otro' : label

    if (makePrimary) {
      await sql`UPDATE contact_emails SET is_primary = false WHERE contact_id = ${req.params.id}`
    }
    const [ce] = await sql`
      INSERT INTO contact_emails (contact_id, client_id, email, label, is_primary)
      VALUES (${req.params.id}, ${req.user.sub}, ${email}, ${storedLabel}, ${makePrimary})
      ON CONFLICT (contact_id, email) DO NOTHING
      RETURNING *
    `
    return reply.code(201).send(ce)
  })

  fastify.delete('/contacts/:id/emails/:emailId', auth, async (req, reply) => {
    const [ce] = await sql`
      SELECT * FROM contact_emails WHERE id = ${req.params.emailId} AND contact_id = ${req.params.id} AND client_id = ${req.user.sub}
    `
    if (!ce) return reply.code(404).send({ error: 'Email no encontrado' })

    await sql`DELETE FROM contact_emails WHERE id = ${req.params.emailId}`

    // Si era el principal, el más antiguo restante toma el relevo.
    if (ce.is_primary) {
      const [next] = await sql`SELECT id FROM contact_emails WHERE contact_id = ${req.params.id} ORDER BY created_at LIMIT 1`
      if (next) await sql`UPDATE contact_emails SET is_primary = true WHERE id = ${next.id}`
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
