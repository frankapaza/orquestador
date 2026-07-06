import { sql } from '../../../lib/db.js'
import { baileysManager } from '../baileys.manager.js'
import { enqueueWarmupTurn } from './warmup.queue.js'
import { varyText } from './catalog.seed.js'
import {
  getWarmupConfig, effectiveConfig, isActiveNow,
  convTargetForDay, activeElapsedFraction, convSentTodayFor,
  getActiveConversations, markConversationUsed, randomDelayMs,
  recordWarmupSent, recordWarmupConv, threadKeyFor,
} from './warmup.service.js'

const MAX_CONV_PER_TICK = 6            // tope de conversaciones que un chip arranca por tick
const TICK_SPREAD_MS     = 9 * 60000   // reparte los arranques dentro del tick (flujo continuo)

const digits = p => (p ?? '').replace(/\D/g, '')
const randInt = n => Math.floor(Math.random() * n)
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(i + 1)
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

// Largo variable de conversación: reproduce de 2 turnos hasta todos (a veces
// termina antes) para que la cantidad de mensajes cambie entre conversaciones.
function variableTurns(turns) {
  if (!Array.isArray(turns) || turns.length <= 2) return turns || []
  const k = 2 + randInt(turns.length - 1)  // 2..turns.length
  return turns.slice(0, k)
}

// Día actual de calentamiento del chip. Inicializa started_at si es la 1ª vez.
// Si ya superó warmup_days, marca el warmup como terminado y devuelve null.
async function ensureWarmupDay(chip, cfg) {
  if (!chip.warmup_started_at) {
    await sql`UPDATE whatsapp_accounts SET warmup_started_at = now(), warmup_day = 1 WHERE id = ${chip.id}`
    chip.warmup_started_at = new Date().toISOString()
    return 1
  }
  const started = new Date(chip.warmup_started_at)
  const elapsed = Math.floor((Date.now() - started.getTime()) / 86400000)
  const day     = elapsed + 1
  if (day > (cfg.warmup_days ?? 7)) {
    await sql`UPDATE whatsapp_accounts SET warmup_enabled = false WHERE id = ${chip.id}`
    return null
  }
  if (day !== chip.warmup_day) {
    await sql`UPDATE whatsapp_accounts SET warmup_day = ${day} WHERE id = ${chip.id}`
  }
  return day
}

async function pickExternalPhone(clientId) {
  const [row] = await sql`
    SELECT (COALESCE(cp.phone_dial, '') || cp.phone) AS phone
    FROM contacts c
    JOIN contact_phones cp ON cp.contact_id = c.id
    WHERE c.client_id = ${clientId} AND c.is_subscribed = true
      AND cp.phone IS NOT NULL AND cp.phone <> ''
    ORDER BY random() LIMIT 1
  `
  return row?.phone ?? null
}

// Reproduce una conversación entre dos chips internos (ambos envían). a y b son
// filas de whatsapp_accounts. startOffset escalona el arranque dentro del tick.
async function playInternal(a, b, conv, cfg, startOffset) {
  const turns = variableTurns(conv.turns)
  let delay = startOffset + randomDelayMs(cfg)
  for (const turn of turns) {
    const isA = turn.from === 'a'
    const sender   = isA ? a : b
    const receiver = isA ? b : a
    await enqueueWarmupTurn({
      fromInstance:   sender.instance_name,
      fromAccountId:  sender.id,
      toPhone:        digits(receiver.phone_number),
      text:           varyText(turn.text),
      simulateTyping: cfg.simulate_typing !== false,
      markRead:       cfg.mark_read !== false,
      peerPhone:      digits(receiver.phone_number),
      peerName:       receiver.name,
      toAccountId:    receiver.id,
      peerKind:       'internal',
      threadKey:      threadKeyFor(sender.phone_number, receiver.phone_number),
    }, delay)
    await recordWarmupSent(sender.id)
    delay += randomDelayMs(cfg)
  }
}

