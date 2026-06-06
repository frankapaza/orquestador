import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { sql } from '../../lib/db.js'

const loginSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(1),
})

const registerSchema = loginSchema.extend({
  name: z.string().min(2),
  password: z.string().min(6),
})

export async function authRoutes(fastify) {
  fastify.post('/auth/register', async (req, reply) => {
    const body = registerSchema.parse(req.body)

    const [existing] = await sql`SELECT id FROM clients WHERE email = ${body.email}`
    if (existing) return reply.code(409).send({ error: 'Email ya registrado' })

    const hashed = await bcrypt.hash(body.password, 10)
    const [client] = await sql`
      INSERT INTO clients (name, email, password)
      VALUES (${body.name}, ${body.email}, ${hashed})
      RETURNING id, name, email, plan, is_admin, created_at
    `

    const token = fastify.jwt.sign({ sub: client.id, email: client.email, is_admin: false })
    return { token, client }
  })

  fastify.post('/auth/login', async (req, reply) => {
    const body = loginSchema.parse(req.body)

    // Intentar login como cliente principal
    const [client] = await sql`SELECT * FROM clients WHERE email = ${body.email} AND is_active = true`
    if (client) {
      const valid = await bcrypt.compare(body.password, client.password)
      if (!valid) return reply.code(401).send({ error: 'Credenciales invalidas' })

      const token = fastify.jwt.sign({
        sub:      client.id,
        email:    client.email,
        is_admin: client.is_admin ?? false,
      })
      const { password: _, ...clientData } = client
      return { token, client: clientData }
    }

    // Intentar login como miembro de equipo
    const [member] = await sql`
      SELECT m.*, c.is_active AS owner_active, c.is_admin
      FROM client_members m
      JOIN clients c ON c.id = m.client_id
      WHERE m.email = ${body.email} AND m.is_active = true AND c.is_active = true
    `
    if (!member) return reply.code(401).send({ error: 'Credenciales invalidas' })

    const valid = await bcrypt.compare(body.password, member.password)
    if (!valid) return reply.code(401).send({ error: 'Credenciales invalidas' })

    const token = fastify.jwt.sign({
      sub:       member.client_id, // usa el client_id del dueño para que todas las queries funcionen
      email:     member.email,
      member_id: member.id,
      role:      member.role,
      is_admin:  false,
    })
    const { password: _, ...memberData } = member
    return { token, client: { ...memberData, id: member.client_id, isMember: true } }
  })

  fastify.get('/auth/me', { onRequest: [fastify.authenticate] }, async (req, reply) => {
    // Si es miembro del equipo, devolver sus propios datos
    if (req.user.member_id) {
      const [member] = await sql`
        SELECT id, name, email, role, is_active, created_at
        FROM client_members WHERE id = ${req.user.member_id}
      `
      if (!member) return reply.code(401).send({ error: 'Sesión inválida' })
      return {
        ...member,
        member_id: member.id,
        is_admin:  false,
        plan:      null,
      }
    }

    // Si es el dueño/admin
    const [client] = await sql`
      SELECT id, name, email, plan, is_active, is_admin, created_at
      FROM clients WHERE id = ${req.user.sub}
    `
    return {
      ...client,
      member_id: null,
      role:      req.user.is_admin ? 'admin' : 'owner',
    }
  })
}
