import { sql } from '../../lib/db.js'
import { isActiveNow } from '../whatsapp/warmup/warmup.service.js'
import { handleAssistantInbound } from './assistant.responder.js'

const sleep = ms => new Promise(r => setTimeout(r, ms))
const rand  = (min, max) => Math.floor(Math.random() * (max - min) + min)

// "Ponerse al día": responde conversaciones de WhatsApp cuyo ÚLTIMO mensaje es
// del cliente y quedó sin contestar (ventana reciente), para asistentes que están
// DENTRO de su horario. Cubre el caso "el cliente escribió fuera de horario → se
// le responde al volver al horario".
//
// Anti-baneo: los envíos van ESPACIADOS (8-25s) y con TOPE por corrida y asistente.
// No es un barrido masivo: solo toma conversaciones con último mensaje entrante
// reciente y con más de 2 min (deja que el manejador en tiempo real atienda lo
// fresco). Reutiliza handleAssistantInbound, que revalida horario/opt-out/IA.
let running = false

export async function runAssistantCatchup({
  windowHours = 12,
  perAssistant = 30,
  delayMinMs = 8000,
  delayMaxMs = 25000,
} = {}) {
  // Evita corridas concurrentes: una corrida puede durar varios minutos (envíos
  // espaciados) y el cron dispara cada 5 min. Sin este guard, dos corridas podrían
  // tomar la misma conversación y responder dos veces.
  if (running) return
  running = true
  try {
  const assistants = await sql`SELECT * FROM wa_assistants WHERE is_active = true`

  for (const asst of assistants) {
    if (!isActiveNow(asst)) continue

    const convs = await sql`
      SELECT c.id AS conversation_id, c.account_id, c.contact_phone, c.contact_name,
             c.client_id, wa.instance_name, lm.body AS last_text
      FROM conversations c
      JOIN whatsapp_accounts wa ON wa.id = c.account_id
      JOIN LATERAL (
        SELECT body, direction, created_at FROM messages m
        WHERE m.conversation_id = c.id AND m.body IS NOT NULL AND m.body <> ''
        ORDER BY m.created_at DESC
        LIMIT 1
      ) lm ON true
      WHERE wa.assistant_id = ${asst.id}
        AND c.account_type = 'whatsapp'
        AND COALESCE(c.ai_enabled, true) = true
        AND COALESCE(c.is_group, false) = false
        AND lm.direction = 'inbound'
        AND lm.created_at >= now() - make_interval(hours => ${windowHours})
        AND lm.created_at <= now() - interval '2 minutes'
      ORDER BY lm.created_at ASC
      LIMIT ${perAssistant}
    `

    for (let i = 0; i < convs.length; i++) {
      const c = convs[i]
      if (i > 0) await sleep(rand(delayMinMs, delayMaxMs)) // espaciado anti-baneo
      try {
        await handleAssistantInbound({
          instanceName:   c.instance_name,
          accountId:      c.account_id,
          clientId:       c.client_id,
          contactPhone:   c.contact_phone,
          contactName:    c.contact_name,
          conversationId: c.conversation_id,
          text:           c.last_text,
          isGroup:        false,
        })
      } catch (e) {
        console.error(`[Catchup] conv ${c.conversation_id}:`, e.message)
      }
    }

    if (convs.length) {
      console.log(`[Catchup] Asistente "${asst.name}": ${convs.length} conversación(es) sin responder atendidas`)
    }
  }
  } finally {
    running = false
  }
}
