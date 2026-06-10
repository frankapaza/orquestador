import { Queue, Worker, QueueEvents } from 'bullmq'
import { redis } from '../lib/redis.js'
import { sql } from '../lib/db.js'
import { pickEmailAccount, sendOneEmail } from '../modules/sending/smtp.sender.js'
import { getAdapterForCampaign } from '../modules/integrations/adapters/factory.js'
import { pickWhatsappAccount, pickSmsAccount, sendWhatsapp, sendSms, randomDelay } from '../modules/channels/channel.sender.js'
import { env } from '../config/env.js'

const QUEUE_NAME = 'campaign-jobs'

export const campaignQueue = new Queue(QUEUE_NAME, { connection: redis })

export async function enqueueCampaign(campaign) {
  const channel = campaign.channel ?? 'email'
  // send_to_all: enviar a TODOS los teléfonos/correos del contacto, o solo al principal.
  const sendAll = campaign.settings?.send_to_all === true

  // Una fila por DESTINO (no por contacto): cada teléfono/correo es un envío.
  let recipients
  if (channel === 'email') {
    recipients = await sql`
      SELECT c.id AS contact_id, ce.email AS recipient_email, NULL::text AS phone_number
      FROM contacts c
      JOIN contact_emails ce ON ce.contact_id = c.id ${sendAll ? sql`` : sql`AND ce.is_primary = true`}
      WHERE c.list_id = ${campaign.list_id} AND c.is_subscribed = true
        AND ce.email IS NOT NULL AND ce.email <> ''
    `
  } else {
    recipients = await sql`
      SELECT c.id AS contact_id, NULL::text AS recipient_email,
             (COALESCE(cp.phone_dial, '') || cp.phone) AS phone_number
      FROM contacts c
      JOIN contact_phones cp ON cp.contact_id = c.id ${sendAll ? sql`` : sql`AND cp.is_primary = true`}
      WHERE c.list_id = ${campaign.list_id} AND c.is_subscribed = true
        AND cp.phone IS NOT NULL AND cp.phone <> ''
    `
  }

  if (recipients.length === 0) {
    await sql`UPDATE campaigns SET status = 'failed', completed_at = now() WHERE id = ${campaign.id}`
    return
  }

  // total_recipients refleja los destinos reales (un contacto puede aportar varios)
  await sql`UPDATE campaigns SET total_recipients = ${recipients.length} WHERE id = ${campaign.id}`

  const jobRows = recipients.map(r => ({
    campaign_id:     campaign.id,
    contact_id:      r.contact_id,
    recipient_email: r.recipient_email,
    phone_number:    r.phone_number,
    channel,
    status:          'pending',
  }))

  await sql`
    INSERT INTO campaign_jobs ${sql(jobRows, 'campaign_id', 'contact_id', 'recipient_email', 'phone_number', 'channel', 'status')}
    ON CONFLICT DO NOTHING
  `

  const settings = campaign.settings ?? {}
  // Para WA/SMS usamos delays más largos para simular comportamiento humano
  const isMessaging = channel === 'whatsapp' || channel === 'sms'
  const delayMin = settings.delay_min_ms ?? (isMessaging ? 8000  : 2000)
  const delayMax = settings.delay_max_ms ?? (isMessaging ? 25000 : 15000)

  const jobs = recipients.map((r, index) => ({
    name: `send-${channel}`,
    data: { campaign_id: campaign.id, contact_id: r.contact_id, channel, recipient_email: r.recipient_email, phone_number: r.phone_number },
    opts: {
      delay:            index * Math.floor(Math.random() * (delayMax - delayMin) + delayMin),
      attempts:         3,
      backoff:          { type: 'exponential', delay: 5000 },
      removeOnComplete: { count: 1000 },
      removeOnFail:     { count: 500 },
    },
  }))

  await campaignQueue.addBulk(jobs)
}

