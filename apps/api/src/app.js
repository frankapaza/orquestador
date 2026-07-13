import Fastify from 'fastify'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import fastifyStatic from '@fastify/static'
import cron from 'node-cron'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { mkdirSync, existsSync } from 'fs'
import { env } from './config/env.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
import authPlugin from './plugins/auth.plugin.js'
import { authRoutes } from './modules/auth/auth.routes.js'
import { domainsRoutes } from './modules/domains/domains.routes.js'
import { contactsRoutes } from './modules/contacts/contacts.routes.js'
import { campaignsRoutes } from './modules/campaigns/campaigns.routes.js'
import { trackingRoutes } from './modules/tracking/tracking.routes.js'
import { reportsRoutes } from './modules/reports/reports.routes.js'
import { integrationsRoutes } from './modules/integrations/integrations.routes.js'
import { webhooksRoutes }     from './modules/webhooks/webhooks.routes.js'
import { adminRoutes }        from './modules/admin/admin.routes.js'
import { settingsRoutes }     from './modules/settings/settings.routes.js'
import { whatsappRoutes }     from './modules/whatsapp/whatsapp.routes.js'
import { assistantsRoutes }   from './modules/assistants/assistants.routes.js'
import { smsRoutes }          from './modules/sms/sms.routes.js'
import { conversationsRoutes } from './modules/conversations/conversations.routes.js'
import { incomingWebhooksRoutes } from './modules/channels/incoming-webhooks.routes.js'
import { webhookSubscriptionsRoutes } from './modules/webhook-subscriptions/webhook-subscriptions.routes.js'
import { templatesRoutes } from './modules/templates/templates.routes.js'
import { docsRoutes }      from './modules/docs/docs.routes.js'
import eventsRoutes        from './modules/events/events.routes.js'
import { startCampaignWorker, enqueueCampaign } from './workers/campaign.queue.js'
import { baileysManager } from './modules/whatsapp/baileys.manager.js'
import { imapManager } from './modules/email/imap.manager.js'
import { warmupRoutes } from './modules/whatsapp/warmup/warmup.routes.js'
import { startWarmupWorker } from './modules/whatsapp/warmup/warmup.queue.js'
import { runWarmupTick } from './modules/whatsapp/warmup/warmup.scheduler.js'
import { recomputeRisk } from './modules/whatsapp/warmup/risk.service.js'
import { generateCatalog, pruneAiCatalog } from './modules/whatsapp/warmup/ai.generator.js'
import { sql } from './lib/db.js'

const fastify = Fastify({
  logger: {
    level: env.NODE_ENV === 'production' ? 'info' : 'debug',
    transport: env.NODE_ENV !== 'production' ? { target: 'pino-pretty' } : undefined,
  },
  bodyLimit: 5 * 1024 * 1024,
})

// Servir archivos subidos (imágenes, documentos, audio)
const UPLOADS_DIR = join(__dirname, '..', 'uploads')
if (!existsSync(UPLOADS_DIR)) mkdirSync(UPLOADS_DIR, { recursive: true })
await fastify.register(fastifyStatic, { root: UPLOADS_DIR, prefix: '/uploads/' })

await fastify.register(cors, {
  origin: true,
  credentials: true,
})

await fastify.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } })
await fastify.register(authPlugin)

// Rutas
const API_PREFIX = '/api/v1'
fastify.register(authRoutes, { prefix: API_PREFIX })
fastify.register(domainsRoutes, { prefix: API_PREFIX })
fastify.register(contactsRoutes, { prefix: API_PREFIX })
fastify.register(campaignsRoutes, { prefix: API_PREFIX })
fastify.register(reportsRoutes, { prefix: API_PREFIX })
fastify.register(integrationsRoutes, { prefix: API_PREFIX })
fastify.register(adminRoutes,        { prefix: API_PREFIX })
fastify.register(settingsRoutes,     { prefix: API_PREFIX })
fastify.register(whatsappRoutes,     { prefix: API_PREFIX })
fastify.register(assistantsRoutes,   { prefix: API_PREFIX })
fastify.register(warmupRoutes,       { prefix: API_PREFIX })
fastify.register(smsRoutes,          { prefix: API_PREFIX })
fastify.register(conversationsRoutes, { prefix: API_PREFIX })
fastify.register(webhookSubscriptionsRoutes, { prefix: API_PREFIX })
fastify.register(templatesRoutes,           { prefix: API_PREFIX })
fastify.register(docsRoutes,               { prefix: API_PREFIX })
fastify.register(eventsRoutes,             { prefix: API_PREFIX })

// Tracking, webhooks y canales entrantes (URLs públicas sin versión)
fastify.register(trackingRoutes)
fastify.register(webhooksRoutes)
fastify.register(incomingWebhooksRoutes)

