import crypto from 'node:crypto'
import { sql } from '../../lib/db.js'
import { env } from '../../config/env.js'

// Tipos de evento que causan baja automática del contacto
const UNSUB_EVENTS = new Set(['spamreport', 'unsubscribe', 'spam'])
// Tipos de evento que se registran como bounce
const BOUNCE_EVENTS = new Set(['bounce', 'hard_bounce', 'soft_bounce', 'dropped'])

async function processEvent({ messageId, eventType, email }) {
  // Buscar el job por message_id (SendGrid puede agregar sufijo, usamos LIKE)
  const [job] = await sql`
    SELECT cj.id, cj.campaign_id, cj.contact_id
    FROM campaign_jobs cj
    WHERE cj.message_id = ${messageId}
       OR cj.message_id LIKE ${messageId + '%'}
    LIMIT 1
  `
  if (!job) return

  if (BOUNCE_EVENTS.has(eventType)) {
    await sql`
      UPDATE campaign_jobs SET status = 'bounced', error_message = ${eventType}
      WHERE id = ${job.id} AND status != 'bounced'
    `
    await sql`UPDATE campaigns SET bounce_count = bounce_count + 1 WHERE id = ${job.campaign_id}`
    await sql`
      INSERT INTO tracking_events (campaign_id, job_id, event_type, recipient_email)
      VALUES (${job.campaign_id}, ${job.id}, 'bounce', ${email})
      ON CONFLICT DO NOTHING
    `
  }

  if (UNSUB_EVENTS.has(eventType)) {
    await sql`
      UPDATE contacts SET is_subscribed = false, unsubscribed_at = now()
      WHERE id = ${job.contact_id} AND is_subscribed = true
    `
    await sql`UPDATE campaigns SET unsub_count = unsub_count + 1 WHERE id = ${job.campaign_id}`
    await sql`
      INSERT INTO tracking_events (campaign_id, job_id, event_type, recipient_email)
      VALUES (${job.campaign_id}, ${job.id}, 'unsub', ${email})
      ON CONFLICT DO NOTHING
    `
  }
}

export async function webhooksRoutes(fastify) {
  // ── SendGrid ──────────────────────────────────────────────────────────────
  // SendGrid envía array de eventos por POST
  fastify.post('/webhooks/sendgrid', async (req, reply) => {
    // Validar firma si está configurada
    if (env.SENDGRID_WEBHOOK_SECRET) {
      const signature = req.headers['x-twilio-email-event-webhook-signature']
      const timestamp = req.headers['x-twilio-email-event-webhook-timestamp']
      if (!signature || !timestamp) return reply.code(403).send({ error: 'Sin firma' })

      const payload = timestamp + JSON.stringify(req.body)
      const expected = crypto.createHmac('sha256', env.SENDGRID_WEBHOOK_SECRET)
        .update(payload).digest('base64')
      if (signature !== expected) return reply.code(403).send({ error: 'Firma invalida' })
    }

    const events = Array.isArray(req.body) ? req.body : [req.body]

    for (const event of events) {
      const messageId = event.sg_message_id?.split('.')[0] ?? event['smtp-id'] ?? ''
      if (!messageId) continue
      await processEvent({ messageId, eventType: event.event, email: event.email }).catch(() => {})
    }

    return { received: events.length }
  })

  // ── Brevo ─────────────────────────────────────────────────────────────────
  // Brevo puede enviar un objeto o array por POST
  fastify.post('/webhooks/brevo', async (req, reply) => {
    if (env.BREVO_WEBHOOK_SECRET) {
      const token = req.headers['x-brevo-token'] ?? req.headers['x-sib-token']
      if (token !== env.BREVO_WEBHOOK_SECRET) return reply.code(403).send({ error: 'Token invalido' })
    }

    const events = Array.isArray(req.body) ? req.body : [req.body]

    for (const event of events) {
      const messageId = event['message-id'] ?? event.MessageId ?? ''
      const eventType = (event.event ?? '').toLowerCase()
      if (!messageId) continue
      await processEvent({ messageId, eventType, email: event.email ?? '' }).catch(() => {})
    }

    return { received: events.length }
  })
}
