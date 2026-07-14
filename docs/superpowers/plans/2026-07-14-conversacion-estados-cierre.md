# Estados de conversación + cierre (Fase 1) — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar estados de conversación con cierre manual y cierre automático por inactividad (timeout por asistente), y que el asistente NO responda a conversaciones cerradas.

**Architecture:** Se reutiliza el campo existente `conversations.status` (open/pending/closed). Un cron cierra por inactividad las conversaciones `open` de números con asistente cuyo último mensaje supera el `inactivity_close_hours` del asistente. El responder en tiempo real y el catch-up pasan a saltar las cerradas. El Inbox gana badge de estado y botones Cerrar/Reabrir.

**Tech Stack:** Node ESM, Fastify, `postgres` (`sql` tag), node-cron, Next.js 14 (JS), Tailwind. Tests: `node --test` (solo para lógica pura; aquí es SQL/UI → `node --check` + verificación manual).

## Global Constraints

- Node ESM; SQL con el tag `sql` de `postgres` SOLO (nunca concatenación).
- Toda ruta bajo `/api/v1`, con `fastify.authenticate`, scoped `client_id = req.user.sub`.
- Migraciones idempotentes (`IF NOT EXISTS`), numeradas en secuencia. Próxima libre: **030**.
- Estados de conversación: `open` · `pending` · `closed` (ya existen). Cierre "duro": conversación `closed` → el asistente NO responde (ni tiempo real ni catch-up) hasta reapertura humana.
- Timeout de inactividad **por asistente**: columna `inactivity_close_hours` (default 24; **0 = desactivado**).
- `pending` es estado manual: el cron de inactividad NO lo cierra (solo cierra `open`).
- 0 dependencias nuevas. Rama `main`. No desplegar (push) sin aprobación del usuario.

---

### Task 1: Migración 030 — cierre de conversación + timeout del asistente

**Files:**
- Create: `apps/api/src/db/migrations/030_conversation_close.sql`

**Interfaces:**
- Produces: `conversations.closed_reason VARCHAR(20)`, `conversations.closed_at TIMESTAMPTZ`, `wa_assistants.inactivity_close_hours INTEGER DEFAULT 24`.

- [ ] **Step 1: Escribir la migración**

Create `apps/api/src/db/migrations/030_conversation_close.sql`:

```sql
-- Motivo y fecha de cierre de la conversación (reporte + dashboard futuro).
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS closed_reason VARCHAR(20);   -- 'inactivity' | 'manual' | (fase 2) 'ai'
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS closed_at     TIMESTAMPTZ;

-- Horas de inactividad tras las cuales el asistente cierra la conversación (0 = desactivado).
ALTER TABLE wa_assistants ADD COLUMN IF NOT EXISTS inactivity_close_hours INTEGER DEFAULT 24;
```

- [ ] **Step 2: Verificar contenido**

Run: `node -e "const s=require('fs').readFileSync('apps/api/src/db/migrations/030_conversation_close.sql','utf8'); if(!/closed_reason/.test(s)||!/inactivity_close_hours/.test(s)) throw new Error('incompleto'); console.log('OK', s.length)"`
Expected: `OK <n>`.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/db/migrations/030_conversation_close.sql
git commit -m "feat(db): migracion 030 cierre de conversacion + inactivity_close_hours"
```

---

### Task 2: Backend — el bot respeta `closed` + cierre manual guarda motivo/fecha

**Files:**
- Modify: `apps/api/src/modules/assistants/assistant.responder.js` (saltar cerradas + log)
- Modify: `apps/api/src/modules/assistants/assistant.catchup.js` (filtrar cerradas)
- Modify: `apps/api/src/modules/conversations/conversations.routes.js` (PATCH status → closed_reason/closed_at)
- Modify: `apps/api/src/modules/assistants/assistants.routes.js` (aceptar `inactivity_close_hours`)

**Interfaces:**
- Consumes: columnas de Task 1.
- Produces: responder/catch-up ignoran `status='closed'`; `PATCH /conversations/:id/status` setea `closed_reason='manual'`+`closed_at` al cerrar y los limpia al reabrir; el upsert de asistentes acepta `inactivity_close_hours`.

- [ ] **Step 1: Responder salta conversaciones cerradas (+ log)**

Modify `apps/api/src/modules/assistants/assistant.responder.js`. Localiza el bloque que carga la conversación por `ai_enabled` (actualmente):

```js
  // ¿La IA está habilitada en esta conversación? (opt-out previo / toma humana)
  const [conv] = await sql`SELECT ai_enabled FROM conversations WHERE id = ${conversationId}`
  if (conv && conv.ai_enabled === false) {
    console.log(`[Assistant][${instanceName}] no responde: IA desactivada en la conversación (toma humana / opt-out previo)`)
    return
  }
