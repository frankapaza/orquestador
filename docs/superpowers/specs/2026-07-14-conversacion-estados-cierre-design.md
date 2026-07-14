# Estados de conversación + cierre (manual e inactividad) — Fase 1 — Diseño

**Fecha:** 2026-07-14
**Autor:** frankapaza (con Claude Code)
**Estado:** Aprobado (diseño) — pasando a plan

## Contexto

Es la **Fase 1** de una funcionalidad mayor de ciclo de vida de conversaciones. Fases siguientes (fuera de este spec):
- **Fase 2:** cierre por IA (el asistente detecta que la conversación culminó → cierra).
- **Fase 3:** vincular conversaciones a la campaña que las originó + cerrar la campaña cuando todas culminaron + dashboard de resumen.

Esta Fase 1 entrega la base usable: **estados de conversación, cierre manual, y cierre automático por inactividad**, con el comportamiento del asistente respetando el estado.

## Estado actual (verificado en el código)

- `conversations.status` **ya existe** (`004_whatsapp_sms_channels.sql:53`): `VARCHAR(50) DEFAULT 'open'`, con índice `idx_conversations_status`. Endpoint `PATCH /conversations/:id/status` acepta `z.enum(['open','closed','pending'])` — el **cierre manual ya es posible**.
- `conversations.last_message_at` existe (índice `idx_conversations_last`) — sirve para medir inactividad sin consultar `messages`.
- El **responder** (`assistant.responder.js`) hoy solo mira `ai_enabled`, **no** `status` → responde igual a conversaciones "cerradas".
- El **catch-up** (`assistant.catchup.js`) filtra por `ai_enabled` pero **no** por `status`.
- Los asistentes (`wa_assistants`) ya tienen horario/handoff; es el lugar natural para el timeout de inactividad.

## Decisiones de diseño (acordadas)

- **Timeout de inactividad: por asistente**, columna nueva `inactivity_close_hours` (default **24**).
- **Cierre "duro" — sin reapertura automática:** una vez `closed`, el asistente **NO responde** aunque el cliente escriba; solo se reactiva si un **humano la reabre** (`status='open'`).
- `pending` se mantiene como estado **manual** (el usuario lo gestiona); el cron de inactividad **no** lo cierra (solo cierra `open`).
- El cierre por inactividad aplica solo a conversaciones de **números con asistente** (las que el bot maneja).

## Arquitectura

### 1. Migración `030_conversation_close.sql` (idempotente)

```sql
-- Motivo y fecha de cierre de la conversación (para reporte y dashboard futuro).
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS closed_reason VARCHAR(20);   -- 'inactivity' | 'manual' | (fase 2) 'ai'
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS closed_at     TIMESTAMPTZ;

-- Horas de inactividad tras las cuales el asistente cierra la conversación.
ALTER TABLE wa_assistants ADD COLUMN IF NOT EXISTS inactivity_close_hours INTEGER DEFAULT 24;
```

### 2. Cierre por inactividad — `assistant.inactivity.js` + cron

Nuevo `apps/api/src/modules/assistants/assistant.inactivity.js`:
- `runAssistantInactivityClose()`:
  - Una sola query (`sql` tag): cierra conversaciones donde
    - `c.status = 'open'`, `c.account_type = 'whatsapp'`,
    - la cuenta tiene asistente (`wa.assistant_id` no nulo y `wa_assistants.is_active`),
    - `c.last_message_at < now() - make_interval(hours => a.inactivity_close_hours)`.
  - Setea `status='closed'`, `closed_reason='inactivity'`, `closed_at=now()`.
  - Loguea cuántas cerró.
- Cron en `app.js` cada **15 min** (dentro del bloque no-`WORKERS_DISABLED`), con try/catch como los demás.

Nota: es un `UPDATE` masivo por SQL (no envía mensajes) → sin riesgo de baneo, no requiere espaciado.

### 3. El bot respeta `closed`

- **`assistant.responder.js`**: en `handleAssistantInbound`, tras cargar la conversación, si `status='closed'` → `return` con log `[Assistant] no responde: conversación cerrada`. (Se añade `status` al `SELECT` de la conversación que ya se hace para `ai_enabled`.)
- **`assistant.catchup.js`**: añadir `AND c.status = 'open'` (o `<> 'closed'`) a su query, para no responder cerradas.

### 4. Cierre/Reapertura manual (backend)

- Extender `PATCH /conversations/:id/status`: cuando `status='closed'` → setear `closed_reason='manual'`, `closed_at=now()`; cuando `status='open'` (reapertura) → limpiar `closed_reason=NULL`, `closed_at=NULL`. Sigue scoped por `client_id`.

### 5. Frontend — Inbox

`apps/web/src/app/dashboard/inbox/page.jsx`:
- **Badge de estado** en la conversación (Abierta / En espera / Cerrada) con color.
- Botón **"Cerrar"** (si abierta) y **"Reabrir"** (si cerrada) en la cabecera → `PATCH /conversations/:id/status`.
- **Filtro** por estado en la lista (Todas / Abiertas / Cerradas) — reusar el parámetro/estado existente si la lista ya lo soporta; si no, filtrar en cliente.

### 6. Frontend — Asistentes

`apps/web/src/app/dashboard/assistants/page.jsx`:
- Campo **"Cerrar conversación tras X horas sin actividad"** (`inactivity_close_hours`, número, default 24) en el formulario del asistente. El backend de asistentes (`upsertSchema` + `COLS`) debe aceptar el campo.

## Casos borde

- Conversación `closed` + cliente escribe → se guarda el mensaje (visible en Inbox) pero **el bot no responde** (ni en tiempo real ni por catch-up). Requiere reapertura humana. *(Consecuencia aceptada de "cierre duro"; la visibilidad de estos casos la dará el dashboard de Fase 3.)*
- Números **sin asistente** → no se auto-cierran por inactividad.
- `inactivity_close_hours` nulo/0 en un asistente → tratar como default 24 (o desactivar si 0; definir en el plan: **0 = desactivado**).
- Reapertura manual limpia `closed_reason`/`closed_at`; a partir de ahí el bot vuelve a responder a nuevos entrantes.

## Pruebas

- **Unidad**: no hay lógica pura nueva significativa; la query de inactividad se valida por `node --check` + prueba manual.
- **Manual/E2E (staging o prod con cuidado)**:
  1. Bajar `inactivity_close_hours` de un asistente a 1h; dejar una conversación sin actividad → verificar que el cron la cierra con `closed_reason='inactivity'`.
  2. Escribir a una conversación cerrada → el bot NO responde; el log muestra el motivo.
  3. Reabrir desde el Inbox → escribir de nuevo → el bot responde.
  4. Cerrar manual desde el Inbox → `closed_reason='manual'`.

## Fuera de alcance (fases siguientes)

- Cierre por IA (detección de objetivo cumplido) — Fase 2.
- Vínculo conversación↔campaña, cierre de campaña y dashboard de resumen — Fase 3.
- Derivación a humano (handoff) — pendiente aparte.
