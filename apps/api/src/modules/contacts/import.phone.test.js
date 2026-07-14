import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseFilePhone } from './import.service.js'

function csv(str) { return Buffer.from(str, 'utf-8') }

test('parseFilePhone: teléfono como clave, resto a metadata, email opcional', () => {
  const buf = csv('telefono,nombre,dni,monto\n51999888777,Juan,123,500\n')
  const r = parseFilePhone(buf, 'x.csv')
  assert.equal(r.valid, 1)
  assert.equal(r.contacts[0].phone, '51999888777')
  assert.equal(r.contacts[0].first_name, 'Juan')
  assert.deepEqual(r.contacts[0].metadata, { dni: '123', monto: '500' })
  assert.deepEqual(r.columns, ['dni', 'monto'])
})

test('parseFilePhone: fila sin teléfono se descarta', () => {
  const r = parseFilePhone(csv('telefono,nombre\n,SinTel\n51988777,Ok\n'), 'x.csv')
  assert.equal(r.valid, 1)
  assert.equal(r.contacts[0].first_name, 'Ok')
})

test('parseFilePhone: sin columna teléfono lanza error', () => {
  assert.throws(() => parseFilePhone(csv('nombre,dni\nJuan,1\n'), 'x.csv'), /tel[eé]fono/i)
})
