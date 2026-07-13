# Campañas por Asistente IA + WhatsApp/SMS manuales — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Añadir tres flujos de campaña — WhatsApp IA (asistente + Excel-plantilla derivada de sus `{{variables}}`, envía el saludo interpolado), WhatsApp manual y SMS con contador de segmentos — reutilizando el motor de campañas existente.

**Architecture:** Se añade `campaigns.assistant_id` para distinguir campaña IA de manual (mismo `channel='whatsapp'`). Las variables del asistente se extraen por regex de `greeting`+`system_prompt`; con ellas se genera un Excel-plantilla y, al subirlo, se crea una lista de contactos indexada por teléfono. El worker interpola `{{variables}}` en WhatsApp/SMS (hoy manda crudo) y, para campañas IA, envía el saludo del asistente desde números que tengan ese asistente vinculado.

**Tech Stack:** Node ESM, Fastify, `postgres` (SQL crudo), BullMQ, `xlsx` (SheetJS), Zod, Next.js 14 (App Router, JS), Tailwind. Runner de tests: `node --test` (nativo, sin dependencias nuevas).

## Global Constraints

- Node ESM en todo el backend (`import`/`export`, `"type":"module"` en `@kubo/api`).
- SQL con el tag `sql` de `postgres` (nunca concatenar strings). Fragmentos condicionales con `sql`` ` ``.
- Toda ruta va bajo `/api/v1` y usa `fastify.authenticate`; scope siempre `client_id = req.user.sub`.
- Rutas de asistentes/campañas IA: solo admin (`req.user.member_id` presente → 403), igual que las rutas existentes de asistentes.
- Regex de variables idéntico al del responder: `/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g`, claves en MAYÚSCULAS.
- Variables automáticas (NO van al Excel): `TELEFONO`, `NOMBRE`, `NOMBRE_CLIENTE`.
- Migraciones idempotentes (`IF NOT EXISTS`), numeradas en secuencia. La siguiente libre es **028**.
- Nueva dependencia = 0. `xlsx` ya está instalado en `@kubo/api`.
- Commits en la rama `feat/campanas-asistente-ia` (ya creada). No push a `main` sin aprobación (dispara auto-deploy).

---

### Task 1: Migración 028 — assistant_id en campaigns + source en contact_lists

**Files:**
- Create: `apps/api/src/db/migrations/028_campaign_assistant.sql`

**Interfaces:**
- Produces: columna `campaigns.assistant_id UUID NULL`, índice `idx_campaigns_assistant`; columna `contact_lists.source VARCHAR(30) DEFAULT 'manual'`.

- [ ] **Step 1: Escribir la migración**

Create `apps/api/src/db/migrations/028_campaign_assistant.sql`:

```sql
-- Campaña IA: vincula la campaña a un asistente. NULL = campaña manual (WhatsApp/SMS/email).
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS assistant_id UUID;
CREATE INDEX IF NOT EXISTS idx_campaigns_assistant ON campaigns(assistant_id);

-- Origen de la lista: 'campaign' marca listas creadas al subir un Excel dentro de una campaña.
ALTER TABLE contact_lists ADD COLUMN IF NOT EXISTS source VARCHAR(30) DEFAULT 'manual';
```

- [ ] **Step 2: Verificar sintaxis SQL localmente (dry parse)**

Run: `node -e "const s=require('fs').readFileSync('apps/api/src/db/migrations/028_campaign_assistant.sql','utf8'); if(!/assistant_id/.test(s)||!/contact_lists/.test(s)) throw new Error('contenido incompleto'); console.log('OK, longitud', s.length)"`
Expected: `OK, longitud <n>` sin errores.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/db/migrations/028_campaign_assistant.sql
git commit -m "feat(db): migracion 028 assistant_id en campaigns + source en contact_lists"
```

---

### Task 2: Utilidad compartida de variables (`assistant.vars.js`)

Extrae la lógica de variables a un módulo puro, testeable sin BD, reutilizable por el responder (ya existente), el generador de plantilla y el sender.

**Files:**
- Create: `apps/api/src/modules/assistants/assistant.vars.js`
- Create: `apps/api/src/modules/assistants/assistant.vars.test.js`
- Modify: `apps/api/src/modules/assistants/assistant.responder.js` (importar `resolveVars` en vez de la copia local)
- Modify: `apps/api/package.json` (script `test`)

**Interfaces:**
- Produces:
  - `VAR_RE: RegExp` (global) — `/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g`
  - `AUTO_VARS: Set<string>` — `{'TELEFONO','NOMBRE','NOMBRE_CLIENTE'}`
  - `extractVars(assistant): string[]` — variables en MAYÚSCULAS de `greeting`+`system_prompt`, sin las automáticas, dedupe, en orden de aparición.
  - `resolveVars(text, ctx): string` — reemplaza `{{VAR}}` por `ctx[VAR.toUpperCase()]` (vacío si falta).
  - `buildContextFromContact(contact, phone): object` — `{ TELEFONO, NOMBRE_CLIENTE, NOMBRE, ...metadataEnMayusculas }` (sin tocar BD).

- [ ] **Step 1: Escribir el test que falla**

Create `apps/api/src/modules/assistants/assistant.vars.test.js`:

```js
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
```

- [ ] **Step 2: Añadir el script de test y correrlo para verlo fallar**

Modify `apps/api/package.json` — añadir a `"scripts"` la línea `"test"` (dejando las demás intactas):

```json
  "scripts": {
    "dev": "node --watch src/app.js",
    "start": "node src/app.js",
    "migrate": "node src/db/migrate.js",
    "seed": "node src/db/seed.js",
    "test": "node --test"
  },
