# Campaña SMS de seguimiento con link wa.me — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Desde una campaña WhatsApp IA, tomar los destinatarios **no entregados** y generar una campaña **SMS** con un **link wa.me** personalizado por cliente, para que el cliente inicie el chat (anti-baneo).

**Architecture:** Se cruza `campaign_jobs.message_id` con `messages.external_id` para conocer la entrega por destinatario. Un endpoint crea una lista con los no-entregados; el front abre el wizard SMS pre-cargado, el usuario escribe el texto con `{{variables}}` + `{{link}}`, y `{{link}}` se reemplaza por `https://wa.me/<número del asistente>?text=<prellenado>`.

**Tech Stack:** Node ESM, Fastify, `postgres` (`sql`), Next.js 14 (JS), Tailwind. Sin migración (solo queries + tablas existentes).

## Global Constraints

- Node ESM; SQL con el tag `sql` SOLO (nunca concatenación); rutas bajo `/api/v1`, `fastify.authenticate`, scoped `client_id = req.user.sub`.
- Sin cambios de esquema. Reutilizar `upsertContactsByPhone` (ya importado en `campaigns.routes.js`).
- Solo aplica a campañas `channel='whatsapp'` con `assistant_id` (las que registran el saludo como mensaje).
- "No entregado" = job `sent` cuyo mensaje de saludo (`messages.external_id = campaign_jobs.message_id`) tiene `status` NOT IN (`delivered`,`read`).
- `{{link}}` se resuelve en el frontend al crear la campaña (URL wa.me fija para todos); las `{{variables}}` se interpolan al enviar (ya existe).
- Rama `main`. No desplegar sin aprobación del usuario.

---

### Task 1: Backend — estado de entrega en `/jobs` + filtro `undelivered`

**Files:**
- Modify: `apps/api/src/modules/campaigns/campaigns.routes.js` (endpoint `GET /campaigns/:id/jobs`)

**Interfaces:**
- Produces: cada job devuelve `delivery_status` (`sent`/`delivered`/`read`/null); el filtro `?status=undelivered` devuelve los jobs `sent` no entregados.

- [ ] **Step 1: Leer el handler actual**

READ `GET /campaigns/:id/jobs` en `campaigns.routes.js` (tiene dos ramas: con y sin `statusFilter`, y dos `COUNT`). Vas a: (a) agregar un LEFT JOIN a `messages` para traer `delivery_status`, y (b) manejar el valor especial `status=undelivered`.

- [ ] **Step 2: Reescribir el handler**

Reemplaza el handler completo `fastify.get('/campaigns/:id/jobs', ...)` por:

```js
  fastify.get('/campaigns/:id/jobs', auth, async (req, reply) => {
    const [campaign] = await sql`
      SELECT id FROM campaigns WHERE id = ${req.params.id} AND client_id = ${req.user.sub}
    `
    if (!campaign) return reply.code(404).send({ error: 'Campana no encontrada' })

    const page   = Math.max(1, parseInt(req.query.page ?? 1))
    const limit  = 50
    const offset = (page - 1) * limit
    const statusFilter = req.query.status ?? null

    // "undelivered" = enviado pero el saludo no llegó (sin delivered/read).
    const whereStatus =
      statusFilter === 'undelivered'
        ? sql`AND cj.status = 'sent' AND COALESCE(m.status, 'sent') NOT IN ('delivered', 'read')`
        : statusFilter
          ? sql`AND cj.status = ${statusFilter}`
          : sql``

    const jobs = await sql`
      SELECT cj.id, cj.recipient_email, cj.phone_number, cj.status, cj.sent_at, cj.error_message,
             c.first_name, c.last_name, m.status AS delivery_status
      FROM campaign_jobs cj
      JOIN contacts c ON c.id = cj.contact_id
      LEFT JOIN messages m ON m.external_id = cj.message_id AND m.client_id = ${req.user.sub}
      WHERE cj.campaign_id = ${req.params.id} ${whereStatus}
      ORDER BY cj.sent_at DESC NULLS LAST, cj.created_at
      LIMIT ${limit} OFFSET ${offset}
    `

    const [{ count }] = await sql`
      SELECT COUNT(*)
      FROM campaign_jobs cj
      LEFT JOIN messages m ON m.external_id = cj.message_id AND m.client_id = ${req.user.sub}
      WHERE cj.campaign_id = ${req.params.id} ${whereStatus}
    `

    return { jobs, total: parseInt(count), page, limit, pages: Math.ceil(parseInt(count) / limit) }
  })
```

