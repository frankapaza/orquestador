import { z } from 'zod'
import { sql } from '../../lib/db.js'
import { env } from '../../config/env.js'
import { EvolutionAdapter } from '../channels/adapters/evolution.adapter.js'
import { AndroidSmsAdapter } from '../channels/adapters/android-sms.adapter.js'
import { baileysManager } from '../whatsapp/baileys.manager.js'
import { dispatchWebhook } from '../webhook-subscriptions/dispatcher.js'
import { bus } from '../../lib/eventBus.js'
import { resolveAiSettings } from '../whatsapp/warmup/ai.generator.js'
import { join, dirname, extname } from 'path'
import { fileURLToPath } from 'url'
import { createWriteStream } from 'fs'
import { pipeline } from 'stream/promises'
import crypto from 'crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Llama al proveedor (compatible OpenAI: ChatGPT/DeepSeek) y devuelve el texto.
// Mismo patrón que assistant.responder.js (chatComplete local).
async function chatComplete({ baseUrl, model, apiKey }, messages) {
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, temperature: 0.3 }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`IA respondió ${res.status}: ${detail.slice(0, 160)}`)
  }
  const data = await res.json()
  return (data?.choices?.[0]?.message?.content ?? '').trim()
}

const AI_SUMMARY_SYSTEM = `Eres un asistente que resume conversaciones de WhatsApp/SMS entre un cliente y un asesor/negocio, en español. Genera un resumen conciso y factual con esta estructura exacta (usa estos encabezados en negrita markdown):

**Intención del cliente**
**Estado de la conversación**
**Datos clave**
**Próximos pasos sugeridos**
**Sentimiento**

Reglas:
- Sé breve y directo, sin relleno.
- En "Datos clave" incluye montos, fechas, DNI u otros datos concretos SOLO si aparecen en la conversación.
- No inventes información que no esté en el texto.
- Si una sección no aplica, escribe "No aplica" en esa sección.`

