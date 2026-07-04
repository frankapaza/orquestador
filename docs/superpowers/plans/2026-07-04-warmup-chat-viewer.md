# Visor de chat del warmup + auto-catálogo + alertas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar visibilidad al calentamiento de chips WhatsApp con un visor de chat, regenerar el catálogo de diálogos con IA semanalmente y alertar in-app cuando un chip entra en riesgo o es baneado.

**Architecture:** Se registra cada mensaje saliente del warmup en una tabla `warmup_messages` (auto-limpieza a 7 días); como en el warmup interno ambos chips envían, con los salientes se reconstruye el chat completo. Dos tablas nuevas (`warmup_messages`, `warmup_alerts`) y una columna (`warmup_config.ai_auto_weekly`) en la migración 020. La UI vive en `/dashboard/warmup` (chat + alertas) y `/dashboard/settings` (toggle auto-regen). Deploy vía push a `main` → CI/CD del VPS corre `migrate.js`.

**Tech Stack:** Fastify 4 + `postgres` (porsager) + BullMQ/Redis (apps/api), Next.js App Router + axios + Tailwind (apps/web), Baileys para WhatsApp.

## Global Constraints

- **Sin framework de tests en el repo.** Verificación por: `node --check <archivo>` (sintaxis), test de importación ESM para lógica pura, y `curl` contra producción tras el deploy. NO inventar Jest/Vitest.
- **Migraciones idempotentes** (`IF NOT EXISTS`), numeradas, en `apps/api/src/db/migrations/`. Se registran solas en `schema_migrations`. Próxima: `020`.
- **SQL:** cliente `postgres` v3.4.4. Insert masivo con `sql(rows, ...cols)` usando `JSON.stringify` para columnas JSONB. Fragmentos condicionales con `sql\`\`` vacío. `sql.json()` para un solo valor JSONB.
- **Auth en rutas:** `onRequest: [fastify.authenticate]`; `req.user.sub` = client_id; `req.user.member_id` presente = no-admin (bloquear escrituras con 403).
- **Colores UI:** usar tokens `jungle-green-*` (alias de la paleta calypso), `muted`, `foreground`. Iconos desde `../../../components/ui/icons`.
- **Deploy:** commit + push a `main`. NO hacer SSH ni tocar el VPS directamente (5432 externo bloqueado, SSH solo password).

---

## File Structure

**apps/api (backend):**
- `src/db/migrations/020_warmup_chat_alerts.sql` — CREAR: tablas `warmup_messages`, `warmup_alerts`, columna `ai_auto_weekly`.
- `src/modules/whatsapp/warmup/warmup.service.js` — MODIFICAR: helpers `threadKeyFor`, `recordWarmupMessage`.
- `src/modules/whatsapp/warmup/warmup.scheduler.js` — MODIFICAR: ampliar payload del job con datos del par.
- `src/modules/whatsapp/warmup/warmup.queue.js` — MODIFICAR: insertar mensaje tras enviar; traer `client_id`.
- `src/modules/whatsapp/warmup/alerts.service.js` — CREAR: `createAlert`, generación anti-spam.
- `src/modules/whatsapp/warmup/risk.service.js` — MODIFICAR: crear alerta al pasar a rojo.
- `src/modules/whatsapp/baileys.manager.js` — MODIFICAR: crear alerta al detectar baneo.
- `src/modules/whatsapp/warmup/ai.generator.js` — MODIFICAR: `pruneAiCatalog`.
- `src/modules/whatsapp/warmup/warmup.routes.js` — MODIFICAR: endpoints de chats, alerts, y `ai_auto_weekly` en config IA.
- `src/app.js` — MODIFICAR: cron de limpieza diaria de mensajes y cron semanal de regeneración.

**apps/web (frontend):**
- `src/app/dashboard/warmup/page.jsx` — MODIFICAR: sección Conversaciones (chat) + badge/lista de alertas.
- `src/app/dashboard/settings/page.jsx` — MODIFICAR: toggle "Regenerar con IA cada semana" en la pestaña Agente IA.

---

## Task 1: Migración 020 (esquema)

**Files:**
- Create: `apps/api/src/db/migrations/020_warmup_chat_alerts.sql`

**Interfaces:**
- Produces: tablas `warmup_messages(id, client_id, thread_key, from_account_id, to_account_id, peer_phone, peer_name, peer_kind, text, created_at)`, `warmup_alerts(id, client_id, account_id, level, reason, acknowledged, created_at)`, y columna `warmup_config.ai_auto_weekly BOOLEAN`.

- [ ] **Step 1: Escribir la migración**

Crear `apps/api/src/db/migrations/020_warmup_chat_alerts.sql`:

