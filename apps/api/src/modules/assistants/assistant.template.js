import * as XLSX from 'xlsx'
import { extractVars } from './assistant.vars.js'

// Genera el Excel-plantilla de un asistente: columnas telefono + nombre + una por
// cada variable {{...}} de Excel (en minúsculas, como las normaliza el importador).
export function buildAssistantTemplate(assistant) {
  const vars = extractVars(assistant).map(v => v.toLowerCase())
  const headers = ['telefono', 'nombre', ...vars]
  const example = ['51999888777', 'Juan Pérez', ...vars.map(() => 'ejemplo')]
  const ws = XLSX.utils.aoa_to_sheet([headers, example])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Contactos')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
}
