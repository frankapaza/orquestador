import { sql } from '../../lib/db.js'

export async function reportsRoutes(fastify) {
  const auth = { onRequest: [fastify.authenticate] }

  // Resumen general multi-canal
  fastify.get('/reports/summary', auth, async (req) => {
    const clientId  = req.user.sub
    const memberId  = req.user.member_id ?? null
    const isAdvisor = !!memberId

    // Para asesores: obtener sus cuentas asignadas
    let advisorAccountIds = []
    if (isAdvisor) {
      const waIds  = await sql`SELECT id FROM whatsapp_accounts WHERE client_id=${clientId} AND assigned_member_id=${memberId} AND is_active=true`
      const smsIds = await sql`SELECT id FROM sms_accounts WHERE client_id=${clientId} AND assigned_member_id=${memberId} AND is_active=true`
      advisorAccountIds = [...waIds.map(r => r.id), ...smsIds.map(r => r.id)]
    }

    const convAccountFilter = isAdvisor && advisorAccountIds.length > 0
      ? sql`AND account_id::text = ANY(ARRAY[${sql.unsafe(advisorAccountIds.map(id => `'${id}'`).join(','))}])`
      : isAdvisor ? sql`AND 1=0` : sql``

    const msgAccountFilter = isAdvisor && advisorAccountIds.length > 0
      ? sql`AND (
          (channel='whatsapp' AND (from_number IN (SELECT phone_number FROM whatsapp_accounts WHERE id::text = ANY(ARRAY[${sql.unsafe(advisorAccountIds.map(id => `'${id}'`).join(','))}])) OR to_number IN (SELECT phone_number FROM whatsapp_accounts WHERE id::text = ANY(ARRAY[${sql.unsafe(advisorAccountIds.map(id => `'${id}'`).join(','))}]))))
          OR
          (channel='sms' AND (from_number IN (SELECT phone_number FROM sms_accounts WHERE id::text = ANY(ARRAY[${sql.unsafe(advisorAccountIds.map(id => `'${id}'`).join(','))}])) OR to_number IN (SELECT phone_number FROM sms_accounts WHERE id::text = ANY(ARRAY[${sql.unsafe(advisorAccountIds.map(id => `'${id}'`).join(','))}]))))
        )`
      : isAdvisor ? sql`AND 1=0` : sql``

    // Métricas de email (solo admin/editor)
    const emailTotals = isAdvisor ? null : (await sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'completed')              AS completed_campaigns,
        COUNT(*) FILTER (WHERE status IN ('sending','scheduled')) AS active_campaigns,
        COALESCE(SUM(sent_count), 0)                              AS total_sent,
        COALESCE(SUM(open_count), 0)                              AS total_opens,
        COALESCE(SUM(click_count), 0)                             AS total_clicks,
        COALESCE(SUM(bounce_count), 0)                            AS total_bounces
      FROM campaigns WHERE client_id = ${clientId}
    `)[0]

    // Métricas de mensajes filtradas
    const [msgTotals] = await sql`
      SELECT
        COUNT(*) FILTER (WHERE direction = 'outbound')                              AS total_sent,
        COUNT(*) FILTER (WHERE direction = 'inbound')                               AS total_received,
        COUNT(*) FILTER (WHERE channel='whatsapp' AND direction='outbound')         AS wa_sent,
        COUNT(*) FILTER (WHERE channel='sms'      AND direction='outbound')         AS sms_sent
      FROM messages WHERE client_id = ${clientId} ${msgAccountFilter}
    `

    // Conversaciones filtradas
    const [convTotals] = await sql`
      SELECT
        COUNT(*)                                      AS total,
        COUNT(*) FILTER (WHERE status = 'open')       AS open,
        COUNT(*) FILTER (WHERE channel = 'whatsapp')  AS whatsapp,
        COUNT(*) FILTER (WHERE channel = 'sms')       AS sms,
        COUNT(*) FILTER (WHERE unread_count > 0)      AS unread
      FROM conversations WHERE client_id = ${clientId} ${convAccountFilter}
    `

    // Mensajes por día filtrados
    const msgByDay = await sql`
      SELECT DATE(created_at AT TIME ZONE 'America/Lima') AS day, channel, COUNT(*) AS count
      FROM messages
      WHERE client_id = ${clientId}
        AND created_at >= now() - INTERVAL '7 days'
        AND direction = 'outbound'
        ${msgAccountFilter}
      GROUP BY day, channel ORDER BY day ASC
    `

    // Campañas recientes (solo no-asesores)
    const recentCampaigns = isAdvisor ? [] : await sql`
      SELECT id, name, status, channel, sent_count, open_count, click_count, completed_at
      FROM campaigns WHERE client_id = ${clientId}
      ORDER BY created_at DESC LIMIT 5
    `

    // Conversaciones pendientes filtradas
    const recentConversations = await sql`
      SELECT c.id, c.channel, c.contact_phone, c.contact_name, c.unread_count, c.last_message_at
      FROM conversations c
      WHERE c.client_id = ${clientId}
        AND c.status = 'open'
        AND c.unread_count > 0
        ${convAccountFilter}
      ORDER BY c.last_message_at DESC NULLS LAST LIMIT 5
    `

    // Canales del asesor vs todos
    const [channels] = isAdvisor ? await sql`
      SELECT
        (SELECT COUNT(*) FROM whatsapp_accounts WHERE client_id=${clientId} AND assigned_member_id=${memberId} AND is_connected=true) AS wa_connected,
        (SELECT COUNT(*) FROM sms_accounts       WHERE client_id=${clientId} AND assigned_member_id=${memberId} AND is_online=true)   AS sms_online,
        0 AS email_active
    ` : await sql`
      SELECT
        (SELECT COUNT(*) FROM whatsapp_accounts WHERE client_id=${clientId} AND is_connected=true) AS wa_connected,
        (SELECT COUNT(*) FROM sms_accounts       WHERE client_id=${clientId} AND is_online=true)   AS sms_online,
        (SELECT COUNT(*) FROM email_accounts     WHERE client_id=${clientId} AND is_active=true)   AS email_active
    `

    return {
      is_advisor:    isAdvisor,
      email:         emailTotals,
      messages:      msgTotals,
      conversations: convTotals,
      channels,
      msg_by_day:    msgByDay,
      recent_campaigns:     recentCampaigns,
      recent_conversations: recentConversations,
    }
  })

  // Reporte detallado por campana
  fastify.get('/reports/campaigns/:id', auth, async (req, reply) => {
    const [campaign] = await sql`
      SELECT * FROM campaigns WHERE id = ${req.params.id} AND client_id = ${req.user.sub}
    `
    if (!campaign) return reply.code(404).send({ error: 'Campana no encontrada' })

    const delivery = await sql`
      SELECT status, COUNT(*) as count
      FROM campaign_jobs WHERE campaign_id = ${req.params.id}
      GROUP BY status
    `

    const eventsByHour = await sql`
      SELECT
        date_trunc('hour', created_at) as hour,
        event_type,
        COUNT(*) as count
      FROM tracking_events
      WHERE campaign_id = ${req.params.id}
      GROUP BY hour, event_type
      ORDER BY hour ASC
    `

    const topLinks = await sql`
      SELECT metadata->>'url' as url, COUNT(*) as clicks
      FROM tracking_events
      WHERE campaign_id = ${req.params.id} AND event_type = 'click'
      GROUP BY url ORDER BY clicks DESC LIMIT 10
    `

    const openRate = campaign.sent_count > 0
      ? ((campaign.open_count / campaign.sent_count) * 100).toFixed(2)
      : '0.00'

    const clickRate = campaign.open_count > 0
      ? ((campaign.click_count / campaign.open_count) * 100).toFixed(2)
      : '0.00'

    return {
      campaign,
      rates: { open_rate: openRate + '%', click_to_open_rate: clickRate + '%' },
      delivery_breakdown: delivery,
      events_by_hour: eventsByHour,
      top_links: topLinks,
    }
  })

  // Lista de jobs fallidos
  fastify.get('/reports/campaigns/:id/failed', auth, async (req, reply) => {
    const [campaign] = await sql`SELECT id FROM campaigns WHERE id = ${req.params.id} AND client_id = ${req.user.sub}`
    if (!campaign) return reply.code(404).send({ error: 'Campana no encontrada' })

    return sql`
      SELECT cj.recipient_email, cj.error_message, cj.created_at
      FROM campaign_jobs cj
      WHERE cj.campaign_id = ${req.params.id} AND cj.status = 'failed'
      ORDER BY cj.created_at DESC
    `
  })
}
