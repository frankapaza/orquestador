# Campañas por Asistente IA + WhatsApp/SMS manuales — Diseño

**Fecha:** 2026-07-13
**Autor:** frankapaza (con Claude Code)
**Estado:** Aprobado (diseño) — pendiente revisión de spec

## Resumen

Extender el módulo de **campañas** para soportar tres nuevos flujos de mensajería, reutilizando al máximo el motor actual (tabla `campaigns`, worker BullMQ, senders de WhatsApp/SMS):

1. **Campaña "WhatsApp IA"** (tipo nuevo): se elige un **asistente IA**, se descarga un **Excel-plantilla** cuyas columnas se derivan de las `{{variables}}` configuradas en el asistente, se sube el Excel lleno (indexado por teléfono), y al enviar la campaña se manda el **saludo del asistente interpolado** a cada número. Las respuestas del cliente las toma automáticamente el asistente ya existente.
2. **Campaña "WhatsApp manual"**: se elige una lista de contactos y se escribe el `content_text` con `{{variables}}` (hoy no se interpolan — se arregla).
3. **Campaña "SMS"**: igual que WhatsApp manual, con **contador/segmentación de 160 caracteres** informativo (GSM-7 vs UCS-2).

Alcance de esta entrega: **los tres tipos juntos** (comparten wizard y worker, el costo incremental es bajo).

## Contexto y estado actual (verificado en el código)

- `campaigns` ya es multicanal: columna `channel` (`email|whatsapp|sms`), `content_text`, `media_url`, `media_caption` (`005_campaigns_multichannel.sql`).
- El worker `apps/api/src/workers/campaign.queue.js` ya envía por WhatsApp (Baileys) y SMS (gateway Android), con delays anti-baneo, rotación de cuentas y cuotas.
- Los **asistentes** (`wa_assistants`, `027_wa_assistants.sql`) guardan `greeting` (saludo) y `system_prompt` con `{{VARIABLES}}` en texto libre. **No existe una lista estructurada de variables** — hay que extraerlas por regex.
- El motor de variables ya existe en `apps/api/src/modules/assistants/assistant.responder.js`:
  - `resolveVars(text, ctx)` reemplaza `/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g` en MAYÚSCULAS.
  - `buildContext()` arma el contexto: `TELEFONO`, `NOMBRE_CLIENTE`, `NOMBRE` + **cada clave de `contacts.metadata`** (columnas del Excel) en MAYÚSCULAS.
  - El asistente busca al contacto **por teléfono** en `contact_phones` y lee su `metadata`. → Por eso la data del Excel **debe** guardarse como contactos reales.
- El importador `apps/api/src/modules/contacts/import.service.js` (usa `xlsx`) parsea columnas → `metadata`, pero **exige columna email**.
- **No existe generación de plantillas Excel** en el proyecto (solo importación).
- **WhatsApp/SMS NO interpolan `{{variables}}`** — `channel.sender.js` manda `content_text` crudo.
- **No existe segmentación SMS de 160** — solo un texto de ayuda en el wizard.

## Decisiones de diseño

- **Modo de campaña IA vs manual**: se añade columna `campaigns.assistant_id UUID NULL`. Presente = campaña IA; `null` = WhatsApp/SMS manual. Se mantiene `channel='whatsapp'`. (Descartado: crear canal `whatsapp_ai` — ensucia el enum y duplica rutas.)
- **La campaña IA envía el saludo del asistente interpolado** como primer mensaje (decisión del usuario).
- **La data del Excel se guarda como lista de contactos reutilizable** (visible en Contactos), indexada por teléfono (decisión del usuario).
- **Ruteo de respuestas**: la campaña IA envía **solo desde números WhatsApp que tengan ese `assistant_id` vinculado**, para que el entrante caiga en el asistente correcto. Se puede elegir **un solo número o un pool (grupo) de varios números**; el worker **rota** entre los seleccionados para repartir carga y reducir riesgo de baneo.
- **SMS de 160**: se **informa**, no se bloquea. El texto se manda completo (el gateway hace el multipart); guardamos el conteo de segmentos para el reporte.

