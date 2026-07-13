import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractVars, resolveVars, buildContextFromContact } from './assistant.vars.js'

test('extractVars: solo variables de Excel, sin automáticas, dedupe, en orden', () => {
  const asst = {
    greeting: 'Hola {{NOMBRE_CLIENTE}}, tu DNI {{DNI}}',
    system_prompt: 'Deuda de {{MONTO}} con {{ENTIDAD}}. Repite {{DNI}}. Tel {{TELEFONO}}.',
  }
  assert.deepEqual(extractVars(asst), ['DNI', 'MONTO', 'ENTIDAD'])
})

test('extractVars: tolera greeting nulo y minúsculas/espacios en llaves', () => {
  const asst = { greeting: null, system_prompt: 'Pago {{ monto }} y {{fecha_pago}}' }
  assert.deepEqual(extractVars(asst), ['MONTO', 'FECHA_PAGO'])
})

test('resolveVars: reemplaza presentes y vacía ausentes', () => {
  const out = resolveVars('Hola {{NOMBRE}}, DNI {{DNI}}, x {{FALTA}}', { NOMBRE: 'Ana', DNI: '123' })
  assert.equal(out, 'Hola Ana, DNI 123, x ')
})

test('buildContextFromContact: nombre completo, nombre, teléfono y metadata en MAYÚSCULAS', () => {
  const ctx = buildContextFromContact(
    { first_name: 'Ana', last_name: 'Pérez', metadata: { dni: '123', monto: '500' } },
    '51999888777',
  )
  assert.equal(ctx.NOMBRE_CLIENTE, 'Ana Pérez')
  assert.equal(ctx.NOMBRE, 'Ana')
  assert.equal(ctx.TELEFONO, '51999888777')
  assert.equal(ctx.DNI, '123')
  assert.equal(ctx.MONTO, '500')
})