```

Reemplázalo por (añade `status` al SELECT y el check de cerrada ANTES del de `ai_enabled`):

```js
  // Estado y toggle de IA de la conversación.
  const [conv] = await sql`SELECT ai_enabled, status FROM conversations WHERE id = ${conversationId}`
  if (conv && conv.status === 'closed') {
    console.log(`[Assistant][${instanceName}] no responde: conversación cerrada (requiere reapertura humana)`)
    return
  }
  if (conv && conv.ai_enabled === false) {
    console.log(`[Assistant][${instanceName}] no responde: IA desactivada en la conversación (toma humana / opt-out previo)`)
    return
  }
```

- [ ] **Step 2: Catch-up salta cerradas**

Modify `apps/api/src/modules/assistants/assistant.catchup.js`. En la query dentro de `runAssistantCatchup`, localiza:

```js
        AND COALESCE(c.ai_enabled, true) = true
        AND COALESCE(c.is_group, false) = false
```

Reemplázalo por (añade el filtro de estado):

```js
        AND COALESCE(c.ai_enabled, true) = true
        AND c.status = 'open'
        AND COALESCE(c.is_group, false) = false
```

- [ ] **Step 3: PATCH status guarda/limpia motivo y fecha**

Modify `apps/api/src/modules/conversations/conversations.routes.js`. Reemplaza el handler `PATCH /conversations/:id/status` completo por:

```js
  fastify.patch('/conversations/:id/status', { onRequest: pre }, async (req, reply) => {
    const { status } = z.object({
      status: z.enum(['open', 'closed', 'pending'])
    }).parse(req.body)

    // Cierre manual guarda motivo/fecha; reapertura los limpia.
    const closedReason = status === 'closed' ? 'manual' : null
    const closedAt     = status === 'closed' ? sql`now()` : sql`null`

    const [conv] = await sql`
      UPDATE conversations
      SET status = ${status}, closed_reason = ${closedReason}, closed_at = ${closedAt}
      WHERE id = ${req.params.id} AND client_id = ${req.user.sub}
      RETURNING id, status, closed_reason, closed_at
    `
    if (!conv) return reply.code(404).send({ error: 'Conversación no encontrada' })
    return conv
  })
```

- [ ] **Step 4: Asistentes aceptan `inactivity_close_hours`**

Modify `apps/api/src/modules/assistants/assistants.routes.js`:
- En `upsertSchema`, añadir (junto a `history_limit`):

```js
    inactivity_close_hours: z.number().int().min(0).max(720).optional(),
```

- En el array `COLS`, añadir `'inactivity_close_hours'` (al final, antes de `'is_active'` o después — cualquier posición sirve mientras esté en la lista):

```js
  const COLS = [
    'name', 'greeting', 'system_prompt', 'ai_provider', 'ai_model',
    'active_hours_start', 'active_hours_end', 'timezone', 'active_days',
    'handoff_number', 'handoff_triggers', 'handoff_timeout_min', 'history_limit',
    'inactivity_close_hours', 'is_active',
  ]
```

- [ ] **Step 5: Verificar sintaxis**

Run: `node --check apps/api/src/modules/assistants/assistant.responder.js && node --check apps/api/src/modules/assistants/assistant.catchup.js && node --check apps/api/src/modules/conversations/conversations.routes.js && node --check apps/api/src/modules/assistants/assistants.routes.js`
Expected: sin salida.

- [ ] **Step 6: Los tests existentes siguen verdes**

Run: `npm test -w apps/api`
Expected: 17/17 pass (esta tarea no toca lógica testeada).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/assistants/assistant.responder.js apps/api/src/modules/assistants/assistant.catchup.js apps/api/src/modules/conversations/conversations.routes.js apps/api/src/modules/assistants/assistants.routes.js
git commit -m "feat(conversations): el asistente no responde cerradas; cierre manual guarda motivo/fecha; timeout del asistente"
```

---

### Task 3: Cierre automático por inactividad (servicio + cron)

**Files:**
- Create: `apps/api/src/modules/assistants/assistant.inactivity.js`
- Modify: `apps/api/src/app.js` (import + cron cada 15 min)

