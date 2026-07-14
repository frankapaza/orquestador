import { z } from 'zod'
import { sql } from '../../lib/db.js'
import { env } from '../../config/env.js'
import { AndroidSmsAdapter } from '../channels/adapters/android-sms.adapter.js'

// URL pública a la que el gateway debe reenviar los SMS entrantes de esta cuenta.
function webhookUrlFor(accountId) {
  return `${env.TRACKING_BASE_URL.replace(/\/$/, '')}/webhooks/sms/${accountId}`
}

// Eventos que registramos en el gateway para CADA cuenta SMS (automático al
// crear/editar). 'received' = SMS entrantes; 'sent'/'delivered'/'failed' = estado
// de entrega real → así el inbox muestra si el SMS se entregó o falló en el operador.
const SMS_WEBHOOK_EVENTS = ['sms:received', 'sms:sent', 'sms:delivered', 'sms:failed']

// Registra (best-effort) los webhooks de SMS en el gateway de la cuenta.
// No lanza: si el gateway está offline o falla, solo se loguea — el alta/edición
// de la cuenta no debe romperse por esto. registerWebhook es idempotente.
async function syncIncomingWebhook(fastify, account) {
  try {
    const adapter = new AndroidSmsAdapter(account)
    for (const ev of SMS_WEBHOOK_EVENTS) {
      await adapter.registerWebhook(webhookUrlFor(account.id), ev)
    }
    fastify.log.info(`[SMS] Webhooks (entrante + estado de entrega) registrados en gateway para cuenta ${account.id}`)
  } catch (err) {
    fastify.log.warn({ err }, `[SMS] No se pudieron registrar los webhooks para cuenta ${account.id}`)
  }
}

// Borra (best-effort) el webhook de SMS entrante del gateway de la cuenta.
async function removeIncomingWebhook(fastify, account) {
  try {
    const adapter = new AndroidSmsAdapter(account)
    await adapter.deleteWebhookByUrl(webhookUrlFor(account.id))
    fastify.log.info(`[SMS] Webhook entrante eliminado del gateway para cuenta ${account.id}`)
  } catch (err) {
    fastify.log.warn({ err }, `[SMS] No se pudo eliminar el webhook entrante para cuenta ${account.id}`)
  }
}

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
    const rows = req.user.member_id
      ? await sql`
          SELECT sa.id, sa.name, sa.phone_number, sa.gateway_url, sa.api_key,
                 sa.daily_limit, sa.sent_today, sa.delay_min, sa.delay_max,
                 sa.active_hours_start, sa.active_hours_end,
                 sa.is_online, sa.is_active, sa.last_used_at, sa.created_at,
                 sa.assigned_member_id
          FROM sms_accounts sa
          WHERE sa.client_id = ${req.user.sub}
            AND sa.assigned_member_id = ${req.user.member_id}
          ORDER BY sa.created_at DESC
        `
      : await sql`
          SELECT sa.id, sa.name, sa.phone_number, sa.gateway_url, sa.api_key,
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

    // Alerta de credenciales duplicadas: varias cuentas con la MISMA api_key (+gateway)
    // apuntan al MISMO teléfono físico → todas envían desde el mismo SIM (fuente de
    // confusión: el SMS sale de otro número). Se marca para avisarlo en la UI.
    // La api_key NUNCA se expone en la respuesta.
    const byKey = new Map()
    for (const a of rows) {
      if (!a.api_key) continue
      const k = `${a.gateway_url}::${a.api_key}`
      if (!byKey.has(k)) byKey.set(k, [])
      byKey.get(k).push(a)
    }
    return rows.map(a => {
      const group = a.api_key ? byKey.get(`${a.gateway_url}::${a.api_key}`) : null
      const shares_with = group && group.length > 1 ? group.filter(x => x.id !== a.id).map(x => x.name) : []
      const { api_key, ...rest } = a
      return { ...rest, shares_apikey: shares_with.length > 0, shares_with }
    })
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

    // Registrar el webhook de SMS entrante en el gateway automáticamente.
    await syncIncomingWebhook(fastify, { id: account.id, gateway_url: body.gateway_url, api_key: body.api_key ?? null })

    return reply.code(201).send(account)
  })

  // Editar configuración técnica (solo admin)
  fastify.patch('/sms/accounts/:id', { onRequest: pre }, async (req, reply) => {
    if (req.user.member_id) return reply.code(403).send({ error: 'Solo el administrador puede editar cuentas' })
    const body = createSchema.omit({ assigned_member_id: true }).partial().parse(req.body)
    // api_key = '' (cadena vacía explícita) → limpiar la credencial (cuenta sin auth).
    // Nota: omitirla del body = "no tocar" (conserva la actual); esto es lo contrario.
    if (body.api_key === '') body.api_key = null
    if (Object.keys(body).length === 0) return reply.code(400).send({ error: 'Nada que actualizar' })

    const [account] = await sql`
      UPDATE sms_accounts
      SET ${sql(body, ...Object.keys(body))}
      WHERE id = ${req.params.id} AND client_id = ${req.user.sub}
      RETURNING id, name, phone_number, gateway_url, daily_limit, delay_min, delay_max,
                active_hours_start, active_hours_end, is_online, is_active, assigned_member_id
    `
    if (!account) return reply.code(404).send({ error: 'Cuenta no encontrada' })

    // Si cambió la conexión al gateway (URL o credenciales), re-registrar el webhook.
    if (body.gateway_url !== undefined || body.api_key !== undefined) {
      const [full] = await sql`
        SELECT id, gateway_url, api_key FROM sms_accounts WHERE id = ${req.params.id}
      `
      if (full) await syncIncomingWebhook(fastify, full)
    }

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

    // Leer la cuenta antes de borrarla para poder limpiar su webhook en el gateway.
    const [account] = await sql`
      SELECT id, gateway_url, api_key FROM sms_accounts
      WHERE id = ${req.params.id} AND client_id = ${req.user.sub}
    `
    if (!account) return reply.code(404).send({ error: 'Cuenta no encontrada' })

    await removeIncomingWebhook(fastify, account)

    await sql`
      DELETE FROM sms_accounts
      WHERE id = ${req.params.id} AND client_id = ${req.user.sub}
    `
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

  // Registrar / reintentar el webhook de SMS entrante en el gateway (NO silencioso,
  // a diferencia del registro automático al crear/editar). Devuelve la URL que quedó
  // registrada y el listado actual del gateway → sirve para diagnosticar por qué no
  // llegan SMS entrantes (URL apuntando a localhost, gateway offline, credenciales, etc.).
  fastify.post('/sms/accounts/:id/webhook/register', { onRequest: pre }, async (req, reply) => {
    if (req.user.member_id) return reply.code(403).send({ error: 'Solo el administrador puede registrar el webhook' })

    const [account] = await sql`
      SELECT id, gateway_url, api_key FROM sms_accounts
      WHERE id = ${req.params.id} AND client_id = ${req.user.sub}
    `
    if (!account) return reply.code(404).send({ error: 'Cuenta no encontrada' })

    const url = webhookUrlFor(account.id)
    const adapter = new AndroidSmsAdapter(account)
    try {
      for (const ev of SMS_WEBHOOK_EVENTS) await adapter.registerWebhook(url, ev)
      const registered = await adapter.listWebhooks().catch(() => [])
      return { ok: true, url, events: SMS_WEBHOOK_EVENTS, registered }
    } catch (err) {
      return reply.code(502).send({ ok: false, url, error: err.message, status: err.status ?? null })
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