- [ ] **Step 3: Verificar sintaxis**

Run: `node --check apps/api/src/modules/campaigns/campaigns.routes.js`
Expected: sin salida.

- [ ] **Step 4: Los tests siguen verdes**

Run: `npm test -w apps/api`
Expected: 21/21 pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/campaigns/campaigns.routes.js
git commit -m "feat(campaigns): estado de entrega en /jobs + filtro undelivered"
```

---

### Task 2: Backend — endpoint `POST /campaigns/:id/sms-followup`

**Files:**
- Modify: `apps/api/src/modules/campaigns/campaigns.routes.js`

**Interfaces:**
- Consumes: `upsertContactsByPhone` (ya importado).
- Produces: `POST /campaigns/:id/sms-followup` → `{ list_id, total, wame_number }`. Crea una lista con los no-entregados y devuelve el número wa.me del asistente.

- [ ] **Step 1: Añadir el endpoint**

En `campaigns.routes.js`, tras el handler `POST /campaigns/import-recipients` (o junto a los otros POST de campañas), añadir:

```js
  // Genera una campaña SMS de seguimiento para los no-entregados de una campaña
  // WhatsApp IA: crea una lista con esos contactos y devuelve el número wa.me del
  // asistente. El front abre el wizard SMS con esta lista y arma el link {{link}}.
  fastify.post('/campaigns/:id/sms-followup', auth, async (req, reply) => {
    const [campaign] = await sql`
      SELECT * FROM campaigns WHERE id = ${req.params.id} AND client_id = ${req.user.sub}
    `
    if (!campaign) return reply.code(404).send({ error: 'Campaña no encontrada' })
    if (campaign.channel !== 'whatsapp' || !campaign.assistant_id) {
      return reply.code(400).send({ error: 'Solo aplica a campañas de WhatsApp IA' })
    }

    // No entregados: jobs 'sent' cuyo saludo no está delivered/read.
    const undelivered = await sql`
      SELECT cj.contact_id, cj.phone_number, c.first_name, c.last_name, c.metadata
      FROM campaign_jobs cj
      JOIN contacts c ON c.id = cj.contact_id
      LEFT JOIN messages m ON m.external_id = cj.message_id AND m.client_id = ${req.user.sub}
      WHERE cj.campaign_id = ${campaign.id}
        AND cj.channel = 'whatsapp' AND cj.status = 'sent'
        AND cj.phone_number IS NOT NULL AND cj.phone_number <> ''
        AND COALESCE(m.status, 'sent') NOT IN ('delivered', 'read')
    `
    if (!undelivered.length) {
      return reply.code(400).send({ error: 'No hay destinatarios sin entregar en esta campaña' })
    }

    // Lista nueva con esos contactos (nombre + metadata para las variables del SMS).
    const [list] = await sql`
      INSERT INTO contact_lists (client_id, name, description, source)
      VALUES (${req.user.sub}, ${campaign.name + ' — no entregados'}, 'Seguimiento SMS con link wa.me', 'campaign')
      RETURNING *
    `
    const rows = undelivered.map(u => ({
      phone:      u.phone_number,
      first_name: u.first_name,
      last_name:  u.last_name,
      metadata:   u.metadata && typeof u.metadata === 'object' ? u.metadata : {},
    }))
    const imported = await upsertContactsByPhone(req.user.sub, list.id, rows)
    await sql`
      UPDATE contact_lists SET total_count = (SELECT COUNT(*) FROM contacts WHERE list_id = ${list.id})
      WHERE id = ${list.id}
    `

    // Número wa.me: el WhatsApp del asistente (conectado; del pool si lo hay).
    const wanted = campaign.settings?.wa_account_ids ?? []
    const [acc] = await sql`
      SELECT phone_number FROM whatsapp_accounts
      WHERE client_id = ${req.user.sub} AND assistant_id = ${campaign.assistant_id}
        ${wanted.length ? sql`AND id IN ${sql(wanted)}` : sql``}
      ORDER BY is_connected DESC, created_at ASC
      LIMIT 1
    `
    const wameNumber = acc ? String(acc.phone_number).replace(/\D/g, '') : null

    return { list_id: list.id, total: imported, wame_number: wameNumber }
  })