export function startCampaignWorker() {
  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const { campaign_id, contact_id, recipient_email, phone_number } = job.data

      const [campaign] = await sql`SELECT * FROM campaigns WHERE id = ${campaign_id}`
      if (!campaign || campaign.status === 'paused') return { skipped: true }

      // Identifica el job exacto de este destino (un contacto puede tener varios).
      const destMatch = sql`AND COALESCE(recipient_email,'') = ${recipient_email ?? ''} AND COALESCE(phone_number,'') = ${phone_number ?? ''}`

      const [contact] = await sql`SELECT * FROM contacts WHERE id = ${contact_id}`
      if (!contact || !contact.is_subscribed) {
        await sql`
          UPDATE campaign_jobs SET status = 'failed', error_message = 'contacto dado de baja'
          WHERE campaign_id = ${campaign_id} AND contact_id = ${contact_id} ${destMatch}
        `
        return { skipped: true }
      }

      const channel = job.data.channel ?? campaign.channel ?? 'email'
      // El destino de este job concreto (uno de los teléfonos/correos del contacto).
      const sendContact = channel === 'email'
        ? { ...contact, email: recipient_email ?? contact.email }
        : { ...contact, phone: phone_number, phone_dial: '' }

      let messageId = null
      let accountId = null

      if (channel === 'whatsapp') {
        // ── WhatsApp via Evolution API (round-robin) ─────────────────
        const account = await pickWhatsappAccount(campaign.client_id)
        if (!account) throw new Error('No hay cuentas WhatsApp disponibles con cuota')
        messageId = await sendWhatsapp({ campaign, contact: sendContact, account })
        accountId = account.id

      } else if (channel === 'sms') {
        // ── SMS via Android Gateway (round-robin) ────────────────────
        const account = await pickSmsAccount(campaign.client_id)
        if (!account) throw new Error('No hay cuentas SMS disponibles con cuota')
        messageId = await sendSms({ campaign, contact: sendContact, account })
        accountId = account.id

      } else if (campaign.strategy === 'smtp_own') {
        // ── SMTP propio ──────────────────────────────────────────────
        const account = await pickEmailAccount(campaign.client_id)
        if (!account) throw new Error('No hay cuentas SMTP disponibles con cuota')
        messageId = await sendOneEmail({
          campaign, contact: sendContact, account,
          trackingBaseUrl: env.TRACKING_BASE_URL,
        })
        accountId = account.id

      } else {
        // ── Proveedor externo (SendGrid, Brevo, Mailchimp) ───────────
        const adapter = await getAdapterForCampaign(campaign)
        const result  = await adapter.send({
          campaign, contact: sendContact,
          trackingBaseUrl: env.TRACKING_BASE_URL,
        })
        messageId = result.messageId
      }

      await sql`
        UPDATE campaign_jobs
        SET status = 'sent', message_id = ${messageId},
            email_account_id = ${channel === 'email' ? accountId : null},
            account_id = ${accountId}, channel = ${channel}, sent_at = now()
        WHERE campaign_id = ${campaign_id} AND contact_id = ${contact_id} ${destMatch}
      `
      await sql`UPDATE campaigns SET sent_count = sent_count + 1 WHERE id = ${campaign_id}`

      return { sent: true, messageId, channel }
    },
    { connection: redis, concurrency: 5 }
  )

  worker.on('failed', async (job, err) => {
    if (!job) return
    const { campaign_id, contact_id, recipient_email, phone_number } = job.data
    await sql`
      UPDATE campaign_jobs SET status = 'failed', error_message = ${err.message}
      WHERE campaign_id = ${campaign_id} AND contact_id = ${contact_id}
        AND COALESCE(recipient_email,'') = ${recipient_email ?? ''} AND COALESCE(phone_number,'') = ${phone_number ?? ''}
    `
    await sql`UPDATE campaigns SET failed_count = failed_count + 1 WHERE id = ${campaign_id}`
  })

  const queueEvents = new QueueEvents(QUEUE_NAME, { connection: redis })
  queueEvents.on('drained', async () => {
    const active = await sql`SELECT id FROM campaigns WHERE status = 'sending'`
    for (const c of active) {
      const [{ count }] = await sql`
        SELECT COUNT(*) FROM campaign_jobs WHERE campaign_id = ${c.id} AND status = 'pending'
      `
      if (parseInt(count) === 0) {
        await sql`UPDATE campaigns SET status = 'completed', completed_at = now() WHERE id = ${c.id}`
      }
    }
  })

  return worker
}