```

Run: `npm test -w apps/api`
Expected: FALLA con `Cannot find module ... assistant.vars.js`.

- [ ] **Step 3: Implementar el módulo**

Create `apps/api/src/modules/assistants/assistant.vars.js`:

```js
// Utilidades puras de variables {{...}} de los asistentes. Sin acceso a BD.

export const VAR_RE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g

// Variables que NO provienen del Excel: se resuelven de los datos del contacto.
export const AUTO_VARS = new Set(['TELEFONO', 'NOMBRE', 'NOMBRE_CLIENTE'])

// Variables de Excel de un asistente: escanea greeting + system_prompt, MAYÚSCULAS,
// quita las automáticas, dedupe conservando el orden de aparición.
export function extractVars(assistant) {
  const text = `${assistant?.greeting ?? ''}\n${assistant?.system_prompt ?? ''}`
  const seen = new Set()
  const out = []
  for (const m of text.matchAll(VAR_RE)) {
    const key = m[1].toUpperCase()
    if (AUTO_VARS.has(key) || seen.has(key)) continue
    seen.add(key)
    out.push(key)
  }
  return out
}

// Reemplaza {{VAR}} por ctx[VAR] (MAYÚSCULAS). Variable sin valor → cadena vacía.
export function resolveVars(text, ctx) {
  if (!text) return ''
  return text.replace(VAR_RE, (_, k) => {
    const v = ctx[k.toUpperCase()]
    return v == null ? '' : String(v)
  })
}

// Contexto de variables a partir de un contacto ya cargado (no toca BD).
export function buildContextFromContact(contact, phone) {
  const ctx = { TELEFONO: phone ?? '' }
  const full = [contact?.first_name, contact?.last_name].filter(Boolean).join(' ')
  ctx.NOMBRE_CLIENTE = full || ''
  ctx.NOMBRE = contact?.first_name || ''
  const meta = contact?.metadata && typeof contact.metadata === 'object' ? contact.metadata : {}
  for (const [k, v] of Object.entries(meta)) ctx[k.toUpperCase()] = v == null ? '' : String(v)
  return ctx
}
```

- [ ] **Step 4: Correr el test hasta que pase**

Run: `npm test -w apps/api`
Expected: PASA (4 tests ok).

- [ ] **Step 5: DRY — el responder reutiliza `resolveVars`**

Modify `apps/api/src/modules/assistants/assistant.responder.js`:
- Añadir al bloque de imports (después de la línea `import { isActiveNow } ...`):

```js
import { resolveVars } from './assistant.vars.js'
```

- Borrar la función local `resolveVars` (líneas 11-19, el bloque `// Reemplaza {{VARIABLE}}...` hasta su `}`). El resto del archivo queda igual (sigue usando `resolveVars(...)`).

- [ ] **Step 6: Verificar que el responder sigue cargando**

Run: `node --check apps/api/src/modules/assistants/assistant.responder.js`
Expected: sin salida (sintaxis OK).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/assistants/assistant.vars.js apps/api/src/modules/assistants/assistant.vars.test.js apps/api/src/modules/assistants/assistant.responder.js apps/api/package.json
git commit -m "feat(assistants): utilidad compartida de variables + tests; responder reutiliza resolveVars"
```

---

### Task 3: Segmentación SMS (`lib/sms-segments.js`)

**Files:**
- Create: `apps/api/src/lib/sms-segments.js`
- Create: `apps/api/src/lib/sms-segments.test.js`

**Interfaces:**
- Produces: `smsSegmentInfo(text): { encoding: 'GSM7'|'UCS2', length: number, segments: number }`
  - GSM-7: ≤160 → 1 segmento; si >160 → segmentos de 153.
  - UCS-2 (algún carácter fuera del set GSM-7, p. ej. emoji): ≤70 → 1; si >70 → segmentos de 67.
  - Caracteres de extensión GSM-7 (`^{}\[~]|€`) cuentan como 2.

- [ ] **Step 1: Escribir el test que falla**

Create `apps/api/src/lib/sms-segments.test.js`:

```js
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
```

- [ ] **Step 2: Correr el test para verlo fallar**

Run: `npm test -w apps/api`
Expected: FALLA con `Cannot find module ... sms-segments.js`.

- [ ] **Step 3: Implementar**

Create `apps/api/src/lib/sms-segments.js`:

```js
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
```

- [ ] **Step 4: Correr el test hasta que pase**

Run: `npm test -w apps/api`
Expected: PASA (todos los tests, incluidos Task 2).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/sms-segments.js apps/api/src/lib/sms-segments.test.js
git commit -m "feat(sms): utilidad de segmentacion GSM-7/UCS-2 con tests"
```

---

### Task 4: Generación del Excel-plantilla + endpoint

**Files:**
- Create: `apps/api/src/modules/assistants/assistant.template.js`
- Create: `apps/api/src/modules/assistants/assistant.template.test.js`
- Modify: `apps/api/src/modules/assistants/assistants.routes.js`

**Interfaces:**
- Consumes: `extractVars` (Task 2).
- Produces:
  - `buildAssistantTemplate(assistant): Buffer` — xlsx con hoja "Contactos"; fila 1 = headers `['telefono','nombre', ...vars.map(minúsculas)]`; fila 2 = ejemplo.
  - Endpoint `GET /whatsapp/assistants/:id/plantilla.xlsx` → descarga el buffer.

- [ ] **Step 1: Escribir el test que falla**

