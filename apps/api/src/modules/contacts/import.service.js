import * as XLSX from 'xlsx'
import { parse as csvParse } from 'csv-parse/sync'

// Nombres de columna aceptados para cada campo (case-insensitive)
const COL_EMAIL      = ['email', 'correo', 'e-mail', 'mail']
const COL_FIRST_NAME = ['first_name', 'firstname', 'nombre', 'name', 'first']
const COL_LAST_NAME  = ['last_name', 'lastname', 'apellido', 'surname', 'last']
const COL_PHONE = ['telefono', 'teléfono', 'phone', 'celular', 'movil', 'móvil', 'whatsapp', 'numero', 'número', 'msisdn', 'tel']

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

// ── Variante indexada por TELÉFONO (para campañas WhatsApp/SMS) ─────────────
// Igual que mapRows pero la clave obligatoria es el teléfono; el email es opcional.
function mapRowsByPhone(headers, rows) {
  const phoneCol     = findCol(headers, COL_PHONE)
  const firstNameCol = findCol(headers, COL_FIRST_NAME)
  const lastNameCol  = findCol(headers, COL_LAST_NAME)
  const emailCol     = findCol(headers, COL_EMAIL)

  if (!phoneCol) {
    throw new Error('No se encontro columna de telefono. Debe llamarse: telefono, phone, celular, movil o whatsapp')
  }

  const known = new Set([phoneCol, firstNameCol, lastNameCol, emailCol].filter(Boolean))
  const metaCols = headers.filter(h => !known.has(h))

  const contacts = []
  const skipped  = []

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const phoneRaw = String(row[phoneCol] ?? '').trim()
    const digits = phoneRaw.replace(/\D/g, '')
    if (!digits || digits.length < 6) {
      skipped.push({ row: i + 2, value: phoneRaw || '(vacio)', reason: 'telefono invalido' })
      continue
    }

    const metadata = {}
    for (const col of metaCols) {
      const val = row[col]
      if (val !== null && val !== undefined && val !== '') {
        metadata[normalize(col)] = String(val).trim()
      }
    }

    const email = emailCol ? String(row[emailCol] ?? '').trim().toLowerCase() : ''

    contacts.push({
      phone:      phoneRaw,
      email:      email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null,
      first_name: firstNameCol ? String(row[firstNameCol] ?? '').trim() || null : null,
      last_name:  lastNameCol  ? String(row[lastNameCol]  ?? '').trim() || null : null,
      metadata,
    })
  }

  return { contacts, skipped, total: rows.length, valid: contacts.length, columns: metaCols.map(normalize) }
}

export function parseFilePhone(buffer, filename) {
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
  return mapRowsByPhone(headers, rows)
}