**Interfaces:**
- Consumes: columnas de Task 1 (`inactivity_close_hours`, `closed_reason`, `closed_at`), `conversations.last_message_at`.
- Produces: `runAssistantInactivityClose(): Promise<number>` — cierra conversaciones vencidas; devuelve cuántas.

- [ ] **Step 1: Crear el servicio**

Create `apps/api/src/modules/assistants/assistant.inactivity.js`:

```js
import { sql } from '../../lib/db.js'

// Cierra por inactividad las conversaciones OPEN de números con asistente activo,
// cuyo último mensaje supera el inactivity_close_hours del asistente (0 = desactivado).
// Es un UPDATE masivo (NO envía mensajes) → sin riesgo de baneo, no requiere espaciado.
export async function runAssistantInactivityClose() {
  const res = await sql`
    UPDATE conversations c
    SET status = 'closed', closed_reason = 'inactivity', closed_at = now()
    FROM whatsapp_accounts wa
    JOIN wa_assistants a ON a.id = wa.assistant_id
    WHERE c.account_id = wa.id
      AND c.account_type = 'whatsapp'
      AND c.status = 'open'
      AND a.is_active = true
      AND COALESCE(a.inactivity_close_hours, 24) > 0
      AND c.last_message_at IS NOT NULL
      AND c.last_message_at < now() - make_interval(hours => COALESCE(a.inactivity_close_hours, 24))
  `
  if (res.count) console.log(`[Inactividad] ${res.count} conversación(es) cerradas por inactividad`)
  return res.count
}
```

- [ ] **Step 2: Verificar sintaxis del servicio**

Run: `node --check apps/api/src/modules/assistants/assistant.inactivity.js`
Expected: sin salida.

- [ ] **Step 3: Cablear el cron en app.js**

Modify `apps/api/src/app.js`:
- Añadir el import junto a los otros de assistants (después de `import { runAssistantCatchup } ...`):

```js
import { runAssistantInactivityClose } from './modules/assistants/assistant.inactivity.js'
```

- Dentro del bloque `else` (no `WORKERS_DISABLED`), después del cron de catch-up, añadir:

```js
  // Cierre por inactividad de conversaciones del asistente, cada 15 min.
  cron.schedule('*/15 * * * *', async () => {
    try {
      await runAssistantInactivityClose()
    } catch (err) {
      fastify.log.error({ err }, '[Cron] Error en cierre por inactividad')
    }
  })
```

- [ ] **Step 4: Verificar sintaxis de app.js**

Run: `node --check apps/api/src/app.js`
Expected: sin salida.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/assistants/assistant.inactivity.js apps/api/src/app.js
git commit -m "feat(conversations): cierre automatico por inactividad (cron cada 15 min)"
```

---

### Task 4: Frontend — campo de inactividad en el formulario del asistente

**Files:**
- Modify: `apps/web/src/app/dashboard/assistants/page.jsx`

**Interfaces:**
- Consumes: el asistente ahora tiene `inactivity_close_hours`; el backend (Task 2) lo acepta en create/update.
- Produces: el formulario del asistente permite editar `inactivity_close_hours`.

READ THE FILE FIRST. Sigue el patrón de los campos numéricos existentes (p. ej. `history_limit` — un `<input type="number">` ligado al estado `form`).

- [ ] **Step 1: Añadir el campo al estado inicial**

En el objeto de estado inicial del formulario (busca donde se define `EMPTY`/estado por defecto con `history_limit`), añadir `inactivity_close_hours: 24`.

- [ ] **Step 2: Añadir el input al formulario**

Cerca del campo `history_limit` (o del bloque de horario), añadir un input numérico. Ejemplo (adaptar al markup real del archivo):

```jsx
<div>
  <label className="text-sm font-medium">Cerrar conversación tras (horas sin actividad)</label>
  <input type="number" min={0} max={720}
    value={form.inactivity_close_hours ?? 24}
    onChange={e => setForm(f => ({ ...f, inactivity_close_hours: Number(e.target.value) }))}
    className="w-full border rounded p-2" />
  <p className="text-xs text-muted-foreground">0 = nunca cerrar por inactividad. Default 24h.</p>
</div>
```

(Usar el helper de cambio de estado y las clases reales del archivo; el submit ya envía todo `form`, así que no hay que tocar el POST/PATCH si el campo vive en `form`.)

- [ ] **Step 3: Verificar build**

Run: `npm run build -w apps/web`
Expected: compila sin errores.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/dashboard/assistants/page.jsx
git commit -m "feat(web): campo de cierre por inactividad en el formulario del asistente"
```

