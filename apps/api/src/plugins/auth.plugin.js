import fp from 'fastify-plugin'
import fastifyJwt from '@fastify/jwt'
import crypto from 'node:crypto'
import { env } from '../config/env.js'
import { sql } from '../lib/db.js'

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex')
}

async function authPlugin(fastify) {
  fastify.register(fastifyJwt, { secret: env.JWT_SECRET })

  fastify.decorate('authenticate', async function (req, reply) {
    const authHeader = req.headers.authorization ?? ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''

    // API Key auth (kubo_...)
    if (token.startsWith('kubo_')) {
      const hash = sha256(token)
      const [key] = await sql`
        SELECT ak.client_id, c.email, c.is_active, c.is_admin
        FROM api_keys ak
        JOIN clients c ON c.id = ak.client_id
        WHERE ak.key_hash = ${hash} AND ak.is_active = true AND c.is_active = true
      `
      if (!key) return reply.code(401).send({ error: 'API key invalida o revocada' })

      await sql`UPDATE api_keys SET last_used_at = now() WHERE key_hash = ${hash}`
      req.user = { sub: key.client_id, email: key.email, is_admin: key.is_admin ?? false }
      return
    }

    // JWT auth
    try {
      await req.jwtVerify()
    } catch {
      reply.code(401).send({ error: 'Token invalido o expirado' })
    }
  })
}

export default fp(authPlugin)
