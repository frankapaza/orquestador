import { z } from 'zod'
import { sql } from '../../lib/db.js'

const schema = z.object({
  name:         z.string().min(1),
  subject:      z.string().min(1),
  from_name:    z.string().min(1),
  html_content: z.string().min(1),
  text_content: z.string().optional(),
})

export async function templatesRoutes(fastify) {
  const auth = { onRequest: [fastify.authenticate] }

  fastify.get('/templates', auth, async (req) => {
    return sql`
      SELECT id, name, subject, from_name, created_at, updated_at
      FROM email_templates
      WHERE client_id = ${req.user.sub}
      ORDER BY updated_at DESC
    `
  })

  fastify.get('/templates/:id', auth, async (req, reply) => {
    const [t] = await sql`
      SELECT * FROM email_templates
      WHERE id = ${req.params.id} AND client_id = ${req.user.sub}
    `
    if (!t) return reply.code(404).send({ error: 'Plantilla no encontrada' })
    return t
  })

  fastify.post('/templates', auth, async (req, reply) => {
    const body = schema.parse(req.body)
    const [t] = await sql`
      INSERT INTO email_templates (client_id, name, subject, from_name, html_content, text_content)
      VALUES (${req.user.sub}, ${body.name}, ${body.subject}, ${body.from_name},
              ${body.html_content}, ${body.text_content ?? null})
      RETURNING *
    `
    return reply.code(201).send(t)
  })

  fastify.patch('/templates/:id', auth, async (req, reply) => {
    const body = schema.partial().parse(req.body)
    const [t] = await sql`
      UPDATE email_templates
      SET name         = COALESCE(${body.name         ?? null}, name),
          subject      = COALESCE(${body.subject      ?? null}, subject),
          from_name    = COALESCE(${body.from_name    ?? null}, from_name),
          html_content = COALESCE(${body.html_content ?? null}, html_content),
          text_content = COALESCE(${body.text_content ?? null}, text_content),
          updated_at   = now()
      WHERE id = ${req.params.id} AND client_id = ${req.user.sub}
      RETURNING *
    `
    if (!t) return reply.code(404).send({ error: 'Plantilla no encontrada' })
    return t
  })

  fastify.delete('/templates/:id', auth, async (req, reply) => {
    const result = await sql`
      DELETE FROM email_templates
      WHERE id = ${req.params.id} AND client_id = ${req.user.sub}
    `
    if (result.count === 0) return reply.code(404).send({ error: 'Plantilla no encontrada' })
    return { ok: true }
  })
}