```sql
-- Chat del warmup, alertas in-app y auto-regeneración de catálogo

-- Mensajes de warmup para el visor de chat (retención: se limpian a los 7 días)
CREATE TABLE IF NOT EXISTS warmup_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  thread_key      VARCHAR(80) NOT NULL,             -- par de teléfonos ordenado 'min|max'
  from_account_id UUID REFERENCES whatsapp_accounts(id) ON DELETE CASCADE,
  to_account_id   UUID REFERENCES whatsapp_accounts(id) ON DELETE SET NULL,
  peer_phone      VARCHAR(30),
  peer_name       VARCHAR(120),
  peer_kind       VARCHAR(10) DEFAULT 'internal',   -- internal | external
  text            TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_warmup_msg_thread  ON warmup_messages(client_id, thread_key, created_at);
CREATE INDEX IF NOT EXISTS idx_warmup_msg_created ON warmup_messages(created_at);

-- Alertas in-app de riesgo/baneo
CREATE TABLE IF NOT EXISTS warmup_alerts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  account_id   UUID NOT NULL REFERENCES whatsapp_accounts(id) ON DELETE CASCADE,
  level        VARCHAR(10) NOT NULL,                -- red | banned
  reason       VARCHAR(255),
  acknowledged BOOLEAN DEFAULT false,
  created_at   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_warmup_alerts_open ON warmup_alerts(client_id) WHERE acknowledged = false;

-- Regeneración automática semanal del catálogo con IA
ALTER TABLE warmup_config ADD COLUMN IF NOT EXISTS ai_auto_weekly BOOLEAN DEFAULT false;
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/db/migrations/020_warmup_chat_alerts.sql
git commit -m "feat(warmup): migración 020 — chat, alertas y auto-catálogo"
```

---

## Task 2: Registro de mensajes del chat

**Files:**
- Modify: `apps/api/src/modules/whatsapp/warmup/warmup.service.js`
- Modify: `apps/api/src/modules/whatsapp/warmup/warmup.scheduler.js`
- Modify: `apps/api/src/modules/whatsapp/warmup/warmup.queue.js`

**Interfaces:**
- Produces: `threadKeyFor(phoneA, phoneB): string`, `recordWarmupMessage({ clientId, threadKey, fromAccountId, toAccountId, peerPhone, peerName, peerKind, text }): Promise<void>` en warmup.service.js.
- Consumes: `enqueueWarmupTurn(data, delayMs)` (existente) — el `data` ahora incluye `peerPhone, peerName, toAccountId, peerKind, threadKey`.

- [ ] **Step 1: Agregar helpers a warmup.service.js**

Al final de `apps/api/src/modules/whatsapp/warmup/warmup.service.js` añadir:

```js
// Clave de hilo del chat: par de teléfonos ordenado, para agrupar A↔B sin importar dirección.
export function threadKeyFor(phoneA, phoneB) {
  const a = (phoneA ?? '').replace(/\D/g, '')
  const b = (phoneB ?? '').replace(/\D/g, '')
  return [a, b].sort().join('|')
}

// Registra un mensaje saliente del warmup para el visor de chat.
export async function recordWarmupMessage({ clientId, threadKey, fromAccountId, toAccountId, peerPhone, peerName, peerKind, text }) {
  await sql`
    INSERT INTO warmup_messages
      (client_id, thread_key, from_account_id, to_account_id, peer_phone, peer_name, peer_kind, text)
    VALUES
      (${clientId}, ${threadKey}, ${fromAccountId}, ${toAccountId ?? null},
       ${peerPhone ?? null}, ${peerName ?? null}, ${peerKind ?? 'internal'}, ${text ?? null})
  `
}
```

- [ ] **Step 2: Ampliar el payload del job en el scheduler (interno)**

En `apps/api/src/modules/whatsapp/warmup/warmup.scheduler.js`, importar `threadKeyFor`:

```js
import {
  getWarmupConfig, effectiveConfig, isActiveNow, rampTargetForDay,
  sentTodayFor, getActiveConversations, randomDelayMs, recordWarmupSent, threadKeyFor,
} from './warmup.service.js'
```

En `playInternal`, reemplazar el bloque `await enqueueWarmupTurn({...}, delay)` por:

```js
    await enqueueWarmupTurn({
      fromInstance:   sender.chip.instance_name,
      fromAccountId:  sender.chip.id,
      toPhone:        digits(receiver.chip.phone_number),
      text:           varyText(turn.text),
      simulateTyping: cfg.simulate_typing !== false,
      markRead:       cfg.mark_read !== false,
      // Datos para el visor de chat:
      peerPhone:      digits(receiver.chip.phone_number),
      peerName:       receiver.chip.name,
      toAccountId:    receiver.chip.id,
      peerKind:       'internal',
      threadKey:      threadKeyFor(sender.chip.phone_number, receiver.chip.phone_number),
    }, delay)
```

- [ ] **Step 3: Ampliar el payload del job en el scheduler (externo)**

En `playExternal`, reemplazar el bloque `await enqueueWarmupTurn({...}, delay)` por:

```js
    await enqueueWarmupTurn({
      fromInstance:   a.chip.instance_name,
      fromAccountId:  a.chip.id,
      toPhone:        digits(phone),
      text:           varyText(turn.text),
      simulateTyping: cfg.simulate_typing !== false,
      markRead:       cfg.mark_read !== false,
      // Datos para el visor de chat:
      peerPhone:      digits(phone),
      peerName:       null,
      toAccountId:    null,
      peerKind:       'external',
      threadKey:      threadKeyFor(a.chip.phone_number, phone),
    }, delay)
```

- [ ] **Step 4: Registrar el mensaje en el worker**

En `apps/api/src/modules/whatsapp/warmup/warmup.queue.js`, importar el helper:

