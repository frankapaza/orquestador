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
    'active_hours_start', 'active_hours_end', 'active_days',
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

// ── Ventana horaria y días activos ───────────────────────────────────────────
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

export function isActiveNow(cfg, now = new Date()) {
  const activeDays = (cfg.active_days ?? '').split(',').map(s => s.trim()).filter(Boolean)
  if (activeDays.length && !activeDays.includes(DAY_KEYS[now.getDay()])) return false

  const pad = n => String(n).padStart(2, '0')
  const cur   = `${pad(now.getHours())}:${pad(now.getMinutes())}`
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
function today() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

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
  return sql`
    SELECT id, topic, turns FROM warmup_conversations
    WHERE (client_id = ${clientId} OR client_id IS NULL) AND is_active = true
  `
}

// Delay aleatorio en ms entre dos mensajes según config.
export function randomDelayMs(cfg) {
  const min = (cfg.delay_min_sec ?? 30)
  const max = Math.max(min + 1, cfg.delay_max_sec ?? 300)
  return Math.floor(Math.random() * (max - min) + min) * 1000
}