Create `apps/api/src/modules/assistants/assistant.template.test.js`:

```js
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
```

- [ ] **Step 2: Correr para verlo fallar**

Run: `npm test -w apps/api`
Expected: FALLA con `Cannot find module ... assistant.template.js`.

- [ ] **Step 3: Implementar el generador**

Create `apps/api/src/modules/assistants/assistant.template.js`:

```js
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
```

- [ ] **Step 4: Correr el test hasta que pase**

Run: `npm test -w apps/api`
Expected: PASA.

- [ ] **Step 5: Añadir el endpoint de descarga**

Modify `apps/api/src/modules/assistants/assistants.routes.js`:
- Añadir import tras la línea 2 (`import { sql } ...`):

```js
import { buildAssistantTemplate } from './assistant.template.js'
```

- Dentro de `assistantsRoutes`, después del handler `PUT /whatsapp/assistants/:id/accounts` (cierre en línea 105) y antes del cierre de la función, añadir:

```js
  // Descargar plantilla Excel con las columnas derivadas de las variables del asistente.
  fastify.get('/whatsapp/assistants/:id/plantilla.xlsx', { onRequest: pre }, async (req, reply) => {
    if (!adminOnly(req, reply)) return
    const [asst] = await sql`SELECT * FROM wa_assistants WHERE id = ${req.params.id} AND client_id = ${req.user.sub}`
    if (!asst) return reply.code(404).send({ error: 'Asistente no encontrado' })

    const buf = buildAssistantTemplate(asst)
    const safe = String(asst.name).replace(/[^a-z0-9]/gi, '_')
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    reply.header('Content-Disposition', `attachment; filename="plantilla-${safe}.xlsx"`)
    return reply.send(buf)
  })
```

- [ ] **Step 6: Verificar sintaxis**

Run: `node --check apps/api/src/modules/assistants/assistants.routes.js`
Expected: sin salida.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/assistants/assistant.template.js apps/api/src/modules/assistants/assistant.template.test.js apps/api/src/modules/assistants/assistants.routes.js
git commit -m "feat(assistants): generacion y endpoint de Excel-plantilla por variables"
```

---

### Task 5: Import por teléfono + endpoint de destinatarios de campaña

**Files:**
- Modify: `apps/api/src/modules/contacts/import.service.js` (añadir `parseFilePhone`)
- Create: `apps/api/src/modules/contacts/phone-import.service.js` (`upsertContactsByPhone`)
- Create: `apps/api/src/modules/contacts/import.phone.test.js`
- Modify: `apps/api/src/modules/campaigns/campaigns.routes.js` (endpoint `POST /campaigns/import-recipients`)

**Interfaces:**
- Consumes: `parseExcel`/`parseCSV` internals (reusa `normalize`, `findCol`), `splitPhone`, `extractVars`.
- Produces:
  - `parseFilePhone(buffer, filename): { contacts: Array<{phone,email,first_name,last_name,metadata}>, skipped, total, valid, columns: string[] }` (`columns` = claves de metadata detectadas, normalizadas).
  - `upsertContactsByPhone(clientId, listId, rows): Promise<number>` — dedup por teléfono completo, fusiona metadata, crea `contacts` + `contact_phones` (+ `contact_emails` si hay email).
  - Endpoint `POST /campaigns/import-recipients?assistant_id=&name=` (multipart) → `{ list_id, list_name, total, columns, variables_faltantes }`.

- [ ] **Step 1: Escribir el test de parseo que falla**

Create `apps/api/src/modules/contacts/import.phone.test.js`:

```js
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
  const r = parseFilePhone(csv('telefono,nombre\n,SinTel\n51988,Ok\n'), 'x.csv')
  assert.equal(r.valid, 1)
  assert.equal(r.contacts[0].first_name, 'Ok')
})

test('parseFilePhone: sin columna teléfono lanza error', () => {
  assert.throws(() => parseFilePhone(csv('nombre,dni\nJuan,1\n'), 'x.csv'), /tel[eé]fono/i)
})
```

- [ ] **Step 2: Correr para verlo fallar**

Run: `npm test -w apps/api`
Expected: FALLA (`parseFilePhone is not a function`).

- [ ] **Step 3: Implementar `parseFilePhone` en el importador**

Modify `apps/api/src/modules/contacts/import.service.js`:
- Tras la constante `COL_LAST_NAME` (línea 7), añadir:

```js
const COL_PHONE = ['telefono', 'teléfono', 'phone', 'celular', 'movil', 'móvil', 'whatsapp', 'numero', 'número', 'msisdn', 'tel']
```

- Al final del archivo (tras `parseFile`, línea 94), añadir:

```js
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
```

- [ ] **Step 4: Correr el test hasta que pase**

Run: `npm test -w apps/api`
Expected: PASA.

- [ ] **Step 5: Implementar `upsertContactsByPhone`**

Create `apps/api/src/modules/contacts/phone-import.service.js`:

```js
import { sql } from '../../lib/db.js'
import { splitPhone } from '../../lib/phone.js'