```js
import { recordWarmupMessage } from './warmup.service.js'
```

Cambiar la query de la cuenta para traer `client_id`:

```js
      const [acc] = await sql`
        SELECT id, client_id, warmup_enabled, banned_at, is_active
        FROM whatsapp_accounts WHERE id = ${fromAccountId}
      `
```

Y tras el envío exitoso, registrar el mensaje. Reemplazar:

```js
      // Nota: el conteo diario (warmup_sent) se registra al ENCOLAR en el
      // scheduler, no aquí, para evitar sobre-encolar entre ticks.
      await baileysManager.sendWarmup(fromInstance, { to: toPhone, text, simulateTyping, markRead })

      return { sent: true }
```

por:

```js
      // Nota: el conteo diario (warmup_sent) se registra al ENCOLAR en el
      // scheduler, no aquí, para evitar sobre-encolar entre ticks.
      await baileysManager.sendWarmup(fromInstance, { to: toPhone, text, simulateTyping, markRead })

      // Registrar el mensaje para el visor de chat (con los datos del par que trae el job).
      await recordWarmupMessage({
        clientId:      acc.client_id,
        threadKey:     job.data.threadKey,
        fromAccountId: fromAccountId,
        toAccountId:   job.data.toAccountId,
        peerPhone:     job.data.peerPhone,
        peerName:      job.data.peerName,
        peerKind:      job.data.peerKind,
        text,
      }).catch(e => console.error('[Warmup] recordWarmupMessage:', e.message))

      return { sent: true }
```

- [ ] **Step 5: Verificar sintaxis**

Run:
```bash
cd apps/api/src && node --check modules/whatsapp/warmup/warmup.service.js && node --check modules/whatsapp/warmup/warmup.scheduler.js && node --check modules/whatsapp/warmup/warmup.queue.js
```
Expected: sin salida de error (exit 0).

- [ ] **Step 6: Verificar lógica pura de threadKeyFor**

Run (desde `apps/api`, con `DATABASE_URL` dummy):
```bash
DATABASE_URL="postgresql://x:x@localhost:5432/x" node --input-type=module -e "import {threadKeyFor} from './src/modules/whatsapp/warmup/warmup.service.js'; console.log(threadKeyFor('+51 999-111','51888')===threadKeyFor('+51888','999111') ? 'OK simétrico' : 'FAIL'); console.log(threadKeyFor('51999111','51888'))"
```
Expected: `OK simétrico` y una clave tipo `51888|51999111`.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/whatsapp/warmup/warmup.service.js apps/api/src/modules/whatsapp/warmup/warmup.scheduler.js apps/api/src/modules/whatsapp/warmup/warmup.queue.js
git commit -m "feat(warmup): registrar mensajes salientes para el visor de chat"
```

---

## Task 3: Endpoints de chat + retención diaria

**Files:**
- Modify: `apps/api/src/modules/whatsapp/warmup/warmup.routes.js`
- Modify: `apps/api/src/app.js`

**Interfaces:**
- Produces: `GET /whatsapp/warmup/chats` (lista de hilos), `GET /whatsapp/warmup/chat?thread=<key>` (mensajes de un hilo).
- Consumes: tabla `warmup_messages` (Task 1), `req.user.sub`.

- [ ] **Step 1: Endpoint de lista de chats**

En `apps/api/src/modules/whatsapp/warmup/warmup.routes.js`, dentro de `warmupRoutes`, añadir tras las rutas de catálogo:

```js
  // ── Visor de chat ─────────────────────────────────────────────────────────
  fastify.get('/whatsapp/warmup/chats', { onRequest: pre }, async (req) => {
    const rows = await sql`
      SELECT thread_key,
             max(created_at)                                    AS last_at,
             count(*)::int                                      AS msg_count,
             (array_agg(text      ORDER BY created_at DESC))[1] AS last_text,
             (array_agg(peer_kind ORDER BY created_at DESC))[1] AS peer_kind
      FROM warmup_messages
      WHERE client_id = ${req.user.sub}
      GROUP BY thread_key
      ORDER BY last_at DESC
      LIMIT 100
    `
    // Mapa teléfono(digits) → nombre de chip, para etiquetar los hilos.
    const chips = await sql`
      SELECT name, phone_number FROM whatsapp_accounts
      WHERE client_id = ${req.user.sub} AND phone_number IS NOT NULL
    `
    const nameByPhone = new Map(chips.map(c => [c.phone_number.replace(/\D/g, ''), c.name]))
    const labelFor = (digitsPhone) => nameByPhone.get(digitsPhone) ?? ('Externo +' + digitsPhone)

    return rows.map(r => {
      const [p1, p2] = r.thread_key.split('|')
      return {
        thread_key: r.thread_key,
        title:      `${labelFor(p1)} ↔ ${labelFor(p2)}`,
        last_text:  r.last_text,
        last_at:    r.last_at,
        msg_count:  r.msg_count,
        peer_kind:  r.peer_kind,
      }
    })
  })

  fastify.get('/whatsapp/warmup/chat', { onRequest: pre }, async (req) => {
    const { thread } = z.object({ thread: z.string().min(1) }).parse(req.query)
    return sql`
      SELECT m.id, m.from_account_id, wa.name AS from_name, m.peer_kind, m.text, m.created_at
      FROM warmup_messages m
      LEFT JOIN whatsapp_accounts wa ON wa.id = m.from_account_id
      WHERE m.client_id = ${req.user.sub} AND m.thread_key = ${thread}
      ORDER BY m.created_at ASC
      LIMIT 500
    `
  })
