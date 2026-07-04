import { sql } from '../../../lib/db.js'
import { decrypt } from '../../../lib/crypto.js'

// Presets por proveedor. ChatGPT y DeepSeek son compatibles con el API de
// OpenAI (POST {base}/chat/completions), así que un solo cliente sirve.
export const AI_PRESETS = {
  openai:   { base_url: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  deepseek: { base_url: 'https://api.deepseek.com',  model: 'deepseek-v4-flash' },
  custom:   { base_url: '',                          model: '' },
}

// Modelos válidos sugeridos por proveedor (para ayuda en la UI).
export const AI_MODEL_HINTS = {
  openai:   ['gpt-4o-mini', 'gpt-4o'],
  deepseek: ['deepseek-v4-flash', 'deepseek-v4-pro'],
  custom:   [],
}

export function resolveAiSettings(cfg) {
  const provider = cfg.ai_provider ?? 'openai'
  const preset   = AI_PRESETS[provider] ?? AI_PRESETS.custom
  return {
    provider,
    baseUrl: (cfg.ai_base_url && cfg.ai_base_url.trim()) || preset.base_url,
    model:   (cfg.ai_model && cfg.ai_model.trim())       || preset.model,
    apiKey:  cfg.ai_api_key_enc ? decrypt(cfg.ai_api_key_enc) : null,
  }
}

const SYSTEM = `Eres un generador de conversaciones cortas y naturales de WhatsApp en español latino, informales y cotidianas (saludos, planes, trabajo, comida, favores, clima, recordatorios). Dos personas: "a" y "b". Nada de temas sensibles, ventas ni spam.`

function buildUserPrompt(count) {
  return `Genera ${count} conversaciones DISTINTAS y variadas.
Cada una: 4 a 8 turnos alternando entre "a" y "b", frases cortas y realistas (pueden llevar algún emoji o "jaja").
Responde SOLO JSON válido con esta forma exacta:
{"conversations":[{"topic":"tema-corto","turns":[{"from":"a","text":"..."},{"from":"b","text":"..."}]}]}`
}

// Llama al proveedor y devuelve el texto de la respuesta.
async function chatComplete({ baseUrl, model, apiKey }, messages, { jsonMode = true } = {}) {
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.9,
      ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
    }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`IA respondió ${res.status}: ${detail.slice(0, 200)}`)
  }
  const data = await res.json()
  return data?.choices?.[0]?.message?.content ?? ''
}

// Prueba de conexión rápida (valida key/modelo/base_url).
export async function testAiConnection(cfg) {
  const settings = resolveAiSettings(cfg)
  if (!settings.apiKey) throw new Error('Falta la API key')
  const content = await chatComplete(settings, [
    { role: 'user', content: 'Responde solo la palabra: ok' },
  ], { jsonMode: false })
  return { ok: true, provider: settings.provider, model: settings.model, sample: content.slice(0, 40) }
}

function parseConversations(raw) {
  let text = (raw ?? '').trim()
  // Quitar fences ```json ... ``` si el modelo los agrega
  text = text.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
  let obj
  try { obj = JSON.parse(text) } catch { throw new Error('La IA no devolvió JSON válido') }
  const list = Array.isArray(obj) ? obj : (obj.conversations ?? [])
  const clean = []
  for (const c of list) {
    const turns = Array.isArray(c?.turns) ? c.turns : []
    const valid = turns
      .filter(t => (t?.from === 'a' || t?.from === 'b') && typeof t?.text === 'string' && t.text.trim())
      .map(t => ({ from: t.from, text: t.text.trim() }))
    if (valid.length >= 2) clean.push({ topic: (c.topic ?? 'ia').toString().slice(0, 120), turns: valid })
  }
  return clean
}

// Genera N conversaciones con IA y las guarda en el catálogo del cliente.
export async function generateCatalog(clientId, count = 20) {
  const [cfg] = await sql`SELECT * FROM warmup_config WHERE client_id = ${clientId}`
  if (!cfg) throw new Error('Configura el warmup antes de generar')
  const settings = resolveAiSettings(cfg)
  if (!settings.apiKey)  throw new Error('Falta la API key del Agente IA')
  if (!settings.baseUrl) throw new Error('Falta la URL base del proveedor')
  if (!settings.model)   throw new Error('Falta el modelo')

  const n = Math.min(Math.max(1, count | 0), 50)
  const content = await chatComplete(settings, [
    { role: 'system', content: SYSTEM },
    { role: 'user',   content: buildUserPrompt(n) },
  ])
  const conversations = parseConversations(content)
  if (!conversations.length) throw new Error('La IA no generó conversaciones utilizables')

  const rows = conversations.map(c => ({
    client_id: clientId,
    topic:     c.topic,
    lang:      'es',
    turns:     JSON.stringify(c.turns),
    source:    'ai',
  }))
  await sql`INSERT INTO warmup_conversations ${sql(rows, 'client_id', 'topic', 'lang', 'turns', 'source')}`

  return { generated: rows.length, provider: settings.provider, model: settings.model }
}
