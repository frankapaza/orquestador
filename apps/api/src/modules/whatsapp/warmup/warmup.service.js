import { sql } from '../../../lib/db.js'

// ── Configuración global por cliente (con defaults si no existe fila) ─────────
export const DEFAULT_WARMUP_CONFIG = {
  is_enabled:         false,
  warmup_days:        7,
  delay_min_sec:      30,
  delay_max_sec:      300,
  active_hours_start: '08:00',
  active_hours_end:   '20:00',
  active_days:        'mon,tue,wed,thu,fri',
  timezone:           'America/Lima',
  ramp_start:         5,
  ramp_end:           40,
  ramp_mode:          'linear',
  daily_cap:          50,
  internal_ratio:     0.60,
  simulate_typing:    true,
  mark_read:          true,
}

export async function getWarmupConfig(clientId) {
  const [cfg] = await sql`SELECT * FROM warmup_config WHERE client_id = ${clientId}`
  return cfg ?? { client_id: clientId, ...DEFAULT_WARMUP_CONFIG }
}

export async function upsertWarmupConfig(clientId, patch) {
  const current = await getWarmupConfig(clientId)
  const merged  = { ...DEFAULT_WARMUP_CONFIG, ...current, ...patch, client_id: clientId }
  // Solo columnas válidas de la tabla
  const cols = [
    'is_enabled', 'warmup_days', 'delay_min_sec', 'delay_max_sec',
    'active_hours_start', 'active_hours_end', 'active_days', 'timezone',
    'ramp_start', 'ramp_end', 'ramp_mode', 'daily_cap',
    'internal_ratio', 'simulate_typing', 'mark_read',
  ]
  const values = Object.fromEntries(cols.map(c => [c, merged[c]]))

  const [row] = await sql`
    INSERT INTO warmup_config ${sql({ client_id: clientId, ...values }, 'client_id', ...cols)}
    ON CONFLICT (client_id) DO UPDATE SET
      ${sql(values, ...cols)}, updated_at = now()
    RETURNING *
  `
  return row
}

// Config efectiva para un chip: global + overrides por chip (JSONB).
export function effectiveConfig(globalCfg, account) {
  const ov = account?.warmup_overrides ?? {}
  return { ...globalCfg, ...ov }
}

// ── Rampa de volumen: cuántos mensajes debe enviar un chip en el día actual ───
export function rampTargetForDay(cfg, day) {
  const days  = Math.max(1, cfg.warmup_days ?? 7)
  const start = cfg.ramp_start ?? 5
  const end   = cfg.ramp_end ?? 40
  const d     = Math.min(Math.max(1, day), days)

  let target
  if (cfg.ramp_mode === 'steps') {
    // Escalones: sube en tramos del 25%
    const stepFrac = Math.ceil((d / days) * 4) / 4
    target = start + (end - start) * stepFrac
  } else {
    // Lineal entre start y end a lo largo de los días
    const frac = days === 1 ? 1 : (d - 1) / (days - 1)
    target = start + (end - start) * frac
  }
  return Math.min(Math.round(target), cfg.daily_cap ?? 50)
}

// Objetivo de mensajes que sube en escalones cada 3 HORAS (más suave/humano que
// el salto diario). Interpola de ramp_start a ramp_end a lo largo de warmup_days,
// avanzando un paso cada 3 h de reloj desde que arrancó el chip. Tope: daily_cap.
export function rampTargetStepped(cfg, startedAt, now = new Date()) {
  const start = Number(cfg.ramp_start ?? 5)
  const end   = Number(cfg.ramp_end ?? 40)
  const days  = Math.max(1, Number(cfg.warmup_days ?? 7))
  const cap   = Number(cfg.daily_cap ?? 50)
  if (!startedAt) return Math.min(Math.round(start), cap)

  const STEP_H     = 3
  const totalSteps = Math.max(1, Math.round((days * 24) / STEP_H))   // p.ej. 7 días → 56 pasos
  const elapsedH   = Math.max(0, (now.getTime() - new Date(startedAt).getTime()) / 3600000)
  const step       = Math.min(totalSteps - 1, Math.floor(elapsedH / STEP_H))
  const frac       = totalSteps <= 1 ? 1 : step / (totalSteps - 1)
  const target     = start + (end - start) * frac
  return Math.min(Math.round(target), cap)
}

// ── Ventana horaria y días activos ───────────────────────────────────────────
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

// Hora/minuto/día de la semana ACTUAL en la zona horaria indicada (default Perú).
export function localParts(timezone = 'America/Lima', now = new Date()) {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
    })
    const p = Object.fromEntries(fmt.formatToParts(now).map(x => [x.type, x.value]))
    return { hour: parseInt(p.hour, 10) % 24, minute: parseInt(p.minute, 10), day: p.weekday.toLowerCase().slice(0, 3) }
  } catch {
    return { hour: now.getHours(), minute: now.getMinutes(), day: DAY_KEYS[now.getDay()] }
  }
}

