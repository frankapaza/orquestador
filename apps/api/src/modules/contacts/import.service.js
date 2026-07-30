import * as XLSX from 'xlsx'
import { parse as csvParse } from 'csv-parse/sync'
import { normalizeCountryHint } from '../../lib/phone.js'

// Genera la plantilla Excel de destinatarios de una campaña, por canal:
// SIEMPRE documento (identidad) + teléfono (WA/SMS) o correo (Email) + nombre,
// y luego las variables dinámicas (columnas que el mensaje/asistente usa como {{...}}).
export function buildContactsTemplate({ channel = 'whatsapp', vars = [] } = {}) {
  const isEmail = channel === 'email'
  const contactCol = isEmail ? 'correo' : 'telefono'
  const contactEx  = isEmail ? 'juan@correo.com' : '999888777'
  // Dedup y quita columnas de identidad para no repetirlas como "variable".
  const IDENT = new Set(['documento', 'dni', 'ruc', 'ce', 'telefono', 'celular', 'phone', 'whatsapp', 'correo', 'email', 'pais', 'país', 'country', 'nombre', 'name', 'first_name', 'last_name', 'apellido'])
  const dynamicVars = [...new Set(vars.map(v => String(v).toLowerCase()).filter(v => v && !IDENT.has(v)))]

  // Canales con teléfono llevan columna 'pais' (opcional): identifica el país
  // cuando el número viene nacional (sin '+'). Email no la necesita. Nombre y
  // apellido separados, igual que el formulario manual.
  const identCols = isEmail
    ? ['documento', contactCol, 'nombre', 'apellido']
    : ['documento', contactCol, 'pais', 'nombre', 'apellido']
  const identEx = isEmail
    ? ['12345678', contactEx, 'Juan', 'Pérez']
    : ['12345678', contactEx, '+51', 'Juan', 'Pérez']

  const headers = [...identCols, ...dynamicVars]
  const example = [...identEx, ...dynamicVars.map(() => 'ejemplo')]
  const ws = XLSX.utils.aoa_to_sheet([headers, example])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Contactos')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
}

// Nombres de columna aceptados para cada campo (case-insensitive)
const COL_EMAIL      = ['email', 'correo', 'e-mail', 'mail']
const COL_FIRST_NAME = ['first_name', 'firstname', 'nombre', 'name', 'first']
const COL_LAST_NAME  = ['last_name', 'lastname', 'apellido', 'surname', 'last']
const COL_PHONE = ['telefono', 'teléfono', 'phone', 'celular', 'movil', 'móvil', 'whatsapp', 'numero', 'número', 'msisdn', 'tel']
const COL_DOCUMENT = ['documento', 'dni', 'ruc', 'ce', 'cedula', 'cédula', 'document', 'nif', 'identificacion', 'identificación', 'doc']
const COL_COUNTRY  = ['pais', 'país', 'country', 'codigo_pais', 'código_pais', 'cod_pais', 'iso']

function normalize(str) {
  return String(str ?? '').trim().toLowerCase().replace(/\s+/g, '_')
}

function findCol(headers, candidates) {
  return headers.find(h => candidates.includes(normalize(h))) ?? null
}

function mapRows(headers, rows) {
  const emailCol     = findCol(headers, COL_EMAIL)
  const firstNameCol = findCol(headers, COL_FIRST_NAME)
  const lastNameCol  = findCol(headers, COL_LAST_NAME)

  if (!emailCol) {
    throw new Error('No se encontro columna de email. Debe llamarse: email, correo, e-mail o mail')
  }

  const metaCols = headers.filter(h =>
    h !== emailCol && h !== firstNameCol && h !== lastNameCol
  )

  const contacts = []
  const skipped  = []

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const email = String(row[emailCol] ?? '').trim().toLowerCase()

    // Validacion basica de email
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      skipped.push({ row: i + 2, value: email || '(vacio)', reason: 'email invalido' })
      continue
    }

    const metadata = {}
    for (const col of metaCols) {
      const val = row[col]
      if (val !== null && val !== undefined && val !== '') {
        metadata[normalize(col)] = String(val).trim()
      }
    }

    contacts.push({
      email,
      first_name: firstNameCol ? String(row[firstNameCol] ?? '').trim() || null : null,
      last_name:  lastNameCol  ? String(row[lastNameCol]  ?? '').trim() || null : null,
      metadata,
    })
  }

  return { contacts, skipped, total: rows.length, valid: contacts.length }
}

export function parseCSV(buffer) {
  const text = buffer.toString('utf-8').replace(/^﻿/, '') // quitar BOM si existe
  const rows = csvParse(text, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  })

  if (rows.length === 0) throw new Error('El archivo CSV esta vacio')
  const headers = Object.keys(rows[0])
  return mapRows(headers, rows)
}

export function parseExcel(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true })
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) throw new Error('El archivo Excel no tiene hojas')

  const sheet = workbook.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: false })

  if (rows.length === 0) throw new Error('La hoja de Excel esta vacia')
  const headers = Object.keys(rows[0])
  return mapRows(headers, rows)
}

