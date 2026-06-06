import crypto from 'node:crypto'
import { sql } from '../../lib/db.js'

export async function dispatchWebhook(clientId, event, payload) {
  const subs = await sql`
    SELECT * FROM webhook_subscriptions
    WHERE client_id = ${clientId}
      AND is_active = true
      AND ${event} = ANY(events)
  `
  if (!subs.length) return

  const body = JSON.stringify({ event, payload, timestamp: new Date().toISOString() })

  await Promise.allSettled(subs.map(async (sub) => {
    const headers = { 'Content-Type': 'application/json' }
    if (sub.secret) {
      const sig = crypto.createHmac('sha256', sub.secret).update(body).digest('hex')
      headers['X-Kubo-Signature'] = `sha256=${sig}`
    }
    try {
      await fetch(sub.url, { method: 'POST', headers, body, signal: AbortSignal.timeout(8000) })
    } catch {}
  }))
}
