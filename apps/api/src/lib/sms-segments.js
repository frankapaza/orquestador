// Set básico GSM-7 (caracteres de 1 unidad). Los de extensión cuentan como 2.
const GSM7_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ ÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
  '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'
const GSM7_EXT = '^{}\\[~]|€'

const basic = new Set([...GSM7_BASIC])
const ext = new Set([...GSM7_EXT])

// Devuelve encoding, longitud (caracteres visibles) y número de segmentos SMS.
export function smsSegmentInfo(text) {
  const str = String(text ?? '')
  const chars = [...str] // respeta caracteres de más de un code unit
  let isGsm = true
  let units = 0
  for (const ch of chars) {
    if (basic.has(ch)) units += 1
    else if (ext.has(ch)) units += 2
    else { isGsm = false; break }
  }

  if (isGsm) {
    const segments = units <= 160 ? 1 : Math.ceil(units / 153)
    return { encoding: 'GSM7', length: chars.length, segments }
  }

  // UCS-2: se cuenta por code units UTF-16.
  const u = str.length
  const segments = u <= 70 ? 1 : Math.ceil(u / 67)
  return { encoding: 'UCS2', length: chars.length, segments }
}