// Upsert de contactos deduplicando por TELÉFONO dentro de la lista. Fusiona metadata
// (las columnas nuevas se agregan/actualizan sin borrar las previas). Crea contact_phones.
export async function upsertContactsByPhone(clientId, listId, rows) {
  const map = new Map()
  for (const r of rows) {
    const sp = splitPhone(r.phone, { country: r.phone_country, dial: r.phone_dial })
    if (!sp.national) continue
    const full = `${sp.dial ?? ''}${sp.national}`
    map.set(full, { ...r, sp, full }) // la última fila del mismo teléfono gana
  }
  const deduped = [...map.values()]
  if (!deduped.length) return 0

  const fulls = deduped.map(r => r.full)
  const existing = await sql`
    SELECT (COALESCE(cp.phone_dial,'') || cp.phone) AS full, cp.contact_id
    FROM contact_phones cp
    JOIN contacts c ON c.id = cp.contact_id
    WHERE c.list_id = ${listId} AND (COALESCE(cp.phone_dial,'') || cp.phone) IN ${sql(fulls)}
  `
  const byFull = new Map(existing.map(e => [e.full, e.contact_id]))

  for (const r of deduped) {
    if (byFull.has(r.full)) {
      await sql`
        UPDATE contacts
        SET first_name = COALESCE(${r.first_name ?? null}, first_name),
            last_name  = COALESCE(${r.last_name ?? null}, last_name),
            metadata   = COALESCE(metadata, '{}'::jsonb) || ${sql.json(r.metadata ?? {})}
        WHERE id = ${byFull.get(r.full)}
      `
    } else {
      const [contact] = await sql`
        INSERT INTO contacts (client_id, list_id, first_name, last_name, metadata)
        VALUES (${clientId}, ${listId}, ${r.first_name ?? null}, ${r.last_name ?? null}, ${sql.json(r.metadata ?? {})})
        RETURNING id
      `
      await sql`
        INSERT INTO contact_phones (contact_id, client_id, phone, phone_dial, phone_country, label, is_primary)
        VALUES (${contact.id}, ${clientId}, ${r.sp.national}, ${r.sp.dial || null}, ${r.sp.country || null}, 'Móvil', true)
        ON CONFLICT (contact_id, phone) DO NOTHING
      `
      if (r.email) {
        await sql`
          INSERT INTO contact_emails (contact_id, client_id, email, label, is_primary)
          VALUES (${contact.id}, ${clientId}, ${r.email}, 'Principal', true)
          ON CONFLICT (contact_id, email) DO NOTHING
        `
      }
    }
  }
  return deduped.length
}
```

- [ ] **Step 6: Añadir el endpoint `POST /campaigns/import-recipients`**

Modify `apps/api/src/modules/campaigns/campaigns.routes.js`:
- Añadir imports tras la línea 3:

```js
import { parseFilePhone } from '../contacts/import.service.js'
import { upsertContactsByPhone } from '../contacts/phone-import.service.js'
import { extractVars } from '../assistants/assistant.vars.js'
```

- Dentro de `campaignsRoutes`, tras `const auth = ...` (línea 43), añadir el handler:

```js
  // Subir Excel de destinatarios (por teléfono) → crea una lista reutilizable.
  // Query: ?assistant_id=<uuid opcional>&name=<nombre base>
  fastify.post('/campaigns/import-recipients', auth, async (req, reply) => {
    const file = await req.file()
    if (!file) return reply.code(400).send({ error: 'No se recibió archivo' })

    const filename = file.filename ?? 'file.xlsx'
    const ext = filename.split('.').pop().toLowerCase()
    if (!['csv', 'xlsx', 'xls'].includes(ext)) {
      return reply.code(400).send({ error: 'Formato no soportado. Use .csv, .xlsx o .xls' })
    }

    const chunks = []
    for await (const chunk of file.file) chunks.push(chunk)
    const buffer = Buffer.concat(chunks)
    if (buffer.length === 0) return reply.code(400).send({ error: 'El archivo está vacío' })
    if (buffer.length > 10 * 1024 * 1024) return reply.code(400).send({ error: 'El archivo supera el límite de 10MB' })

    let parsed
    try {
      parsed = parseFilePhone(buffer, filename)
    } catch (err) {
      return reply.code(422).send({ error: err.message })
    }
    if (parsed.contacts.length === 0) {
      return reply.code(422).send({ error: 'No se encontraron destinatarios válidos', skipped: parsed.skipped.slice(0, 20) })
    }

    const baseName = String(req.query.name ?? 'Campaña').slice(0, 200)
    const [list] = await sql`
      INSERT INTO contact_lists (client_id, name, description, source)
      VALUES (${req.user.sub}, ${baseName + ' — destinatarios'}, 'Generada desde campaña', 'campaign')
      RETURNING *
    `

    const BATCH = 1000
    let imported = 0
    for (let i = 0; i < parsed.contacts.length; i += BATCH) {
      imported += await upsertContactsByPhone(req.user.sub, list.id, parsed.contacts.slice(i, i + BATCH))
    }
    await sql`
      UPDATE contact_lists SET total_count = (SELECT COUNT(*) FROM contacts WHERE list_id = ${list.id})
      WHERE id = ${list.id}
    `

    // Variables del asistente que NO vienen como columna en el Excel.
    let variables_faltantes = []
    if (req.query.assistant_id) {
      const [asst] = await sql`SELECT * FROM wa_assistants WHERE id = ${req.query.assistant_id} AND client_id = ${req.user.sub}`
      if (asst) {
        const cols = new Set(parsed.columns.map(c => c.toUpperCase()))
        variables_faltantes = extractVars(asst).filter(v => !cols.has(v))
      }
    }

    return { list_id: list.id, list_name: list.name, total: imported, columns: parsed.columns, variables_faltantes }
  })