export function isActiveNow(cfg, now = new Date()) {
  const { hour, minute, day } = localParts(cfg.timezone || 'America/Lima', now)

  const activeDays = (cfg.active_days ?? '').split(',').map(s => s.trim()).filter(Boolean)
  if (activeDays.length && !activeDays.includes(day)) return false

  const pad = n => String(n).padStart(2, '0')
  const cur   = `${pad(hour)}:${pad(minute)}`
  const start = (cfg.active_hours_start ?? '00:00').slice(0, 5)
  const end   = (cfg.active_hours_end ?? '23:59').slice(0, 5)
  return cur >= start && cur <= end
}

// ── Detección de números internos (chips del mismo cliente) ──────────────────
const digits = p => (p ?? '').replace(/\D/g, '')

// Devuelve Map<digitsPhone, account> de los chips del cliente (para saber si un
// mensaje entrante proviene de otro chip del sistema → tráfico de warmup).
export async function internalAccountsByPhone(clientId) {
  const accounts = await sql`
    SELECT id, instance_name, phone_number, warmup_enabled
    FROM whatsapp_accounts
    WHERE client_id = ${clientId} AND provider = 'baileys' AND phone_number IS NOT NULL
  `
  const map = new Map()
  for (const a of accounts) map.set(digits(a.phone_number), a)
  return map
}

// ── Stats diarias agregadas (contador ligero, sin guardar contenido) ─────────
// Fecha de "hoy" en hora peruana (America/Lima), para que el día ruede a la
// medianoche de Perú y no a la del servidor (UTC).
export function todayLima(now = new Date()) {
  try {
    // en-CA formatea como YYYY-MM-DD
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(now)
  } catch {
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  }
}
const today = todayLima

export async function recordWarmupSent(accountId, n = 1) {
  await sql`
    INSERT INTO warmup_daily_stats (account_id, stat_date, warmup_sent)
    VALUES (${accountId}, ${today()}, ${n})
    ON CONFLICT (account_id, stat_date)
    DO UPDATE SET warmup_sent = warmup_daily_stats.warmup_sent + ${n}
  `
}

export async function recordWarmupReceived(accountId, n = 1) {
  await sql`
    INSERT INTO warmup_daily_stats (account_id, stat_date, warmup_received)
    VALUES (${accountId}, ${today()}, ${n})
    ON CONFLICT (account_id, stat_date)
    DO UPDATE SET warmup_received = warmup_daily_stats.warmup_received + ${n}
  `
}

export async function sentTodayFor(accountId) {
  const [row] = await sql`
    SELECT warmup_sent FROM warmup_daily_stats
    WHERE account_id = ${accountId} AND stat_date = ${today()}
  `
  return row?.warmup_sent ?? 0
}

// ── Catálogo de conversaciones ───────────────────────────────────────────────
export async function getActiveConversations(clientId) {
  const rows = await sql`
    SELECT id, topic, turns FROM warmup_conversations
    WHERE (client_id = ${clientId} OR client_id IS NULL) AND is_active = true
  `
  // Normalizar turns: algunas filas quedaron guardadas como string JSON (doble
  // codificación en columna JSONB). Garantizar siempre un array de turnos.
  return rows.map(r => ({
    ...r,
    turns: typeof r.turns === 'string' ? safeParseTurns(r.turns) : (Array.isArray(r.turns) ? r.turns : []),
  }))
}

function safeParseTurns(s) {
  try {
    const v = JSON.parse(s)
    return Array.isArray(v) ? v : []
  } catch { return [] }
}

// Delay aleatorio en ms entre dos mensajes según config.
export function randomDelayMs(cfg) {
  const min = (cfg.delay_min_sec ?? 30)
  const max = Math.max(min + 1, cfg.delay_max_sec ?? 300)
  return Math.floor(Math.random() * (max - min) + min) * 1000
}

// Clave de hilo del chat: par de teléfonos ordenado, para agrupar A↔B sin importar dirección.
export function threadKeyFor(phoneA, phoneB) {
  const a = (phoneA ?? '').replace(/\D/g, '')
  const b = (phoneB ?? '').replace(/\D/g, '')
  return [a, b].sort().join('|')
}

// Registra un mensaje saliente del warmup para el visor de chat.
export async function recordWarmupMessage({ clientId, threadKey, fromAccountId, toAccountId, peerPhone, peerName, peerKind, text }) {
  await sql`
    INSERT INTO warmup_messages
      (client_id, thread_key, from_account_id, to_account_id, peer_phone, peer_name, peer_kind, text)
    VALUES
      (${clientId}, ${threadKey}, ${fromAccountId}, ${toAccountId ?? null},
       ${peerPhone ?? null}, ${peerName ?? null}, ${peerKind ?? 'internal'}, ${text ?? null})
  `
}
