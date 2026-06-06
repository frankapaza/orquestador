import { z } from 'zod'
import { sql } from '../../lib/db.js'
import { AndroidSmsAdapter } from '../channels/adapters/android-sms.adapter.js'

const createSchema = z.object({
  name:               z.string().min(1),
  phone_number:       z.string().min(1),
  gateway_url:        z.string().url(),
  api_key:            z.string().optional(),
  daily_limit:        z.number().int().positive().default(100),
  delay_min:          z.number().int().min(0).default(5),
  delay_max:          z.number().int().min(0).default(15),
  active_hours_start: z.string().default('08:00'),
  active_hours_end:   z.string().default('20:00'),
  assigned_member_id: z.string().uuid().nullable().optional(),
})

export async function smsRoutes(fastify) {
  const pre = [fastify.authenticate]

  // Listar cuentas — asesores solo ven la suya
  fastify.get('/sms/accounts', { onRequest: pre }, async (req) => {
    if (req.user.member_id) {
      return sql`
        SELECT sa.id, sa.name, sa.phone_number, sa.gateway_url,
               sa.daily_limit, sa.sent_today, sa.delay_min, sa.delay_max,
               sa.active_hours_start, sa.active_hours_end,
               sa.is_online, sa.is_active, sa.last_used_at, sa.created_at,
               sa.assigned_member_id
        FROM sms_accounts sa
        WHERE sa.client_id = ${req.user.sub}
          AND sa.assigned_member_id = ${req.user.member_id}
        ORDER BY sa.created_at DESC
      `
    }
    return sql`
      SELECT sa.id, sa.name, sa.phone_number, sa.gateway_url,
             sa.daily_limit, sa.sent_today, sa.delay_min, sa.delay_max,
             sa.active_hours_start, sa.active_hours_end,
             sa.is_online, sa.is_active, sa.last_used_at, sa.created_at,
             sa.assigned_member_id,
             cm.name  AS assigned_member_name,
             cm.email AS assigned_member_email
      FROM sms_accounts sa
      LEFT JOIN client_members cm ON cm.id = sa.assigned_member_id
      WHERE sa.client_id = ${req.user.sub}
      ORDER BY sa.created_at DESC
    `
  })

  // Crear cuenta
  fastify.post('/sms/accounts', { onRequest: pre }, async (req, reply) => {
    if (req.user.member_id) return reply.code(403).send({ error: 'Solo el administrador puede crear cuentas' })
    const body = createSchema.parse(req.body)

    // Intentar ping al gateway antes de guardar
    const adapter = new AndroidSmsAdapter(body)
    let isOnline = false
    try { await adapter.ping(); isOnline = true } catch {}

    const [account] = await sql`
      INSERT INTO sms_accounts
        (client_id, name, phone_number, gateway_url, api_key,
         daily_limit, delay_min, delay_max, active_hours_start, active_hours_end,
         assigned_member_id, is_online)
      VALUES
        (${req.user.sub}, ${body.name}, ${body.phone_number}, ${body.gateway_url},
         ${body.api_key ?? null}, ${body.daily_limit}, ${body.delay_min}, ${body.delay_max},
         ${body.active_hours_start}, ${body.active_hours_end},
         ${body.assigned_member_id ?? null}, ${isOnline})
      RETURNING id, name, phone_number, gateway_url, daily_limit, delay_min, delay_max,
                active_hours_start, active_hours_end, is_online, is_active,
                assigned_member_id, created_at
    `
    return reply.code(201).send(account)
  })

  // Editar configuración técnica (solo admin)
  fastify.patch('/sms/accounts/:id', { onRequest: pre }, async (req, reply) => {
    if (req.user.member_id) return reply.code(403).send({ error: 'Solo el administrador puede editar cuentas' })
    const body = createSchema.omit({ assigned_member_id: true }).partial().parse(req.body)
    if (Object.keys(body).length === 0) return reply.code(400).send({ error: 'Nada que actualizar' })

    const [account] = await sql`
      UPDATE sms_accounts
      SET ${sql(body, ...Object.keys(body))}
      WHERE id = ${req.params.id} AND client_id = ${req.user.sub}
      RETURNING id, name, phone_number, gateway_url, daily_limit, delay_min, delay_max,
                active_hours_start, active_hours_end, is_online, is_active, assigned_member_id
    `
    if (!account) return reply.code(404).send({ error: 'Cuenta no encontrada' })
    return account
  })

  // Asignar cuenta a un miembro (solo admin)
  fastify.patch('/sms/accounts/:id/assign', { onRequest: pre }, async (req, reply) => {
    if (req.user.member_id) return reply.code(403).send({ error: 'Solo el administrador puede asignar cuentas' })
    const { member_id } = z.object({ member_id: z.string().uuid().nullable() }).parse(req.body)

    const [account] = await sql`
      UPDATE sms_accounts
      SET assigned_member_id = ${member_id}
      WHERE id = ${req.params.id} AND client_id = ${req.user.sub}
      RETURNING id, name, phone_number, assigned_member_id
    `
    if (!account) return reply.code(404).send({ error: 'Cuenta no encontrada' })
    return account
  })

  // Eliminar cuenta (solo admin)
  fastify.delete('/sms/accounts/:id', { onRequest: pre }, async (req, reply) => {
    if (req.user.member_id) return reply.code(403).send({ error: 'Solo el administrador puede eliminar cuentas' })
    const result = await sql`
      DELETE FROM sms_accounts
      WHERE id = ${req.params.id} AND client_id = ${req.user.sub}
    `
    if (result.count === 0) return reply.code(404).send({ error: 'Cuenta no encontrada' })
    return { ok: true }
  })

  // Verificar gateway (admin y asesor asignado)
  fastify.get('/sms/accounts/:id/ping', { onRequest: pre }, async (req, reply) => {
    const memberFilter = req.user.member_id
      ? sql`AND assigned_member_id = ${req.user.member_id}`
      : sql``

    const [account] = await sql`
      SELECT * FROM sms_accounts
      WHERE id = ${req.params.id} AND client_id = ${req.user.sub} ${memberFilter}
    `
    if (!account) return reply.code(404).send({ error: 'Cuenta no encontrada' })

    const adapter = new AndroidSmsAdapter(account)
    try {
      await adapter.ping()
      await sql`UPDATE sms_accounts SET is_online = true WHERE id = ${req.params.id}`
      return { online: true }
    } catch {
      await sql`UPDATE sms_accounts SET is_online = false WHERE id = ${req.params.id}`
      return { online: false }
    }
  })

  // Enviar SMS puntual
  fastify.post('/sms/send', { onRequest: pre }, async (req, reply) => {
    const body = z.object({
      account_id: z.string().uuid(),
      to:         z.string().min(1),
      body:       z.string().min(1),
    }).parse(req.body)

    const [account] = await sql`
      SELECT * FROM sms_accounts
      WHERE id = ${body.account_id} AND client_id = ${req.user.sub} AND is_active = true
    `
    if (!account) return reply.code(404).send({ error: 'Cuenta no encontrada' })

    const adapter = new AndroidSmsAdapter(account)
    const result = await adapter.send({ to: body.to, body: body.body })
    await sql`UPDATE sms_accounts SET last_used_at = now() WHERE id = ${body.account_id}`
    return result
  })
}
