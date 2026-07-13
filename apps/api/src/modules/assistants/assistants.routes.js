import { z } from 'zod'
import { sql } from '../../lib/db.js'

const upsertSchema = z.object({
  name:                z.string().min(1),
  greeting:            z.string().optional().nullable(),
  system_prompt:       z.string().min(1),
  ai_provider:         z.string().optional().nullable(),
  ai_model:            z.string().optional().nullable(),
  active_hours_start:  z.string().optional(),
  active_hours_end:    z.string().optional(),
  timezone:            z.string().optional(),
  active_days:         z.string().optional(),
  handoff_number:      z.string().optional().nullable(),
  handoff_triggers:    z.string().optional().nullable(),
  handoff_timeout_min: z.number().int().min(1).max(120).optional(),
  history_limit:       z.number().int().min(2).max(40).optional(),
  is_active:           z.boolean().optional(),
})

const COLS = [
  'name', 'greeting', 'system_prompt', 'ai_provider', 'ai_model',
  'active_hours_start', 'active_hours_end', 'timezone', 'active_days',
  'handoff_number', 'handoff_triggers', 'handoff_timeout_min', 'history_limit', 'is_active',
]

export async function assistantsRoutes(fastify) {
  const pre = [fastify.authenticate]
  const adminOnly = (req, reply) => {
    if (req.user.member_id) { reply.code(403).send({ error: 'Solo el administrador' }); return false }
    return true
  }

  // Listar asistentes + qué números usa cada uno.
  fastify.get('/whatsapp/assistants', { onRequest: pre }, async (req, reply) => {
    if (!adminOnly(req, reply)) return
    const assistants = await sql`
      SELECT * FROM wa_assistants WHERE client_id = ${req.user.sub} ORDER BY created_at DESC
    `
    const accounts = await sql`
      SELECT id, name, phone_number, assistant_id, is_connected
      FROM whatsapp_accounts
      WHERE client_id = ${req.user.sub} AND provider = 'baileys'
      ORDER BY created_at DESC
    `
    return {
      assistants: assistants.map(a => ({
        ...a,
        account_ids: accounts.filter(w => w.assistant_id === a.id).map(w => w.id),
      })),
      accounts,
    }
  })

  fastify.post('/whatsapp/assistants', { onRequest: pre }, async (req, reply) => {
    if (!adminOnly(req, reply)) return
    const body = upsertSchema.parse(req.body)
    const vals = Object.fromEntries(COLS.map(c => [c, body[c] ?? null]))
    const [row] = await sql`
      INSERT INTO wa_assistants ${sql({ client_id: req.user.sub, ...vals }, 'client_id', ...COLS)}
      RETURNING *
    `
    return reply.code(201).send(row)
  })

  fastify.patch('/whatsapp/assistants/:id', { onRequest: pre }, async (req, reply) => {
    if (!adminOnly(req, reply)) return
    const body = upsertSchema.partial().parse(req.body)
    const keys = Object.keys(body)
    if (!keys.length) return reply.code(400).send({ error: 'Nada que actualizar' })
    const [row] = await sql`
      UPDATE wa_assistants SET ${sql(body, ...keys)}, updated_at = now()
      WHERE id = ${req.params.id} AND client_id = ${req.user.sub}
      RETURNING *
    `
    if (!row) return reply.code(404).send({ error: 'Asistente no encontrado' })
    return row
  })

  fastify.delete('/whatsapp/assistants/:id', { onRequest: pre }, async (req, reply) => {
    if (!adminOnly(req, reply)) return
    // Desasociar de cualquier número antes de borrar.
    await sql`UPDATE whatsapp_accounts SET assistant_id = NULL WHERE client_id = ${req.user.sub} AND assistant_id = ${req.params.id}`
    const [row] = await sql`
      DELETE FROM wa_assistants WHERE id = ${req.params.id} AND client_id = ${req.user.sub} RETURNING id
    `
    if (!row) return reply.code(404).send({ error: 'Asistente no encontrado' })
    return { ok: true }
  })

  // Definir qué números (Baileys) usan este asistente.
  fastify.put('/whatsapp/assistants/:id/accounts', { onRequest: pre }, async (req, reply) => {
    if (!adminOnly(req, reply)) return
    const { account_ids } = z.object({ account_ids: z.array(z.string().uuid()) }).parse(req.body)
    const [asst] = await sql`SELECT id FROM wa_assistants WHERE id = ${req.params.id} AND client_id = ${req.user.sub}`
    if (!asst) return reply.code(404).send({ error: 'Asistente no encontrado' })

    await sql`UPDATE whatsapp_accounts SET assistant_id = NULL
              WHERE client_id = ${req.user.sub} AND assistant_id = ${req.params.id}`
    if (account_ids.length) {
      await sql`UPDATE whatsapp_accounts SET assistant_id = ${req.params.id}
                WHERE client_id = ${req.user.sub} AND id IN ${sql(account_ids)}`
    }
    return { ok: true, count: account_ids.length }
  })
}
