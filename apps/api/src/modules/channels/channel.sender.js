import { sql } from '../../lib/db.js'
import { EvolutionAdapter } from './adapters/evolution.adapter.js'
import { AndroidSmsAdapter } from './adapters/android-sms.adapter.js'
import { baileysManager } from '../whatsapp/baileys.manager.js'

function isWithinActiveHours(account) {
  const now = new Date()
  const pad = n => String(n).padStart(2, '0')
  const current = `${pad(now.getHours())}:${pad(now.getMinutes())}`
  const start = account.active_hours_start?.slice(0, 5) ?? '00:00'
  const end   = account.active_hours_end?.slice(0, 5)   ?? '23:59'
  return current >= start && current <= end
}

function randomDelay(min, max) {
  return Math.floor(Math.random() * (max - min) + min) * 1000
}

// Selecciona la cuenta con menor carga proporcional (sent_today / daily_limit)
export async function pickWhatsappAccount(clientId) {
  const accounts = await sql`
    SELECT * FROM whatsapp_accounts
    WHERE client_id = ${clientId}
      AND is_active = true
      AND is_connected = true
      AND sent_today < daily_limit
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

export async function sendWhatsapp({ campaign, contact, account }) {
  const phone = contact.phone ?? contact.metadata?.phone ?? null
  if (!phone) throw new Error('Contacto sin número de teléfono')

  const payload = {
    to:           phone,
    body:         campaign.content_text,
    mediaUrl:     campaign.media_url ?? undefined,
    mediaType:    campaign.settings?.media_type ?? 'image',
    mediaCaption: campaign.media_caption ?? undefined,
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

  return result?.key?.id ?? result?.id ?? null
}

export async function sendSms({ campaign, contact, account }) {
  const adapter = new AndroidSmsAdapter(account)

  const phone = contact.metadata?.phone ?? contact.phone_number ?? null
  if (!phone) throw new Error('Contacto sin número de teléfono')

  const result = await adapter.send({ to: phone, body: campaign.content_text })

  await sql`
    UPDATE sms_accounts
    SET sent_today = sent_today + 1, last_used_at = now()
    WHERE id = ${account.id}
  `

  return result?.id ?? null
}

export { randomDelay }
