import { test } from 'node:test'
import assert from 'node:assert/strict'
import { smsSegmentInfo } from './sms-segments.js'

test('GSM-7 corto = 1 segmento', () => {
  assert.deepEqual(smsSegmentInfo('Hola mundo'), { encoding: 'GSM7', length: 10, segments: 1 })
})

test('GSM-7 exactamente 160 = 1 segmento', () => {
  const r = smsSegmentInfo('a'.repeat(160))
  assert.equal(r.segments, 1)
  assert.equal(r.length, 160)
})

test('GSM-7 161 = 2 segmentos (153 c/u)', () => {
  assert.equal(smsSegmentInfo('a'.repeat(161)).segments, 2)
})

test('Unicode (emoji) usa UCS-2 y umbral 70', () => {
  const r = smsSegmentInfo('Hola 😀')
  assert.equal(r.encoding, 'UCS2')
  assert.equal(r.segments, 1)
})

test('Unicode 71 chars (no-GSM7) = 2 segmentos', () => {
  // 'д' (cirílico) es 1 code unit UTF-16 pero fuera de GSM-7 → UCS-2.
  assert.equal(smsSegmentInfo('д'.repeat(71)).segments, 2)
})

test('carácter de extensión GSM-7 cuenta doble', () => {
  // 80 llaves '{' = 160 unidades → 1 segmento; 81 = 162 → 2
  assert.equal(smsSegmentInfo('{'.repeat(80)).segments, 1)
  assert.equal(smsSegmentInfo('{'.repeat(81)).segments, 2)
})