```

- [ ] **Step 2: Cron de retención diaria en app.js**

En `apps/api/src/app.js`, dentro del `cron.schedule('0 0 * * *', ...)` existente (reset diario), añadir la limpieza. Reemplazar el cuerpo del try por:

```js
    try {
      const result = await sql`UPDATE email_accounts SET sent_today = 0`
      fastify.log.info(`[Cron] Contadores diarios reseteados: ${result.count} cuentas`)
      // Retención del chat de warmup: borrar mensajes de más de 7 días.
      const del = await sql`DELETE FROM warmup_messages WHERE created_at < now() - interval '7 days'`
      fastify.log.info(`[Cron] Mensajes de warmup purgados: ${del.count}`)
    } catch (err) {
      fastify.log.error({ err }, '[Cron] Error en tareas diarias de medianoche')
    }
```

- [ ] **Step 3: Verificar sintaxis**

Run:
```bash
cd apps/api/src && node --check modules/whatsapp/warmup/warmup.routes.js && node --check app.js
```
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/whatsapp/warmup/warmup.routes.js apps/api/src/app.js
git commit -m "feat(warmup): endpoints de chat + retención diaria de mensajes"
```

---

## Task 4: UI del visor de chat

**Files:**
- Modify: `apps/web/src/app/dashboard/warmup/page.jsx`

**Interfaces:**
- Consumes: `GET /whatsapp/warmup/chats`, `GET /whatsapp/warmup/chat?thread=<key>`.

- [ ] **Step 1: Estado y carga del chat**

En `apps/web/src/app/dashboard/warmup/page.jsx`, dentro del componente `WarmupPage`, añadir estado tras el estado existente:

```jsx
  const [chats, setChats]       = useState([])
  const [activeThread, setActiveThread] = useState(null)
  const [threadMsgs, setThreadMsgs] = useState([])
```

En la función `load` (dentro del `Promise.all`), añadir la carga de chats. Reemplazar el `Promise.all` por:

```jsx
      const [c, s, cat, aiRes, ch] = await Promise.all([
        api.get('/whatsapp/warmup/config'),
        api.get('/whatsapp/warmup/status'),
        api.get('/whatsapp/warmup/catalog'),
        api.get('/whatsapp/warmup/ai'),
        api.get('/whatsapp/warmup/chats'),
      ])
      setCfg(c.data)
      setChips(s.data)
      setCatalog(cat.data)
      setAi(aiRes.data)
      setChats(ch.data)
```

- [ ] **Step 2: Auto-refresh y carga de mensajes del hilo**

Tras el `useEffect(() => { load() }, [load])` existente, añadir:

```jsx
  // Auto-refresh de la lista de chats cada 6s.
  useEffect(() => {
    const t = setInterval(() => {
      api.get('/whatsapp/warmup/chats').then(r => setChats(r.data)).catch(() => {})
    }, 6000)
    return () => clearInterval(t)
  }, [])

  // Cargar (y refrescar) los mensajes del hilo activo.
  useEffect(() => {
    if (!activeThread) return
    let alive = true
    const fetchMsgs = () => api.get('/whatsapp/warmup/chat', { params: { thread: activeThread } })
      .then(r => { if (alive) setThreadMsgs(r.data) }).catch(() => {})
    fetchMsgs()
    const t = setInterval(fetchMsgs, 6000)
    return () => { alive = false; clearInterval(t) }
  }, [activeThread])
```

- [ ] **Step 3: Sección de UI del chat**

Antes de la sección `{/* Catálogo */}`, insertar la sección de conversaciones:

```jsx
      {/* Conversaciones (chat) */}
      <section className={card}>
        <div className="border-b p-5">
          <h2 className="text-sm font-semibold text-foreground">💬 Conversaciones</h2>
          <p className="text-xs text-muted-foreground">Lo que se están diciendo los chips (se actualiza solo · historial de 7 días).</p>
        </div>
        {chats.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Aún no hay mensajes de calentamiento.</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-[240px_1fr]">
            {/* Lista de hilos */}
            <ul className="max-h-96 divide-y overflow-y-auto border-r">
              {chats.map(t => (
                <li key={t.thread_key}>
                  <button onClick={() => setActiveThread(t.thread_key)}
                    className={`w-full px-4 py-3 text-left transition-colors hover:bg-muted/50 ${activeThread === t.thread_key ? 'bg-muted/60' : ''}`}>
                    <p className="truncate text-sm font-medium text-foreground">{t.title}</p>
                    <p className="truncate text-xs text-muted-foreground">{t.last_text}</p>
                  </button>
                </li>
              ))}
            </ul>
            {/* Burbujas del hilo activo */}
            <div className="max-h-96 space-y-2 overflow-y-auto p-4">
              {!activeThread ? (
                <p className="pt-8 text-center text-sm text-muted-foreground">Elige una conversación para verla.</p>
              ) : threadMsgs.length === 0 ? (
                <p className="pt-8 text-center text-sm text-muted-foreground">Sin mensajes.</p>
              ) : (
                threadMsgs.map((m, i) => {
                  // Alinear por emisor: el primer emisor del hilo va a la izquierda.
                  const leftId = threadMsgs[0].from_account_id
                  const mine = m.from_account_id === leftId
                  return (
                    <div key={m.id} className={`flex ${mine ? 'justify-start' : 'justify-end'}`}>
                      <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${mine ? 'bg-muted text-foreground' : 'bg-jungle-green-600 text-white'}`}>
                        <p className="mb-0.5 text-[10px] opacity-70">{m.from_name ?? 'Chip'}</p>
                        {m.text}
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        )}
      </section>
