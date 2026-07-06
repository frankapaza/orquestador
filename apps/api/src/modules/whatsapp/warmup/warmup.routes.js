import { z } from 'zod'
import { sql } from '../../../lib/db.js'
import { encrypt } from '../../../lib/crypto.js'
import { baileysManager } from '../baileys.manager.js'
import { getWarmupConfig, upsertWarmupConfig, todayLima, isActiveNow, convTargetForDay, activeElapsedFraction } from './warmup.service.js'
import { seedWarmupCatalog } from './catalog.seed.js'
import { recomputeRisk } from './risk.service.js'
import { generateCatalog, testAiConnection, AI_PRESETS, AI_MODEL_HINTS } from './ai.generator.js'
import { runTickForClient } from './warmup.scheduler.js'
import { drainWarmupJobs } from './warmup.queue.js'

// Nunca exponer la key cifrada al frontend; solo si existe.
function publicConfig(cfg) {
  const { ai_api_key_enc, ...rest } = cfg
  return { ...rest, has_ai_key: !!ai_api_key_enc }
}

function dayFromStart(startedAt, when) {
  if (!startedAt) return 1
  const elapsed = Math.floor((when.getTime() - new Date(startedAt).getTime()) / 86400000)
  return Math.max(1, elapsed + 1)
}

// Cupo de CONVERSACIONES liberado para un chip en el instante T (flujo continuo).
function convAllowedAt(cfg, startedAt, T) {
  const day = dayFromStart(startedAt, T)
  return Math.max(1, Math.ceil(convTargetForDay(cfg, day) * activeElapsedFraction(cfg, T)))
}

// Busca hacia adelante el próximo instante (real, para cuenta regresiva) en que
// un chip podrá conversar: dentro del horario activo Y con cupo disponible.
// Ojo: el cupo diario se reinicia a medianoche de Perú.
function nextSendAt(cfg, chips, now = new Date()) {
  const STEP = 10 * 60000            // resolución de búsqueda: 10 min
  const HORIZON = 8 * 24 * 3600000   // hasta 8 días
  const todayNow = todayLima(now)
  for (let t = STEP; t <= HORIZON; t += STEP) {
    const T = new Date(now.getTime() + t)
    if (!isActiveNow(cfg, T)) continue
    const sameDay = todayLima(T) === todayNow
    for (const c of chips) {
      const effSent = sameDay ? c.sent : 0   // el contador se reinicia otro día
      if (convAllowedAt(cfg, c.startedAt, T) - effSent > 0) return T
    }
  }
  return null
}

const timeStr = z.string().regex(/^\d{2}:\d{2}$/)

const configSchema = z.object({
  is_enabled:         z.boolean().optional(),
  warmup_days:        z.number().int().min(1).max(60).optional(),
  delay_min_sec:      z.number().int().min(5).optional(),
  delay_max_sec:      z.number().int().min(10).optional(),
  active_hours_start: timeStr.optional(),
  active_hours_end:   timeStr.optional(),
  active_days:        z.string().optional(),
  timezone:           z.string().max(64).optional(),
  ramp_start:         z.number().int().min(1).optional(),
  ramp_end:           z.number().int().min(1).optional(),
  ramp_mode:          z.enum(['linear', 'steps']).optional(),
  daily_cap:          z.number().int().min(1).optional(),
  internal_ratio:     z.number().min(0).max(1).optional(),
  simulate_typing:    z.boolean().optional(),
  mark_read:          z.boolean().optional(),
  conv_start:         z.number().int().min(1).optional(),
  conv_growth:        z.number().min(1).max(10).optional(),
  conv_cap:           z.number().int().min(1).optional(),
  allow_external:     z.boolean().optional(),
}).strict()