## Arquitectura

### 1. Migración `028_campaign_assistant.sql`

```sql
-- Campaña IA: vincula la campaña a un asistente. NULL = campaña manual.
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS assistant_id UUID;
CREATE INDEX IF NOT EXISTS idx_campaigns_assistant ON campaigns(assistant_id);

-- Origen de la lista: marca las listas creadas al subir un Excel de campaña,
-- para poder distinguirlas/limpiarlas si hiciera falta (opcional pero útil).
ALTER TABLE contact_lists ADD COLUMN IF NOT EXISTS source VARCHAR(30) DEFAULT 'manual';
```

Idempotente (`IF NOT EXISTS`), en línea con las demás migraciones del proyecto.

### 2. Extracción de variables del asistente (backend, reutilizable)

Nueva utilidad (p. ej. `apps/api/src/modules/assistants/assistant.vars.js`):

- `extractVars(assistant)` → escanea `greeting` + `system_prompt` con el regex `/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g`, uppercasea, dedupe, y **excluye** las automáticas: `TELEFONO`, `NOMBRE`, `NOMBRE_CLIENTE`. Devuelve la lista de variables "de Excel".

Es la única fuente de verdad de las columnas de la plantilla y del preview.

### 3. Generación del Excel-plantilla

- Endpoint: `GET /whatsapp/assistants/:id/plantilla.xlsx` (admin, scoped por `client_id`).
- Columnas (en este orden): `telefono` (obligatoria), `nombre` (alimenta `{{NOMBRE_CLIENTE}}`), + una por cada variable de `extractVars` (en minúsculas snake_case, que es como `import.service.js` normaliza los headers).
- Primera fila de ejemplo con datos de muestra (ej. `51999888777`, `Juan Pérez`, ...).
- Implementación: primer uso de `XLSX.utils.book_new` + `XLSX.utils.aoa_to_sheet` + `XLSX.write(..., { type: 'buffer' })`. Se responde con `Content-Type` de xlsx y `Content-Disposition: attachment`.

### 4. Import por teléfono (variante del importador)

- Nueva función en `import.service.js` (o servicio nuevo `phone-import.service.js`): parsea el Excel usando `telefono` como **clave** (email opcional).
- Detección de columna teléfono con alias: `telefono`, `phone`, `celular`, `movil`, `whatsapp`, `numero`.
- Deduplica por teléfono normalizado (dígitos) en `contact_phones`. Upsert: si el contacto/teléfono ya existe, **fusiona** la metadata (las columnas nuevas del Excel se agregan/actualizan) sin borrar las claves previas.
- Todas las columnas que no sean `telefono`/`nombre`/`apellido`/`email` → `contacts.metadata` (misma normalización `normalize()` actual).
- No rompe el import por email existente.

### 5. Subida del Excel dentro de la campaña → lista

- Endpoint: `POST /campaigns/import-recipients` (multipart, `@fastify/multipart`), o extender el flujo de creación:
  - Recibe el archivo + `assistant_id` (para validar variables faltantes).
  - Crea una `contact_list` (`source='campaign'`, nombre autogenerado a partir del nombre de la campaña) e importa los contactos por teléfono.
  - Devuelve: `list_id`, `total` destinatarios, `variables_detectadas`, y `variables_faltantes` (las que el asistente usa pero no vienen como columna en el Excel).

### 6. Rutas y validación de campañas (`campaigns.routes.js`)

- `campaignBase` gana `assistant_id: z.string().uuid().optional().nullable()`.
- `refine`:
  - IA (`assistant_id` presente): exige `channel='whatsapp'`, `list_id` válido, y que el/los número(s) seleccionados tengan ese `assistant_id`. No exige `content_text`.
  - WhatsApp/SMS manual: exige `content_text` no vacío (como hoy).
