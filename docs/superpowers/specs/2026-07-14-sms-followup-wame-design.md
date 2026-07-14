# Campaña SMS de seguimiento con link wa.me (para no-entregados) — Diseño

**Fecha:** 2026-07-14
**Autor:** frankapaza (con Claude Code)
**Estado:** Aprobado (diseño) — pasando a plan

## Contexto y problema

Las campañas de **WhatsApp IA** envían el saludo en frío. WhatsApp **acepta** el mensaje (✓) pero para números con los que el chip nunca conversó **no lo entrega** (sin ✓✓) — es su protección anti-spam. Esto se ve ahora gracias al rastreo de entrega recién desplegado (el saludo IA se registra como mensaje con `external_id`; los recibos de Baileys actualizan `delivered_at`/`read_at`).

**Solución (anti-baneo real):** en vez de insistir con envío en frío, tomar los **no entregados** y mandarles por **SMS** un **link wa.me (click-to-chat)**. Al hacer clic, **el cliente inicia** la conversación de WhatsApp → WhatsApp NO lo throttlea → el asistente continúa el diálogo con los datos de ese cliente (cruzando por teléfono, que ya funciona).

Alcance de este spec: **solo la conversión de no-entregados de una campaña WhatsApp IA a una campaña SMS con link wa.me**. (Fuera de alcance: wa.me desde cualquier lista, y el asistente siempre-activo con captura de datos — features aparte.)

## Estado actual reutilizable

- El saludo de campaña IA se registra como mensaje (`messages`) con `external_id` = id de Baileys; `campaign_jobs.message_id` guarda ese mismo id. Cruzando ambos se conoce el estado de entrega por destinatario.
- Los recibos de Baileys (`messages.update` / `message-receipt.update`) actualizan `messages.status` a `delivered`/`read` (via `updateMessageStatus`).
- Campañas SMS ya interpolan `{{variables}}` y tienen contador de segmentos.
- Import por teléfono (`upsertContactsByPhone`) crea contactos con nombre/metadata.
- El asistente ya cruza el entrante por teléfono y responde con los datos del contacto.

## Decisiones de diseño (acordadas)

- Los teléfonos salen **solo de los "no entregados"** de una campaña WhatsApp IA previa.
- El **texto del SMS lo escribe el usuario**, con `{{variables}}` + un marcador `{{link}}`.
- El **`{{link}}`** se reemplaza por `https://wa.me/<número>?text=<texto prellenado>`, donde `<número>` = el WhatsApp del **asistente de esa campaña** (si tenía pool, el primero conectado; editable).
- Como el enlace apunta al número del negocio y el cruce del entrante es **por teléfono del cliente**, el texto prellenado del wa.me puede ser **genérico** (no requiere código por cliente).
- Sin cambios de esquema (todo se resuelve con queries + tablas existentes).

## Arquitectura

### 1. Detección de "no entregados" (backend)

Un destinatario está **no entregado** si su job de WhatsApp está `sent` y su mensaje de saludo (cruzado por `campaign_jobs.message_id = messages.external_id`) tiene `status` NOT IN (`delivered`, `read`).

- Extender `GET /campaigns/:id/jobs` para incluir el **estado de entrega** por job (LEFT JOIN a `messages` por `external_id = message_id`, trayendo `messages.status` como `delivery_status`).
- Nuevo valor de filtro **`undelivered`** en ese endpoint (jobs `sent` cuyo `delivery_status` no sea `delivered`/`read`).

### 2. Endpoint: crear la campaña SMS de seguimiento

`POST /campaigns/:id/sms-followup` (auth, scoped `client_id`):
1. Valida que la campaña sea `channel='whatsapp'` con `assistant_id`.
2. Calcula los **no entregados** (query del punto 1).
3. Crea una **lista nueva** (`contact_lists`, `source='campaign'`, nombre derivado, ej. *"<campaña> — no entregados"*) y **copia** esos contactos (nombre, teléfono, metadata) a la lista, reutilizando el patrón de `upsertContactsByPhone`.
4. Resuelve el **número wa.me**: el `whatsapp_accounts.phone_number` (dígitos) del asistente de la campaña, conectado (de `settings.wa_account_ids` o los vinculados). 
5. Devuelve `{ list_id, total, wame_number }`.

### 3. Frontend: filtro + botón + wizard

- **Detalle de campaña** (`campaigns/[id]/page.jsx`): 
  - Nuevo filtro/tab **"No entregado"** en Destinatarios (usa `?status=undelivered`), y una columna/ícono de entrega (✓ / ✓✓) por fila usando `delivery_status`.
  - Botón **"Generar SMS con link wa.me"** (visible en campañas WhatsApp IA con ≥1 no entregado). Al pulsarlo, llama a `sms-followup` y **navega al wizard de campaña SMS** con `list_id` pre-cargado y un aviso de que puede usar `{{link}}`.
- **Wizard SMS** (`campaigns/new/page.jsx`, canal SMS): 
  - Cuando viene de este flujo, muestra un campo extra **"Texto prellenado del wa.me"** (default editable) y arma el link `https://wa.me/<wame_number>?text=<encode(prellenado)>`.
  - El usuario escribe el `content_text` con `{{variables}}` y `{{link}}`. Al crear la campaña, el front **reemplaza `{{link}}`** por el URL wa.me (fijo para todos) y postea a `/campaigns` normal (canal sms). Las `{{variables}}` se interpolan al enviar (ya funciona).

### 4. Cierre del ciclo (sin cambios)

El cliente hace clic → escribe al número del negocio → entrante → el asistente lo cruza por teléfono → responde con sus datos. Ya funciona; no requiere código nuevo.

## Casos borde

- **Entrega asíncrona:** al pulsar el botón, "no entregado" = estado actual (algunos podrían entregar después). Es aceptable — es un corte en el momento; el usuario decide cuándo generarlo.
- **Campaña sin no-entregados:** botón deshabilitado / mensaje "todos entregados".
- **Solo campañas WhatsApp IA:** el estado de entrega solo existe donde el saludo se registró como mensaje (campañas IA). El botón/filtro no aplica a email ni a WhatsApp manual (que hoy no registran el saludo).
- **Longitud SMS:** el link cuenta para los 160 caracteres → el contador de segmentos ya avisa.
- **`{{link}}` ausente en el texto:** si el usuario no lo pone, se envía sin link (advertir en el wizard).
- **Metadata:** los contactos copiados a la lista nueva conservan su metadata → las `{{variables}}` del SMS funcionan igual.

## Pruebas

- **Unidad:** la sustitución `{{link}}` → URL wa.me (front) y el `encodeURIComponent` del texto prellenado.
- **Integración/manual:** 
  1. Campaña WhatsApp IA con un no-entregado real → filtro "No entregado" lo muestra.
  2. "Generar SMS con link wa.me" → crea lista + wizard pre-cargado.
  3. Escribir texto con `{{nombre}}` y `{{link}}` → enviar → el SMS llega con el nombre y el link correctos.
  4. Hacer clic en el link → abre WhatsApp al número del negocio → enviar → el asistente responde con los datos del cliente.

## Fuera de alcance (features aparte)

- **Feature C completa:** generar campaña SMS con link wa.me desde **cualquier** lista (no solo no-entregados).
- **Feature B:** asistente siempre-activo iniciado por el cliente + captura de datos + carga de datos faltantes por el admin.
- Descarga CSV de no-entregados para uso manual (se prioriza el flujo SMS-con-link; el CSV se puede agregar luego si hace falta).