```

- [ ] **Step 4: Verificar sintaxis JSX**

Run (desde la raíz del repo):
```bash
node --input-type=module -e "import ts from 'typescript'; import {readFileSync} from 'fs'; const f='apps/web/src/app/dashboard/warmup/page.jsx'; const o=ts.transpileModule(readFileSync(f,'utf8'),{compilerOptions:{jsx:ts.JsxEmit.Preserve,target:ts.ScriptTarget.ESNext,module:ts.ModuleKind.ESNext},reportDiagnostics:true,fileName:f}); const e=(o.diagnostics||[]).filter(d=>d.category===1); console.log(e.length? 'FAIL '+e.map(d=>ts.flattenDiagnosticMessageText(d.messageText,' ')).join('; ') : 'OK JSX')"
```
Expected: `OK JSX`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/dashboard/warmup/page.jsx
git commit -m "feat(warmup): visor de chat en /dashboard/warmup"
```

---

## Task 5: Alertas — backend

**Files:**
- Create: `apps/api/src/modules/whatsapp/warmup/alerts.service.js`
- Modify: `apps/api/src/modules/whatsapp/warmup/risk.service.js`
- Modify: `apps/api/src/modules/whatsapp/baileys.manager.js`
- Modify: `apps/api/src/modules/whatsapp/warmup/warmup.routes.js`

**Interfaces:**
- Produces: `createAlert(clientId, accountId, level, reason): Promise<void>` (anti-spam) en alerts.service.js; `GET /whatsapp/warmup/alerts`, `POST /whatsapp/warmup/alerts/:id/ack`.
- Consumes: tabla `warmup_alerts` (Task 1).

- [ ] **Step 1: Crear alerts.service.js**

Crear `apps/api/src/modules/whatsapp/warmup/alerts.service.js`:

```js
import { sql } from '../../../lib/db.js'

// Crea una alerta in-app evitando duplicados: si ya hay una NO reconocida del
// mismo chip y nivel, no crea otra.
export async function createAlert(clientId, accountId, level, reason) {
  const [existing] = await sql`
    SELECT id FROM warmup_alerts
    WHERE account_id = ${accountId} AND level = ${level} AND acknowledged = false
    LIMIT 1
  `
  if (existing) return
  await sql`
    INSERT INTO warmup_alerts (client_id, account_id, level, reason)
    VALUES (${clientId}, ${accountId}, ${level}, ${reason ?? null})
  `
}
```

- [ ] **Step 2: Generar alerta al pasar a rojo en risk.service.js**

En `apps/api/src/modules/whatsapp/warmup/risk.service.js`, importar arriba:

```js
import { createAlert } from './alerts.service.js'
```

Dentro de `recomputeRisk`, en el bloque donde se calcula `level` y se hace el UPDATE (rama no baneada), tras el `results.push(...)`, añadir la creación de alerta cuando pasa a rojo. Localizar:

```js
    const level = levelFor(score)

    // Rojo preventivo → pausar warmup del chip.
    const pause = level === 'red'
    await sql`
      UPDATE whatsapp_accounts
      SET risk_score = ${score}, risk_level = ${level}, risk_checked_at = now()
          ${pause ? sql`, warmup_enabled = false` : sql``}
      WHERE id = ${a.id}
    `
    results.push({ id: a.id, score, level, reasons, paused: pause })
```

y reemplazar por (añade la alerta solo en la transición hacia rojo):

```js
    const level = levelFor(score)

    // Rojo preventivo → pausar warmup del chip.
    const pause = level === 'red'
    await sql`
      UPDATE whatsapp_accounts
      SET risk_score = ${score}, risk_level = ${level}, risk_checked_at = now()
          ${pause ? sql`, warmup_enabled = false` : sql``}
      WHERE id = ${a.id}
    `
    // Alerta solo cuando ENTRA a rojo (antes no era rojo).
    if (level === 'red' && a.risk_level !== 'red') {
      await createAlert(a.client_id, a.id, 'red', reasons.join('; ') || 'Riesgo alto de baneo')
        .catch(e => console.error('[Warmup] createAlert red:', e.message))
    }
    results.push({ id: a.id, score, level, reasons, paused: pause })
```

- [ ] **Step 3: Generar alerta al detectar baneo en baileys.manager.js**

En `apps/api/src/modules/whatsapp/baileys.manager.js`, importar el helper junto a los otros de warmup:

```js
import { internalAccountsByPhone, recordWarmupReceived } from './warmup/warmup.service.js'
import { createAlert } from './warmup/alerts.service.js'
```