- La creación guarda `assistant_id`.

### 7. Envío / worker

**`channel.sender.js`:**
- Añadir interpolación: nueva `buildCampaignContext(contact)` (nombre, teléfono, metadata → MAYÚSCULAS) + `resolveVars` (reutilizar/compartir con `assistant.responder.js` extrayendo la función a `lib/` o a `assistant.vars.js`).
- `sendWhatsapp`/`sendSms`: interpolar el body antes de enviar.
- Campaña IA: si `campaign.assistant_id`, el body = `greeting` del asistente **interpolado** (en vez de `content_text`).

**`campaign.queue.js`:**
- En `enqueueCampaign`, para campaña IA, restringir el pool de cuentas WhatsApp a **las seleccionadas en la campaña** (uno o varios números), todas con ese `assistant_id`. `pickWhatsappAccount` rota entre ellas (menos cargada primero) respetando cuotas y horario. Persistir la selección de números en `campaigns.settings` (p. ej. `settings.wa_account_ids: []`).
- SMS: calcular y guardar `segments` en el job/metadata para el reporte (no parte el texto).

### 8. Segmentación SMS (frontend)

- En el paso de mensaje del wizard, para SMS: detectar GSM-7 vs Unicode (presencia de caracteres fuera del set GSM-7 → UCS-2).
- Contador: `X caracteres · N segmento(s)` (GSM-7: 160 simple / 153 por segmento en multipart; UCS-2: 70 / 67).
- Aviso cuando supera 160/70: *"Supera el límite de un SMS → se enviará en N mensajes por teléfono."* Informa, no bloquea.

### 9. Wizard de creación (`apps/web/src/app/dashboard/campaigns/new/page.jsx`)

- Selector de tipo arriba: **Email · WhatsApp · WhatsApp IA · SMS**.
- **WhatsApp IA**: paso extra → (a) seleccionar asistente; (b) botón **Descargar plantilla Excel**; (c) subir Excel lleno → preview (nº destinatarios, variables detectadas/faltantes) → crea la lista; (d) seleccionar **uno o varios** número(s) WhatsApp (pool) **filtrados** a los que tienen ese asistente vinculado. Sin campo de mensaje.
- **WhatsApp manual / SMS**: elegir lista + `content_text` con ayuda de variables; SMS con contador de segmentos.
- **Email**: sin cambios.

## Casos borde y validaciones

- Excel sin columna teléfono → error claro al subir.
- Variables del asistente que no vienen en el Excel → se avisa en el preview; en runtime quedan vacías (comportamiento actual de `resolveVars`).
- Campaña IA sin números con ese asistente vinculado → bloquear con mensaje explicativo.
- Teléfono duplicado en el Excel → se deduplica (una campaña por destino, ya soportado por `campaign_jobs_campaign_contact_dest_unique`).
- `greeting` vacío en el asistente elegido → advertir (la campaña IA no tendría mensaje de apertura).

## Pruebas

- **Unidad**: `extractVars` (varios prompts, dedupe, exclusión de automáticas); generación del Excel (columnas correctas); segmentación SMS (GSM-7 vs UCS-2, conteos límite).
- **Import por teléfono**: crea lista + contactos, fusiona metadata, no exige email.
- **Interpolación**: `content_text`/`greeting` con variables presentes y ausentes.
- **E2E manual (contra staging/local)**: crear campaña IA, descargar plantilla, subir Excel, enviar, verificar que llega el saludo interpolado y que la respuesta la toma el asistente.

## Fuera de alcance

- Cambios al motor del asistente en runtime (ya funciona).
- Segmentación/partición real del texto SMS en el servidor (el gateway lo maneja).
- Editor estructurado de variables en el asistente (se siguen escribiendo `{{...}}` a mano).
- Programación avanzada / A-B testing de estas campañas.