---

### Task 5: Frontend — Inbox: badge de estado + Cerrar/Reabrir + filtro

**Files:**
- Modify: `apps/web/src/app/dashboard/inbox/page.jsx`

**Interfaces:**
- Consumes: `conversation.status` (`open`/`pending`/`closed`) que ya devuelve `GET /conversations`; `PATCH /conversations/:id/status`.
- Produces: badge de estado en la conversación seleccionada, botones **Cerrar**/**Reabrir**, y filtro por estado en la lista.

READ THE FILE FIRST (es el inbox de una sola página; reutiliza el cliente `api` de `@/lib/api` y los patrones de la cabecera de conversación que ya existen — allí se agregó antes el botón "Resumen IA").

- [ ] **Step 1: Badge de estado en la conversación**

En la cabecera de la conversación seleccionada, mostrar un badge según `selected.status`:

```jsx
{selected?.status && (
  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
    selected.status === 'closed' ? 'bg-muted text-muted-foreground'
    : selected.status === 'pending' ? 'bg-amber-100 text-amber-700'
    : 'bg-jungle-green-100 text-jungle-green-700'}`}>
    {selected.status === 'closed' ? 'Cerrada' : selected.status === 'pending' ? 'En espera' : 'Abierta'}
  </span>
)}
```

- [ ] **Step 2: Botón Cerrar/Reabrir**

Junto a los botones existentes de la cabecera, añadir:

```jsx
<Button variant="outline" size="sm" onClick={async () => {
  const next = selected.status === 'closed' ? 'open' : 'closed'
  try {
    await api.patch(`/conversations/${selected.id}/status`, { status: next })
    // refrescar el estado local de la conversación seleccionada y de la lista
    setSelected(s => ({ ...s, status: next }))
    // (usar la misma función de recarga de conversaciones que ya use el archivo)
  } catch (e) { /* usar el patrón de error del archivo */ }
}}>
  {selected.status === 'closed' ? 'Reabrir' : 'Cerrar'}
</Button>
```

(Adaptar a cómo el archivo mantiene la conversación seleccionada y recarga la lista tras un cambio.)

- [ ] **Step 3: Filtro por estado en la lista**

Añadir un filtro simple (Todas / Abiertas / Cerradas) sobre la lista de conversaciones. Si `GET /conversations` no soporta filtro por query, filtrar en cliente por `c.status`. Seguir el estilo de tabs/botones del archivo.

- [ ] **Step 4: Verificar build**

Run: `npm run build -w apps/web`
Expected: compila sin errores.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/dashboard/inbox/page.jsx
git commit -m "feat(web): estado de conversacion en el inbox (badge, cerrar/reabrir, filtro)"
```

---

### Task 6: Verificación E2E manual + deploy (con aprobación)

**Files:** ninguno.

- [ ] **Step 1: Suite de tests**

Run: `npm test -w apps/api`
Expected: 17/17 pass.

- [ ] **Step 2: Verificación manual (contra prod, con cuidado, o local)**

1. Poner `inactivity_close_hours = 1` en un asistente. Dejar una conversación `open` sin actividad > 1h → esperar el cron (≤15 min) → verificar que queda `closed` con `closed_reason='inactivity'`.
2. Escribir a esa conversación cerrada → el asistente **NO** responde; el log del API muestra `no responde: conversación cerrada`.
3. Reabrir desde el Inbox (botón Reabrir) → escribir de nuevo → el asistente responde.
4. Cerrar manual desde el Inbox → verificar `closed_reason='manual'`, `closed_at` seteado; el badge muestra "Cerrada".

- [ ] **Step 3: Deploy (requiere aprobación explícita del usuario)**

NO ejecutar sin OK. Push a `main` → CI/CD corre la migración 030 y despliega. Verificar la Actions run = success.

---

## Notas / desviaciones

- Sin tests unitarios nuevos: la lógica es SQL/integración/UI. Se verifica con `node --check`, la suite existente en verde, `npm run build`, y la E2E manual (Task 6). Consistente con el resto del repo (sin arnés de integración).
- `inactivity_close_hours = 0` desactiva el cierre por inactividad para ese asistente.
- El cierre por inactividad es un `UPDATE` masivo (no envía mensajes) → no necesita espaciado anti-baneo (a diferencia del catch-up).