Dentro del `connection.close`, en el bloque de detección de baneo, tras el `UPDATE ... SET banned_at ...`, crear la alerta. Localizar el `console.warn(...Posible BANEO...)` y justo después del bloque `try { ... } catch {}` que hace el UPDATE, añadir:

```js
            // Alerta in-app de baneo (necesitamos el client_id del chip).
            const [acc] = await sql`SELECT id, client_id FROM whatsapp_accounts WHERE instance_name = ${name}`
            if (acc) await createAlert(acc.client_id, acc.id, 'banned', reason).catch(() => {})
```

(colócalo dentro del `if (code === 403 || code === 401 || loggedOut) { ... }`, después del `try/catch` del UPDATE y usando la variable `reason` ya definida ahí.)

- [ ] **Step 4: Endpoints de alertas**

En `apps/api/src/modules/whatsapp/warmup/warmup.routes.js`, añadir tras los endpoints de chat:

```js
  // ── Alertas ───────────────────────────────────────────────────────────────
  fastify.get('/whatsapp/warmup/alerts', { onRequest: pre }, async (req) => {
    return sql`
      SELECT al.id, al.account_id, al.level, al.reason, al.created_at, wa.name AS account_name
      FROM warmup_alerts al
      LEFT JOIN whatsapp_accounts wa ON wa.id = al.account_id
      WHERE al.client_id = ${req.user.sub} AND al.acknowledged = false
      ORDER BY al.created_at DESC
    `
  })

  fastify.post('/whatsapp/warmup/alerts/:id/ack', { onRequest: pre }, async (req, reply) => {
    if (!adminOnly(req, reply)) return
    await sql`
      UPDATE warmup_alerts SET acknowledged = true
      WHERE id = ${req.params.id} AND client_id = ${req.user.sub}
    `
    return { ok: true }
  })
```

- [ ] **Step 5: Verificar sintaxis**

Run:
```bash
cd apps/api/src && node --check modules/whatsapp/warmup/alerts.service.js && node --check modules/whatsapp/warmup/risk.service.js && node --check modules/whatsapp/baileys.manager.js && node --check modules/whatsapp/warmup/warmup.routes.js
```
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/whatsapp/warmup/alerts.service.js apps/api/src/modules/whatsapp/warmup/risk.service.js apps/api/src/modules/whatsapp/baileys.manager.js apps/api/src/modules/whatsapp/warmup/warmup.routes.js
git commit -m "feat(warmup): alertas in-app en rojo y baneo + endpoints"
```

---

## Task 6: Alertas — UI

**Files:**
- Modify: `apps/web/src/app/dashboard/warmup/page.jsx`

**Interfaces:**
- Consumes: `GET /whatsapp/warmup/alerts`, `POST /whatsapp/warmup/alerts/:id/ack`.

- [ ] **Step 1: Estado y carga de alertas**

En `WarmupPage`, añadir estado:

```jsx
  const [alerts, setAlerts] = useState([])
```

En el `Promise.all` de `load`, añadir `api.get('/whatsapp/warmup/alerts')` y su `setAlerts`. El `Promise.all` queda:

```jsx
      const [c, s, cat, aiRes, ch, al] = await Promise.all([
        api.get('/whatsapp/warmup/config'),
        api.get('/whatsapp/warmup/status'),
        api.get('/whatsapp/warmup/catalog'),
        api.get('/whatsapp/warmup/ai'),
        api.get('/whatsapp/warmup/chats'),
        api.get('/whatsapp/warmup/alerts'),
      ])
      setCfg(c.data); setChips(s.data); setCatalog(cat.data)
      setAi(aiRes.data); setChats(ch.data); setAlerts(al.data)
```

- [ ] **Step 2: Función para reconocer alerta**

Junto a las otras funciones del componente, añadir:

```jsx
  async function ackAlert(id) {
    try {
      await api.post(`/whatsapp/warmup/alerts/${id}/ack`)
      setAlerts(a => a.filter(x => x.id !== id))
    } catch { flash('error', 'No se pudo marcar la alerta') }
  }
