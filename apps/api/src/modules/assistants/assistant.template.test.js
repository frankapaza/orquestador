import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as XLSX from 'xlsx'
import { buildAssistantTemplate } from './assistant.template.js'

test('buildAssistantTemplate: headers = telefono, nombre + variables en minúsculas', () => {
  const asst = { name: 'Cobranzas', greeting: 'Hola {{NOMBRE_CLIENTE}}', system_prompt: 'DNI {{DNI}}, monto {{MONTO}}' }
  const buf = buildAssistantTemplate(asst)
  const wb = XLSX.read(buf, { type: 'buffer' })
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 })
  assert.deepEqual(rows[0], ['telefono', 'nombre', 'dni', 'monto'])
  assert.equal(rows.length >= 2, true) // incluye fila de ejemplo
})

test('buildAssistantTemplate: asistente sin variables → solo telefono y nombre', () => {
  const buf = buildAssistantTemplate({ name: 'Simple', greeting: 'Hola {{NOMBRE}}', system_prompt: 'Sé amable' })
  const wb = XLSX.read(buf, { type: 'buffer' })
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 })
  assert.deepEqual(rows[0], ['telefono', 'nombre'])
})
