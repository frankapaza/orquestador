import * as XLSX from 'xlsx'
import { extractVars } from './assistant.vars.js'

// Genera el Excel-plantilla de un asistente: columnas telefono + nombre + una por
// cada variable {{...}} de Excel (en minúsculas, como las normaliza el importador).
export function buildAssistantTemplate(assistant) {
  const vars = extractVars(assistant).map(v => v.toLowerCase())
  // 'documento' (DNI/RUC) obligatorio = identidad del contacto. 'pais' (opcional)
  // identifica el país cuando el teléfono viene nacional (sin '+').
  const headers = ['documento', 'telefono', 'pais', 'nombre', ...vars]
  const example = ['12345678', '999888777', '+51', 'Juan Pérez', ...vars.map(() => 'ejemplo')]
  const ws = XLSX.utils.aoa_to_sheet([headers, example])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Contactos')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
}