```

- [ ] **Step 3: Panel de alertas en el header**

Tras el bloque `{msg && (...)}` (el aviso flash), insertar el panel de alertas:

```jsx
      {alerts.length > 0 && (
        <section className="rounded-2xl border border-red-200 bg-red-50 p-4">
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-red-700">
            🚨 {alerts.length} alerta(s) de riesgo
          </p>
          <ul className="space-y-2">
            {alerts.map(a => (
              <li key={a.id} className="flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">
                    {a.account_name} · <span className="text-red-600">{a.level === 'banned' ? 'Baneado' : 'Riesgo alto'}</span>
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{a.reason}</p>
                </div>
                <button onClick={() => ackAlert(a.id)}
                  className="shrink-0 rounded-lg border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted">
                  Marcar leída
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
```

- [ ] **Step 4: Verificar sintaxis JSX**

Run (desde la raíz):
```bash
node --input-type=module -e "import ts from 'typescript'; import {readFileSync} from 'fs'; const f='apps/web/src/app/dashboard/warmup/page.jsx'; const o=ts.transpileModule(readFileSync(f,'utf8'),{compilerOptions:{jsx:ts.JsxEmit.Preserve,target:ts.ScriptTarget.ESNext,module:ts.ModuleKind.ESNext},reportDiagnostics:true,fileName:f}); const e=(o.diagnostics||[]).filter(d=>d.category===1); console.log(e.length? 'FAIL '+e.map(d=>ts.flattenDiagnosticMessageText(d.messageText,' ')).join('; ') : 'OK JSX')"
```
Expected: `OK JSX`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/dashboard/warmup/page.jsx
git commit -m "feat(warmup): panel de alertas in-app en la página de calentamiento"
```

---

## Task 7: Auto-regenerar catálogo con IA

**Files:**
- Modify: `apps/api/src/modules/whatsapp/warmup/ai.generator.js`
- Modify: `apps/api/src/modules/whatsapp/warmup/warmup.routes.js`
- Modify: `apps/api/src/app.js`
- Modify: `apps/web/src/app/dashboard/settings/page.jsx`

**Interfaces:**
- Produces: `pruneAiCatalog(clientId, keep): Promise<number>` en ai.generator.js; toggle `ai_auto_weekly` en `GET/PUT /whatsapp/warmup/ai`; cron semanal.
- Consumes: `generateCatalog(clientId, count)` (existente), columna `warmup_config.ai_auto_weekly` (Task 1).

- [ ] **Step 1: pruneAiCatalog en ai.generator.js**

Al final de `apps/api/src/modules/whatsapp/warmup/ai.generator.js` añadir:

```js
// Desactiva las conversaciones IA más antiguas dejando solo las `keep` más recientes
// activas (el catálogo base source='manual' no se toca). Devuelve cuántas desactivó.
export async function pruneAiCatalog(clientId, keep = 60) {
  const res = await sql`
    UPDATE warmup_conversations SET is_active = false
    WHERE client_id = ${clientId} AND source = 'ai' AND is_active = true
      AND id NOT IN (
        SELECT id FROM warmup_conversations
        WHERE client_id = ${clientId} AND source = 'ai' AND is_active = true
        ORDER BY created_at DESC
        LIMIT ${keep}
      )
  `
  return res.count
}
```

- [ ] **Step 2: Exponer y guardar ai_auto_weekly en las rutas IA**

En `apps/api/src/modules/whatsapp/warmup/warmup.routes.js`, en `GET /whatsapp/warmup/ai`, añadir el campo a la respuesta:

```js
    return {
      ai_provider: cfg.ai_provider ?? 'openai',
      ai_model:    cfg.ai_model ?? '',
      ai_base_url: cfg.ai_base_url ?? '',
      has_ai_key:  !!cfg.ai_api_key_enc,
      ai_auto_weekly: !!cfg.ai_auto_weekly,
      presets:     AI_PRESETS,
      model_hints: AI_MODEL_HINTS,
    }
```

En `PUT /whatsapp/warmup/ai`, ampliar el schema y el UPDATE. Cambiar el `z.object({...})` por:

```js
    const body = z.object({
      ai_provider: z.enum(['openai', 'deepseek', 'custom']),
      ai_model:    z.string().max(80).optional().nullable(),
      ai_base_url: z.string().max(200).optional().nullable(),
      api_key:     z.string().min(10).optional(),
      ai_auto_weekly: z.boolean().optional(),
    }).parse(req.body)
```

y añadir `ai_auto_weekly` al UPDATE (antes de `updated_at = now()`):

```js
    const keyUpdate  = body.api_key ? sql`, ai_api_key_enc = ${encrypt(body.api_key)}` : sql``
    const autoUpdate = body.ai_auto_weekly === undefined ? sql`` : sql`, ai_auto_weekly = ${body.ai_auto_weekly}`
    await sql`
      UPDATE warmup_config
      SET ai_provider = ${body.ai_provider},
          ai_model    = ${body.ai_model ?? null},
          ai_base_url = ${body.ai_base_url ?? null}
          ${keyUpdate}${autoUpdate},
          updated_at  = now()
      WHERE client_id = ${req.user.sub}
    `
```

y devolver el campo en la respuesta del PUT:

```js
    const cfg = await getWarmupConfig(req.user.sub)
    return { ai_provider: cfg.ai_provider, ai_model: cfg.ai_model, ai_base_url: cfg.ai_base_url, has_ai_key: !!cfg.ai_api_key_enc, ai_auto_weekly: !!cfg.ai_auto_weekly }
```

- [ ] **Step 3: Cron semanal en app.js**

En `apps/api/src/app.js`, importar `pruneAiCatalog` y `generateCatalog`:

```js
import { generateCatalog, pruneAiCatalog } from './modules/whatsapp/warmup/ai.generator.js'
```

Dentro del bloque `else` (workers activos), tras el cron de riesgo `*/30`, añadir:

```js
  // Regeneración semanal del catálogo IA (domingo 03:00 hora del servidor).
  cron.schedule('0 3 * * 0', async () => {
    try {
      const clients = await sql`
        SELECT client_id FROM warmup_config
        WHERE is_enabled = true AND ai_auto_weekly = true AND ai_api_key_enc IS NOT NULL
      `
      for (const { client_id } of clients) {
        try {
          const r = await generateCatalog(client_id, 20)
          const pruned = await pruneAiCatalog(client_id, 60)
          fastify.log.info(`[Cron] Warmup IA: +${r.generated} diálogos, -${pruned} podados (cliente ${client_id})`)
        } catch (e) {
          fastify.log.error(`[Cron] Warmup IA cliente ${client_id}: ${e.message}`)
        }
      }
    } catch (err) {
      fastify.log.error({ err }, '[Cron] Error en regeneración semanal de catálogo')
    }
  })
```

- [ ] **Step 4: Toggle en la UI de Settings**

En `apps/web/src/app/dashboard/settings/page.jsx`, dentro de `AiAgentTab`, añadir el toggle antes del bloque de botones (`<div className="flex flex-wrap gap-3">`):

```jsx
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-jungle-green-600"
              checked={!!ai.ai_auto_weekly} onChange={e => setField('ai_auto_weekly', e.target.checked)} />
            Regenerar diálogos con IA cada semana (domingos)
          </label>
```

Y en la función `save`, incluir el campo en el payload:

```js
      const payload = { ai_provider: ai.ai_provider, ai_model: model, ai_base_url: ai.ai_base_url || null, ai_auto_weekly: !!ai.ai_auto_weekly }
```

- [ ] **Step 5: Verificar sintaxis**

Run:
```bash
cd apps/api/src && node --check modules/whatsapp/warmup/ai.generator.js && node --check modules/whatsapp/warmup/warmup.routes.js && node --check app.js
```
Expected: exit 0.

Run (desde la raíz, JSX de settings):
```bash
node --input-type=module -e "import ts from 'typescript'; import {readFileSync} from 'fs'; const f='apps/web/src/app/dashboard/settings/page.jsx'; const o=ts.transpileModule(readFileSync(f,'utf8'),{compilerOptions:{jsx:ts.JsxEmit.Preserve,target:ts.ScriptTarget.ESNext,module:ts.ModuleKind.ESNext},reportDiagnostics:true,fileName:f}); const e=(o.diagnostics||[]).filter(d=>d.category===1); console.log(e.length? 'FAIL '+e.map(d=>ts.flattenDiagnosticMessageText(d.messageText,' ')).join('; ') : 'OK JSX')"
```
Expected: `OK JSX`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/whatsapp/warmup/ai.generator.js apps/api/src/modules/whatsapp/warmup/warmup.routes.js apps/api/src/app.js apps/web/src/app/dashboard/settings/page.jsx
git commit -m "feat(warmup): auto-regeneración semanal del catálogo IA con poda + toggle"
```

---

## Task 8: Deploy y verificación end-to-end

**Files:** (ninguno nuevo — deploy)

- [ ] **Step 1: Push a main (dispara CI/CD)**

```bash
git fetch origin && git rev-list --count HEAD..origin/main   # debe ser 0; si no, git rebase origin/main
git push origin main
```

- [ ] **Step 2: Esperar el deploy y verificar la migración + endpoints**

Esperar ~4 min. Login como admin y verificar (reemplazar por script real):

```bash
BASE="https://orquestador.kuboti.com/api/v1"
TOKEN=$(curl -s -X POST "$BASE/auth/login" -H "Content-Type: application/json" -d '{"email":"admin@kubo.com","password":"Admin123!"}' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).token))")
curl -s -o /dev/null -w "chats  → %{http_code}\n"  "$BASE/whatsapp/warmup/chats"  -H "Authorization: Bearer $TOKEN"
curl -s -o /dev/null -w "alerts → %{http_code}\n"  "$BASE/whatsapp/warmup/alerts" -H "Authorization: Bearer $TOKEN"
curl -s "$BASE/whatsapp/warmup/ai" -H "Authorization: Bearer $TOKEN" | grep -o 'ai_auto_weekly'
```
Expected: `chats → 200`, `alerts → 200`, y que aparezca `ai_auto_weekly` (confirma migración 020 aplicada).

- [ ] **Step 3: Verificación funcional (manual)**

Con el warmup activo dentro del horario, abrir `/dashboard/warmup` y confirmar que la sección **Conversaciones** empieza a mostrar hilos y burbujas a medida que los chips conversan. Confirmar que el toggle de auto-regeneración se guarda en **Configuración → Agente IA**.

---

## Self-Review

**Cobertura del spec:**
- Chat (tabla + retención + registro + endpoints + UI) → Tasks 1, 2, 3, 4. ✓
- Auto-regenerar catálogo (columna + cron + poda + toggle) → Tasks 1, 7. ✓
- Alertas in-app (tabla + generación rojo/baneo + endpoints + UI) → Tasks 1, 5, 6. ✓
- Migración 020 con las 2 tablas + columna → Task 1. ✓
- Deploy vía push → Task 8. ✓

**Consistencia de tipos/nombres:** `threadKeyFor`, `recordWarmupMessage`, `createAlert`, `pruneAiCatalog` se definen en Tasks 2/5/7 y se consumen con las mismas firmas. Campos del job (`peerPhone, peerName, toAccountId, peerKind, threadKey`) se producen en Task 2 (scheduler) y se consumen en Task 2 (worker). `ai_auto_weekly` se crea en Task 1 y se usa en Task 7.

**Sin placeholders:** cada paso trae el código o comando concreto.
