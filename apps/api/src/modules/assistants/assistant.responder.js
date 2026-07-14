import { sql } from '../../lib/db.js'
import { baileysManager } from '../whatsapp/baileys.manager.js'
import { resolveAiSettings } from '../whatsapp/warmup/ai.generator.js'
import { isActiveNow } from '../whatsapp/warmup/warmup.service.js'
import { resolveVars } from './assistant.vars.js'

const digits = p => (p ?? '').replace(/\D/g, '')

// Palabras que apagan la IA en esa conversación (opt-out del cliente).
const OPT_OUT = /^\s*(stop|baja|cancelar|no escribir|no molestar|dar de baja)\s*!?\.?\s*$/i

// Arma el contexto de variables del cliente: datos del contacto + su metadata
// (columnas del Excel importado en la campaña) + teléfono.
async function buildContext(clientId, contactPhone, contactName) {
  const ctx = { TELEFONO: contactPhone ?? '' }
  const [row] = await sql`
    SELECT c.first_name, c.last_name, c.metadata
    FROM contact_phones cp
    JOIN contacts c ON c.id = cp.contact_id
    WHERE c.client_id = ${clientId}
      AND regexp_replace(COALESCE(cp.phone_dial, '') || cp.phone, '\D', '', 'g') = ${digits(contactPhone)}
    LIMIT 1
  `.catch(() => [])
  if (row) {
    const full = [row.first_name, row.last_name].filter(Boolean).join(' ')
    ctx.NOMBRE_CLIENTE = full || contactName || ''
    ctx.NOMBRE         = row.first_name || contactName || ''
    const meta = row.metadata && typeof row.metadata === 'object' ? row.metadata : {}
    for (const [k, v] of Object.entries(meta)) ctx[k.toUpperCase()] = v == null ? '' : String(v)
  } else {
    ctx.NOMBRE_CLIENTE = contactName || ''
    ctx.NOMBRE         = contactName || ''
  }
  return ctx
}

// Llama al proveedor (compatible OpenAI: ChatGPT/DeepSeek) y devuelve el texto.
async function chatComplete({ baseUrl, model, apiKey }, messages) {
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, temperature: 0.6 }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`IA respondió ${res.status}: ${detail.slice(0, 160)}`)
  }
  const data = await res.json()
  return (data?.choices?.[0]?.message?.content ?? '').trim()
}

// Historial reciente de la conversación como turnos user/assistant para la IA.
async function loadHistory(conversationId, limit) {
  const rows = await sql`
    SELECT direction, body FROM messages
    WHERE conversation_id = ${conversationId} AND body IS NOT NULL AND body <> ''
    ORDER BY created_at DESC
    LIMIT ${Math.max(2, Math.min(40, limit | 0 || 12))}
  `
  return rows.reverse().map(m => ({
    role:    m.direction === 'inbound' ? 'user' : 'assistant',
    content: m.body,
  }))
}

// Punto de entrada: procesa un mensaje ENTRANTE y, si el número tiene un
// asistente activo, responde con IA. Fase 1: solo entrantes, sin derivación.
// Es best-effort — nunca lanza hacia el handler de Baileys.
export async function handleAssistantInbound({ instanceName, accountId, clientId, contactPhone, contactName, conversationId, text, isGroup }) {
  if (isGroup || !text || !text.trim()) return

  // ¿El número tiene un asistente activo?
  const [asst] = await sql`
    SELECT a.* FROM whatsapp_accounts wa
    JOIN wa_assistants a ON a.id = wa.assistant_id
    WHERE wa.id = ${accountId} AND a.is_active = true
  `
  if (!asst) return

  // Estado y toggle de IA de la conversación.
  const [conv] = await sql`SELECT ai_enabled, status, contact_phone FROM conversations WHERE id = ${conversationId}`
  if (conv && conv.status === 'closed') {
    console.log(`[Assistant][${instanceName}] no responde: conversación cerrada (requiere reapertura humana)`)
    return
  }
  if (conv && conv.ai_enabled === false) {
    console.log(`[Assistant][${instanceName}] no responde: IA desactivada en la conversación (toma humana / opt-out previo)`)
    return
  }

  // Opt-out: el cliente pide no recibir más → apagar la IA en la conversación.
  if (OPT_OUT.test(text)) {
    await sql`UPDATE conversations SET ai_enabled = false WHERE id = ${conversationId}`
    console.log(`[Assistant][${instanceName}] no responde: opt-out del cliente ("${text.trim().slice(0, 40)}") → IA apagada en la conversación`)
    return
  }

  // Respetar horario / días activos del asistente.
  if (!isActiveNow(asst)) {
    console.log(`[Assistant][${instanceName}] no responde: fuera del horario del asistente "${asst.name}" (${asst.active_hours_start?.slice(0,5)}-${asst.active_hours_end?.slice(0,5)}, ${asst.active_days}, ${asst.timezone})`)
    return
  }

  // Ajustes de IA: key global del cliente (Agente IA), con override de modelo.
  const [cfg] = await sql`SELECT * FROM warmup_config WHERE client_id = ${clientId}`
  if (!cfg) {
    console.log(`[Assistant][${instanceName}] no responde: IA no configurada (sin warmup_config para el cliente)`)
    return
  }
  const settings = resolveAiSettings(cfg)
  if (asst.ai_model) settings.model = asst.ai_model
  if (!settings.apiKey || !settings.baseUrl || !settings.model) {
    console.log(`[Assistant][${instanceName}] no responde: Agente IA incompleto (falta API key, base URL o modelo)`)
    return
  }

  const ctx     = await buildContext(clientId, contactPhone, contactName)
  const prompt  = resolveVars(asst.system_prompt, ctx)
  const greeting = resolveVars(asst.greeting, ctx)
  const history = await loadHistory(conversationId, asst.history_limit)

  const messages = [
    {
      role: 'system',
      content:
        prompt +
        (greeting ? `\n\nSaludo inicial sugerido (úsalo solo si aún no has saludado al cliente): ${greeting}` : '') +
        `\n\nResponde en español, breve y natural para WhatsApp. No inventes datos que no tengas.`,
    },
    ...history,
  ]

  let reply
  try {
    reply = await chatComplete(settings, messages)
  } catch (e) {
    console.error(`[Assistant][${instanceName}] IA:`, e.message)
    return
  }
  if (!reply) return

  try {
    const sent = await baileysManager.send(instanceName, { to: digits(contactPhone), body: reply })
    const externalId = sent?.key?.id ?? sent?.id ?? null
    // Registrar el saliente en la BD. El eco fromMe solo captura mensajes enviados
    // desde el teléfono físico, NO los enviados por API como este. Sin este registro
    // el catch-up cree que el entrante sigue sin responder y re-contesta EN LOOP, y
    // el inbox no muestra las respuestas del asistente.
    await sql`
      INSERT INTO messages
        (client_id, conversation_id, channel, direction, from_number, to_number, body, external_id, status, sent_at)
      VALUES
        (${clientId}, ${conversationId}, 'whatsapp', 'outbound', NULL,
         ${conv?.contact_phone ?? contactPhone}, ${reply}, ${externalId}, 'sent', now())
    `
    await sql`UPDATE conversations SET last_message_at = now() WHERE id = ${conversationId}`
  } catch (e) {
    console.error(`[Assistant][${instanceName}] registro/envío:`, e.message)
  }
}
