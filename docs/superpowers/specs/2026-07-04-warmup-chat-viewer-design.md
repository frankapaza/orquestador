# Diseño — Visor de chat del warmup + auto-catálogo + alertas

**Fecha:** 2026-07-04
**Estado:** Aprobado (pendiente implementación)
**Contexto:** El calentamiento (warmup) de chips WhatsApp ya está en producción. Hoy solo
expone contadores enviados/recibidos por día; no se ve el contenido de las conversaciones.
Este diseño agrega visibilidad (chat), regeneración automática del catálogo con IA y alertas
de riesgo in-app.

## Objetivos

1. **Visor de chat** — ver cómo conversan los chips (internos ↔ internos y chips → externos)
   como un chat real, con historial.
2. **Auto-regenerar catálogo** — que la IA cree diálogos nuevos cada semana sin intervención.
3. **Alertas en rojo (in-app)** — avisar en la app cuando un chip entra en riesgo alto (`red`) o
   es baneado.

Fuera de alcance (YAGNI): botón de pánico, notificaciones por email/WhatsApp, ver respuestas
de contactos externos (esas van al inbox real).

---

## 1. Visor de chat

### Modelo de datos (migración `020_warmup_chat_alerts.sql`)

Tabla `warmup_messages` (auto-limpiable por retención):

| Columna | Tipo | Nota |
|---|---|---|
| id | UUID PK | |
| client_id | UUID FK clients | |
| thread_key | VARCHAR(80) | par de teléfonos ordenado `min|max` (agrupa A↔B sin importar dirección) |
| from_account_id | UUID FK whatsapp_accounts | chip que envió |
| to_account_id | UUID NULL | chip interno receptor; null si externo |
| peer_phone | VARCHAR(30) | teléfono del otro lado |
| peer_name | VARCHAR(120) NULL | nombre del chip interno o del contacto |
| peer_kind | VARCHAR(10) | `internal` \| `external` |
| text | TEXT | contenido del mensaje |
| created_at | TIMESTAMPTZ default now() | |

Índice: `(client_id, thread_key, created_at)`.

**Principio clave:** en el warmup interno **ambos chips envían** (A→B y B→A), por lo que basta
**registrar solo los mensajes salientes** de cada chip para reconstruir el chat completo. Para
externos se registra solo el saliente (una sola dirección).

### Registro

- El scheduler (`warmup.scheduler.js`) ya arma cada turno; se amplía el payload del job para
  incluir: `peerPhone`, `peerName`, `toAccountId` (null si externo), `peerKind`, `threadKey`.
- El worker (`warmup.queue.js`), tras `sendWarmup` exitoso, inserta la fila en `warmup_messages`.
- `threadKey` se calcula como `[digits(chipPhone), digits(peerPhone)].sort().join('|')`.

### Retención

- Cron **diario** (junto al reset de contadores): `DELETE FROM warmup_messages WHERE created_at < now() - interval '7 days'`.

### API

- `GET /whatsapp/warmup/chats` → lista de hilos del cliente: `thread_key`, participantes
  (nombres/teléfonos), último `text`, `last_at`, `count`. `GROUP BY thread_key ORDER BY last_at DESC`.
- `GET /whatsapp/warmup/chats/:threadKey` → mensajes del hilo (validando pertenencia al cliente),
  ordenados por `created_at ASC`, con `from_account_id` y `from_name` para alinear burbujas.

### UI

- Sección **"Conversaciones"** en `/dashboard/warmup` (o pestaña), estilo maestro-detalle:
  - Izquierda: lista de chats (par de chips / contacto, último mensaje, hora).
  - Derecha: burbujas del chat seleccionado, alineadas/coloreadas por emisor.
  - Auto-refresh por polling cada ~6 s.

---

## 2. Auto-regenerar catálogo con IA

- Nueva columna `ai_auto_weekly BOOLEAN DEFAULT false` en `warmup_config` (migración 020).
- Cron **semanal** (domingo 03:00 hora servidor): para cada cliente con `warmup_config.is_enabled`
  y API key de IA configurada y `ai_auto_weekly = true`:
  - Llama `generateCatalog(clientId, N)` (N por defecto 20).
  - **Poda:** deja como activas solo las últimas ~60 conversaciones IA (`is_active = false` a las
    más antiguas) para no inflar el catálogo. El catálogo base (`source = 'manual'`) no se toca.
- UI: toggle "Regenerar diálogos con IA cada semana" en la sección Agente IA (Configuración).

---

## 3. Alertas en rojo (in-app)

### Modelo de datos (migración 020)

Tabla `warmup_alerts`:

| Columna | Tipo | Nota |
|---|---|---|
| id | UUID PK | |
| client_id | UUID FK clients | |
| account_id | UUID FK whatsapp_accounts | |
| level | VARCHAR(10) | `red` \| `banned` |
| reason | VARCHAR(255) | |
| acknowledged | BOOLEAN default false | |
| created_at | TIMESTAMPTZ default now() | |

### Generación

- En `risk.service.js` (`recomputeRisk`): cuando un chip pasa a `red`, crear alerta `red`.
- En `baileys.manager.js` (`connection.close`): solo al detectar **baneo** (código 401/403),
  crear alerta `banned`. Las desconexiones transitorias (reconexión automática) NO generan
  alerta, para evitar ruido.
- **Anti-spam:** no crear si ya existe una alerta no reconocida (`acknowledged = false`) del mismo
  `account_id` y `level`.

### API

- `GET /whatsapp/warmup/alerts` → alertas no reconocidas del cliente (con nombre del chip).
- `POST /whatsapp/warmup/alerts/:id/ack` → marcar como reconocida.

### UI

- Badge con conteo de alertas + lista desplegable (chip, motivo, hora, botón "marcar leída") en
  la cabecera de `/dashboard/warmup`.

---

## Resumen de cambios

- **Migración 020**: tablas `warmup_messages`, `warmup_alerts`; columna `warmup_config.ai_auto_weekly`.
- **Backend**: registro de mensajes en worker + payload ampliado en scheduler; alertas en
  `risk.service.js` y `baileys.manager.js`; endpoints de chats y alerts; 2 crons nuevos
  (limpieza diaria de mensajes, regeneración semanal de catálogo).
- **Frontend**: sección Conversaciones (chat) + badge/lista de alertas en `/dashboard/warmup`;
  toggle de auto-regeneración en Configuración → Agente IA.
- **Sin infraestructura nueva** (mismo Postgres/Redis/BullMQ).

## Despliegue

Vía push a `main` → CI/CD del VPS aplica la migración 020 con `migrate.js` (ver
credenciales.txt puntos 8-10).