```

- [ ] **Step 7: Verificar sintaxis**

Run: `node --check apps/api/src/modules/campaigns/campaigns.routes.js && node --check apps/api/src/modules/contacts/phone-import.service.js`
Expected: sin salida.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/contacts/import.service.js apps/api/src/modules/contacts/phone-import.service.js apps/api/src/modules/contacts/import.phone.test.js apps/api/src/modules/campaigns/campaigns.routes.js
git commit -m "feat(campaigns): import de destinatarios por telefono + endpoint import-recipients"
```

---

### Task 6: Campaña IA en el schema y creación (`campaigns.routes.js`)

**Files:**
- Modify: `apps/api/src/modules/campaigns/campaigns.routes.js` (schema, refine, INSERT, validación de números)

**Interfaces:**
- Consumes: tablas `whatsapp_accounts` (columna `assistant_id`), `wa_assistants`.
- Produces: campo `assistant_id` persistido en `campaigns`; `settings.wa_account_ids` en el JSONB.

- [ ] **Step 1: Extender el schema de validación**

Modify `apps/api/src/modules/campaigns/campaigns.routes.js`:
- En `campaignBase`, tras `media_caption` (línea 18), añadir dentro del objeto:

```js
  // WhatsApp IA
  assistant_id: z.string().uuid().optional().nullable(),
```

- En el objeto `settings` (tras `send_to_all`, línea 30), añadir:

```js
    wa_account_ids: z.array(z.string().uuid()).optional(),  // pool de números para campaña IA
```

- Reemplazar el `campaignSchema` (líneas 34-40) por:

```js
// email: asunto/remitente/HTML. WhatsApp/SMS manual: mensaje. WhatsApp IA: asistente (sin mensaje).
const campaignSchema = campaignBase.refine(
  d => {
    if (d.assistant_id) return d.channel === 'whatsapp'
    if (d.channel === 'email') return !!(d.subject && d.from_name && d.html_content)
    return !!(d.content_text && d.content_text.trim())
  },
  { message: 'Faltan campos requeridos para el tipo de campaña' },
)
```

- [ ] **Step 2: Validar los números en la creación e insertar `assistant_id`**

En el handler `POST /campaigns` (a partir de línea 66), tras la validación de la lista (línea 70, después del `if (!list) ...`), añadir:

```js
    // Campaña IA: los números elegidos deben existir y tener ese asistente vinculado.
    if (body.assistant_id) {
      const wanted = body.settings?.wa_account_ids ?? []
      if (!wanted.length) return reply.code(400).send({ error: 'Selecciona al menos un número de WhatsApp para la campaña IA' })
      const linked = await sql`
        SELECT id FROM whatsapp_accounts
        WHERE client_id = ${req.user.sub} AND assistant_id = ${body.assistant_id} AND id IN ${sql(wanted)}
      `
      if (linked.length !== wanted.length) {
        return reply.code(400).send({ error: 'Todos los números deben tener el asistente seleccionado vinculado' })
      }
    }
```

- Reemplazar el `INSERT INTO campaigns (...) VALUES (...)` (líneas 76-89) por la versión con `assistant_id`:

```js
    const [campaign] = await sql`
      INSERT INTO campaigns (
        client_id, name, channel, subject, from_name, reply_to, html_content, text_content,
        content_text, media_url, media_caption, list_id, strategy, scheduled_at, settings,
        total_recipients, assistant_id
      )
      VALUES (
        ${req.user.sub}, ${body.name}, ${body.channel}, ${subject}, ${fromName},
        ${body.reply_to ?? null}, ${body.html_content ?? null}, ${body.text_content ?? null},
        ${body.content_text ?? null}, ${body.media_url || null}, ${body.media_caption ?? null},
        ${body.list_id}, ${body.strategy}, ${body.scheduled_at ?? null},
        ${sql.json(body.settings)}, ${list.total_count}, ${body.assistant_id ?? null}
      )
      RETURNING *
    `
```

- [ ] **Step 3: Verificar sintaxis**

