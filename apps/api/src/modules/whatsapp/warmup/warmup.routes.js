import { z } from 'zod'
import { sql } from '../../../lib/db.js'
import { baileysManager } from '../baileys.manager.js'
import { getWarmupConfig, upsertWarmupConfig } from './warmup.service.js'
import { seedWarmupCatalog } from './catalog.seed.js'
import { recomputeRisk } from './risk.service.js'

const timeStr = z.string().regex(/^\d{2}:\d{2}$/)

const configSchema = z.object({
  is_enabled:         z.boolean().optional(),
  warmup_days:        z.number().int().min(1).max(60).optional(),
  delay_min_sec:      z.number().int().min(5).optional(),
  delay_max_sec:      z.number().int().min(10).optional(),
  active_hours_start: timeStr.optional(),
  active_hours_end:   timeStr.optional(),
  active_days:        z.string().optional(),
  ramp_start:         z.number().int().min(1).optional(),
  ramp_end:           z.number().int().min(1).optional(),
  ramp_mode:          z.enum(['linear', 'steps']).optional(),
  daily_cap:          z.number().int().min(1).optional(),
  internal_ratio:     z.number().min(0).max(1).optional(),
  simulate_typing:    z.boolean().optional(),
  mark_read:          z.boolean().optional(),
}).strict()

export async function warmupRoutes(fastify) {
  const pre = [fastify.authenticate]
  const adminOnly = (req, reply) => {
    if (req.user.member_id) { reply.code(403).send({ error: 'Solo el administrador' }); return false }
    return true
  }

  // ── Configuración global ─────────────────────────────────────────────────
  fastify.get('/whatsapp/warmup/config', { onRequest: pre }, async (req) => {
    return getWarmupConfig(req.user.sub)
  })

  fastify.put('/whatsapp/warmup/config', { onRequest: pre }, async (req, reply) => {
    if (!adminOnly(req, reply)) return
    const patch = configSchema.parse(req.body)
    if (patch.delay_max_sec != null && patch.delay_min_sec != null && patch.delay_max_sec <= patch.delay_min_sec) {
      return reply.code(400).send({ error: 'delay_max_sec debe ser mayor que delay_min_sec' })
    }
    // Al habilitar el warmup por primera vez, sembrar el catálogo si está vacío.
    if (patch.is_enabled) await seedWarmupCatalog(req.user.sub).catch(() => {})
    return upsertWarmupConfig(req.user.sub, patch)
  })

  // ── Toggle / override por chip ────────────────────────────────────────────
  fastify.patch('/whatsapp/accounts/:id/warmup', { onRequest: pre }, async (req, reply) => {
    if (!adminOnly(req, reply)) return
    const body = z.object({
      warmup_enabled: z.boolean().optional(),
      overrides:      z.record(z.any()).nullable().optional(),
    }).parse(req.body)

    const [acc] = await sql`
      SELECT * FROM whatsapp_accounts WHERE id = ${req.params.id} AND client_id = ${req.user.sub}
    `
    if (!acc) return reply.code(404).send({ error: 'Cuenta no encontrada' })
    if (acc.banned_at && body.warmup_enabled) {
      return reply.code(400).send({ error: 'Chip marcado como baneado; no se puede calentar' })
    }

    // Al activar, reiniciar el ciclo (día 1) para que la rampa arranque limpia.
    const resetCycle = body.warmup_enabled === true && !acc.warmup_enabled
    // Solo tocamos warmup_overrides si vino en el body (evita reescribir jsonb).
    const overridesSet = body.overrides === undefined
      ? sql``
      : sql`, warmup_overrides = ${body.overrides ? sql.json(body.overrides) : null}`

    const [row] = await sql`
      UPDATE whatsapp_accounts
      SET warmup_enabled = ${body.warmup_enabled ?? acc.warmup_enabled}
          ${overridesSet}
          ${resetCycle ? sql`, warmup_started_at = null, warmup_day = 0` : sql``}
      WHERE id = ${req.params.id}
      RETURNING id, warmup_enabled, warmup_day, warmup_overrides
    `
    if (body.warmup_enabled) await seedWarmupCatalog(req.user.sub).catch(() => {})
    return row
  })

  // ── Estado del warmup por chip ────────────────────────────────────────────
  fastify.get('/whatsapp/warmup/status', { onRequest: pre }, async (req) => {
    const memberFilter = req.user.member_id ? sql`AND wa.assigned_member_id = ${req.user.member_id}` : sql``
    const today = new Date().toISOString().slice(0, 10)

    const rows = await sql`
      SELECT wa.id, wa.name, wa.phone_number, wa.instance_name,
             wa.warmup_enabled, wa.warmup_day, wa.warmup_started_at,
             wa.risk_level, wa.risk_score, wa.risk_checked_at,
             wa.banned_at, wa.ban_reason,
             COALESCE(s.warmup_sent, 0)     AS sent_today,
             COALESCE(s.warmup_received, 0) AS received_today
      FROM whatsapp_accounts wa
      LEFT JOIN warmup_daily_stats s ON s.account_id = wa.id AND s.stat_date = ${today}
      WHERE wa.client_id = ${req.user.sub} AND wa.provider = 'baileys' ${memberFilter}
      ORDER BY wa.created_at DESC
    `
    return rows.map(r => ({ ...r, connected: baileysManager.getStatus(r.instance_name) === 'connected' }))
  })

  // ── Riesgo ────────────────────────────────────────────────────────────────
  fastify.post('/whatsapp/warmup/risk/recompute', { onRequest: pre }, async (req, reply) => {
    if (!adminOnly(req, reply)) return
    const results = await recomputeRisk(req.user.sub)
    return { updated: results.length, results }
  })

  // ── Catálogo de conversaciones ────────────────────────────────────────────
  fastify.get('/whatsapp/warmup/catalog', { onRequest: pre }, async (req) => {
    return sql`
      SELECT id, topic, lang, turns, source, is_active, created_at
      FROM warmup_conversations
      WHERE (client_id = ${req.user.sub} OR client_id IS NULL)
      ORDER BY created_at DESC
    `
  })

  fastify.post('/whatsapp/warmup/catalog/seed', { onRequest: pre }, async (req, reply) => {
    if (!adminOnly(req, reply)) return
    return seedWarmupCatalog(req.user.sub)
  })

  fastify.post('/whatsapp/warmup/catalog', { onRequest: pre }, async (req, reply) => {
    if (!adminOnly(req, reply)) return
    const body = z.object({
      topic: z.string().min(1),
      lang:  z.string().default('es'),
      turns: z.array(z.object({ from: z.enum(['a', 'b']), text: z.string().min(1) })).min(2),
    }).parse(req.body)

    const [row] = await sql`
      INSERT INTO warmup_conversations (client_id, topic, lang, turns, source)
      VALUES (${req.user.sub}, ${body.topic}, ${body.lang}, ${sql.json(body.turns)}, 'manual')
      RETURNING id, topic, lang, turns, source, is_active, created_at
    `
    return reply.code(201).send(row)
  })

  fastify.delete('/whatsapp/warmup/catalog/:id', { onRequest: pre }, async (req, reply) => {
    if (!adminOnly(req, reply)) return
    await sql`
      DELETE FROM warmup_conversations
      WHERE id = ${req.params.id} AND client_id = ${req.user.sub}
    `
    return { ok: true }
  })
}
