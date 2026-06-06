import { sql } from '../../lib/db.js'

// Pixel 1x1 GIF transparente
const TRACKING_PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
)

export async function trackingRoutes(fastify) {
  // Pixel de apertura
  fastify.get('/track/open/:campaignId/:contactId', async (req, reply) => {
    const { campaignId, contactId } = req.params

    const [job] = await sql`
      SELECT id, recipient_email FROM campaign_jobs
      WHERE campaign_id = ${campaignId} AND contact_id = ${contactId}
      LIMIT 1
    `

    if (job) {
      await sql`
        INSERT INTO tracking_events (campaign_id, job_id, event_type, recipient_email, ip_address, user_agent)
        VALUES (${campaignId}, ${job.id}, 'open', ${job.recipient_email}, ${req.ip}, ${req.headers['user-agent'] ?? ''})
      `
      await sql`UPDATE campaigns SET open_count = open_count + 1 WHERE id = ${campaignId}`
    }

    return reply
      .header('Content-Type', 'image/gif')
      .header('Cache-Control', 'no-store, no-cache, must-revalidate')
      .send(TRACKING_PIXEL)
  })

  // Redirect de click
  fastify.get('/track/click/:campaignId/:contactId', async (req, reply) => {
    const { campaignId, contactId } = req.params
    const { url } = req.query

    if (!url) return reply.code(400).send({ error: 'url requerido' })

    const [job] = await sql`
      SELECT id, recipient_email FROM campaign_jobs
      WHERE campaign_id = ${campaignId} AND contact_id = ${contactId}
      LIMIT 1
    `

    if (job) {
      await sql`
        INSERT INTO tracking_events (campaign_id, job_id, event_type, recipient_email, metadata, ip_address, user_agent)
        VALUES (${campaignId}, ${job.id}, 'click', ${job.recipient_email}, ${sql.json({ url })}, ${req.ip}, ${req.headers['user-agent'] ?? ''})
      `
      await sql`UPDATE campaigns SET click_count = click_count + 1 WHERE id = ${campaignId}`
    }

    return reply.redirect(302, decodeURIComponent(url))
  })

  // Webhook de baja (unsubscribe)
  fastify.get('/unsubscribe/:campaignId/:contactId', async (req, reply) => {
    const { campaignId, contactId } = req.params

    const [job] = await sql`SELECT recipient_email FROM campaign_jobs WHERE campaign_id = ${campaignId} AND contact_id = ${contactId} LIMIT 1`

    if (job) {
      await sql`UPDATE contacts SET is_subscribed = false, unsubscribed_at = now() WHERE id = ${contactId}`
      await sql`
        INSERT INTO tracking_events (campaign_id, job_id, event_type, recipient_email)
        VALUES (${campaignId}, null, 'unsub', ${job.recipient_email})
      `
      await sql`UPDATE campaigns SET unsub_count = unsub_count + 1 WHERE id = ${campaignId}`
    }

    const email = job?.recipient_email ?? ''
    return reply.type('text/html').send(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Dado de baja</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f8fafc; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .card { background: white; border-radius: 16px; padding: 48px 40px; max-width: 440px; width: 90%; box-shadow: 0 4px 24px rgba(0,0,0,0.08); text-align: center; }
    .icon { font-size: 48px; margin-bottom: 20px; }
    h1 { font-size: 22px; font-weight: 700; color: #111827; margin-bottom: 10px; }
    p { color: #6b7280; font-size: 15px; line-height: 1.6; }
    .email { display: inline-block; margin-top: 12px; background: #f3f4f6; padding: 4px 12px; border-radius: 6px; font-size: 13px; color: #374151; font-family: monospace; }
    .footer { margin-top: 32px; font-size: 12px; color: #9ca3af; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">✅</div>
    <h1>Te has dado de baja</h1>
    <p>Tu solicitud fue procesada correctamente. No recibirás más correos de esta lista.</p>
    ${email ? `<span class="email">${email}</span>` : ''}
    <div class="footer">Si esto fue un error, contacta al remitente del correo.</div>
  </div>
</body>
</html>`)
  })
}
