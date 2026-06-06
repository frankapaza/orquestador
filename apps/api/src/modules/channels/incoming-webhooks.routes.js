import { sql } from '../../lib/db.js'
import { dispatchWebhook } from '../webhook-subscriptions/dispatcher.js'

async function upsertConversation({ clientId, channel, contactPhone, contactName, accountId, accountType }) {
  const [conv] = await sql`
    INSERT INTO conversations (client_id, channel, contact_phone, contact_name, account_id, account_type, last_message_at)
    VALUES (${clientId}, ${channel}, ${contactPhone}, ${contactName ?? null}, ${accountId}, ${accountType}, now())
    ON CONFLICT (client_id, channel, contact_phone, account_id)
    DO UPDATE SET
      last_message_at = now(),
      contact_name    = COALESCE(EXCLUDED.contact_name, conversations.contact_name),
      unread_count    = conversations.unread_count + 1
    RETURNING *
  `
  return conv
}

async function saveMessage({ clientId, conversationId, channel, direction, from, to, body, mediaUrl, mediaType, externalId, status }) {
  const [msg] = await sql`
    INSERT INTO messages
      (client_id, conversation_id, channel, direction, from_number, to_number,
       body, media_url, media_type, external_id, status, sent_at)
    VALUES
      (${clientId}, ${conversationId}, ${channel}, ${direction}, ${from ?? null}, ${to ?? null},
       ${body ?? null}, ${mediaUrl ?? null}, ${mediaType ?? null}, ${externalId ?? null},
       ${status ?? 'sent'}, now())
    RETURNING *
  `
  return msg
}

