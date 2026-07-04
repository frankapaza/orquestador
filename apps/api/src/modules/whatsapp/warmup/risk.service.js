import { sql } from '../../../lib/db.js'
import { createAlert } from './alerts.service.js'

// Score de riesgo de baneo (heurístico, 0-100). No es una certeza: es una
// estimación por señales indirectas para pausar ANTES de llegar al ban.
// Factores: antigüedad del chip, volumen vs límite, ratio saliente/entrante.
function scoreFor({ createdAt, sentToday, warmupSent, warmupReceived, dailyLimit }) {
  let score = 0
  const reasons = []

  // 1. Antigüedad — números nuevos son más frágiles.
  const ageDays = createdAt ? (Date.now() - new Date(createdAt).getTime()) / 86400000 : 999
  if      (ageDays < 3)  { score += 25; reasons.push('chip muy nuevo (<3 días)') }
  else if (ageDays < 7)  { score += 15; reasons.push('chip nuevo (<7 días)') }
  else if (ageDays < 14) { score += 8 }

  // 2. Volumen vs límite diario.
  const totalSent = (sentToday ?? 0) + (warmupSent ?? 0)
  const limit     = Math.max(1, dailyLimit ?? 200)
  const volRatio  = totalSent / limit
  if      (volRatio >= 0.9) { score += 30; reasons.push('volumen diario cerca del límite') }
  else if (volRatio >= 0.7) { score += 20; reasons.push('volumen diario alto') }
  else if (volRatio >= 0.5) { score += 10 }

  // 3. Ratio saliente/entrante — solo enviar y nunca recibir es sospechoso.
  const recv = warmupReceived ?? 0
  if (totalSent >= 10 && recv === 0) {
    score += 25; reasons.push('solo envía, no recibe respuestas')
  } else if (totalSent > 0) {
    const ratio = totalSent / (recv + 1)
    if      (ratio > 5) { score += 20; reasons.push('ratio saliente/entrante muy alto') }
    else if (ratio > 3) { score += 12 }
    else if (ratio > 2) { score += 6 }
  }

  return { score: Math.min(100, Math.round(score)), reasons }
}

function levelFor(score) {
  if (score >= 70) return 'red'
  if (score >= 40) return 'yellow'
  return 'green'
}

// Recalcula el riesgo de todos los chips (o de un cliente). Pausa el warmup de
// los que entren en rojo (medida preventiva) y devuelve el resumen.
export async function recomputeRisk(clientId = null) {
  const today = new Date().toISOString().slice(0, 10)

  const accounts = await sql`
    SELECT wa.*,
           COALESCE(s.warmup_sent, 0)     AS w_sent,
           COALESCE(s.warmup_received, 0) AS w_received
    FROM whatsapp_accounts wa
    LEFT JOIN warmup_daily_stats s
      ON s.account_id = wa.id AND s.stat_date = ${today}
    WHERE wa.provider = 'baileys' AND wa.is_active = true
      ${clientId ? sql`AND wa.client_id = ${clientId}` : sql``}
  `

  const results = []
  for (const a of accounts) {
    // Los ya baneados quedan en rojo fijo.
    if (a.banned_at) {
      await sql`UPDATE whatsapp_accounts SET risk_level = 'red', risk_score = 100, risk_checked_at = now() WHERE id = ${a.id}`
      results.push({ id: a.id, score: 100, level: 'red', banned: true })
      continue
    }

    const { score, reasons } = scoreFor({
      createdAt:      a.created_at,
      sentToday:      a.sent_today,
      warmupSent:     a.w_sent,
      warmupReceived: a.w_received,
      dailyLimit:     a.daily_limit,
    })
    const level = levelFor(score)

    // Rojo preventivo → pausar warmup del chip.
    const pause = level === 'red'
    await sql`
      UPDATE whatsapp_accounts
      SET risk_score = ${score}, risk_level = ${level}, risk_checked_at = now()
          ${pause ? sql`, warmup_enabled = false` : sql``}
      WHERE id = ${a.id}
    `
    // Alerta solo cuando ENTRA a rojo (antes no era rojo).
    if (level === 'red' && a.risk_level !== 'red') {
      await createAlert(a.client_id, a.id, 'red', reasons.join('; ') || 'Riesgo alto de baneo')
        .catch(e => console.error('[Warmup] createAlert red:', e.message))
    }
    results.push({ id: a.id, score, level, reasons, paused: pause })
  }

  return results
}
