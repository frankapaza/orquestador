import { sql } from '../../lib/db.js'
import { EvolutionAdapter } from './adapters/evolution.adapter.js'
import { AndroidSmsAdapter } from './adapters/android-sms.adapter.js'
import { baileysManager } from '../whatsapp/baileys.manager.js'
import { fullPhone } from '../../lib/phone.js'
import { resolveVars, buildContextFromContact } from '../assistants/assistant.vars.js'
import { upsertConversation, saveMessage } from './message.service.js'

function isWithinActiveHours(account) {
  // El horario se interpreta en la zona del NEGOCIO (America/Lima por defecto), NO
  // en la del servidor (que corre en UTC). Sin esto, un horario "08:00-20:00" se
  // corría 5h y excluía la cuenta cerca del borde → "No hay cuentas disponibles".
  const tz = account.timezone || 'America/Lima'
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date())
  const hh = parts.find(p => p.type === 'hour')?.value ?? '00'
  const mm = parts.find(p => p.type === 'minute')?.value ?? '00'
  const current = `${hh}:${mm}`
  const start = account.active_hours_start?.slice(0, 5) ?? '00:00'
  const end   = account.active_hours_end?.slice(0, 5)   ?? '23:59'
  return current >= start && current <= end
}

function randomDelay(min, max) {
  return Math.floor(Math.random() * (max - min) + min) * 1000
}

// Selecciona la cuenta con menor carga proporcional (sent_today / daily_limit).
// Opcional: filtra por asistente vinculado, por un pool de IDs (campaña IA) y/o
// por tipo de número (role: 'campaign' | 'advisor'). Las campañas normales solo
// deben usar números de tipo Campaña.
export async function pickWhatsappAccount(clientId, { assistantId = null, accountIds = null, role = null } = {}) {
  const accounts = await sql`
    SELECT * FROM whatsapp_accounts
    WHERE client_id = ${clientId}
      AND is_active = true
      AND is_connected = true
      AND sent_today < daily_limit
      AND banned_at IS NULL
      AND COALESCE(risk_level, 'green') <> 'red'
      ${role ? sql`AND COALESCE(role, 'campaign') = ${role}` : sql``}
      ${assistantId ? sql`AND assistant_id = ${assistantId}` : sql``}
      ${accountIds && accountIds.length ? sql`AND id IN ${sql(accountIds)}` : sql``}
    ORDER BY (sent_today::float / daily_limit) ASC
  `
  return accounts.find(isWithinActiveHours) ?? null
}

export async function pickSmsAccount(clientId) {
  const accounts = await sql`
    SELECT * FROM sms_accounts
    WHERE client_id = ${clientId}
      AND is_active = true
      AND is_online = true
      AND sent_today < daily_limit
    ORDER BY (sent_today::float / daily_limit) ASC
  `
  return accounts.find(isWithinActiveHours) ?? null
}

// Valida (anti-baneo) que el número tenga WhatsApp ANTES de enviarle.
// Solo se puede consultar por Baileys; con otros proveedores no bloqueamos.
// Si el chequeo falla por red/transitorio, devolvemos true para no descartar
// números válidos por un error puntual (mejor enviar que perder el mensaje).
// Valida (anti-baneo) que el número tenga WhatsApp y resuelve el JID canónico al
// que hay que enviar. Devuelve { valid, jid, checked }:
//   valid   = se puede enviar (número con WhatsApp, o proveedor no verificable)
//   jid     = JID exacto de onWhatsApp para enviar (null → armar desde el número)
//   checked = si realmente se verificó (para no descartar por error transitorio)
export async function checkWhatsappTarget({ contact, account }) {
  if (account.provider !== 'baileys') return { valid: true, jid: null, checked: false }
  const phone = fullPhone(contact) ?? contact.metadata?.phone ?? contact.phone_number ?? null
  if (!phone) return { valid: false, jid: null, checked: true }
  try {
    const jid = await baileysManager.isOnWhatsApp(account.instance_name, phone)
    return { valid: !!jid, jid, checked: true }
  } catch {
    // Error transitorio en la consulta → no descartar; enviar al JID construido.
    return { valid: true, jid: null, checked: false }
  }
}

export async function sendWhatsapp({ campaign, contact, account, jid = null }) {
  // El número se guarda separado (phone_dial + phone). Aquí se concatena el completo.
  const phone = fullPhone(contact) ?? contact.metadata?.phone ?? null
  if (!phone) throw new Error('Contacto sin número de teléfono')

  const ctx = buildContextFromContact(contact, phone)

  // Campaña IA: el mensaje es el saludo del asistente. Manual: el content_text.
  let bodyTpl = campaign.content_text ?? ''
  if (campaign.assistant_id) {
    const [asst] = await sql`SELECT greeting FROM wa_assistants WHERE id = ${campaign.assistant_id}`
    bodyTpl = asst?.greeting ?? ''
  }
  const body = resolveVars(bodyTpl, ctx)

  const payload = {
    to:           phone,
    jid,          // JID verificado por onWhatsApp (mejor entrega); null → se arma del número
    body,
    mediaUrl:     campaign.media_url ?? undefined,
    mediaType:    campaign.settings?.media_type ?? 'image',
    mediaCaption: campaign.media_caption ? resolveVars(campaign.media_caption, ctx) : undefined,
  }

  let result
  if (account.provider === 'baileys') {
    result = await baileysManager.send(account.instance_name, payload)
  } else {
    const adapter = new EvolutionAdapter(account)
    result = await adapter.send(payload)
  }

  await sql`
    UPDATE whatsapp_accounts
    SET sent_today = sent_today + 1, last_used_at = now()
    WHERE id = ${account.id}
  `

  const messageId = result?.key?.id ?? result?.id ?? null

  // Campaña IA: registrar el saludo como mensaje de conversación → aparece en el
  // Inbox y el acuse de entrega (✓✓ entregado / leído) se actualiza solo vía los
  // recibos de Baileys (messages.update → updateMessageStatus por external_id).
  if (campaign.assistant_id && messageId) {
    try {
      const contactName = [contact.first_name, contact.last_name].filter(Boolean).join(' ') || null
      const conv = await upsertConversation({
        clientId: campaign.client_id, channel: 'whatsapp', contactPhone: phone,
        contactName, accountId: account.id, accountType: 'whatsapp',
      })
      await saveMessage({
        clientId: campaign.client_id, conversationId: conv.id, channel: 'whatsapp',
        direction: 'outbound', to: phone, body, externalId: messageId, status: 'sent',
      })
    } catch (e) {
      console.error('[Campaign][WA] registrar saludo en conversación:', e.message)
    }
  }

  return messageId
}

export async function sendSms({ campaign, contact, account }) {
  const adapter = new AndroidSmsAdapter(account)

  const phone = contact.metadata?.phone ?? fullPhone(contact) ?? contact.phone_number ?? null
  if (!phone) throw new Error('Contacto sin número de teléfono')

  const ctx = buildContextFromContact(contact, phone)
  const body = resolveVars(campaign.content_text ?? '', ctx)

  const result = await adapter.send({ to: phone, body })

  await sql`
    UPDATE sms_accounts
    SET sent_today = sent_today + 1, last_used_at = now()
    WHERE id = ${account.id}
  `

  return result?.id ?? null
}

export { randomDelay }
