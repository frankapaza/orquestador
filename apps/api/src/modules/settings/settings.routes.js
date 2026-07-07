import { z } from 'zod'
import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'
import { sql } from '../../lib/db.js'

const ROLES = ['owner', 'asesor', 'editor', 'viewer']

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex')
}

function generateApiKey() {
  const rand = crypto.randomBytes(30).toString('base64url').slice(0, 40)
  return `kubo_${rand}`
}

function maskKey(prefix) {
  return `${prefix}••••••••`
}

export async function settingsRoutes(fastify) {
  const auth = { onRequest: [fastify.authenticate] }

  // ── PERFIL ────────────────────────────────────────────────────────────────

  fastify.patch('/settings/profile', auth, async (req, reply) => {
    const body = z.object({
      name:  z.string().min(2).optional(),
      email: z.string().email().optional(),
    }).parse(req.body)

    if (body.email) {
      const [conflict] = await sql`SELECT id FROM clients WHERE email = ${body.email} AND id != ${req.user.sub}`
      if (conflict) return reply.code(409).send({ error: 'Email ya en uso' })
    }

    const [client] = await sql`
      UPDATE clients
      SET name  = COALESCE(${body.name  ?? null}, name),
          email = COALESCE(${body.email ?? null}, email),
          updated_at = now()
      WHERE id = ${req.user.sub}
      RETURNING id, name, email, plan, is_admin, created_at
    `
    return client
  })

  fastify.patch('/settings/password', auth, async (req, reply) => {
    const body = z.object({
      current_password: z.string().min(1),
      new_password:     z.string().min(8),
    }).parse(req.body)

    const [client] = await sql`SELECT password FROM clients WHERE id = ${req.user.sub}`
    const valid = await bcrypt.compare(body.current_password, client.password)
    if (!valid) return reply.code(400).send({ error: 'Contrasena actual incorrecta' })

    const hashed = await bcrypt.hash(body.new_password, 10)
    await sql`UPDATE clients SET password = ${hashed}, updated_at = now() WHERE id = ${req.user.sub}`
    return { ok: true }
  })

  // ── CANALES ASIGNADOS AL ASESOR LOGUEADO ─────────────────────────────────

  fastify.get('/settings/my-channels', auth, async (req) => {
    const clientId = req.user.sub

    const [waAccount] = req.user.member_id ? await sql`
      SELECT id, name, phone_number, instance_name, provider,
             is_connected, role, daily_limit, sent_today,
             active_hours_start, active_hours_end
      FROM whatsapp_accounts
      WHERE client_id = ${clientId} AND assigned_member_id = ${req.user.member_id} AND is_active = true
      LIMIT 1
    ` : []

    const [smsAccount] = req.user.member_id ? await sql`
      SELECT id, name, phone_number, gateway_url,
             is_online, daily_limit, sent_today,
             active_hours_start, active_hours_end
      FROM sms_accounts
      WHERE client_id = ${clientId} AND assigned_member_id = ${req.user.member_id} AND is_active = true
      LIMIT 1
    ` : []

    const [emailAccount] = req.user.member_id ? await sql`
      SELECT ea.id, ea.email, ea.smtp_host, ea.smtp_port, ea.use_tls,
             ea.daily_limit, ea.sent_today, ea.is_active,
             d.domain
      FROM email_accounts ea
      JOIN domains d ON d.id = ea.domain_id
      WHERE ea.client_id = ${clientId} AND ea.assigned_member_id = ${req.user.member_id} AND ea.is_active = true
      LIMIT 1
    ` : []

    return {
      whatsapp: waAccount  ?? null,
      sms:      smsAccount ?? null,
      email:    emailAccount ?? null,
    }
  })

  // ── EQUIPO ────────────────────────────────────────────────────────────────

  fastify.get('/settings/team', auth, async (req) => {
    const members = await sql`
      SELECT id, name, email, role, is_active, created_at
      FROM client_members
      WHERE client_id = ${req.user.sub}
      ORDER BY created_at ASC
    `
    // Incluir el dueño al inicio
    const [owner] = await sql`SELECT id, name, email FROM clients WHERE id = ${req.user.sub}`
    return [
      { ...owner, role: 'owner', is_active: true, is_owner: true },
      ...members,
    ]
  })

  fastify.post('/settings/team', auth, async (req, reply) => {
    const body = z.object({
      name:     z.string().min(2),
      email:    z.string().email(),
      password: z.string().min(8),
      role:     z.enum(['asesor', 'editor', 'viewer']).default('asesor'),
    }).parse(req.body)

    // Verificar que el email no exista en clientes ni en miembros
    const [clientConflict] = await sql`SELECT id FROM clients WHERE email = ${body.email}`
    if (clientConflict) return reply.code(409).send({ error: 'Email ya registrado como cliente' })

    const [memberConflict] = await sql`SELECT id FROM client_members WHERE email = ${body.email}`
    if (memberConflict) return reply.code(409).send({ error: 'Email ya registrado como miembro' })

    const hashed = await bcrypt.hash(body.password, 10)
    const [member] = await sql`
      INSERT INTO client_members (client_id, name, email, password, role)
      VALUES (${req.user.sub}, ${body.name}, ${body.email}, ${hashed}, ${body.role})
      RETURNING id, name, email, role, is_active, created_at
    `
    return reply.code(201).send(member)
  })

  fastify.patch('/settings/team/:id', auth, async (req, reply) => {
    const body = z.object({
      role:      z.enum(['asesor', 'editor', 'viewer']).optional(),
      is_active: z.boolean().optional(),
    }).parse(req.body)

    const [member] = await sql`
      UPDATE client_members
      SET role      = COALESCE(${body.role ?? null}, role),
          is_active = COALESCE(${body.is_active ?? null}, is_active)
      WHERE id = ${req.params.id} AND client_id = ${req.user.sub}
      RETURNING id, name, email, role, is_active
    `
    if (!member) return reply.code(404).send({ error: 'Miembro no encontrado' })
    return member
  })

  fastify.delete('/settings/team/:id', auth, async (req, reply) => {
    const [member] = await sql`
      DELETE FROM client_members WHERE id = ${req.params.id} AND client_id = ${req.user.sub}
      RETURNING id
    `
    if (!member) return reply.code(404).send({ error: 'Miembro no encontrado' })
    return { deleted: true }
  })

  // ── PROXIES (anti-baneo) ────────────────────────────────────────────────────
  // Proveedores habilitados + configuración de proxy por celular Baileys.

  fastify.get('/settings/proxies', auth, async (req, reply) => {
    if (req.user.member_id) return reply.code(403).send({ error: 'Solo el administrador' })
    const [c] = await sql`
      SELECT proxy_iproxy_enabled, proxy_proxidize_enabled FROM clients WHERE id = ${req.user.sub}
    `
    const accounts = await sql`
      SELECT id, name, phone_number, proxy_provider, proxy_url, is_connected
      FROM whatsapp_accounts
      WHERE client_id = ${req.user.sub} AND provider = 'baileys'
      ORDER BY created_at DESC
    `
    return {
      iproxy_enabled:    !!c?.proxy_iproxy_enabled,
      proxidize_enabled: !!c?.proxy_proxidize_enabled,
      accounts,
    }
  })

  fastify.put('/settings/proxies', auth, async (req, reply) => {
    if (req.user.member_id) return reply.code(403).send({ error: 'Solo el administrador' })
    const body = z.object({
      iproxy_enabled:    z.boolean().optional(),
      proxidize_enabled: z.boolean().optional(),
    }).parse(req.body)

    const [c] = await sql`
      UPDATE clients SET
        proxy_iproxy_enabled    = COALESCE(${body.iproxy_enabled    ?? null}, proxy_iproxy_enabled),
        proxy_proxidize_enabled = COALESCE(${body.proxidize_enabled ?? null}, proxy_proxidize_enabled),
        updated_at = now()
      WHERE id = ${req.user.sub}
      RETURNING proxy_iproxy_enabled, proxy_proxidize_enabled
    `
    return { iproxy_enabled: !!c.proxy_iproxy_enabled, proxidize_enabled: !!c.proxy_proxidize_enabled }
  })

  // ── API KEYS ──────────────────────────────────────────────────────────────

  fastify.get('/settings/api-keys', auth, async (req) => {
    return sql`
      SELECT id, name, key_prefix, last_used_at, is_active, created_at
      FROM api_keys
      WHERE client_id = ${req.user.sub}
      ORDER BY created_at DESC
    `
  })

  fastify.post('/settings/api-keys', auth, async (req, reply) => {
    const body = z.object({ name: z.string().min(2) }).parse(req.body)

    const rawKey    = generateApiKey()
    const keyHash   = sha256(rawKey)
    const keyPrefix = rawKey.slice(0, 13) // "kubo_" + 8 chars

    const [apiKey] = await sql`
      INSERT INTO api_keys (client_id, name, key_hash, key_prefix)
      VALUES (${req.user.sub}, ${body.name}, ${keyHash}, ${keyPrefix})
      RETURNING id, name, key_prefix, created_at
    `

    // Devolver la clave completa UNA SOLA VEZ
    return reply.code(201).send({ ...apiKey, raw_key: rawKey })
  })

  fastify.delete('/settings/api-keys/:id', auth, async (req, reply) => {
    const [key] = await sql`
      DELETE FROM api_keys WHERE id = ${req.params.id} AND client_id = ${req.user.sub}
      RETURNING id
    `
    if (!key) return reply.code(404).send({ error: 'API Key no encontrada' })
    return { deleted: true }
  })
}