Run: `node --check apps/api/src/modules/campaigns/campaigns.routes.js`
Expected: sin salida.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/campaigns/campaigns.routes.js
git commit -m "feat(campaigns): soporte assistant_id y pool de numeros en creacion"
```

---

### Task 7: Envío — interpolación de variables + saludo IA + pool restringido

**Files:**
- Modify: `apps/api/src/modules/channels/channel.sender.js`
- Modify: `apps/api/src/workers/campaign.queue.js`

**Interfaces:**
- Consumes: `resolveVars`, `buildContextFromContact` (Task 2).
- Produces: `pickWhatsappAccount(clientId, { assistantId, accountIds })` con filtros opcionales; `sendWhatsapp`/`sendSms` interpolan variables; campaña IA envía `wa_assistants.greeting` interpolado.

- [ ] **Step 1: Actualizar `channel.sender.js`**

Modify `apps/api/src/modules/channels/channel.sender.js`:
- Añadir import tras la línea 5:

```js
import { resolveVars, buildContextFromContact } from '../assistants/assistant.vars.js'
```

- Reemplazar `pickWhatsappAccount` (líneas 21-33) por:

```js
// Selecciona la cuenta con menor carga proporcional (sent_today / daily_limit).
// Opcional: filtra por asistente vinculado y/o por un pool de IDs (campaña IA).
export async function pickWhatsappAccount(clientId, { assistantId = null, accountIds = null } = {}) {
  const accounts = await sql`
    SELECT * FROM whatsapp_accounts
    WHERE client_id = ${clientId}
      AND is_active = true
      AND is_connected = true
      AND sent_today < daily_limit
      AND banned_at IS NULL
      AND COALESCE(risk_level, 'green') <> 'red'
      ${assistantId ? sql`AND assistant_id = ${assistantId}` : sql``}
      ${accountIds && accountIds.length ? sql`AND id IN ${sql(accountIds)}` : sql``}
    ORDER BY (sent_today::float / daily_limit) ASC
  `
  return accounts.find(isWithinActiveHours) ?? null
}
```

- Reemplazar `sendWhatsapp` (líneas 47-75) por:

```js
export async function sendWhatsapp({ campaign, contact, account }) {
  // El número se guarda separado (phone_dial + phone). Aquí se concatena el completo.
  const phone = fullPhone(contact) ?? contact.metadata?.phone ?? null
  if (!phone) throw new Error('Contacto sin número de teléfono')

  const ctx = buildContextFromContact(contact, phone)

  // Campaña IA: el mensaje es el saludo del asistente. Manual: el content_text.
  let bodyTpl = campaign.content_text ?? ''
  if (campaign.assistant_id) {
    const [asst] = await sql`SELECT greeting FROM wa_assistants WHERE id = ${campaign.assistant_id}`
    bodyTpl = asst?.greeting ?? ''
  }
  const body = resolveVars(bodyTpl, ctx)

  const payload = {
    to:           phone,
    body,
    mediaUrl:     campaign.media_url ?? undefined,
    mediaType:    campaign.settings?.media_type ?? 'image',
    mediaCaption: campaign.media_caption ? resolveVars(campaign.media_caption, ctx) : undefined,
  }

  let result
  if (account.provider === 'baileys') {
    result = await baileysManager.send(account.instance_name, payload)
  } else {
    const adapter = new EvolutionAdapter(account)
    result = await adapter.send(payload)
  }

  await sql`
    UPDATE whatsapp_accounts
    SET sent_today = sent_today + 1, last_used_at = now()
    WHERE id = ${account.id}
  `

  return result?.key?.id ?? result?.id ?? null
}
```

- Reemplazar `sendSms` (líneas 77-92) por:

```js
export async function sendSms({ campaign, contact, account }) {
  const adapter = new AndroidSmsAdapter(account)

  const phone = contact.metadata?.phone ?? fullPhone(contact) ?? contact.phone_number ?? null
  if (!phone) throw new Error('Contacto sin número de teléfono')

  const ctx = buildContextFromContact(contact, phone)
  const body = resolveVars(campaign.content_text ?? '', ctx)

  const result = await adapter.send({ to: phone, body })

  await sql`
    UPDATE sms_accounts
    SET sent_today = sent_today + 1, last_used_at = now()
    WHERE id = ${account.id}
  `

  return result?.id ?? null
}
```

- [ ] **Step 2: Restringir el pool en el worker**

Modify `apps/api/src/workers/campaign.queue.js`:
- Reemplazar el bloque WhatsApp del worker (líneas 112-117) por:

```js
      if (channel === 'whatsapp') {
        // ── WhatsApp (Baileys/Evolution). Campaña IA → pool con el asistente vinculado.
        const account = await pickWhatsappAccount(campaign.client_id, {
          assistantId: campaign.assistant_id ?? null,
          accountIds:  campaign.settings?.wa_account_ids ?? null,
        })
        if (!account) throw new Error('No hay cuentas WhatsApp disponibles con cuota (o ninguna con el asistente vinculado)')
        messageId = await sendWhatsapp({ campaign, contact: sendContact, account })
        accountId = account.id
```

- [ ] **Step 3: Verificar sintaxis de ambos**

Run: `node --check apps/api/src/modules/channels/channel.sender.js && node --check apps/api/src/workers/campaign.queue.js`
Expected: sin salida.

- [ ] **Step 4: Verificar que toda la suite de tests sigue verde**

Run: `npm test -w apps/api`
Expected: PASA (todos los tests de Tasks 2-5).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/channels/channel.sender.js apps/api/src/workers/campaign.queue.js
git commit -m "feat(campaigns): interpolacion de variables en WA/SMS + saludo IA + pool restringido"
```

---

### Task 8: Contador de segmentos SMS en el frontend

**Files:**
- Create: `apps/web/src/lib/sms.js`
- Modify: `apps/web/src/app/dashboard/campaigns/new/page.jsx` (paso Mensaje, canal SMS)

**Interfaces:**
- Produces: `smsSegments(text): { encoding, length, segments }` (misma lógica que `lib/sms-segments.js`, para uso en cliente).

- [ ] **Step 1: Crear la utilidad de cliente**

Create `apps/web/src/lib/sms.js`:

```js
// Segmentación SMS en cliente (espejo de apps/api/src/lib/sms-segments.js).
const GSM7_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ ÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
  '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'
const GSM7_EXT = '^{}\\[~]|€'
const basic = new Set([...GSM7_BASIC])
const ext = new Set([...GSM7_EXT])

export function smsSegments(text) {
  const str = String(text ?? '')
  const chars = [...str]
  let isGsm = true
  let units = 0
  for (const ch of chars) {
    if (basic.has(ch)) units += 1
    else if (ext.has(ch)) units += 2
    else { isGsm = false; break }
  }
  if (isGsm) {
    return { encoding: 'GSM7', length: chars.length, segments: units <= 160 ? 1 : Math.ceil(units / 153) }
  }
  const u = str.length
  return { encoding: 'UCS2', length: chars.length, segments: u <= 70 ? 1 : Math.ceil(u / 67) }
}
```

- [ ] **Step 2: Usarla en el paso de mensaje (canal SMS)**

Modify `apps/web/src/app/dashboard/campaigns/new/page.jsx`:
- Añadir el import al inicio del archivo (junto a los demás imports):

```js
import { smsSegments } from '@/lib/sms'
```

- En el bloque del textarea de WA/SMS (donde hoy se muestra `{form.content_text.length} caracteres`), sustituir ese contador por uno que, cuando el canal sea SMS, muestre segmentos y aviso. Localiza el `<textarea>` de `content_text` y su línea de conteo, y reemplaza la línea de conteo por:

```jsx
              {channel === 'sms' ? (() => {
                const s = smsSegments(form.content_text)
                return (
                  <p className={`text-xs mt-1 ${s.segments > 1 ? 'text-amber-600' : 'text-gray-500'}`}>
                    {s.length} caracteres · {s.segments} segmento{s.segments !== 1 ? 's' : ''} ({s.encoding === 'UCS2' ? 'Unicode 70/seg' : 'GSM 160/seg'})
                    {s.segments > 1 && ' — supera un SMS: se enviará en varios mensajes por teléfono.'}
                  </p>
                )
              })() : (
                <p className="text-xs mt-1 text-gray-500">{form.content_text.length} caracteres</p>
              )}
```

(Nota para el implementador: leer el archivo primero e insertar respetando el nombre real de la variable de canal — en el análisis es `channel`/`form.content_text`. Ajustar si difiere.)

- [ ] **Step 3: Verificar build del front**

Run: `npm run build -w apps/web`
Expected: build exitoso (o al menos sin errores nuevos en el archivo modificado).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/sms.js apps/web/src/app/dashboard/campaigns/new/page.jsx
git commit -m "feat(web): contador de segmentos SMS en el wizard de campanas"
```

---

### Task 9: Tipo "WhatsApp IA" en el wizard (selector + paso de asistente/Excel/números)

**Files:**
- Modify: `apps/web/src/app/dashboard/campaigns/new/page.jsx`

**Interfaces:**
- Consumes: `GET /whatsapp/assistants` (lista `{ assistants, accounts }`), `GET /whatsapp/assistants/:id/plantilla.xlsx`, `POST /campaigns/import-recipients`, `POST /campaigns`.
- Produces: en el submit, cuando es IA, envía `{ channel:'whatsapp', assistant_id, list_id, settings:{ wa_account_ids } }` sin `content_text`.

Este task integra sobre un archivo grande. El implementador DEBE leer `apps/web/src/app/dashboard/campaigns/new/page.jsx` completo antes de editar y seguir sus patrones (estado `form`, `channel`, `apiClient`/axios, pasos).

- [ ] **Step 1: Añadir la 4.ª tarjeta de tipo "WhatsApp IA"**

En el selector de canal (las 3 tarjetas Email/WhatsApp/SMS), añadir una 4.ª tarjeta "🤖 WhatsApp IA". Al elegirla, fijar `channel='whatsapp'` y un flag de modo IA (p. ej. `setIsAI(true)`; para los otros tipos `setIsAI(false)`). Reutilizar el handler `pickChannel` existente añadiéndole el flag.

- [ ] **Step 2: Cargar asistentes y números al entrar en modo IA**

Añadir estado y carga:

```jsx
const [isAI, setIsAI] = useState(false)
const [assistants, setAssistants] = useState([])
const [waAccounts, setWaAccounts] = useState([])
const [assistantId, setAssistantId] = useState('')
const [selectedAccIds, setSelectedAccIds] = useState([])
const [importInfo, setImportInfo] = useState(null) // { list_id, total, variables_faltantes }
const [importing, setImporting] = useState(false)

useEffect(() => {
  if (!isAI) return
  apiClient.get('/whatsapp/assistants')
    .then(r => { setAssistants(r.data.assistants ?? []); setWaAccounts(r.data.accounts ?? []) })
    .catch(() => {})
}, [isAI])
```

(Usar el cliente HTTP real del archivo — en el proyecto es axios vía `@/lib/api`. Ajustar el nombre.)

- [ ] **Step 3: Paso IA — asistente, plantilla, Excel, números**

Cuando `isAI`, renderizar (en el paso de "Mensaje"/configuración IA) estos controles:

```jsx
{isAI && (
  <div className="space-y-4">
    {/* Asistente */}
    <div>
      <label className="text-sm font-medium">Asistente IA</label>
      <select className="w-full border rounded p-2" value={assistantId}
        onChange={e => { setAssistantId(e.target.value); setSelectedAccIds([]); setImportInfo(null) }}>
        <option value="">Selecciona un asistente…</option>
        {assistants.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
    </div>

    {assistantId && (
      <>
        {/* Descargar plantilla */}
        <a className="inline-block text-sm underline text-blue-600"
           href={`${API_BASE}/whatsapp/assistants/${assistantId}/plantilla.xlsx`}
           /* si el endpoint requiere token en header, descargar via fetch+blob en su lugar */>
          ⬇ Descargar plantilla Excel
        </a>

        {/* Subir Excel lleno */}
        <div>
          <label className="text-sm font-medium">Subir Excel de destinatarios</label>
          <input type="file" accept=".xlsx,.xls,.csv" disabled={importing}
            onChange={async e => {
              const file = e.target.files?.[0]; if (!file) return
              setImporting(true)
              try {
                const fd = new FormData(); fd.append('file', file)
                const q = `?assistant_id=${assistantId}&name=${encodeURIComponent(form.name || 'Campaña')}`
                const r = await apiClient.post(`/campaigns/import-recipients${q}`, fd)
                setImportInfo(r.data)
              } catch (err) {
                alert(err?.response?.data?.error ?? 'Error al subir el Excel')
              } finally { setImporting(false) }
            }} />
        </div>

        {importInfo && (
          <div className="text-sm bg-gray-50 border rounded p-3">
            <p>✅ {importInfo.total} destinatarios cargados.</p>
            {importInfo.variables_faltantes?.length > 0 && (
              <p className="text-amber-600">⚠ Faltan columnas para: {importInfo.variables_faltantes.join(', ')} (quedarán vacías).</p>
            )}
          </div>
        )}

        {/* Números con el asistente vinculado */}
        <div>
          <label className="text-sm font-medium">Números de WhatsApp (con este asistente)</label>
          {waAccounts.filter(w => w.assistant_id === assistantId).length === 0 && (
            <p className="text-xs text-red-600">Ningún número tiene este asistente vinculado. Vincúlalo en Asistentes IA.</p>
          )}
          {waAccounts.filter(w => w.assistant_id === assistantId).map(w => (
            <label key={w.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={selectedAccIds.includes(w.id)}
                onChange={e => setSelectedAccIds(ids => e.target.checked ? [...ids, w.id] : ids.filter(x => x !== w.id))} />
              {w.name} · {w.phone_number}
            </label>
          ))}
        </div>
      </>
    )}
  </div>
)}
```

(`API_BASE` = `process.env.NEXT_PUBLIC_API_URL`. Si el endpoint de plantilla requiere JWT en header, cambiar el `<a href>` por una descarga `fetch`+`blob` con el token del cliente axios.)

- [ ] **Step 4: Ajustar el submit para el modo IA**

En el handler de envío del formulario, cuando `isAI`, construir el payload sin `content_text`:

```jsx
if (isAI) {
  if (!assistantId) return alert('Selecciona un asistente')
  if (!importInfo?.list_id) return alert('Sube el Excel de destinatarios')
  if (selectedAccIds.length === 0) return alert('Selecciona al menos un número')
  payload = {
    name: form.name,
    channel: 'whatsapp',
    assistant_id: assistantId,
    list_id: importInfo.list_id,
    scheduled_at: form.scheduled_at || undefined,
    settings: { ...(payload?.settings ?? {}), wa_account_ids: selectedAccIds, send_to_all: true },
  }
}
// ... luego el POST /campaigns existente usa `payload`
```

(Integrar respetando cómo el archivo arma hoy `payload`. La clave: para IA, `list_id` viene de `importInfo`, no del selector de listas; ocultar el selector de lista y el textarea de mensaje cuando `isAI`.)

- [ ] **Step 5: Verificar build**

Run: `npm run build -w apps/web`
Expected: build exitoso.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/dashboard/campaigns/new/page.jsx
git commit -m "feat(web): tipo de campana WhatsApp IA (asistente + plantilla Excel + pool de numeros)"
```

---

### Task 10: Verificación E2E manual (local con Docker) y checklist final

**Files:** ninguno (verificación).

- [ ] **Step 1: Levantar entorno local**

Run: `docker compose up -d postgres redis` y luego `npm run dev` (o `docker compose up -d --build`).
Correr migraciones: `npm run migrate -w apps/api` — verificar en logs `aplicando 028_campaign_assistant.sql`.

- [ ] **Step 2: Flujo campaña IA (contra local)**

1. Crear/usar un asistente con `greeting` que use `{{NOMBRE_CLIENTE}}` y `{{DNI}}`, y vincularlo a un número WhatsApp conectado.
2. En Campañas → Nueva → WhatsApp IA: elegir asistente, descargar plantilla (verificar columnas `telefono, nombre, dni`), llenarla con 1 teléfono propio de prueba, subirla (verificar preview de total y faltantes), elegir el número, crear y enviar.
3. Verificar que llega el saludo con `{{NOMBRE_CLIENTE}}`/`{{DNI}}` interpolados; responder desde el móvil y confirmar que el asistente contesta usando el DNI (viene de `contacts.metadata`).

- [ ] **Step 3: Flujo WhatsApp manual y SMS**

1. WhatsApp manual: lista existente + `content_text` con `{{NOMBRE}}` → verificar interpolación al enviar.
2. SMS: escribir >160 caracteres → verificar el aviso de segmentos en el wizard; enviar y confirmar recepción.

- [ ] **Step 4: Suite de tests final**

Run: `npm test -w apps/api`
Expected: PASA todo.

- [ ] **Step 5: Deploy (requiere aprobación explícita del usuario)**

NO ejecutar sin OK del usuario. Opciones:
- Automático: `git checkout main && git merge feat/campanas-asistente-ia && git push origin main` (dispara GitHub Actions → corre migración 028 en el VPS).
- Manual (SSH al VPS): el bloque del punto 8 de `credenciales.txt` (`git pull`, `docker compose up -d --build`, `docker compose exec -T api node src/db/migrate.js`).

---

## Notas / desviaciones respecto al spec

- **Segmentos SMS**: se implementa el contador informativo en el wizard (lo que pidió el usuario). NO se persiste el conteo por-job (evita añadir columna a `campaign_jobs`); el gateway Android hace el multipart del texto completo. Si más adelante se quiere reporte de segmentos, se añade una columna en una migración posterior.
- **Tests**: se usa `node --test` nativo para la lógica pura (variables, segmentación, plantilla, parseo por teléfono). Los flujos con BD/worker/frontend se verifican manualmente (Task 10) por no existir arnés de integración en el repo.
- **Plantilla**: incluye una fila de ejemplo con `'ejemplo'` en las columnas de variables para orientar al usuario; se puede vaciar si molesta.