export async function incomingWebhooksRoutes(fastify) {

  // Evolution API webhook (WhatsApp entrante)
  fastify.post('/webhooks/evolution/:instanceName', async (req, reply) => {
    const { instanceName } = req.params
    const event = req.body

    // Buscar la cuenta por instance_name
    const [account] = await sql`
      SELECT wa.*, c.id AS client_id
      FROM whatsapp_accounts wa
      JOIN clients c ON c.id = wa.client_id
      WHERE wa.instance_name = ${instanceName} AND wa.is_active = true
    `
    if (!account) return reply.code(404).send({ error: 'Instancia no encontrada' })

    const eventType = event?.event ?? event?.type

    // Mensaje recibido
    if (eventType === 'messages.upsert' || eventType === 'MESSAGES_UPSERT') {
      const msgs = event?.data?.messages ?? event?.messages ?? []
      for (const m of msgs) {
        if (m.key?.fromMe) continue // ignorar mensajes propios

        const contactPhone = m.key?.remoteJid?.replace('@s.whatsapp.net', '')
        const contactName  = m.pushName ?? null
        const body         = m.message?.conversation
                          ?? m.message?.extendedTextMessage?.text
                          ?? null
        const mediaUrl     = m.message?.imageMessage?.url
                          ?? m.message?.documentMessage?.url
                          ?? null
        const mediaType    = m.message?.imageMessage ? 'image'
                          : m.message?.documentMessage ? 'document'
                          : m.message?.audioMessage ? 'audio'
                          : m.message?.videoMessage ? 'video'
                          : null

        const conv = await upsertConversation({
          clientId:    account.client_id,
          channel:     'whatsapp',
          contactPhone,
          contactName,
          accountId:   account.id,
          accountType: 'whatsapp',
        })

        const msg = await saveMessage({
          clientId:       account.client_id,
          conversationId: conv.id,
          channel:        'whatsapp',
          direction:      'inbound',
          from:           contactPhone,
          to:             account.phone_number,
          body,
          mediaUrl,
          mediaType,
          externalId:     m.key?.id,
          status:         'received',
        })

        // Marcar número como conectado si aún no lo estaba
        await sql`UPDATE whatsapp_accounts SET is_connected = true WHERE id = ${account.id}`

        // Notificar a sistemas externos
        await dispatchWebhook(account.client_id, 'message.received', {
          channel:          'whatsapp',
          conversation_id:  conv.id,
          message_id:       msg.id,
          contact_phone:    contactPhone,
          contact_name:     contactName,
          body,
          media_url:        mediaUrl,
          received_at:      msg.created_at,
        })
      }
    }

    // Actualización de estado (enviado, entregado, leído)
    if (eventType === 'messages.update' || eventType === 'MESSAGES_UPDATE') {
      const updates = event?.data?.updates ?? event?.updates ?? []
      for (const u of updates) {
        const statusMap = { 2: 'sent', 3: 'delivered', 4: 'read' }
        const newStatus = statusMap[u.update?.status]
        if (!newStatus || !u.key?.id) continue

        const updateData = { status: newStatus }
        if (newStatus === 'delivered') updateData.delivered_at = new Date()
        if (newStatus === 'read')      updateData.read_at = new Date()

        await sql`
          UPDATE messages SET ${sql(updateData, ...Object.keys(updateData))}
          WHERE external_id = ${u.key.id} AND client_id = ${account.client_id}
        `

        if (newStatus === 'read') {
          await dispatchWebhook(account.client_id, 'message.read', {
            channel:     'whatsapp',
            external_id: u.key.id,
          })
        }
      }
    }

    // Evento de conexión/desconexión
    if (eventType === 'connection.update' || eventType === 'CONNECTION_UPDATE') {
      const state = event?.data?.state ?? event?.state
      const connected = state === 'open'
      await sql`UPDATE whatsapp_accounts SET is_connected = ${connected} WHERE id = ${account.id}`
    }

    return reply.code(200).send({ ok: true })
  })

  // Android SMS Gateway webhook (SMS entrante)
  fastify.post('/webhooks/sms/:accountId', async (req, reply) => {
    const { accountId } = req.params
    const event = req.body

    const [account] = await sql`
      SELECT * FROM sms_accounts
      WHERE id = ${accountId} AND is_active = true
    `
    if (!account) return reply.code(404).send({ error: 'Cuenta no encontrada' })

    // Mensaje recibido: { event: "sms:received", payload: { message, phoneNumber, receivedAt } }
    if (event?.event === 'sms:received' || event?.type === 'received') {
      const payload = event?.payload ?? event
      const contactPhone = payload?.phoneNumber ?? payload?.from
      const body         = payload?.message ?? payload?.body

      const conv = await upsertConversation({
        clientId:    account.client_id,
        channel:     'sms',
        contactPhone,
        contactName: null,
        accountId:   account.id,
        accountType: 'sms',
      })

      const msg = await saveMessage({
        clientId:       account.client_id,
        conversationId: conv.id,
        channel:        'sms',
        direction:      'inbound',
        from:           contactPhone,
        to:             account.phone_number,
        body,
        externalId:     payload?.id ?? null,
        status:         'received',
      })

      await sql`UPDATE sms_accounts SET is_online = true WHERE id = ${accountId}`

      await dispatchWebhook(account.client_id, 'message.received', {
        channel:          'sms',
        conversation_id:  conv.id,
        message_id:       msg.id,
        contact_phone:    contactPhone,
        body,
        received_at:      msg.created_at,
      })
    }

    // SMS enviado desde el teléfono (manual o via API)
    if (event?.event === 'sms:sent' || event?.state === 'Sent') {
      const payload    = event?.payload ?? event
      const externalId = payload?.id ?? null
      const body       = payload?.message ?? payload?.body ?? null
      const phones     = payload?.phoneNumbers ?? (payload?.phoneNumber ? [payload.phoneNumber] : [])

      if (externalId) {
        // Verificar si el mensaje ya existe en Kubo (fue enviado desde la plataforma)
        const [existing] = await sql`
          SELECT id FROM messages
          WHERE external_id = ${externalId} AND client_id = ${account.client_id}
        `

        if (existing) {
          // Solo actualizar estado
          await sql`
            UPDATE messages SET status = 'sent', sent_at = now()
            WHERE external_id = ${externalId} AND client_id = ${account.client_id}
          `
        } else if (body && phones.length > 0) {
          // SMS enviado manualmente desde el teléfono — registrar en Kubo
          for (const contactPhone of phones) {
            const conv = await upsertConversation({
              clientId:    account.client_id,
              channel:     'sms',
              contactPhone,
              contactName: null,
              accountId:   account.id,
              accountType: 'sms',
            })

            await saveMessage({
              clientId:       account.client_id,
              conversationId: conv.id,
              channel:        'sms',
              direction:      'outbound',
              from:           account.phone_number,
              to:             contactPhone,
              body,
              externalId,
              status: 'sent',
            })

            await sql`UPDATE sms_accounts SET last_used_at = now() WHERE id = ${accountId}`

            await dispatchWebhook(account.client_id, 'message.sent', {
              channel: 'sms', conversation_id: conv.id,
              contact_phone: contactPhone, body,
            })
          }
        }
      }
    }

    return reply.code(200).send({ ok: true })
  })
}
