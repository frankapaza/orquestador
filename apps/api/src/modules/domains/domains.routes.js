import { z } from 'zod'
import nodemailer from 'nodemailer'
import { sql } from '../../lib/db.js'
import { imapManager } from '../email/imap.manager.js'

const domainSchema = z.object({
  domain: z.string().min(4),
  daily_limit: z.number().int().min(1).max(50000).default(1000),
  spf_configured:   z.boolean().optional(),
  dkim_configured:  z.boolean().optional(),
  dmarc_configured: z.boolean().optional(),
})

const accountSchema = z.object({
  email:       z.string().email(),
  smtp_host:   z.string().min(1),
  smtp_port:   z.number().int().default(587),
  smtp_user:   z.string().min(1),
  smtp_pass:   z.string().min(1),
  use_tls:     z.boolean().default(true),
  daily_limit: z.number().int().min(1).max(2000).default(300),
  // IMAP (recepción de respuestas en tiempo real). Opcionales: se derivan del SMTP.
  imap_host:    z.string().optional(),
  imap_port:    z.number().int().optional(),
  imap_user:    z.string().optional(),
  imap_pass:    z.string().optional(),
  imap_tls:     z.boolean().optional(),
  imap_enabled: z.boolean().optional(),
  is_active:    z.boolean().optional(),
})

// Deriva el host IMAP a partir del SMTP cuando no se especifica.
function deriveImapHost(smtpHost) {
  if (!smtpHost) return null
  const h = String(smtpHost).toLowerCase().trim()
  if (h.includes('gmail'))                       return 'imap.gmail.com'
  if (h.includes('office365') || h.includes('outlook')) return 'outlook.office365.com'
  if (h.startsWith('smtp.'))                     return 'imap.' + h.slice(5)
  return h
}

