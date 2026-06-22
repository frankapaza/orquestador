// SSE (Server-Sent Events): canal push del backend al frontend.
//
// El frontend abre `new EventSource('/api/v1/events?token=<jwt>')` una vez al
// montar el dashboard. Cuando el backend hace bus.emit(clientId, evento), todos
// los EventSource abiertos con ese clientId reciben "data: <json>\n\n".
//
// Auth: como EventSource nativo no permite headers personalizados, se acepta
// el token por query string. Para mayor seguridad a futuro: migrar a cookie
// httpOnly o usar event-source-polyfill.
import { bus } from '../../lib/eventBus.js'
import crypto from 'node:crypto'
import { sql } from '../../lib/db.js'

function sha256(text) { return crypto.createHash('sha256').update(text).digest('hex') }

// Resuelve el client_id de un token (Bearer JWT o API key kubo_*).
// Devuelve null si el token es inválido.
async function resolverClientId(fastify, token) {
  if (!token) return null
  if (token.startsWith('kubo_')) {
    const hash = sha256(token)
    const [k] = await sql`
      SELECT ak.client_id
      FROM api_keys ak
      JOIN clients c ON c.id = ak.client_id
      WHERE ak.key_hash = ${hash} AND ak.is_active = true AND c.is_active = true
    `
    return k?.client_id ?? null
  }
  try {
    const payload = fastify.jwt.verify(token)
    return payload?.sub ?? null
  } catch {
    return null
  }
}

export default async function eventsRoutes(fastify) {
  fastify.get('/events', async (req, reply) => {
    const token = req.query?.token
    const clientId = await resolverClientId(fastify, token)
    if (!clientId) {
      reply.code(401).send({ error: 'Token invalido o expirado' })
      return
    }

    // Headers SSE
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',  // desactiva buffering de nginx
    })
    // Mensaje inicial de bienvenida (sirve también para que el frontend confirme conexión)
    reply.raw.write(`: connected\n\n`)
    reply.raw.write(`event: ready\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`)

    // Suscripción al bus
    const unsub = bus.subscribe(clientId, (evento) => {
      try {
        const tipo = evento?.type ?? 'message'
        reply.raw.write(`event: ${tipo}\n`)
        reply.raw.write(`data: ${JSON.stringify(evento)}\n\n`)
      } catch {}
    })

    // Heartbeat cada 25s (mantiene viva la conexión a través de proxies que
    // cierran sockets idle a los 30-60s; el comentario ":" no es evento, no
    // dispara nada en el cliente).
    const hb = setInterval(() => {
      try { reply.raw.write(`: ping\n\n`) }
      catch { clearInterval(hb) }
    }, 25000)

    // Cleanup al desconectar
    req.raw.on('close', () => {
      clearInterval(hb)
      unsub()
    })

    // Mantener la promesa abierta para que Fastify no cierre la respuesta.
    return new Promise(() => {})
  })

  // Endpoint diagnóstico (útil para verificar cuántos clientes están conectados)
  fastify.get('/events/stats', { onRequest: [fastify.authenticate] }, async (req) => {
    return {
      total: bus.size(),
      mine: bus.size(req.user.sub),
    }
  })
}
