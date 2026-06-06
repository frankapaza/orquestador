import { z } from 'zod'
import { sql } from '../../lib/db.js'
import { EvolutionAdapter } from '../channels/adapters/evolution.adapter.js'
import { baileysManager } from './baileys.manager.js'

const createSchema = z.object({
  provider:           z.enum(['baileys', 'evolution']).default('baileys'),
  name:               z.string().min(1),
  instance_name:      z.string().min(1).regex(/^[a-z0-9_-]+$/, 'Solo letras minúsculas, números y guiones. Ej: mi-numero'),
  phone_number:       z.string().min(6).optional(),
  daily_limit:        z.number().int().positive().default(200),
  delay_min:          z.number().int().min(0).default(10),
  delay_max:          z.number().int().min(0).default(30),
  active_hours_start: z.string().default('08:00'),
  active_hours_end:   z.string().default('20:00'),
  role:               z.enum(['advisor', 'campaign']).default('campaign'),
  assigned_member_id: z.string().uuid().nullable().optional(),
  // Evolution API (opcionales, requeridos solo si provider=evolution)
  evolution_url:      z.string().url().optional(),
  evolution_api_key:  z.string().optional(),
}).refine(d => d.provider !== 'evolution' || (d.evolution_url && d.evolution_api_key), {
  message: 'Para Evolution API se requiere URL y API Key',
})

