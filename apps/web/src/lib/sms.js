// Segmentación SMS en cliente (espejo de apps/api/src/lib/sms-segments.js).
const GSM7_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ ÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
  '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'
const GSM7_EXT = '^{}\\[~]|€'
const basic = new Set([...GSM7_BASIC])
const ext = new Set([...GSM7_EXT])

export function smsSegments(text) {
  const str = String(text ?? '')
  const chars = [...str]
  let isGsm = true
  let units = 0
  for (const ch of chars) {
    if (basic.has(ch)) units += 1
    else if (ext.has(ch)) units += 2
    else { isGsm = false; break }
  }
  if (isGsm) {
    return { encoding: 'GSM7', length: chars.length, segments: units <= 160 ? 1 : Math.ceil(units / 153) }
  }
  const u = str.length
  return { encoding: 'UCS2', length: chars.length, segments: u <= 70 ? 1 : Math.ceil(u / 67) }
}
