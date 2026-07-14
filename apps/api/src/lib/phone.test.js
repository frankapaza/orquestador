import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canonicalPhone } from './phone.js'

test('canonicalPhone: agrega + a un número sin prefijo', () => {
  assert.equal(canonicalPhone('51986095857'), '+51986095857')
})

test('canonicalPhone: mantiene el + y quita espacios/guiones', () => {
  assert.equal(canonicalPhone('+51 986-095 857'), '+51986095857')
  assert.equal(canonicalPhone('+51986095857'), '+51986095857')
})

test('canonicalPhone: idempotente (aplicar dos veces da lo mismo)', () => {
  assert.equal(canonicalPhone(canonicalPhone('51986095857')), '+51986095857')
})

test('canonicalPhone: deja intacto lo que no parece teléfono (identificador corto)', () => {
  assert.equal(canonicalPhone('123'), '123')
  assert.equal(canonicalPhone(''), '')
})
