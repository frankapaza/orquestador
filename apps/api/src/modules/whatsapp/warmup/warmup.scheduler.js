import { sql } from '../../../lib/db.js'
import { baileysManager } from '../baileys.manager.js'
import { enqueueWarmupTurn } from './warmup.queue.js'
import { varyText } from './catalog.seed.js'
import {
  getWarmupConfig, effectiveConfig, isActiveNow, rampTargetStepped,
  sentTodayFor, getActiveConversations, randomDelayMs, recordWarmupSent, threadKeyFor,
} from './warmup.service.js'

const digits = p => (p ?? '').replace(/\D/g, '')
const randInt = n => Math.floor(Math.random() * n)
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(i + 1)
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

// Día actual de calentamiento del chip. Inicializa started_at si es la 1ª vez.
// Si ya superó warmup_days, marca el warmup como terminado y devuelve null.
async function ensureWarmupDay(chip, cfg) {
  if (!chip.warmup_started_at) {
    await sql`
      UPDATE whatsapp_accounts SET warmup_started_at = now(), warmup_day = 1
      WHERE id = ${chip.id}
    `
    chip.warmup_started_at = new Date().toISOString()  // reflejar para este mismo tick
    return 1
  }
  const started  = new Date(chip.warmup_started_at)
  const elapsed  = Math.floor((Date.now() - started.getTime()) / 86400000)
  const day      = elapsed + 1
  if (day > (cfg.warmup_days ?? 7)) {
    // Calentamiento completado: se apaga solo.
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

// Reproduce una conversación entre dos chips internos (ambos envían).
async function playInternal(a, b, conv, cfg, budget) {
  let delay = randomDelayMs(cfg)  // arranque escalonado
  for (const turn of conv.turns) {
    const isA = turn.from === 'a'
    const sender   = isA ? a : b
    const receiver = isA ? b : a
    if (budget.get(sender.chip.id) <= 0) continue

    await enqueueWarmupTurn({
      fromInstance:   sender.chip.instance_name,
      fromAccountId:  sender.chip.id,
      toPhone:        digits(receiver.chip.phone_number),
      text:           varyText(turn.text),
      simulateTyping: cfg.simulate_typing !== false,
      markRead:       cfg.mark_read !== false,
      // Datos para el visor de chat:
      peerPhone:      digits(receiver.chip.phone_number),
      peerName:       receiver.chip.name,
      toAccountId:    receiver.chip.id,
      peerKind:       'internal',
      threadKey:      threadKeyFor(sender.chip.phone_number, receiver.chip.phone_number),
    }, delay)

    // Contar al encolar (no al enviar) para no sobre-encolar entre ticks.
    await recordWarmupSent(sender.chip.id)
    budget.set(sender.chip.id, budget.get(sender.chip.id) - 1)
    delay += randomDelayMs(cfg)
  }
}

// Reproduce solo los turnos salientes hacia un número externo real.
async function playExternal(a, phone, conv, cfg, budget) {
  let delay = randomDelayMs(cfg)
  for (const turn of conv.turns) {
    if (turn.from !== 'a') continue
    if (budget.get(a.chip.id) <= 0) break

    await enqueueWarmupTurn({
      fromInstance:   a.chip.instance_name,
      fromAccountId:  a.chip.id,
      toPhone:        digits(phone),
      text:           varyText(turn.text),
      simulateTyping: cfg.simulate_typing !== false,
      markRead:       cfg.mark_read !== false,
      // Datos para el visor de chat:
      peerPhone:      digits(phone),
      peerName:       null,
      toAccountId:    null,
      peerKind:       'external',
      threadKey:      threadKeyFor(a.chip.phone_number, phone),
    }, delay)

    await recordWarmupSent(a.chip.id)
    budget.set(a.chip.id, budget.get(a.chip.id) - 1)
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

  const convs = await getActiveConversations(clientId)
  if (!convs.length) return

  // Presupuesto restante de mensajes por chip para hoy.
  const budget = new Map()
  const eligible = []
  for (const c of chips) {
    const ecfg = effectiveConfig(cfg, c)
    const day  = await ensureWarmupDay(c, ecfg)
    if (day == null) continue
    // Objetivo que sube cada 3 horas (rampTargetStepped ya aplica el daily_cap).
    const target = rampTargetStepped(ecfg, c.warmup_started_at)
    const sent   = await sentTodayFor(c.id)
    const remaining = target - sent
    if (remaining > 0) {
      budget.set(c.id, remaining)
      eligible.push({ chip: c, ecfg })
    }
  }
  if (!eligible.length) return

  // Emparejar y arrancar una conversación por chip disponible este tick.
  shuffle(eligible)
  const used = new Set()
  for (const e of eligible) {
    if (used.has(e.chip.id) || budget.get(e.chip.id) <= 0) continue
    const conv = convs[randInt(convs.length)]
    const goInternal = Math.random() < (e.ecfg.internal_ratio ?? 0.6)

    let partner = null
    if (goInternal) {
      partner = eligible.find(x => !used.has(x.chip.id) && x.chip.id !== e.chip.id && budget.get(x.chip.id) > 0)
    }

    if (partner) {
      used.add(e.chip.id); used.add(partner.chip.id)
      await playInternal(e, partner, conv, e.ecfg, budget)
    } else {
      const phone = await pickExternalPhone(clientId)
      if (!phone) continue
      used.add(e.chip.id)
      await playExternal(e, phone, conv, e.ecfg, budget)
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