```

- [ ] **Step 2: Verificar sintaxis**

Run: `node --check apps/api/src/modules/campaigns/campaigns.routes.js`
Expected: sin salida.

- [ ] **Step 3: Tests verdes**

Run: `npm test -w apps/api`
Expected: 21/21 pass.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/campaigns/campaigns.routes.js
git commit -m "feat(campaigns): endpoint sms-followup (lista de no-entregados + numero wa.me)"
```

---

### Task 3: Frontend — detalle: entrega + filtro "No entregado" + botón

**Files:**
- Modify: `apps/web/src/app/dashboard/campaigns/[id]/page.jsx`

**Interfaces:**
- Consumes: `/campaigns/:id/jobs` (ahora con `delivery_status` y filtro `undelivered`); `POST /campaigns/:id/sms-followup`.
- Produces: filtro "No entregado", indicador de entrega por fila, y botón que crea la lista y navega al wizard SMS.

READ THE FILE FIRST. Usa el cliente `api` de `@/lib/api`, el patrón de `FILTERS`, `JOB_COLOR`, y la tabla de destinatarios existentes (se editaron antes para el estado del job).

- [ ] **Step 1: Añadir el filtro "No entregado"**

En el array `FILTERS`, añadir (solo tiene sentido en campañas WhatsApp IA, pero mostrarlo no rompe nada):

```jsx
    { value: 'undelivered', label: 'No entregado' },
```

- [ ] **Step 2: Mostrar la entrega por fila**

En la fila de cada destinatario, junto al estado del job, mostrar el acuse de entrega usando `job.delivery_status`:

```jsx
{job.delivery_status && (
  <span className="ml-2 text-xs text-muted-foreground" title={`Entrega: ${job.delivery_status}`}>
    {job.delivery_status === 'read' ? '✓✓ leído'
      : job.delivery_status === 'delivered' ? '✓✓ entregado'
      : '✓ enviado'}
  </span>
)}
```

- [ ] **Step 3: Botón "Generar SMS con link wa.me"**

En la cabecera de la campaña (junto a Exportar CSV / Ver reporte), añadir un botón visible cuando `campaign.channel === 'whatsapp' && campaign.assistant_id`:

```jsx
{campaign.channel === 'whatsapp' && campaign.assistant_id && (
  <Button variant="outline" onClick={async () => {
    try {
      const r = await api.post(`/campaigns/${campaign.id}/sms-followup`)
      const { list_id, wame_number } = r.data
      // Navegar al wizard SMS pre-cargado con la lista y el número wa.me.
      router.push(`/dashboard/campaigns/new?channel=sms&list_id=${list_id}&wame=${wame_number ?? ''}`)
    } catch (e) {
      // usar el patrón de error del archivo (o un aviso simple)
      alert(e?.response?.data?.error ?? 'No se pudo generar el seguimiento')
    }
  }}>
    Generar SMS con link wa.me
  </Button>
)}
```

(Usa el `router` de `next/navigation` que el archivo ya use; adapta el manejo de error al patrón del archivo.)

- [ ] **Step 4: Verificar build**

