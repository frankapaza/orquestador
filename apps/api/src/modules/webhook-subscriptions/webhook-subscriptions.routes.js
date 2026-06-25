import { z } from 'zod'
import { sql } from '../../lib/db.js'

const VALID_EVENTS = ['message.received', 'message.sent', 'message.delivered', 'message.read', 'conversation.created', 'email.received']

const createSchema = z.object({
  name:   z.string().min(1),
  url:    z.string().url(),
  events: z.array(z.enum(VALID_EVENTS)).min(1),
  secret: z.string().optional(),
})

export async function webhookSubscriptionsRoutes(fastify) {
  const pre = [fastify.authenticate]

  fastify.get('/webhook-subscriptions', { onRequest: pre }, async (req) => {
    return sql`
      SELECT id, name, url, events, is_active, created_at
      FROM webhook_subscriptions
      WHERE client_id = ${req.user.sub}
      ORDER BY created_at DESC
    `
  })

  fastify.post('/webhook-subscriptions', { onRequest: pre }, async (req, reply) => {
    const body = createSchema.parse(req.body)
    const [sub] = await sql`
      INSERT INTO webhook_subscriptions (client_id, name, url, events, secret)
      VALUES (${req.user.sub}, ${body.name}, ${body.url}, ${sql.array(body.events)}, ${body.secret ?? null})
      RETURNING id, name, url, events, is_active, created_at
    `
    return reply.code(201).send(sub)
  })

  fastify.patch('/webhook-subscriptions/:id', { onRequest: pre }, async (req, reply) => {
    const body = createSchema.partial().parse(req.body)
    if (body.events) body.events = sql.array(body.events)

    const [sub] = await sql`
      UPDATE webhook_subscriptions
      SET ${sql(body, ...Object.keys(body))}
      WHERE id = ${req.params.id} AND client_id = ${req.user.sub}
      RETURNING id, name, url, events, is_active, created_at
    `
    if (!sub) return reply.code(404).send({ error: 'Suscripción no encontrada' })
    return sub
  })

  fastify.delete('/webhook-subscriptions/:id', { onRequest: pre }, async (req, reply) => {
    const result = await sql`
      DELETE FROM webhook_subscriptions
      WHERE id = ${req.params.id} AND client_id = ${req.user.sub}
    `
    if (result.count === 0) return reply.code(404).send({ error: 'Suscripción no encontrada' })
    return { ok: true }
  })

  // Test: dispara un webhook de prueba
  fastify.post('/webhook-subscriptions/:id/test', { onRequest: pre }, async (req, reply) => {
    const [sub] = await sql`
      SELECT * FROM webhook_subscriptions
      WHERE id = ${req.params.id} AND client_id = ${req.user.sub}
    `
    if (!sub) return reply.code(404).send({ error: 'Suscripción no encontrada' })

    try {
      const body = JSON.stringify({ event: 'test', payload: { message: 'Webhook de prueba desde Kubo' }, timestamp: new Date().toISOString() })
      const res = await fetch(sub.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(8000),
      })
      return { ok: res.ok, status: res.status }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })
}
