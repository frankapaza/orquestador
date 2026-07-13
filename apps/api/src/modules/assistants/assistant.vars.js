// Utilidades puras de variables {{...}} de los asistentes. Sin acceso a BD.

export const VAR_RE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g

// Variables que NO provienen del Excel: se resuelven de los datos del contacto.
export const AUTO_VARS = new Set(['TELEFONO', 'NOMBRE', 'NOMBRE_CLIENTE'])

// Variables de Excel de un asistente: escanea greeting + system_prompt, MAYÚSCULAS,
// quita las automáticas, dedupe conservando el orden de aparición.
export function extractVars(assistant) {
  const text = `${assistant?.greeting ?? ''}\n${assistant?.system_prompt ?? ''}`
  const seen = new Set()
  const out = []
  for (const m of text.matchAll(VAR_RE)) {
    const key = m[1].toUpperCase()
    if (AUTO_VARS.has(key) || seen.has(key)) continue
    seen.add(key)
    out.push(key)
  }
  return out
}

// Reemplaza {{VAR}} por ctx[VAR] (MAYÚSCULAS). Variable sin valor → cadena vacía.
export function resolveVars(text, ctx) {
  if (!text) return ''
  return text.replace(VAR_RE, (_, k) => {
    const v = ctx[k.toUpperCase()]
    return v == null ? '' : String(v)
  })
}

// Contexto de variables a partir de un contacto ya cargado (no toca BD).
export function buildContextFromContact(contact, phone) {
  const ctx = { TELEFONO: phone ?? '' }
  const full = [contact?.first_name, contact?.last_name].filter(Boolean).join(' ')
  ctx.NOMBRE_CLIENTE = full || ''
  ctx.NOMBRE = contact?.first_name || ''
  const meta = contact?.metadata && typeof contact.metadata === 'object' ? contact.metadata : {}
  for (const [k, v] of Object.entries(meta)) ctx[k.toUpperCase()] = v == null ? '' : String(v)
  return ctx
}
