import { Queue, Worker } from 'bullmq'
import { redis } from '../../../lib/redis.js'
import { sql } from '../../../lib/db.js'
import { baileysManager } from '../baileys.manager.js'
import { recordWarmupMessage } from './warmup.service.js'
import { bus } from '../../../lib/eventBus.js'

const QUEUE_NAME = 'warmup-jobs'

export const warmupQueue = new Queue(QUEUE_NAME, { connection: redis })

// Encola un turno de conversación de calentamiento con retardo.
// data: { fromInstance, fromAccountId, toPhone, text, simulateTyping, markRead }
export async function enqueueWarmupTurn(data, delayMs) {
  await warmupQueue.add('warmup-turn', data, {
    delay:            Math.max(0, delayMs | 0),
    attempts:         2,
    backoff:          { type: 'fixed', delay: 10000 },
    removeOnComplete: { count: 200 },
    removeOnFail:     { count: 100 },
  })
}

// Vacía la cola (mensajes en espera y retardados) — usado por el botón Detener.
export async function drainWarmupJobs() {
  try { await warmupQueue.drain(true) }
  catch (e) { console.error('[Warmup] drain:', e.message) }
}

export function startWarmupWorker() {
  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const { fromInstance, fromAccountId, toPhone, text, simulateTyping, markRead } = job.data

      // Verificar que el chip siga habilitado, conectado y no baneado.
      const [acc] = await sql`
        SELECT id, client_id, warmup_enabled, banned_at, is_active
        FROM whatsapp_accounts WHERE id = ${fromAccountId}
      `
      if (!acc || !acc.warmup_enabled || acc.banned_at || !acc.is_active) {
        return { skipped: 'chip no elegible' }
      }
      if (baileysManager.getStatus(fromInstance) !== 'connected') {
        return { skipped: 'chip no conectado' }
      }

      // Nota: el conteo diario (warmup_sent) se registra al ENCOLAR en el
      // scheduler, no aquí, para evitar sobre-encolar entre ticks.
      await baileysManager.sendWarmup(fromInstance, { to: toPhone, text, simulateTyping, markRead })

      // Registrar el mensaje para el visor de chat (con los datos del par que trae el job).
      await recordWarmupMessage({
        clientId:      acc.client_id,
        threadKey:     job.data.threadKey,
        fromAccountId: fromAccountId,
        toAccountId:   job.data.toAccountId,
        peerPhone:     job.data.peerPhone,
        peerName:      job.data.peerName,
        peerKind:      job.data.peerKind,
        text,
      }).catch(e => console.error('[Warmup] recordWarmupMessage:', e.message))

      // Push en tiempo real al frontend (SSE) para el visor de chat.
      bus.emit(acc.client_id, { type: 'warmup:message', thread_key: job.data.threadKey, at: Date.now() })

      return { sent: true }
    },
    { connection: redis, concurrency: 3 }
  )

  worker.on('failed', (job, err) => {
    console.error(`[Warmup] job ${job?.id} falló:`, err?.message)
  })

  return worker
}
