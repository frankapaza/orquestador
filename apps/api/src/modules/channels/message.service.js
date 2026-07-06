import { sql } from '../../lib/db.js'
import { dispatchWebhook } from '../webhook-subscriptions/dispatcher.js'
import { bus } from '../../lib/eventBus.js'

export async function upsertConversation({ clientId, channel, contactPhone, contactName, accountId, accountType }) {
  const [conv] = await sql`
    INSERT INTO conversations
      (client_id, channel, contact_phone, contact_name, account_id, account_type, last_message_at)
    VALUES
      (${clientId}, ${channel}, ${contactPhone}, ${contactName ?? null}, ${accountId}, ${accountType}, now())
    ON CONFLICT (client_id, channel, contact_phone, account_id)
    DO UPDATE SET
      last_message_at = now(),
      contact_name    = COALESCE(EXCLUDED.contact_name, conversations.contact_name),
      unread_count    = conversations.unread_count + 1
    RETURNING *
  `
  return conv
}

export async function saveMessage({ clientId, conversationId, channel, direction, from, to, body, mediaUrl, mediaType, externalId, status }) {
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

export async function processIncoming({ clientId, channel, accountId, accountType, contactPhone, contactName, body, mediaUrl, mediaType, externalId }) {
  const conv = await upsertConversation({ clientId, channel, contactPhone, contactName, accountId, accountType })
  const msg  = await saveMessage({
    clientId, conversationId: conv.id, channel,
    direction: 'inbound', from: contactPhone,
    body, mediaUrl, mediaType, externalId, status: 'received',
  })

  await dispatchWebhook(clientId, 'message.received', {
    channel, conversation_id: conv.id, message_id: msg.id,
    contact_phone: contactPhone, contact_name: contactName,
    body, media_url: mediaUrl, received_at: msg.created_at,
  })

  // Push en vivo al Inbox (SSE).
  bus.emit(clientId, {
    type:            'message:new',
    conversation_id: conv.id,
    message:         msg,
    channel,
  })

  return { conv, msg }
}

// Guarda un mensaje SALIENTE que el usuario escribió desde el CELULAR (no desde
// la plataforma). Dedup por external_id (evita duplicar los enviados desde la
// plataforma, que llegan con el mismo id). NO incrementa no-leídos (es nuestro).
export async function processOutgoingFromDevice({ clientId, channel, accountId, accountType, contactPhone, contactName, body, mediaUrl, mediaType, externalId }) {
  if (externalId) {
    const [exist] = await sql`SELECT id FROM messages WHERE client_id = ${clientId} AND external_id = ${externalId} LIMIT 1`
    if (exist) return null   // ya guardado (enviado desde la plataforma)
  }

  const [conv] = await sql`
    INSERT INTO conversations
      (client_id, channel, contact_phone, contact_name, account_id, account_type, last_message_at)
    VALUES
      (${clientId}, ${channel}, ${contactPhone}, ${contactName ?? null}, ${accountId}, ${accountType}, now())
    ON CONFLICT (client_id, channel, contact_phone, account_id)
    DO UPDATE SET
      last_message_at = now(),
      contact_name    = COALESCE(EXCLUDED.contact_name, conversations.contact_name)
    RETURNING *
  `
  const msg = await saveMessage({
    clientId, conversationId: conv.id, channel,
    direction: 'outbound', to: contactPhone,
    body, mediaUrl, mediaType, externalId, status: 'sent',
  })

  bus.emit(clientId, { type: 'message:new', conversation_id: conv.id, message: msg, channel })
  return { conv, msg }
}

export async function updateMessageStatus(clientId, externalId, status) {
  const updates = { status }
  if (status === 'delivered') updates.delivered_at = new Date()
  if (status === 'read')      updates.read_at = new Date()

  const [updated] = await sql`
    UPDATE messages
    SET ${sql(updates, ...Object.keys(updates))}
    WHERE external_id = ${externalId} AND client_id = ${clientId}
    RETURNING id, conversation_id, status, delivered_at, read_at
  `

  // Push del cambio de check para que el frontend lo pinte sin polling.
  if (updated) {
    bus.emit(clientId, {
      type:            'message:status',
      conversation_id: updated.conversation_id,
      message_id:      updated.id,
      status:          updated.status,
      delivered_at:    updated.delivered_at,
      read_at:         updated.read_at,
    })
  }
}