export function parseFile(buffer, filename) {
  const ext = filename.split('.').pop().toLowerCase()
  if (ext === 'csv') return parseCSV(buffer)
  if (ext === 'xlsx' || ext === 'xls') return parseExcel(buffer)
  throw new Error(`Formato no soportado: .${ext}. Use .csv, .xlsx o .xls`)
}

// ── Import de destinatarios de CAMPAÑA (WhatsApp / SMS / Email) ─────────────
// Identidad SIEMPRE por documento (obligatorio). Según el canal, exige teléfono
// (mensajería) o correo (email); el otro dato es opcional si viene. Un contacto
// puede traer teléfono y/o correo.
function mapRowsContacts(headers, rows, mode) {
  const phoneCol     = findCol(headers, COL_PHONE)
  const emailCol     = findCol(headers, COL_EMAIL)
  const documentCol  = findCol(headers, COL_DOCUMENT)
  const countryCol   = findCol(headers, COL_COUNTRY)
  const firstNameCol = findCol(headers, COL_FIRST_NAME)
  const lastNameCol  = findCol(headers, COL_LAST_NAME)

  // El documento (DNI/RUC) es la identidad del contacto: obligatorio siempre.
  if (!documentCol) {
    throw new Error('Falta la columna de documento. Debe llamarse: documento, dni, ruc o ce')
  }
  if (mode === 'email' && !emailCol) {
    throw new Error('No se encontro columna de email. Debe llamarse: email, correo, e-mail o mail')
  }
  if (mode !== 'email' && !phoneCol) {
    throw new Error('No se encontro columna de telefono. Debe llamarse: telefono, phone, celular, movil o whatsapp')
  }

  // Documento/teléfono/correo/país/nombre son identidad-contacto, NO variables.
  const known = new Set([phoneCol, emailCol, documentCol, countryCol, firstNameCol, lastNameCol].filter(Boolean))
  const metaCols = headers.filter(h => !known.has(h))

  const contacts = []
  const skipped  = []

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const document = String(row[documentCol] ?? '').trim()
    if (!document) {
      skipped.push({ row: i + 2, value: '(sin documento)', reason: 'documento vacio' })
      continue
    }

    const phoneRaw   = phoneCol ? String(row[phoneCol] ?? '').trim() : ''
    const phoneDigits = phoneRaw.replace(/\D/g, '')
    const phoneOk    = phoneDigits.length >= 6

    const emailRaw   = emailCol ? String(row[emailCol] ?? '').trim().toLowerCase() : ''
    const emailOk    = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)

    if (mode === 'email' && !emailOk) {
      skipped.push({ row: i + 2, value: emailRaw || '(vacio)', reason: 'email invalido' })
      continue
    }
    if (mode !== 'email' && !phoneOk) {
      skipped.push({ row: i + 2, value: phoneRaw || '(vacio)', reason: 'telefono invalido' })
      continue
    }

    // País (columna 'pais', opcional): acepta ISO (PE) o código (+51 / 51). Si el
    // valor NO es un país/código válido, se rechaza la fila y se reporta.
    const paisRaw = countryCol ? String(row[countryCol] ?? '').trim() : ''
    const ch = normalizeCountryHint(paisRaw)
    if (paisRaw && !ch.valid) {
      skipped.push({ row: i + 2, value: paisRaw, reason: `país no reconocido: "${paisRaw}"` })
      continue
    }
    const phone_country = ch.phone_country
    const phone_dial    = ch.phone_dial

    const metadata = {}
    for (const col of metaCols) {
      const val = row[col]
      if (val !== null && val !== undefined && val !== '') {
        metadata[normalize(col)] = String(val).trim()
      }
    }

    contacts.push({
      document,
      phone:      phoneOk ? phoneRaw : null,
      phone_country,
      phone_dial,
      email:      emailOk ? emailRaw : null,
      first_name: firstNameCol ? String(row[firstNameCol] ?? '').trim() || null : null,
      last_name:  lastNameCol  ? String(row[lastNameCol]  ?? '').trim() || null : null,
      metadata,
    })
  }

  return { contacts, skipped, total: rows.length, valid: contacts.length, columns: metaCols.map(normalize) }
}

// mode: 'email' (exige correo) | 'phone' (exige teléfono; default para WA/SMS).
export function parseFileContacts(buffer, filename, mode = 'phone') {
  const ext = filename.split('.').pop().toLowerCase()
  let rows, headers
  if (ext === 'csv') {
    const text = buffer.toString('utf-8').replace(/^﻿/, '')
    rows = csvParse(text, { columns: true, skip_empty_lines: true, trim: true, relax_column_count: true })
    if (rows.length === 0) throw new Error('El archivo CSV esta vacio')
    headers = Object.keys(rows[0])
  } else if (ext === 'xlsx' || ext === 'xls') {
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true })
    const sheetName = workbook.SheetNames[0]
    if (!sheetName) throw new Error('El archivo Excel no tiene hojas')
    rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: null, raw: false })
    if (rows.length === 0) throw new Error('La hoja de Excel esta vacia')
    headers = Object.keys(rows[0])
  } else {
    throw new Error(`Formato no soportado: .${ext}. Use .csv, .xlsx o .xls`)
  }
  return mapRowsContacts(headers, rows, mode)
}
