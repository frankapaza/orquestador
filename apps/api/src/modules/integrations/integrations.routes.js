import { z } from 'zod'
import { sql } from '../../lib/db.js'
import { buildAdapter } from './adapters/factory.js'
import { encryptCredentials, decryptCredentials } from '../../lib/crypto.js'

const PROVIDERS = {
  sendgrid: {
    label:  'SendGrid',
    fields: [
      { key: 'api_key',    label: 'API Key',           type: 'password', required: true },
      { key: 'from_email', label: 'Email de envio',    type: 'email',    required: true },
    ],
  },
  brevo: {
    label:  'Brevo (ex-Sendinblue)',
    fields: [
      { key: 'api_key',    label: 'API Key',           type: 'password', required: true },
      { key: 'from_email', label: 'Email de envio',    type: 'email',    required: true },
    ],
  },
  mailchimp: {
    label:  'Mailchimp Transactional (Mandrill)',
    fields: [
      { key: 'api_key',    label: 'API Key (Mandrill)', type: 'password', required: true },
      { key: 'from_email', label: 'Email de envio',     type: 'email',    required: true },
    ],
  },
}

const integrationSchema = z.object({
  provider:    z.enum(['sendgrid', 'brevo', 'mailchimp']),
  name:        z.string().min(2),
  credentials: z.record(z.string()),
})

function maskKey(key) {
  if (!key || key.length < 8) return '••••••••'
  return key.slice(0, 4) + '••••••••' + key.slice(-4)
}

function sanitize(integration) {
  const creds = decryptCredentials({ ...integration.credentials })
  if (creds.api_key) creds.api_key = maskKey(creds.api_key)
  return { ...integration, credentials: creds }
}

export async function integrationsRoutes(fastify) {
  const auth = { onRequest: [fastify.authenticate] }

  // Listar proveedores disponibles y sus campos requeridos
  fastify.get('/integrations/providers', auth, async () => {
    return Object.entries(PROVIDERS).map(([key, val]) => ({ provider: key, ...val }))
  })

  // Listar integraciones del cliente
  fastify.get('/integrations', auth, async (req) => {
    const rows = await sql`
      SELECT * FROM integrations WHERE client_id = ${req.user.sub} ORDER BY created_at DESC
    `
    return rows.map(sanitize)
  })

  // Crear integracion
  fastify.post('/integrations', auth, async (req, reply) => {
    const body = integrationSchema.parse(req.body)

    // Validar credenciales antes de guardar (con credenciales en texto plano)
    const adapter = buildAdapter(body.provider, body.credentials)
    try {
      await adapter.verify()
    } catch (err) {
      return reply.code(422).send({ error: `Credenciales invalidas: ${err.message}` })
    }

    const [existing] = await sql`
      SELECT id FROM integrations
      WHERE client_id = ${req.user.sub} AND provider = ${body.provider} AND name = ${body.name}
    `
    if (existing) return reply.code(409).send({ error: 'Ya existe una integracion con ese nombre para este proveedor' })

    const encryptedCreds = encryptCredentials(body.credentials)
    const [integration] = await sql`
      INSERT INTO integrations (client_id, provider, name, credentials)
      VALUES (${req.user.sub}, ${body.provider}, ${body.name}, ${sql.json(encryptedCreds)})
      RETURNING *
    `
    return reply.code(201).send(sanitize(integration))
  })

  // Probar conexion de una integracion existente
  fastify.post('/integrations/:id/test', auth, async (req, reply) => {
    const [integration] = await sql`
      SELECT * FROM integrations WHERE id = ${req.params.id} AND client_id = ${req.user.sub}
    `
    if (!integration) return reply.code(404).send({ error: 'Integracion no encontrada' })

    const adapter = buildAdapter(integration.provider, decryptCredentials(integration.credentials))
    try {
      const info = await adapter.verify()
      return { ok: true, message: 'Conexion exitosa', info }
    } catch (err) {
      return reply.code(422).send({ ok: false, message: err.message })
    }
  })

  // Activar / desactivar
  fastify.patch('/integrations/:id', auth, async (req, reply) => {
    const { is_active } = z.object({ is_active: z.boolean() }).parse(req.body)
    const [integration] = await sql`
      UPDATE integrations SET is_active = ${is_active}
      WHERE id = ${req.params.id} AND client_id = ${req.user.sub}
      RETURNING *
    `
    if (!integration) return reply.code(404).send({ error: 'Integracion no encontrada' })
    return sanitize(integration)
  })

  // Eliminar
  fastify.delete('/integrations/:id', auth, async (req, reply) => {
    const [integration] = await sql`
      DELETE FROM integrations WHERE id = ${req.params.id} AND client_id = ${req.user.sub}
      RETURNING id
    `
    if (!integration) return reply.code(404).send({ error: 'Integracion no encontrada' })
    return { deleted: true }
  })
}