export async function conversationsRoutes(fastify) {
  const pre = [fastify.authenticate]

  // Subir archivo de media (imagen, audio, documento)
  fastify.post('/media/upload', { onRequest: pre }, async (req, reply) => {
    const file = await req.file({ limits: { fileSize: 16 * 1024 * 1024 } }) // 16 MB
    if (!file) return reply.code(400).send({ error: 'No se recibió archivo' })

    const ext      = extname(file.filename || '.bin').toLowerCase()
    const allowed  = ['.jpg','.jpeg','.png','.gif','.webp','.mp4','.mp3','.ogg','.opus','.pdf','.doc','.docx','.txt']
    if (!allowed.includes(ext)) return reply.code(400).send({ error: `Formato no permitido: ${ext}` })

    const fileName = `${crypto.randomUUID()}${ext}`
    const uploadsDir = join(__dirname, '..', '..', '..', 'uploads')
    const filePath   = join(uploadsDir, fileName)

    await pipeline(file.file, createWriteStream(filePath))

    const baseUrl  = env.TRACKING_BASE_URL ?? 'http://localhost:3002'
    const mediaUrl = `${baseUrl}/uploads/${fileName}`

    // Detectar tipo de media
    const imageExts = ['.jpg','.jpeg','.png','.gif','.webp']
    const audioExts = ['.mp3','.ogg','.opus','.m4a']
    const videoExts = ['.mp4','.mov']
    const mediaType = imageExts.includes(ext) ? 'image'
                    : audioExts.includes(ext) ? 'audio'
                    : videoExts.includes(ext) ? 'video'
                    : 'document'

    return { url: mediaUrl, type: mediaType, filename: file.filename }
  })

  // Iniciar o enviar mensaje nuevo (crea conversación si no existe)
  fastify.post('/messages/send', { onRequest: pre }, async (req, reply) => {
    const body = z.object({
      channel:    z.enum(['whatsapp', 'sms']),
      account_id: z.string().uuid(),
      to:         z.string().min(6),
      message:    z.string().min(1),
      media_url:  z.string().url().optional(),
      media_type: z.string().optional(),
    }).parse(req.body)

    // Verificar que la cuenta pertenece al cliente
    const table  = body.channel === 'whatsapp' ? 'whatsapp_accounts' : 'sms_accounts'
    const [account] = await sql`
      SELECT * FROM ${sql(table)}
      WHERE id = ${body.account_id} AND client_id = ${req.user.sub} AND is_active = true
    `
    if (!account) return reply.code(404).send({ error: 'Cuenta no encontrada' })

    let externalId = null
    let error      = null

    try {
      if (body.channel === 'whatsapp') {
        if (!account.is_connected) return reply.code(400).send({ error: 'Número WhatsApp no conectado. Vincula el número primero.' })

        let result
        if (account.provider === 'baileys') {
          result = await baileysManager.send(account.instance_name, {
            to: body.to, body: body.message,
            mediaUrl: body.media_url, mediaType: body.media_type,
          })
        } else {
          const adapter = new EvolutionAdapter(account)
          result = await adapter.send({ to: body.to, body: body.message, mediaUrl: body.media_url, mediaType: body.media_type })
        }
        externalId = result?.key?.id ?? result?.id ?? null
        await sql`UPDATE whatsapp_accounts SET last_used_at = now(), sent_today = sent_today + 1 WHERE id = ${account.id}`
      } else {
        const adapter = new AndroidSmsAdapter(account)
        const result  = await adapter.send({ to: body.to, body: body.message })
        externalId    = result?.id ?? null
        await sql`UPDATE sms_accounts SET last_used_at = now(), sent_today = sent_today + 1 WHERE id = ${account.id}`
      }
    } catch (err) {
      error = err.message
    }

    // Crear o recuperar conversación
    const [conv] = await sql`
      INSERT INTO conversations
        (client_id, channel, contact_phone, account_id, account_type, last_message_at)
      VALUES
        (${req.user.sub}, ${body.channel}, ${body.to}, ${account.id}, ${body.channel}, now())
      ON CONFLICT (client_id, channel, contact_phone, account_id)
      DO UPDATE SET last_message_at = now()
      RETURNING *
    `

    // Guardar mensaje
    const [msg] = await sql`
      INSERT INTO messages
        (client_id, conversation_id, channel, direction, to_number,
         body, media_url, media_type, external_id, status, sent_at)
      VALUES
        (${req.user.sub}, ${conv.id}, ${body.channel}, 'outbound', ${body.to},
         ${body.message}, ${body.media_url ?? null}, ${body.media_type ?? null},
         ${externalId}, ${error ? 'failed' : 'sent'}, now())
      RETURNING *
    `

    if (error) return reply.code(500).send({ error, message: msg, conversation: conv })

    await dispatchWebhook(req.user.sub, 'message.sent', {
      channel: body.channel, conversation_id: conv.id, message_id: msg.id,
      contact_phone: body.to, body: body.message,
    })

    return reply.code(201).send({ message: msg, conversation: conv })
  })

  // Listar conversaciones (inbox)
  fastify.get('/conversations', { onRequest: pre }, async (req) => {
    const { channel, status = 'open', account, page = 1, limit = 30 } = req.query
    const offset = (page - 1) * limit

    const channelFilter   = channel ? sql`AND c.channel = ${channel}` : sql``
    const statusFilter    = (status && status !== 'all') ? sql`AND c.status = ${status}` : sql``
    const accountIdFilter = account ? sql`AND c.account_id::text = ${account}` : sql``

    // Asesores: filtrar solo conversaciones de sus canales asignados
    let accountFilter = sql``
    if (req.user.member_id) {
      const waIds = await sql`
        SELECT id FROM whatsapp_accounts
        WHERE client_id = ${req.user.sub} AND assigned_member_id = ${req.user.member_id} AND is_active = true
      `
      const smsIds = await sql`
        SELECT id FROM sms_accounts
        WHERE client_id = ${req.user.sub} AND assigned_member_id = ${req.user.member_id} AND is_active = true
      `
      const ids = [...waIds.map(r => r.id), ...smsIds.map(r => r.id)]
      if (ids.length === 0) return []
      // Comparar como text para evitar problemas de tipo uuid en postgres.js
      accountFilter = sql`AND c.account_id::text = ANY(ARRAY[${sql.unsafe(ids.map(id => `'${id}'`).join(','))}])`
    }

    return sql`
      SELECT
        c.*,
        m.body        AS last_body,
        m.direction   AS last_direction,
        m.status      AS last_status,
        m.created_at  AS last_message_created_at,
        COALESCE(wa.name, sa.name)                 AS account_name,
        COALESCE(wa.phone_number, sa.phone_number) AS account_phone
      FROM conversations c
      LEFT JOIN LATERAL (
        SELECT body, direction, status, created_at
        FROM messages
        WHERE conversation_id = c.id
        ORDER BY created_at DESC
        LIMIT 1
      ) m ON true
      LEFT JOIN whatsapp_accounts wa ON wa.id = c.account_id AND c.account_type = 'whatsapp'
      LEFT JOIN sms_accounts      sa ON sa.id = c.account_id AND c.account_type = 'sms'
      WHERE c.client_id = ${req.user.sub}
        ${statusFilter}
        ${channelFilter}
        ${accountIdFilter}
        ${accountFilter}
      ORDER BY c.last_message_at DESC NULLS LAST
      LIMIT ${limit} OFFSET ${offset}
    `
  })

  // Detalle de una conversación + sus mensajes
  fastify.get('/conversations/:id', { onRequest: pre }, async (req) => {
    const [conv] = await sql`
      SELECT c.*,
        COALESCE(wa.name, sa.name)                 AS account_name,
        COALESCE(wa.phone_number, sa.phone_number) AS account_phone
      FROM conversations c
      LEFT JOIN whatsapp_accounts wa ON wa.id = c.account_id AND c.account_type = 'whatsapp'
      LEFT JOIN sms_accounts      sa ON sa.id = c.account_id AND c.account_type = 'sms'
      WHERE c.id = ${req.params.id} AND c.client_id = ${req.user.sub}
    `
    if (!conv) return req.server.httpErrors?.notFound() ?? { error: 'No encontrada' }

    const messages = await sql`
      SELECT * FROM messages
      WHERE conversation_id = ${req.params.id}
      ORDER BY created_at ASC
    `

    // Marcar como leídos
    await sql`
      UPDATE conversations SET unread_count = 0
      WHERE id = ${req.params.id}
    `

    return { ...conv, messages }
  })

  // Responder en una conversación
  fastify.post('/conversations/:id/reply', { onRequest: pre }, async (req, reply) => {
    const body = z.object({
      body:         z.string().optional(),
      media_url:    z.string().url().optional(),
      media_type:   z.string().optional(),
      media_caption: z.string().optional(),
    }).refine(d => d.body || d.media_url, { message: 'Debe enviar body o media_url' })
     .parse(req.body)

    const [conv] = await sql`
      SELECT * FROM conversations
      WHERE id = ${req.params.id} AND client_id = ${req.user.sub}
    `
    if (!conv) return reply.code(404).send({ error: 'Conversación no encontrada' })

    let externalId = null
    let error = null

    try {
      if (conv.channel === 'whatsapp') {
        const [account] = await sql`SELECT * FROM whatsapp_accounts WHERE id = ${conv.account_id}`
        let result
        if (account.provider === 'baileys') {
          result = await baileysManager.send(account.instance_name, {
            to:           conv.contact_phone,
            body:         body.body,
            mediaUrl:     body.media_url,
            mediaType:    body.media_type,
            mediaCaption: body.media_caption,
          })
        } else {
          const adapter = new EvolutionAdapter(account)
          result = await adapter.send({ to: conv.contact_phone, ...body })
        }
        externalId = result?.key?.id ?? result?.id ?? null
        await sql`UPDATE whatsapp_accounts SET last_used_at = now(), sent_today = sent_today + 1 WHERE id = ${account.id}`
      } else if (conv.channel === 'sms') {
        const [account] = await sql`SELECT * FROM sms_accounts WHERE id = ${conv.account_id}`
        const adapter = new AndroidSmsAdapter(account)
        const result = await adapter.send({ to: conv.contact_phone, body: body.body })
        externalId = result?.id ?? null
        await sql`UPDATE sms_accounts SET last_used_at = now(), sent_today = sent_today + 1 WHERE id = ${account.id}`
      }
    } catch (err) {
      error = err.message
    }

    const [msg] = await sql`
      INSERT INTO messages
        (client_id, conversation_id, channel, direction, from_number, to_number,
         body, media_url, media_type, media_caption, external_id, status, sent_at)
      VALUES
        (${conv.client_id}, ${conv.id}, ${conv.channel}, 'outbound',
         NULL, ${conv.contact_phone},
         ${body.body ?? null}, ${body.media_url ?? null}, ${body.media_type ?? null},
         ${body.media_caption ?? null}, ${externalId}, ${error ? 'failed' : 'sent'}, now())
      RETURNING *
    `

    await sql`UPDATE conversations SET last_message_at = now() WHERE id = ${conv.id}`

    if (!error) {
      await dispatchWebhook(conv.client_id, 'message.sent', {
        channel:         conv.channel,
        conversation_id: conv.id,
        message_id:      msg.id,
        contact_phone:   conv.contact_phone,
        body:            body.body,
      })
    }

    // Push en vivo a todas las pestañas/agentes del mismo cliente.
    bus.emit(conv.client_id, {
      type:            'message:new',
      conversation_id: conv.id,
      message:         msg,
      channel:         conv.channel,
    })

    return reply.code(error ? 500 : 201).send({ ...msg, error })
  })

  // Suscribe al monitoreo de presencia del contacto de esta conversación.
  // Lo dispara el frontend al abrir la conv (una sola vez). Devuelve el último
  // estado conocido para mostrarlo de inmediato.
  fastify.post('/conversations/:id/presence-subscribe', { onRequest: pre }, async (req, reply) => {
    const [conv] = await sql`
      SELECT c.id, c.contact_phone, c.presence, c.last_seen_at, c.presence_updated_at,
             wa.instance_name, wa.provider
      FROM conversations c
      LEFT JOIN whatsapp_accounts wa ON wa.id = c.account_id AND c.channel = 'whatsapp'
      WHERE c.id = ${req.params.id} AND c.client_id = ${req.user.sub}
    `
    if (!conv) return reply.code(404).send({ error: 'Conversación no encontrada' })

    if (conv.provider === 'baileys' && conv.instance_name) {
      try {
        await baileysManager.subscribePresence(conv.instance_name, conv.contact_phone)
      } catch {}
    }

    return {
      contact_phone: conv.contact_phone,
      presence:      conv.presence,
      last_seen_at:  conv.last_seen_at,
      updated_at:    conv.presence_updated_at,
    }
  })

  // Marcar los mensajes inbound de una conversación como leídos POR el operador
  // del Inbox. NO confundir con el "read" del webhook (que es cuando el cliente
  // del cliente lee nuestro outbound).
  fastify.post('/conversations/:id/read', { onRequest: pre }, async (req, reply) => {
    const [conv] = await sql`
      SELECT id, client_id FROM conversations
      WHERE id = ${req.params.id} AND client_id = ${req.user.sub}
    `
    if (!conv) return reply.code(404).send({ error: 'Conversación no encontrada' })

    await sql`
      UPDATE messages SET read_at = COALESCE(read_at, now())
      WHERE conversation_id = ${conv.id}
        AND direction = 'inbound'
        AND read_at IS NULL
    `
    await sql`UPDATE conversations SET unread_count = 0 WHERE id = ${conv.id}`

    bus.emit(conv.client_id, {
      type:            'conversation:read',
      conversation_id: conv.id,
    })

    return { ok: true }
  })

  // Cambiar estado de conversación
  fastify.patch('/conversations/:id/status', { onRequest: pre }, async (req, reply) => {
    const { status } = z.object({
      status: z.enum(['open', 'closed', 'pending'])
    }).parse(req.body)

    const [conv] = await sql`
      UPDATE conversations SET status = ${status}
      WHERE id = ${req.params.id} AND client_id = ${req.user.sub}
      RETURNING id, status
    `
    if (!conv) return reply.code(404).send({ error: 'Conversación no encontrada' })
    return conv
  })

  // Resumen de conversación generado con IA (on-the-fly, sin persistencia).
  fastify.post('/conversations/:id/summary', { onRequest: pre }, async (req, reply) => {
    const [conv] = await sql`
      SELECT * FROM conversations
      WHERE id = ${req.params.id} AND client_id = ${req.user.sub}
    `
    if (!conv) return reply.code(404).send({ error: 'Conversación no encontrada' })

    const messages = await sql`
      SELECT body, direction, created_at FROM messages
      WHERE conversation_id = ${req.params.id}
      ORDER BY created_at ASC
    `
    const withBody = messages.filter(m => m.body && m.body.trim())
    if (withBody.length === 0) {
      return { summary: 'No hay mensajes suficientes para resumir.' }
    }

    const [cfg] = await sql`SELECT * FROM warmup_config WHERE client_id = ${req.user.sub}`
    const settings = resolveAiSettings(cfg ?? {})
    if (!settings.apiKey || !settings.baseUrl || !settings.model) {
      return reply.code(400).send({ error: 'La IA (Agente IA) no está configurada. Configúrala en Calentamiento → Agente IA.' })
    }

    const transcript = withBody
      .slice(-60)
      .map(m => `${m.direction === 'inbound' ? 'Cliente' : 'Asistente'}: ${m.body.trim()}`)
      .join('\n')

    let summary
    try {
      summary = await chatComplete(settings, [
        { role: 'system', content: AI_SUMMARY_SYSTEM },
        { role: 'user', content: transcript },
      ])
    } catch (e) {
      return reply.code(502).send({ error: 'No se pudo generar el resumen: ' + e.message })
    }

    return { summary }
  })
}
