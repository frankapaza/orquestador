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

  // Ya viene como número nacional
  return {
    country: country ?? null,
    dial: dial ?? (country ? DIAL_BY_ISO[country] ?? null : null),
    national: s.replace(/\D/g, ''),
  }
}

// Concatena el número completo E.164 a partir de las columnas separadas.
export function fullPhone({ phone_dial, phone } = {}) {
  if (!phone) return null
  return `${phone_dial ?? ''}${phone}`
}
