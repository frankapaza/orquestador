import { sql } from '../../lib/db.js'

async function requireAdmin(req, reply) {
  if (!req.user?.is_admin) {
    return reply.code(403).send({ error: 'Acceso solo para administradores' })
  }
}

export async function adminRoutes(fastify) {
  const auth      = { onRequest: [fastify.authenticate] }
  const adminAuth = { onRequest: [fastify.authenticate, requireAdmin] }

  // Resumen global
  fastify.get('/admin/stats', adminAuth, async () => {
    const [clients]   = await sql`SELECT COUNT(*) FROM clients WHERE is_admin = false`
    const [campaigns] = await sql`SELECT COUNT(*) FROM campaigns`
    const [sent]      = await sql`SELECT COALESCE(SUM(sent_count), 0) as total FROM campaigns`
    const [contacts]  = await sql`SELECT COUNT(*) FROM contacts`
    return {
      clients:   parseInt(clients.count),
      campaigns: parseInt(campaigns.count),
      emails_sent: parseInt(sent.total),
      contacts:  parseInt(contacts.count),
    }
  })

  // Listar todos los clientes
  fastify.get('/admin/clients', adminAuth, async () => {
    return sql`
      SELECT
        c.id, c.name, c.email, c.plan, c.is_active, c.is_admin, c.created_at,
        COUNT(DISTINCT ca.id)            AS campaign_count,
        COALESCE(SUM(ca.sent_count), 0)  AS total_sent,
        COUNT(DISTINCT d.id)             AS domain_count
      FROM clients c
      LEFT JOIN campaigns ca ON ca.client_id = c.id
      LEFT JOIN domains d    ON d.client_id  = c.id
      GROUP BY c.id
      ORDER BY c.created_at DESC
    `
  })

  // Activar / desactivar cliente
  fastify.patch('/admin/clients/:id', adminAuth, async (req, reply) => {
    const { is_active } = req.body
    if (typeof is_active !== 'boolean') return reply.code(400).send({ error: 'is_active requerido' })

    const [client] = await sql`
      UPDATE clients SET is_active = ${is_active} WHERE id = ${req.params.id} RETURNING id, name, is_active
    `
    if (!client) return reply.code(404).send({ error: 'Cliente no encontrado' })
    return client
  })

  // Campanas de un cliente
  fastify.get('/admin/clients/:id/campaigns', adminAuth, async (req, reply) => {
    const rows = await sql`
      SELECT c.id, c.name, c.status, c.strategy, c.sent_count, c.total_recipients,
             c.open_count, c.failed_count, c.created_at, cl.name AS list_name
      FROM campaigns c
      JOIN contact_lists cl ON cl.id = c.list_id
      WHERE c.client_id = ${req.params.id}
      ORDER BY c.created_at DESC
      LIMIT 50
    `
    return rows
  })
}
