import { z } from 'zod'
import nodemailer from 'nodemailer'
import { sql } from '../../lib/db.js'

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
})

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
    return { ok: true, message_id: info.messageId, to: body.to, from: account.email }
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
             ea.assigned_member_id,
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
    const [account] = await sql`
      INSERT INTO email_accounts
        (domain_id, client_id, email, smtp_host, smtp_port, smtp_user, smtp_pass, use_tls, daily_limit)
      VALUES
        (${req.params.domainId}, ${req.user.sub}, ${body.email}, ${body.smtp_host},
         ${body.smtp_port}, ${body.smtp_user}, ${body.smtp_pass}, ${body.use_tls}, ${body.daily_limit})
      RETURNING id, domain_id, email, smtp_host, smtp_port, use_tls, daily_limit, is_active, created_at
    `
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
        is_active   = COALESCE(${body.is_active   ?? null}, is_active)
      WHERE id = ${req.params.accountId}
        AND domain_id = ${req.params.domainId}
        AND client_id = ${req.user.sub}
      RETURNING id, domain_id, email, smtp_host, smtp_port, smtp_user, use_tls, daily_limit, is_active, created_at
    `
    if (!account) return reply.code(404).send({ error: 'Cuenta no encontrada' })
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
    return { deleted: true }
  })
}