export async function warmupRoutes(fastify) {
  const pre = [fastify.authenticate]
  const adminOnly = (req, reply) => {
    if (req.user.member_id) { reply.code(403).send({ error: 'Solo el administrador' }); return false }
    return true
  }

  // ── Configuración global ─────────────────────────────────────────────────
  fastify.get('/whatsapp/warmup/config', { onRequest: pre }, async (req) => {
    return publicConfig(await getWarmupConfig(req.user.sub))
  })

  fastify.put('/whatsapp/warmup/config', { onRequest: pre }, async (req, reply) => {
    if (!adminOnly(req, reply)) return
    const patch = configSchema.parse(req.body)
    if (patch.delay_max_sec != null && patch.delay_min_sec != null && patch.delay_max_sec <= patch.delay_min_sec) {
      return reply.code(400).send({ error: 'delay_max_sec debe ser mayor que delay_min_sec' })
    }
    // Al habilitar el warmup por primera vez, sembrar el catálogo si está vacío.
    if (patch.is_enabled) await seedWarmupCatalog(req.user.sub).catch(() => {})
    return publicConfig(await upsertWarmupConfig(req.user.sub, patch))
  })

  // ── Control: Iniciar / Pausar / Detener ───────────────────────────────────
  // Iniciar: activa el warmup y dispara un tick INMEDIATO (encola conversaciones
  // ya, sin esperar el ciclo de 10 min). Sirve también para "generar ahora"
  // cuando se agregan chips nuevos.
  fastify.post('/whatsapp/warmup/start', { onRequest: pre }, async (req, reply) => {
    if (!adminOnly(req, reply)) return
    await upsertWarmupConfig(req.user.sub, { is_enabled: true })
    await seedWarmupCatalog(req.user.sub).catch(() => {})
    await runTickForClient(req.user.sub)
    return { ok: true, status: 'running' }
  })

  // Pausar: detiene el warmup pero conserva el progreso (día de rampa, selección).
  fastify.post('/whatsapp/warmup/pause', { onRequest: pre }, async (req, reply) => {
    if (!adminOnly(req, reply)) return
    await upsertWarmupConfig(req.user.sub, { is_enabled: false })
    return { ok: true, status: 'paused' }
  })

  // Detener: apaga el warmup, reinicia la rampa de los chips y vacía la cola.
  fastify.post('/whatsapp/warmup/stop', { onRequest: pre }, async (req, reply) => {
    if (!adminOnly(req, reply)) return
    await upsertWarmupConfig(req.user.sub, { is_enabled: false })
    await sql`
      UPDATE whatsapp_accounts
      SET warmup_started_at = null, warmup_day = 0
      WHERE client_id = ${req.user.sub} AND provider = 'baileys'
    `
    await drainWarmupJobs()
    return { ok: true, status: 'stopped' }
  })

  // ── Próxima conversación (estimación) ─────────────────────────────────────
  fastify.get('/whatsapp/warmup/next', { onRequest: pre }, async (req) => {
    const cfg = await getWarmupConfig(req.user.sub)
    if (!cfg.is_enabled) return { status: 'stopped', label: 'detenido' }

    const today = todayLima()
    const rows = await sql`
      SELECT wa.id, wa.instance_name, wa.warmup_started_at,
             COALESCE(s.warmup_conv, 0) AS sent
      FROM whatsapp_accounts wa
      LEFT JOIN warmup_daily_stats s ON s.account_id = wa.id AND s.stat_date = ${today}
      WHERE wa.client_id = ${req.user.sub} AND wa.provider = 'baileys'
        AND wa.warmup_enabled = true AND wa.banned_at IS NULL AND wa.phone_number IS NOT NULL
    `
    const connected = rows.filter(r => baileysManager.getStatus(r.instance_name) === 'connected')
    if (!connected.length) return { status: 'no_chips', label: 'sin chips conectados' }

    const chips = connected.map(r => ({ startedAt: r.warmup_started_at, sent: Number(r.sent) }))
    const now = new Date()

    // ¿Activo y con cupo ahora? → próxima ronda en el siguiente tick de 10 min.
    if (isActiveNow(cfg, now) && chips.some(c => convAllowedAt(cfg, c.startedAt, now) - c.sent > 0)) {
      const nextTick = new Date(Math.ceil((now.getTime() + 1000) / 600000) * 600000)
      return { status: 'soon', next_at: nextTick.toISOString() }
    }

    const at = nextSendAt(cfg, chips, now)
    if (!at) return { status: 'done', label: 'calentamiento por completar' }
    return { status: 'scheduled', next_at: at.toISOString() }
  })

  // ── Agente IA (generación del catálogo) ───────────────────────────────────
  fastify.get('/whatsapp/warmup/ai', { onRequest: pre }, async (req) => {
    const cfg = await getWarmupConfig(req.user.sub)
    return {
      ai_provider: cfg.ai_provider ?? 'openai',
      ai_model:    cfg.ai_model ?? '',
      ai_base_url: cfg.ai_base_url ?? '',
      has_ai_key:  !!cfg.ai_api_key_enc,
      ai_auto_weekly: !!cfg.ai_auto_weekly,
      presets:     AI_PRESETS,
      model_hints: AI_MODEL_HINTS,
    }
  })

  fastify.put('/whatsapp/warmup/ai', { onRequest: pre }, async (req, reply) => {
    if (!adminOnly(req, reply)) return
    const body = z.object({
      ai_provider: z.enum(['openai', 'deepseek', 'custom']),
      ai_model:    z.string().max(80).optional().nullable(),
      ai_base_url: z.string().max(200).optional().nullable(),
      api_key:     z.string().min(10).optional(),  // solo si se cambia
      ai_auto_weekly: z.boolean().optional(),
    }).parse(req.body)

    // Garantizar que exista la fila de config.
    await upsertWarmupConfig(req.user.sub, {})

    const keyUpdate  = body.api_key ? sql`, ai_api_key_enc = ${encrypt(body.api_key)}` : sql``
    const autoUpdate = body.ai_auto_weekly === undefined ? sql`` : sql`, ai_auto_weekly = ${body.ai_auto_weekly}`
    await sql`
      UPDATE warmup_config
      SET ai_provider = ${body.ai_provider},
          ai_model    = ${body.ai_model ?? null},
          ai_base_url = ${body.ai_base_url ?? null}
          ${keyUpdate}${autoUpdate},
          updated_at  = now()
      WHERE client_id = ${req.user.sub}
    `
    const cfg = await getWarmupConfig(req.user.sub)
    return { ai_provider: cfg.ai_provider, ai_model: cfg.ai_model, ai_base_url: cfg.ai_base_url, has_ai_key: !!cfg.ai_api_key_enc, ai_auto_weekly: !!cfg.ai_auto_weekly }
  })

  fastify.post('/whatsapp/warmup/ai/test', { onRequest: pre }, async (req, reply) => {
    if (!adminOnly(req, reply)) return
    try {
      const cfg = await getWarmupConfig(req.user.sub)
      return await testAiConnection(cfg)
    } catch (e) {
      return reply.code(400).send({ error: e.message })
    }
  })

  fastify.post('/whatsapp/warmup/catalog/generate', { onRequest: pre }, async (req, reply) => {
    if (!adminOnly(req, reply)) return
    const { count } = z.object({ count: z.number().int().min(1).max(50).default(20) }).parse(req.body ?? {})
    try {
      return await generateCatalog(req.user.sub, count)
    } catch (e) {
      return reply.code(400).send({ error: e.message })
    }
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
    const today = todayLima()

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

  // ── Visor de chat ─────────────────────────────────────────────────────────
  fastify.get('/whatsapp/warmup/chats', { onRequest: pre }, async (req) => {
    const rows = await sql`
      SELECT thread_key,
             max(created_at)                                    AS last_at,
             count(*)::int                                      AS msg_count,
             (array_agg(text      ORDER BY created_at DESC))[1] AS last_text,
             (array_agg(peer_kind ORDER BY created_at DESC))[1] AS peer_kind
      FROM warmup_messages
      WHERE client_id = ${req.user.sub}
      GROUP BY thread_key
      ORDER BY last_at DESC
      LIMIT 100
    `
    // Mapa teléfono(digits) → nombre de chip, para etiquetar los hilos.
    const chips = await sql`
      SELECT name, phone_number FROM whatsapp_accounts
      WHERE client_id = ${req.user.sub} AND phone_number IS NOT NULL
    `
    const nameByPhone = new Map(chips.map(c => [c.phone_number.replace(/\D/g, ''), c.name]))
    const labelFor = (digitsPhone) => nameByPhone.get(digitsPhone) ?? ('Externo +' + digitsPhone)

    return rows.map(r => {
      const [p1, p2] = r.thread_key.split('|')
      return {
        thread_key: r.thread_key,
        title:      `${labelFor(p1)} ↔ ${labelFor(p2)}`,
        last_text:  r.last_text,
        last_at:    r.last_at,
        msg_count:  r.msg_count,
        peer_kind:  r.peer_kind,
      }
    })
  })

  fastify.get('/whatsapp/warmup/chat', { onRequest: pre }, async (req) => {
    const { thread } = z.object({ thread: z.string().min(1) }).parse(req.query)
    // Traer los 500 mensajes MÁS RECIENTES (no los más antiguos) y devolverlos en
    // orden ascendente para mostrarlos. Si se ordenara ASC con LIMIT, en hilos con
    // +500 mensajes se cortaban los últimos y el mensaje nuevo no aparecía en el chat
    // aunque sí en la tarjeta (que usa max(created_at)).
    return sql`
      SELECT * FROM (
        SELECT m.id, m.from_account_id, wa.name AS from_name, m.peer_kind, m.text, m.created_at
        FROM warmup_messages m
        LEFT JOIN whatsapp_accounts wa ON wa.id = m.from_account_id
        WHERE m.client_id = ${req.user.sub} AND m.thread_key = ${thread}
        ORDER BY m.created_at DESC
        LIMIT 500
      ) t
      ORDER BY t.created_at ASC
    `
  })

  // ── Alertas ───────────────────────────────────────────────────────────────
  fastify.get('/whatsapp/warmup/alerts', { onRequest: pre }, async (req) => {
    return sql`
      SELECT al.id, al.account_id, al.level, al.reason, al.created_at, wa.name AS account_name
      FROM warmup_alerts al
      LEFT JOIN whatsapp_accounts wa ON wa.id = al.account_id
      WHERE al.client_id = ${req.user.sub} AND al.acknowledged = false
      ORDER BY al.created_at DESC
    `
  })

  fastify.post('/whatsapp/warmup/alerts/:id/ack', { onRequest: pre }, async (req, reply) => {
    if (!adminOnly(req, reply)) return
    await sql`
      UPDATE warmup_alerts SET acknowledged = true
      WHERE id = ${req.params.id} AND client_id = ${req.user.sub}
    `
    return { ok: true }
  })
}