fastify.get('/health', async () => ({ status: 'ok', env: env.NODE_ENV }))

// Procesos de fondo (worker de envios, cron de campanas, sesiones WhatsApp).
// Se pueden desactivar con DISABLE_WORKERS=true — util al apuntar el entorno
// local a una BD de produccion para NO disparar envios reales ni tumbar el
// WhatsApp del servidor. Quitar el flag para tener el comportamiento completo.
const WORKERS_DISABLED = process.env.DISABLE_WORKERS === 'true'

if (WORKERS_DISABLED) {
  fastify.log.warn('[Worker] DISABLE_WORKERS=true → worker de campanas, cron y Baileys DESACTIVADOS (modo solo lectura/API)')
} else {
  // Iniciar worker de envio
  startCampaignWorker()
  fastify.log.info('[Worker] Campaign worker iniciado')

  // Iniciar worker de calentamiento (warmup) de chips WhatsApp
  startWarmupWorker()
  fastify.log.info('[Worker] Warmup worker iniciado')

  // Iniciar sesiones Baileys guardadas (con delay para que la DB esté lista)
  setTimeout(() => {
    baileysManager.initAll().catch(err => fastify.log.error({ err }, '[Baileys] Error al inicializar sesiones'))
  }, 3000)

  // Iniciar conexiones IMAP IDLE (recepción de correo en tiempo real)
  setTimeout(() => {
    imapManager.initAll().catch(err => fastify.log.error({ err }, '[IMAP] Error al inicializar conexiones'))
  }, 4000)

  // Verificar campanas programadas cada minuto
  cron.schedule('* * * * *', async () => {
    try {
      const due = await sql`
        SELECT * FROM campaigns WHERE status = 'scheduled' AND scheduled_at <= now()
      `
      for (const campaign of due) {
        await sql`UPDATE campaigns SET status = 'sending', started_at = now() WHERE id = ${campaign.id}`
        await enqueueCampaign(campaign)
        fastify.log.info(`[Cron] Campana programada iniciada: ${campaign.name} (${campaign.id})`)
      }
    } catch (err) {
      fastify.log.error({ err }, '[Cron] Error al verificar campanas programadas')
    }
  })

  // Calentamiento: planificar y encolar conversaciones cada 10 minutos.
  cron.schedule('*/10 * * * *', async () => {
    try {
      await runWarmupTick()
    } catch (err) {
      fastify.log.error({ err }, '[Cron] Error en tick de warmup')
    }
  })

  // Recalcular riesgo de baneo de los chips cada 30 minutos.
  cron.schedule('*/30 * * * *', async () => {
    try {
      const r = await recomputeRisk()
      const reds = r.filter(x => x.level === 'red').length
      if (reds) fastify.log.warn(`[Cron] Riesgo recalculado: ${reds} chip(s) en ROJO`)
    } catch (err) {
      fastify.log.error({ err }, '[Cron] Error al recalcular riesgo')
    }
  })

  // Regeneración semanal del catálogo IA (domingo 03:00 hora del servidor).
  cron.schedule('0 3 * * 0', async () => {
    try {
      const clients = await sql`
        SELECT client_id FROM warmup_config
        WHERE is_enabled = true AND ai_auto_weekly = true AND ai_api_key_enc IS NOT NULL
      `
      for (const { client_id } of clients) {
        try {
          const r = await generateCatalog(client_id, 20)
          const pruned = await pruneAiCatalog(client_id, 60)
          fastify.log.info(`[Cron] Warmup IA: +${r.generated} diálogos, -${pruned} podados (cliente ${client_id})`)
        } catch (e) {
          fastify.log.error(`[Cron] Warmup IA cliente ${client_id}: ${e.message}`)
        }
      }
    } catch (err) {
      fastify.log.error({ err }, '[Cron] Error en regeneración semanal de catálogo')
    }
  }, { timezone: 'America/Lima' })

  // Reset diario de contadores sent_today a medianoche
  cron.schedule('0 0 * * *', async () => {
    try {
      const result = await sql`UPDATE email_accounts SET sent_today = 0`
      fastify.log.info(`[Cron] Contadores diarios reseteados: ${result.count} cuentas`)
      // Retención del chat de warmup: borrar mensajes de más de 7 días.
      const del = await sql`DELETE FROM warmup_messages WHERE created_at < now() - interval '7 days'`
      fastify.log.info(`[Cron] Mensajes de warmup purgados: ${del.count}`)
    } catch (err) {
      fastify.log.error({ err }, '[Cron] Error en tareas diarias de medianoche')
    }
  }, { timezone: 'America/Lima' })
}

try {
  await fastify.listen({ port: env.PORT, host: '0.0.0.0' })
} catch (err) {
  fastify.log.error(err)
  process.exit(1)
}