export async function whatsappRoutes(fastify) {
  const pre = [fastify.authenticate]

  // Listar cuentas
  fastify.get('/whatsapp/accounts', { onRequest: pre }, async (req) => {
    const memberFilter = req.user.member_id
      ? sql`AND wa.assigned_member_id = ${req.user.member_id}`
      : sql``

    const accounts = await sql`
      SELECT wa.id, wa.name, wa.phone_number, wa.instance_name,
             wa.evolution_url, wa.provider,
             wa.daily_limit, wa.sent_today, wa.delay_min, wa.delay_max,
             wa.active_hours_start, wa.active_hours_end,
             wa.is_connected, wa.role, wa.is_active, wa.last_used_at, wa.created_at,
             wa.assigned_member_id,
             cm.name  AS assigned_member_name,
             cm.email AS assigned_member_email
      FROM whatsapp_accounts wa
      LEFT JOIN client_members cm ON cm.id = wa.assigned_member_id
      WHERE wa.client_id = ${req.user.sub} ${memberFilter}
      ORDER BY wa.created_at DESC
    `

    // Para cuentas Baileys, enriquecer con estado en tiempo real
    return accounts.map(acc => {
      if (acc.provider !== 'baileys') return acc
      const status = baileysManager.getStatus(acc.instance_name)
      return {
        ...acc,
        is_connected: status === 'connected',
        baileys_status: status,
      }
    })
  })

  // Crear cuenta
  fastify.post('/whatsapp/accounts', { onRequest: pre }, async (req, reply) => {
    if (req.user.member_id) return reply.code(403).send({ error: 'Solo el administrador puede crear cuentas' })

    const body = createSchema.parse(req.body)

    const [existing] = await sql`
      SELECT id FROM whatsapp_accounts
      WHERE client_id = ${req.user.sub} AND instance_name = ${body.instance_name}
    `
    if (existing) return reply.code(409).send({ error: 'Ya existe una cuenta con ese nombre de instancia' })

    // Para Evolution API, crear instancia en el servidor remoto
    if (body.provider === 'evolution') {
      const adapter = new EvolutionAdapter({ ...body, instance_name: body.instance_name })
      try { await adapter.createInstance() } catch (err) {
        if (!err.message?.includes('already')) throw err
      }
    }

    const [account] = await sql`
      INSERT INTO whatsapp_accounts
        (client_id, name, instance_name, provider,
         phone_number,
         evolution_url, evolution_api_key,
         daily_limit, delay_min, delay_max,
         active_hours_start, active_hours_end,
         role, assigned_member_id)
      VALUES
        (${req.user.sub}, ${body.name}, ${body.instance_name}, ${body.provider},
         ${body.phone_number ?? null},
         ${body.evolution_url ?? null}, ${body.evolution_api_key ?? null},
         ${body.daily_limit}, ${body.delay_min}, ${body.delay_max},
         ${body.active_hours_start}, ${body.active_hours_end},
         ${body.role}, ${body.assigned_member_id ?? null})
      RETURNING *
    `

    // Iniciar sesión Baileys automáticamente
    if (body.provider === 'baileys') {
      baileysManager.startSession(account).catch(() => {})
    }

    return reply.code(201).send(account)
  })

  // Editar
  fastify.patch('/whatsapp/accounts/:id', { onRequest: pre }, async (req, reply) => {
    if (req.user.member_id) return reply.code(403).send({ error: 'Solo el administrador puede editar cuentas' })
    const schema = z.object({
      name:               z.string().min(1).optional(),
      daily_limit:        z.number().int().positive().optional(),
      delay_min:          z.number().int().min(0).optional(),
      delay_max:          z.number().int().min(0).optional(),
      active_hours_start: z.string().optional(),
      active_hours_end:   z.string().optional(),
      role:               z.enum(['advisor', 'campaign']).optional(),
      is_active:          z.boolean().optional(),
    })
    const body = schema.parse(req.body)
    if (!Object.keys(body).length) return reply.code(400).send({ error: 'Nada que actualizar' })

    const [account] = await sql`
      UPDATE whatsapp_accounts
      SET ${sql(body, ...Object.keys(body))}
      WHERE id = ${req.params.id} AND client_id = ${req.user.sub}
      RETURNING *
    `
    if (!account) return reply.code(404).send({ error: 'Cuenta no encontrada' })
    return account
  })

  // Asignar miembro (solo admin)
  fastify.patch('/whatsapp/accounts/:id/assign', { onRequest: pre }, async (req, reply) => {
    if (req.user.member_id) return reply.code(403).send({ error: 'Solo el administrador puede asignar cuentas' })
    const { member_id } = z.object({ member_id: z.string().uuid().nullable() }).parse(req.body)
    const [account] = await sql`
      UPDATE whatsapp_accounts SET assigned_member_id = ${member_id}
      WHERE id = ${req.params.id} AND client_id = ${req.user.sub}
      RETURNING id, name, assigned_member_id
    `
    if (!account) return reply.code(404).send({ error: 'Cuenta no encontrada' })
    return account
  })

  // Eliminar
  fastify.delete('/whatsapp/accounts/:id', { onRequest: pre }, async (req, reply) => {
    if (req.user.member_id) return reply.code(403).send({ error: 'Solo el administrador puede eliminar cuentas' })
    const [account] = await sql`
      SELECT * FROM whatsapp_accounts
      WHERE id = ${req.params.id} AND client_id = ${req.user.sub}
    `
    if (!account) return reply.code(404).send({ error: 'Cuenta no encontrada' })

    if (account.provider === 'baileys') {
      await baileysManager.stopSession(account.instance_name)
    } else if (account.provider === 'evolution') {
      const adapter = new EvolutionAdapter(account)
      try { await adapter.deleteInstance() } catch {}
    }

    await sql`DELETE FROM whatsapp_accounts WHERE id = ${req.params.id}`
    return { ok: true }
  })

  // ── Vinculación Baileys ───────────────────────────────────────────────────────

  // Solicitar código de emparejamiento por número (alternativa al QR)
  fastify.post('/whatsapp/accounts/:id/pairing-code', { onRequest: pre }, async (req, reply) => {
    const [account] = await sql`SELECT * FROM whatsapp_accounts WHERE id = ${req.params.id} AND client_id = ${req.user.sub}`
    if (!account) return reply.code(404).send({ error: 'Cuenta no encontrada' })
    if (account.provider !== 'baileys') return reply.code(400).send({ error: 'Solo disponible para cuentas Baileys' })

    const { phone_number } = z.object({ phone_number: z.string().min(6) }).parse(req.body)

    // Guardar número y limpiar sesión anterior para empezar limpio
    await sql`UPDATE whatsapp_accounts SET phone_number = ${phone_number} WHERE id = ${req.params.id}`
    await baileysManager.deleteSession(account.instance_name)

    // Iniciar sesión fresca con pairing code
    const updated = { ...account, phone_number }
    baileysManager.startSession(updated, { usePairingCode: true }).catch(() => {})

    // Esperar código hasta 30s (WhatsApp puede tardar en responder)
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 500))
      const code = baileysManager.getPairingCode(account.instance_name)
      if (code) return { pairing_code: code }
      const status = baileysManager.getStatus(account.instance_name)
      // Si llegó a QR es que falló el código, devolver lo que hay
      if (status === 'qr') {
        return reply.code(400).send({ error: 'WhatsApp no aceptó el código de emparejamiento. Intenta con el método QR.' })
      }
      if (status === 'error') {
        const err = baileysManager.getError(account.instance_name)
        return reply.code(400).send({ error: err ?? 'Error al generar código' })
      }
    }
    return reply.code(504).send({ error: 'Tiempo de espera agotado. Intenta de nuevo.' })
  })

  // Reconectar sesión Baileys sin borrar credenciales (para cuando aparece "Sin conectar")
  fastify.post('/whatsapp/accounts/:id/reconnect', { onRequest: pre }, async (req, reply) => {
    const [account] = await sql`SELECT * FROM whatsapp_accounts WHERE id = ${req.params.id} AND client_id = ${req.user.sub}`
    if (!account) return reply.code(404).send({ error: 'Cuenta no encontrada' })
    if (account.provider !== 'baileys') return reply.code(400).send({ error: 'Solo para cuentas Baileys' })

    // Detener sesión actual sin borrar credenciales
    await baileysManager.stopSession(account.instance_name)
    // Reiniciar — si hay credenciales guardadas reconecta automáticamente sin QR
    baileysManager.startSession(account).catch(() => {})

    return { ok: true, message: 'Reconectando... espera unos segundos y verifica el estado.' }
  })

  // Desconectar y limpiar sesión Baileys (permite re-vincular)
  fastify.post('/whatsapp/accounts/:id/disconnect', { onRequest: pre }, async (req, reply) => {
    const [account] = await sql`SELECT * FROM whatsapp_accounts WHERE id = ${req.params.id} AND client_id = ${req.user.sub}`
    if (!account) return reply.code(404).send({ error: 'Cuenta no encontrada' })
    if (account.provider !== 'baileys') return reply.code(400).send({ error: 'Solo para cuentas Baileys' })

    await baileysManager.deleteSession(account.instance_name)
    // Reiniciar sesión limpia para generar nuevo QR
    baileysManager.startSession(account).catch(() => {})
    return { ok: true, message: 'Sesión cerrada. Escanea el nuevo QR para vincular.' }
  })

  // ── QR ───────────────────────────────────────────────────────────────────────

  fastify.get('/whatsapp/accounts/:id/qr', { onRequest: pre }, async (req, reply) => {
    const memberFilter = req.user.member_id
      ? sql`AND assigned_member_id = ${req.user.member_id}`
      : sql``

    const [account] = await sql`
      SELECT * FROM whatsapp_accounts
      WHERE id = ${req.params.id} AND client_id = ${req.user.sub} ${memberFilter}
    `
    if (!account) return reply.code(404).send({ error: 'Cuenta no encontrada' })

    if (account.provider === 'baileys') {
      const status      = baileysManager.getStatus(account.instance_name)
      const qrBase64    = baileysManager.getQr(account.instance_name)
      const pairingCode = baileysManager.getPairingCode(account.instance_name)

      if (status === 'connected') return { status: 'connected', is_connected: true }
      if (status === 'not_started') {
        baileysManager.startSession(account).catch(() => {})
        return { status: 'starting', is_connected: false, qrBase64: null }
      }
      return { status, is_connected: false, qrBase64, pairingCode }
    }

    // Evolution API
    const adapter = new EvolutionAdapter(account)
    const data    = await adapter.getQr()
    return { ...data, status: 'qr', provider: 'evolution' }
  })

  // Estado de conexión
  fastify.get('/whatsapp/accounts/:id/status', { onRequest: pre }, async (req, reply) => {
    const memberFilter = req.user.member_id
      ? sql`AND assigned_member_id = ${req.user.member_id}`
      : sql``

    const [account] = await sql`
      SELECT * FROM whatsapp_accounts
      WHERE id = ${req.params.id} AND client_id = ${req.user.sub} ${memberFilter}
    `
    if (!account) return reply.code(404).send({ error: 'Cuenta no encontrada' })

    if (account.provider === 'baileys') {
      const status    = baileysManager.getStatus(account.instance_name)
      const connected = status === 'connected'
      await sql`UPDATE whatsapp_accounts SET is_connected = ${connected} WHERE id = ${req.params.id}`
      return { status, is_connected: connected, provider: 'baileys' }
    }

    const adapter   = new EvolutionAdapter(account)
    const data      = await adapter.getStatus()
    const connected = data?.instance?.state === 'open'
    await sql`UPDATE whatsapp_accounts SET is_connected = ${connected} WHERE id = ${req.params.id}`
    return { ...data, is_connected: connected, provider: 'evolution' }
  })

  // Envío puntual
  fastify.post('/whatsapp/send', { onRequest: pre }, async (req, reply) => {
    const body = z.object({
      account_id:    z.string().uuid(),
      to:            z.string().min(1),
      body:          z.string().optional(),
      media_url:     z.string().url().optional(),
      media_type:    z.string().optional(),
      media_caption: z.string().optional(),
    }).parse(req.body)

    const [account] = await sql`
      SELECT * FROM whatsapp_accounts
      WHERE id = ${body.account_id} AND client_id = ${req.user.sub} AND is_active = true
    `
    if (!account) return reply.code(404).send({ error: 'Cuenta no encontrada' })

    let result
    if (account.provider === 'baileys') {
      result = await baileysManager.send(account.instance_name, body)
    } else {
      const adapter = new EvolutionAdapter(account)
      result = await adapter.send(body)
    }

    await sql`UPDATE whatsapp_accounts SET last_used_at = now() WHERE id = ${body.account_id}`
    return result
  })
}