export async function domainsRoutes(fastify) {
  const auth = { onRequest: [fastify.authenticate] }

  // --- Envío transaccional desde una cuenta SMTP específica ---
  // Usado por sistemas externos (MCOB) para enviar un correo "desde" la cuenta
  // que el usuario tiene autorizada, sin necesidad de que el destino sea un
  // contacto registrado. La cuenta se valida contra el cliente del token.
  const sendEmailSchema = z.object({
    account_id:   z.string().uuid(),
    to:           z.string().email(),
    subject:      z.string().min(1),
    html_content: z.string().min(1),
    text_content: z.string().optional(),
    from_name:    z.string().optional(),
    reply_to:     z.string().email().optional(),
    cc:           z.array(z.string().email()).optional(),
    bcc:          z.array(z.string().email()).optional(),
  })

  fastify.post('/email/send', auth, async (req, reply) => {
    const body = sendEmailSchema.parse(req.body)

    // La cuenta debe pertenecer a un dominio del cliente del token y estar activa.
    const [account] = await sql`
      SELECT ea.*
      FROM email_accounts ea
      JOIN domains d ON d.id = ea.domain_id
      WHERE ea.id = ${body.account_id}
        AND d.client_id = ${req.user.sub}
        AND ea.is_active = true
    `
    if (!account) return reply.code(404).send({ error: 'Cuenta de correo no encontrada o inactiva' })
    if (account.daily_limit != null && account.sent_today >= account.daily_limit)
      return reply.code(429).send({ error: 'Cuenta sin cupo diario disponible' })

    const transporter = nodemailer.createTransport({
      host:   account.smtp_host,
      port:   account.smtp_port,
      secure: account.smtp_port === 465,
      auth:   { user: account.smtp_user, pass: account.smtp_pass },
      tls:    { rejectUnauthorized: false },
    })

    let info
    try {
      info = await transporter.sendMail({
        from:    `"${body.from_name || account.email}" <${account.email}>`,
        to:      body.to,
        replyTo: body.reply_to ?? account.email,
        cc:      body.cc?.join(', ')  ?? undefined,
        bcc:     body.bcc?.join(', ') ?? undefined,
        subject: body.subject,
        html:    body.html_content,
        text:    body.text_content ?? undefined,
      })
    } catch (e) {
      return reply.code(502).send({ error: 'Fallo el envío SMTP: ' + (e?.message || 'desconocido') })
    }

    await sql`UPDATE email_accounts SET sent_today = sent_today + 1, last_used_at = now() WHERE id = ${account.id}`

    // Vincula el envío a un contacto si el destino coincide con uno registrado,
    // y lo guarda para que aparezca en la vista 360° (sección Email).
    const [ct] = await sql`
      SELECT ce.contact_id
      FROM contact_emails ce
      JOIN contacts c ON c.id = ce.contact_id
      WHERE lower(ce.email) = lower(${body.to}) AND c.client_id = ${req.user.sub}
      LIMIT 1
    `
    await sql`
      INSERT INTO transactional_emails
        (client_id, contact_id, email_account_id, from_email, from_name, recipient_email, subject, body, status, message_id, sent_at)
      VALUES
        (${req.user.sub}, ${ct?.contact_id ?? null}, ${account.id}, ${account.email}, ${body.from_name ?? null}, ${body.to},
         ${body.subject}, ${body.html_content}, 'sent', ${info.messageId}, now())
    `

    return { ok: true, message_id: info.messageId, to: body.to, from: account.email }
  })

  // Lista plana de cuentas SMTP activas del cliente (para selectores "Enviar desde").
  fastify.get('/email/accounts', auth, async (req) => {
    return sql`
      SELECT ea.id, ea.email, ea.smtp_host, ea.daily_limit, ea.sent_today,
             d.id AS domain_id, d.domain
      FROM email_accounts ea
      JOIN domains d ON d.id = ea.domain_id
      WHERE d.client_id = ${req.user.sub} AND ea.is_active = true
      ORDER BY d.domain, ea.email
    `
  })

  // Hilo de correo (enviados + recibidos) con una dirección. Lo consume MCOB para
  // mostrar la conversación de correo con el cliente. Ordenado cronológicamente.
  fastify.get('/email/thread', auth, async (req) => {
    const address = String(req.query.address || '').trim().toLowerCase()
    if (!address) return []

    const enviados = await sql`
      SELECT 'out' AS direction, te.subject, te.body,
             te.from_email, te.from_name, te.recipient_email AS counterpart,
             te.status, te.sent_at AS at
      FROM transactional_emails te
      WHERE te.client_id = ${req.user.sub} AND te.sent_at IS NOT NULL
        AND lower(te.recipient_email) = ${address}
    `
    const recibidos = await sql`
      SELECT 'in' AS direction, ei.subject,
             COALESCE(NULLIF(ei.body_text, ''), ei.body_html) AS body,
             ei.from_email, ei.from_name, ei.to_email AS counterpart,
             NULL AS status, ei.received_at AS at
      FROM email_inbound ei
      WHERE ei.client_id = ${req.user.sub} AND lower(ei.from_email) = ${address}
    `
    return [...enviados, ...recibidos]
      .sort((a, b) => new Date(a.at) - new Date(b.at))
      .slice(-100)
  })

  // --- Dominios ---

  fastify.get('/domains', auth, async (req) => {
    const domains = await sql`
      SELECT d.*,
        COUNT(ea.id)::int AS account_count,
        COALESCE(SUM(ea.sent_today), 0)::int AS sent_today_total
      FROM domains d
      LEFT JOIN email_accounts ea ON ea.domain_id = d.id
      WHERE d.client_id = ${req.user.sub}
      GROUP BY d.id
      ORDER BY d.created_at DESC
    `
    return domains
  })

  fastify.post('/domains', auth, async (req, reply) => {
    const body = domainSchema.parse(req.body)
    const [domain] = await sql`
      INSERT INTO domains (client_id, domain, daily_limit)
      VALUES (${req.user.sub}, ${body.domain}, ${body.daily_limit})
      RETURNING *
    `
    return reply.code(201).send(domain)
  })

  fastify.patch('/domains/:id', auth, async (req, reply) => {
    const body = domainSchema.partial().parse(req.body)
    const [domain] = await sql`
      UPDATE domains SET
        daily_limit      = COALESCE(${body.daily_limit      ?? null}, daily_limit),
        spf_configured   = COALESCE(${body.spf_configured   ?? null}, spf_configured),
        dkim_configured  = COALESCE(${body.dkim_configured  ?? null}, dkim_configured),
        dmarc_configured = COALESCE(${body.dmarc_configured ?? null}, dmarc_configured)
      WHERE id = ${req.params.id} AND client_id = ${req.user.sub}
      RETURNING *
    `
    if (!domain) return reply.code(404).send({ error: 'Dominio no encontrado' })
    return domain
  })

  fastify.delete('/domains/:id', auth, async (req, reply) => {
    const [domain] = await sql`
      DELETE FROM domains WHERE id = ${req.params.id} AND client_id = ${req.user.sub}
      RETURNING id
    `
    if (!domain) return reply.code(404).send({ error: 'Dominio no encontrado' })
    return { deleted: true }
  })

  // --- Cuentas SMTP ---

  fastify.get('/domains/:domainId/accounts', auth, async (req, reply) => {
    const [domain] = await sql`SELECT id FROM domains WHERE id = ${req.params.domainId} AND client_id = ${req.user.sub}`
    if (!domain) return reply.code(404).send({ error: 'Dominio no encontrado' })

    return sql`
      SELECT ea.id, ea.domain_id, ea.email, ea.smtp_host, ea.smtp_port, ea.use_tls,
             ea.daily_limit, ea.sent_today, ea.last_used_at, ea.is_active, ea.created_at,
             ea.assigned_member_id, ea.imap_host, ea.imap_port, ea.imap_enabled,
             cm.name  AS assigned_member_name,
             cm.email AS assigned_member_email
      FROM email_accounts ea
      LEFT JOIN client_members cm ON cm.id = ea.assigned_member_id
      WHERE ea.domain_id = ${req.params.domainId}
      ORDER BY ea.created_at DESC
    `
  })

  fastify.post('/domains/:domainId/accounts', auth, async (req, reply) => {
    const [domain] = await sql`SELECT id FROM domains WHERE id = ${req.params.domainId} AND client_id = ${req.user.sub}`
    if (!domain) return reply.code(404).send({ error: 'Dominio no encontrado' })

    const body = accountSchema.parse(req.body)
    // IMAP: si no se especifica, se deriva del SMTP (mismo buzón).
    const imapHost = body.imap_host ?? deriveImapHost(body.smtp_host)
    const imapUser = body.imap_user ?? body.smtp_user
    const imapPass = body.imap_pass ?? body.smtp_pass
    const imapPort = body.imap_port ?? 993
    const imapTls  = body.imap_tls  ?? true
    const imapEnabled = body.imap_enabled ?? false
    const [account] = await sql`
      INSERT INTO email_accounts
        (domain_id, client_id, email, smtp_host, smtp_port, smtp_user, smtp_pass, use_tls, daily_limit,
         imap_host, imap_port, imap_user, imap_pass, imap_tls, imap_enabled)
      VALUES
        (${req.params.domainId}, ${req.user.sub}, ${body.email}, ${body.smtp_host},
         ${body.smtp_port}, ${body.smtp_user}, ${body.smtp_pass}, ${body.use_tls}, ${body.daily_limit},
         ${imapHost}, ${imapPort}, ${imapUser}, ${imapPass}, ${imapTls}, ${imapEnabled})
      RETURNING id, domain_id, email, smtp_host, smtp_port, use_tls, daily_limit, is_active, created_at,
                imap_host, imap_port, imap_enabled
    `
    imapManager.reconcile(account.id).catch(() => {})   // activa IMAP IDLE si corresponde
    return reply.code(201).send(account)
  })

  // Probar conexion SMTP de una cuenta
  fastify.post('/domains/:domainId/accounts/:accountId/test', auth, async (req, reply) => {
    const [account] = await sql`
      SELECT * FROM email_accounts
      WHERE id = ${req.params.accountId}
        AND domain_id = ${req.params.domainId}
        AND client_id = ${req.user.sub}
    `
    if (!account) return reply.code(404).send({ error: 'Cuenta no encontrada' })

    const transporter = nodemailer.createTransport({
      host:   account.smtp_host,
      port:   account.smtp_port,
      secure: account.smtp_port === 465,
      auth:   { user: account.smtp_user, pass: account.smtp_pass },
      tls:    { rejectUnauthorized: false },
      connectionTimeout: 8000,
      greetingTimeout:   8000,
    })

    try {
      await transporter.verify()
      return { ok: true, message: 'Conexion SMTP exitosa' }
    } catch (err) {
      return reply.code(422).send({ ok: false, message: err.message })
    } finally {
      transporter.close()
    }
  })

  // Asignar cuenta de email a un miembro del equipo
  fastify.patch('/domains/:domainId/accounts/:accountId/assign', auth, async (req, reply) => {
    const { member_id } = z.object({ member_id: z.string().uuid().nullable() }).parse(req.body)
    const [account] = await sql`
      UPDATE email_accounts SET assigned_member_id = ${member_id}
      WHERE id = ${req.params.accountId}
        AND domain_id = ${req.params.domainId}
        AND client_id = ${req.user.sub}
      RETURNING id, email, assigned_member_id
    `
    if (!account) return reply.code(404).send({ error: 'Cuenta no encontrada' })
    return account
  })

  fastify.patch('/domains/:domainId/accounts/:accountId', auth, async (req, reply) => {
    const body = accountSchema.partial().parse(req.body)
    const [account] = await sql`
      UPDATE email_accounts SET
        email       = COALESCE(${body.email       ?? null}, email),
        smtp_host   = COALESCE(${body.smtp_host   ?? null}, smtp_host),
        smtp_port   = COALESCE(${body.smtp_port   ?? null}, smtp_port),
        smtp_user   = COALESCE(${body.smtp_user   ?? null}, smtp_user),
        smtp_pass   = COALESCE(${body.smtp_pass   ?? null}, smtp_pass),
        use_tls     = COALESCE(${body.use_tls     ?? null}, use_tls),
        daily_limit = COALESCE(${body.daily_limit ?? null}, daily_limit),
        is_active   = COALESCE(${body.is_active   ?? null}, is_active),
        imap_host    = COALESCE(${body.imap_host    ?? null}, imap_host),
        imap_port    = COALESCE(${body.imap_port    ?? null}, imap_port),
        imap_user    = COALESCE(${body.imap_user    ?? null}, imap_user),
        imap_pass    = COALESCE(${body.imap_pass    ?? null}, imap_pass),
        imap_tls     = COALESCE(${body.imap_tls     ?? null}, imap_tls),
        imap_enabled = COALESCE(${body.imap_enabled ?? null}, imap_enabled)
      WHERE id = ${req.params.accountId}
        AND domain_id = ${req.params.domainId}
        AND client_id = ${req.user.sub}
      RETURNING id, domain_id, email, smtp_host, smtp_port, smtp_user, use_tls, daily_limit, is_active, created_at,
                imap_host, imap_port, imap_enabled
    `
    if (!account) return reply.code(404).send({ error: 'Cuenta no encontrada' })
    imapManager.reconcile(account.id).catch(() => {})   // reconecta/desconecta IMAP según estado
    return account
  })

  fastify.delete('/domains/:domainId/accounts/:accountId', auth, async (req, reply) => {
    const [account] = await sql`
      DELETE FROM email_accounts
      WHERE id = ${req.params.accountId}
        AND domain_id = ${req.params.domainId}
        AND client_id = ${req.user.sub}
      RETURNING id
    `
    if (!account) return reply.code(404).send({ error: 'Cuenta no encontrada' })
    imapManager.disconnect(req.params.accountId).catch(() => {})   // corta IMAP IDLE si estaba activo
    return { deleted: true }
  })
}
