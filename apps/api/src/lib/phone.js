// Utilidades de teléfono: el número se guarda SEPARADO en la BD
// (phone_country ISO, phone_dial '+51', phone = número nacional).
// Cuando se necesita el número completo (enviar / emparejar) se concatena.

const DIALS = [
  ['PE', '+51'], ['MX', '+52'], ['CO', '+57'], ['AR', '+54'], ['CL', '+56'],
  ['EC', '+593'], ['BO', '+591'], ['VE', '+58'], ['PY', '+595'], ['UY', '+598'],
  ['US', '+1'], ['CA', '+1'], ['ES', '+34'], ['BR', '+55'], ['GT', '+502'],
  ['CR', '+506'], ['PA', '+507'], ['DO', '+1'], ['HN', '+504'], ['SV', '+503'],
  ['NI', '+505'], ['CU', '+53'], ['PR', '+1'], ['GB', '+44'], ['FR', '+33'],
  ['DE', '+49'], ['IT', '+39'], ['PT', '+351'], ['NL', '+31'], ['BE', '+32'],
  ['CH', '+41'], ['SE', '+46'], ['NO', '+47'], ['DK', '+45'], ['FI', '+358'],
  ['IE', '+353'], ['AT', '+43'], ['PL', '+48'], ['RU', '+7'], ['TR', '+90'],
  ['CN', '+86'], ['JP', '+81'], ['KR', '+82'], ['IN', '+91'], ['ID', '+62'],
  ['PH', '+63'], ['TH', '+66'], ['VN', '+84'], ['MY', '+60'], ['SG', '+65'],
  ['AU', '+61'], ['NZ', '+64'], ['ZA', '+27'], ['EG', '+20'], ['MA', '+212'],
  ['NG', '+234'], ['SA', '+966'], ['AE', '+971'], ['IL', '+972'],
]
const DIAL_BY_ISO = Object.fromEntries(DIALS)
const SORTED = DIALS.map(([iso, dial]) => ({ iso, dial })).sort((a, b) => b.dial.length - a.dial.length)

// ISO válidos y mapa código→países (para validar la columna 'pais' del Excel).
export const ISO_CODES = new Set(DIALS.map(([iso]) => iso))
const ISO_BY_DIAL = {}
for (const [iso, dial] of DIALS) (ISO_BY_DIAL[dial] ??= []).push(iso)
// Un código único (ej. +51) mapea a un país; los compartidos (+1) quedan sin país.
function countryFromDial(dial) {
  const arr = ISO_BY_DIAL[dial]
  return arr && arr.length === 1 ? arr[0] : null
}

// Normaliza la pista de país de una celda: acepta ISO ('PE'), código ('+51' o '51')
// o vacío. Devuelve { phone_country, phone_dial, valid }. `valid=false` si el
// código NO existe (para poder avisar en la carga del Excel).
export function normalizeCountryHint(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return { phone_country: null, phone_dial: null, valid: true } // vacío = opcional
  if (s.startsWith('+') || /^\d{1,4}$/.test(s)) {
    const dial = '+' + s.replace(/\D/g, '')
    if (!ISO_BY_DIAL[dial]) return { phone_country: null, phone_dial: null, valid: false }
    return { phone_country: countryFromDial(dial), phone_dial: dial, valid: true }
  }
  if (/^[a-zA-Z]{2}$/.test(s)) {
    const iso = s.toUpperCase()
    if (!ISO_CODES.has(iso)) return { phone_country: null, phone_dial: null, valid: false }
    return { phone_country: iso, phone_dial: DIAL_BY_ISO[iso] ?? null, valid: true }
  }
  return { phone_country: null, phone_dial: null, valid: false }
}

// Separa una entrada en { country (ISO), dial (+51), national (986095857) }.
// Acepta un número completo (+51986095857) o ya separado (national + isoHint/dialHint).
export function splitPhone(raw, { country, dial } = {}) {
  if (!raw) return { country: country ?? null, dial: dial ?? (country ? DIAL_BY_ISO[country] ?? null : null), national: null }
  const s = String(raw).trim()

  // Si viene completo (+...), inferir o usar el país sugerido
  if (s.startsWith('+')) {
    if (country && DIAL_BY_ISO[country] && s.startsWith(DIAL_BY_ISO[country])) {
      const d = DIAL_BY_ISO[country]
      return { country, dial: d, national: s.slice(d.length).replace(/\D/g, '') }
    }
    const m = SORTED.find(c => s.startsWith(c.dial))
    if (m) return { country: m.iso, dial: m.dial, national: s.slice(m.dial.length).replace(/\D/g, '') }
    return { country: country ?? null, dial: dial ?? null, national: s.replace(/\D/g, '') }
  }

  // Ya viene como número nacional (o con el código pegado SIN '+', ej "51936109504").
  const resolvedDial = dial ?? (country ? DIAL_BY_ISO[country] ?? null : null)
  let national = s.replace(/\D/g, '')
  // Si hay país/código conocido y el número trae ese código pegado adelante, se le
  // quita — evita el "doble código" (ej. 51 + 51936109504). Solo si al quitarlo
  // queda un nacional plausible (>= 6 dígitos), para no cortar números legítimos.
  if (resolvedDial) {
    const dd = resolvedDial.replace(/\D/g, '')
    if (dd && national.startsWith(dd) && national.length - dd.length >= 6) {
      national = national.slice(dd.length)
    }
  }
  return { country: country ?? null, dial: resolvedDial, national }
}

// Concatena el número completo E.164 a partir de las columnas separadas.
export function fullPhone({ phone_dial, phone } = {}) {
  if (!phone) return null
  return `${phone_dial ?? ''}${phone}`
}

// Formato canónico E.164 ("+" + dígitos) para indexar conversaciones de forma
// consistente y evitar duplicados por "+51..." vs "51...". Si la entrada no parece
// un teléfono (muy pocos dígitos), se devuelve tal cual — NO usar con IDs de grupo.
export function canonicalPhone(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return s
  const digits = (s.startsWith('+') ? s.slice(1) : s).replace(/\D/g, '')
  return digits.length >= 8 ? '+' + digits : s
}