// Reproduce solo los turnos salientes hacia un número externo real.
async function playExternal(a, phone, conv, cfg, startOffset) {
  const turns = variableTurns(conv.turns)
  let delay = startOffset + randomDelayMs(cfg)
  for (const turn of turns) {
    if (turn.from !== 'a') continue
    await enqueueWarmupTurn({
      fromInstance:   a.instance_name,
      fromAccountId:  a.id,
      toPhone:        digits(phone),
      text:           varyText(turn.text),
      simulateTyping: cfg.simulate_typing !== false,
      markRead:       cfg.mark_read !== false,
      peerPhone:      digits(phone),
      peerName:       null,
      toAccountId:    null,
      peerKind:       'external',
      threadKey:      threadKeyFor(a.phone_number, phone),
    }, delay)
    await recordWarmupSent(a.id)
    delay += randomDelayMs(cfg)
  }
}

async function tickClient(clientId) {
  const cfg = await getWarmupConfig(clientId)
  if (!isActiveNow(cfg)) return

  let chips = await sql`
    SELECT * FROM whatsapp_accounts
    WHERE client_id = ${clientId} AND provider = 'baileys'
      AND warmup_enabled = true AND is_active = true AND banned_at IS NULL
      AND phone_number IS NOT NULL
  `
  chips = chips.filter(c => baileysManager.getStatus(c.instance_name) === 'connected')
  if (!chips.length) return

  const convs = await getActiveConversations(clientId)  // ordenadas por menos usadas (rotación)
  if (!convs.length) return

  // Presupuesto en CONVERSACIONES por chip, liberado en FLUJO CONTINUO según cuánto
  // de la ventana activa ha transcurrido hoy.
  const now  = new Date()
  const frac = activeElapsedFraction(cfg, now)

  const eligible = []
  for (const c of chips) {
    const ecfg = effectiveConfig(cfg, c)
    const day  = await ensureWarmupDay(c, ecfg)
    if (day == null) continue
    const dailyConv  = convTargetForDay(ecfg, day)
    const allowedNow = Math.max(1, Math.ceil(dailyConv * frac))
    const sent       = await convSentTodayFor(c.id)
    const remaining  = allowedNow - sent
    if (remaining > 0) eligible.push({ chip: c, ecfg, remaining })
  }
  if (!eligible.length) return

  let ci = 0
  const nextConv = () => convs[(ci++) % convs.length]

  shuffle(eligible)
  for (const e of eligible) {
    const cfgE          = e.ecfg
    const allowExternal = cfgE.allow_external === true
    const others        = chips.filter(c => c.id !== e.chip.id)  // otros chips activos (para internas)
    const n = Math.min(e.remaining, MAX_CONV_PER_TICK)

    for (let i = 0; i < n; i++) {
      // Interno por defecto; externo solo si está permitido (según internal_ratio).
      const goInternal = !allowExternal || Math.random() < (cfgE.internal_ratio ?? 0.6)
      const conv = nextConv()
      await markConversationUsed(conv.id).catch(() => {})
      const startOffset = randInt(TICK_SPREAD_MS)

      if (goInternal && others.length) {
        const partner = others[randInt(others.length)]
        await playInternal(e.chip, partner, conv, cfgE, startOffset)
        await recordWarmupConv(e.chip.id)
      } else if (allowExternal) {
        const phone = await pickExternalPhone(clientId)
        if (!phone) continue
        await playExternal(e.chip, phone, conv, cfgE, startOffset)
        await recordWarmupConv(e.chip.id)
      }
      // Si es interno pero no hay otro chip (solo 1 activo) y externos apagados: nada.
    }
  }
}

// Un "tick" del calentamiento: recorre los clientes con warmup activo.
export async function runWarmupTick() {
  const clients = await sql`SELECT client_id FROM warmup_config WHERE is_enabled = true`
  for (const { client_id } of clients) {
    try { await tickClient(client_id) }
    catch (e) { console.error(`[Warmup] tick cliente ${client_id} falló:`, e.message) }
  }
}

// Dispara un tick inmediato para un solo cliente (botón "Iniciar / generar ahora").
export async function runTickForClient(clientId) {
  try { await tickClient(clientId) }
  catch (e) { console.error(`[Warmup] tick manual cliente ${clientId} falló:`, e.message) }
}