Run: `npm run build -w apps/web`
Expected: compila.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/dashboard/campaigns/[id]/page.jsx"
git commit -m "feat(web): detalle de campana muestra entrega + boton SMS con link wa.me"
```

---

### Task 4: Frontend — wizard SMS con link wa.me pre-cargado

**Files:**
- Modify: `apps/web/src/app/dashboard/campaigns/new/page.jsx`

**Interfaces:**
- Consumes: query params `?channel=sms&list_id=...&wame=...`.
- Produces: cuando viene `wame`, muestra el campo "Texto prellenado del wa.me", arma el link, y al crear reemplaza `{{link}}` en el `content_text` por `https://wa.me/<wame>?text=<encode(prellenado)>`.

READ THE FILE FIRST. Reutiliza cómo el wizard lee query params (ya soporta `?from=`), el estado `form`, el paso de mensaje SMS, y el submit.

- [ ] **Step 1: Leer los query params al montar**

Al inicializar el form, leer `channel`, `list_id` y `wame` de la URL (con el hook de searchParams que el archivo ya use). Si vienen: fijar `form.channel='sms'`, `form.list_id=<list_id>`, y guardar `wameNumber` en estado. Añadir estado:

```jsx
const [wameNumber, setWameNumber] = useState('')
const [wamePrefill, setWamePrefill] = useState('Hola, quiero continuar con mi atención')
```

- [ ] **Step 2: Campo del texto prellenado + ayuda de `{{link}}`**

En el paso de mensaje SMS, cuando `wameNumber` esté presente, mostrar:

```jsx
{wameNumber && (
  <div className="space-y-1.5">
    <Label>Texto prellenado del WhatsApp (lo que verá escrito el cliente al abrir el chat)</Label>
    <Input value={wamePrefill} onChange={e => setWamePrefill(e.target.value)} />
    <p className="text-xs text-muted-foreground">
      Usa <code>{'{{link}}'}</code> en tu mensaje para insertar el enlace. Ej: "Hola {'{{nombre}}'}, escríbenos aquí: {'{{link}}'}"
    </p>
  </div>
)}
```

- [ ] **Step 3: Reemplazar `{{link}}` al crear**

En el submit, antes de armar el payload de la campaña SMS, si hay `wameNumber`, construir el link y reemplazar `{{link}}` en `form.content_text`:

```jsx
let contentText = form.content_text
if (wameNumber) {
  const url = `https://wa.me/${wameNumber}?text=${encodeURIComponent(wamePrefill)}`
  contentText = contentText.replaceAll('{{link}}', url)
}
// usar contentText como content_text en el POST /campaigns (canal sms)
```

(Integrar respetando cómo el archivo arma el payload SMS. El resto — lista, variables, contador de segmentos — ya funciona.)

- [ ] **Step 4: Verificar build**

Run: `npm run build -w apps/web`
Expected: compila.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/dashboard/campaigns/new/page.jsx"
git commit -m "feat(web): wizard SMS arma link wa.me y reemplaza {{link}}"
```

---

### Task 5: Verificación E2E + deploy (con aprobación)

- [ ] **Step 1: Tests**

Run: `npm test -w apps/api`
Expected: 21/21 pass.

- [ ] **Step 2: Manual (staging/prod con cuidado)**

1. Campaña WhatsApp IA con un no-entregado real → el filtro "No entregado" lo muestra y la fila indica ✓ enviado.
2. "Generar SMS con link wa.me" → crea la lista y abre el wizard SMS con esa lista.
3. Escribir `"Hola {{nombre}}, escríbenos aquí: {{link}}"` → crear/enviar → el SMS llega con el nombre y un link `wa.me/...` válido.
4. Clic en el link → abre WhatsApp al número del negocio con el texto prellenado → enviar → el asistente responde con los datos del cliente.

- [ ] **Step 3: Deploy (requiere OK del usuario)**

NO ejecutar sin aprobación. Push a `main` → CI/CD despliega. Verificar la Actions run = success.

---

## Notas / desviaciones

- Sin migración: todo con queries + tablas existentes.
- El `{{link}}` se resuelve en el front (URL fija por campaña); las `{{variables}}` se interpolan al enviar (backend ya existe).
- Solo campañas WhatsApp IA (son las que registran el saludo → conocemos la entrega).
