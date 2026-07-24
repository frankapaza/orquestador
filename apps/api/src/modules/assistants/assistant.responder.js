import { sql } from '../../lib/db.js'
import { baileysManager } from '../whatsapp/baileys.manager.js'
import { resolveAiSettings } from '../whatsapp/warmup/ai.generator.js'
import { isActiveNow } from '../whatsapp/warmup/warmup.service.js'
import { resolveVars, extractVars } from './assistant.vars.js'

// Valores que NO son datos reales: relleno de plantilla, vacíos, "no aplica".
// Se tratan como DESCONOCIDO para que la IA no los repita ni construya sobre ellos.
function isPlaceholder(v) {
  const s = String(v ?? '').trim()
  return !s || /^(ejemplos?|example|placeholder|x{2,}|-{2,}|\.{2,}|_{2,}|n\/?a|na|null|none|tbd|pendiente|sin dato)$/i.test(s)
}

// Reglas duras anti-invención. Van al final del prompt del sistema (máxima
// prioridad). Cobranza: un dato inventado es un problema legal/reputacional.
const GUARDRAIL = `
====================
REGLAS ESTRICTAS DE DATOS (prioridad máxima, obligatorias):
1. Solo puedes afirmar montos, fechas, números de factura, formas de pago, nombres de empresa o cualquier dato del caso si aparecen EXACTOS en "DATOS DEL CLIENTE". Nada fuera de ahí es real.
2. PROHIBIDO inventar, suponer, estimar, redondear o dar de ejemplo cualquier dato que no esté en esa lista. Es mejor NO dar el dato que dar uno inventado.
3. No cambies el formato de los datos: no agregues símbolos de moneda ($, S/) ni separadores de miles, y no conviertas monedas ni fechas. Cópialos tal cual están.
4. Si un dato aparece como (NO DISPONIBLE) o no está en la lista, trátalo como DESCONOCIDO: no lo menciones y no lo inventes.
5. Si el cliente pregunta por un dato que no tienes, dile que lo vas a verificar con un asesor. NUNCA lo inventes.
6. No inventes nombres de personas, sucursales, direcciones ni datos de contacto.
====================`

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
    ORDER BY c.created_at DESC
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
    // Temperatura baja: es un asistente de datos (cobranza), no creativo. Menos
    // temperatura = mucha menos tendencia a inventar montos/fechas/facturas.
    body: JSON.stringify({ model, messages, temperature: 0.2 }),
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

  // Toggle de IA de la conversación. Nota: el estado "cerrado" es SOLO visual
  // (separa la bandeja), NO apaga la IA — un chat cerrado que recibe un mensaje
  // sigue siendo atendido. Para silenciar la IA en una conversación se usa
  // ai_enabled = false (toma humana / opt-out).
  const [conv] = await sql`SELECT ai_enabled, contact_phone FROM conversations WHERE id = ${conversationId}`
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

  const ctx = await buildContext(clientId, contactPhone, contactName)

  // (FIX) Neutraliza valores placeholder/vacíos ("ejemplo", etc.) ANTES de resolver
  // el prompt. Antes el prompt se llenaba con "ejemplo" y el modelo veía literal
  // "Factura: ejemplo" y lo tomaba como un dato a completar → inventaba. Ahora ve
  // "Factura: (no disponible)" y entiende que ese dato no existe.
  const ctxClean = {}
  for (const [k, v] of Object.entries(ctx)) ctxClean[k] = isPlaceholder(v) ? '(no disponible)' : v

  const prompt   = resolveVars(asst.system_prompt, ctxClean)
  const greeting = resolveVars(asst.greeting, ctxClean)
  const history  = await loadHistory(conversationId, asst.history_limit)

  // Bloque de datos ciertos: enumera cada variable del asistente con su valor real,
  // marcando (NO DISPONIBLE) los vacíos/placeholder. Así la IA sabe qué SÍ puede
  // decir y qué no existe, en vez de rellenarlo inventando.
  const excelVars = extractVars(asst)
  const datosLines = []
  if (!isPlaceholder(ctx.NOMBRE_CLIENTE)) datosLines.push(`- Nombre del cliente: ${ctx.NOMBRE_CLIENTE}`)
  for (const k of excelVars) {
    datosLines.push(`- ${k}: ${isPlaceholder(ctx[k]) ? '(NO DISPONIBLE)' : ctx[k]}`)
  }
  const datosBlock = datosLines.length
    ? `\n\nDATOS DEL CLIENTE (lo único que sabes con certeza; nada fuera de esta lista es real):\n${datosLines.join('\n')}`
    : `\n\nDATOS DEL CLIENTE: no tienes ningún dato específico del cliente. No menciones montos, fechas ni facturas.`

  // (FIX) Bloqueo POR CAMPO: cualquier dato faltante/placeholder queda prohibido.
  // Antes se exigía que TODO estuviera vacío (every), y como el nombre real existe,
  // el bloqueo nunca se activaba.
  const faltantes = excelVars.filter(k => isPlaceholder(ctx[k]))
  const bloqueoFaltantes = faltantes.length
    ? `\n\n🚫 DATOS QUE NO TIENES (DESCONOCIDOS) — PROHIBIDO MENCIONARLOS O INVENTARLOS: ${faltantes.join(', ')}.\nEstos datos NO existen para ti. NO los menciones, NO inventes cifras/fechas/facturas, NO uses valores de ejemplo. Si el cliente pregunta por alguno (su monto, su factura, su vencimiento, etc.), responde EXACTAMENTE algo como: "Déjame verificar ese dato con un asesor y te lo confirmo enseguida." Jamás afirmes un número o dato que no esté en DATOS DEL CLIENTE.`
    : ''

  // Antídoto contra historial contaminado: mensajes previos de la IA pudieron
  // contener datos inventados; no deben tomarse como verdad.
  const ignorarHistorial = `\n\nIMPORTANTE: IGNORA cualquier monto, número de factura, fecha o dato que aparezca en mensajes ANTERIORES de esta conversación — pudieron ser errores previos. La ÚNICA fuente válida de datos es la lista "DATOS DEL CLIENTE" de arriba.`

  const messages = [
    {
      role: 'system',
      content:
        prompt +
        (greeting ? `\n\nSaludo inicial sugerido (úsalo solo si aún no has saludado al cliente): ${greeting}` : '') +
        datosBlock +
        `\n\nResponde en español, breve y natural para WhatsApp.` +
        GUARDRAIL +
        bloqueoFaltantes +
        ignorarHistorial,
    },
    ...history,
  ]

  // DEBUG temporal: ver EXACTAMENTE qué recibe el modelo (si el prompt llega limpio
  // con "(no disponible)" o todavía con "ejemplo", y cuántos mensajes de historial).
  console.log(`[Assistant][debug ${instanceName}] faltantes=[${faltantes.join(',')}] bloqueo=${bloqueoFaltantes ? 'SI' : 'NO'} histMsgs=${history.length} model=${settings.model} temp | SYSTEM(0-400)="${messages[0].content.replace(/\s+/g, ' ').slice(0, 400)}"`)

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
