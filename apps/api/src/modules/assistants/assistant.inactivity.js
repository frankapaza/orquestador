import { sql } from '../../lib/db.js'

// Cierra por inactividad las conversaciones OPEN de números con asistente activo,
// cuyo último mensaje supera el inactivity_close_hours del asistente (0 = desactivado).
// Es un UPDATE masivo (NO envía mensajes) → sin riesgo de baneo, no requiere espaciado.
export async function runAssistantInactivityClose() {
  const res = await sql`
    UPDATE conversations c
    SET status = 'closed', closed_reason = 'inactivity', closed_at = now()
    FROM whatsapp_accounts wa
    JOIN wa_assistants a ON a.id = wa.assistant_id
    WHERE c.account_id = wa.id
      AND c.account_type = 'whatsapp'
      AND c.status = 'open'
      AND a.is_active = true
      AND COALESCE(a.inactivity_close_hours, 24) > 0
      AND c.last_message_at IS NOT NULL
      AND c.last_message_at < now() - make_interval(hours => COALESCE(a.inactivity_close_hours, 24))
  `
  if (res.count) console.log(`[Inactividad] ${res.count} conversación(es) cerradas por inactividad`)
  return res.count
}
