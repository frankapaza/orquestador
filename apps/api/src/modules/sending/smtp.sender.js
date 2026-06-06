import nodemailer from 'nodemailer'
import { sql } from '../../lib/db.js'
import { env } from '../../config/env.js'

const transporterCache = new Map()

function getTransporter(account) {
  const key = account.id
  if (!transporterCache.has(key)) {
    transporterCache.set(key, nodemailer.createTransport({
      host: account.smtp_host,
      port: account.smtp_port,
      secure: account.smtp_port === 465,
      auth: { user: account.smtp_user, pass: account.smtp_pass },
      tls: { rejectUnauthorized: false },
    }))
  }
  return transporterCache.get(key)
}

// Selecciona la cuenta con menor uso del dia con capacidad disponible
export async function pickEmailAccount(clientId) {
  const [account] = await sql`
    SELECT ea.*
    FROM email_accounts ea
    JOIN domains d ON d.id = ea.domain_id
    WHERE ea.client_id = ${clientId}
      AND ea.is_active = true
      AND d.is_active = true
      AND ea.sent_today < ea.daily_limit
    ORDER BY ea.sent_today ASC, RANDOM()
    LIMIT 1
  `
  return account ?? null
}

// Delay aleatorio entre min y max ms para simular comportamiento humano
function humanDelay(minMs = 2000, maxMs = 15000) {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs
  return new Promise(resolve => setTimeout(resolve, ms))
}

function buildHumanHeaders() {
  const clients = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
  ]
  return {
    'X-Mailer': 'Microsoft Outlook 16.0',
    'X-Originating-IP': `${Math.floor(Math.random()*200)+10}.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}`,
    'User-Agent': clients[Math.floor(Math.random() * clients.length)],
  }
}

function interpolate(template, contact) {
  return template
    .replace(/\{\{first_name\}\}/g, contact.first_name ?? '')
    .replace(/\{\{last_name\}\}/g, contact.last_name ?? '')
    .replace(/\{\{email\}\}/g, contact.email ?? '')
    .replace(/\{\{(\w+)\}\}/g, (_, key) => contact.metadata?.[key] ?? '')
}

export async function sendOneEmail({ campaign, contact, account, trackingBaseUrl }) {
  const transporter = getTransporter(account)

  const html = interpolate(campaign.html_content, contact)
  const subject = interpolate(campaign.subject, contact)

  const trackOpen = campaign.settings?.track_opens !== false
  const trackPixel = trackOpen
    ? `<img src="${trackingBaseUrl}/track/open/${campaign.id}/${contact.id}" width="1" height="1" style="display:none" />`
    : ''

  const htmlWithTracking = html + trackPixel

  const info = await transporter.sendMail({
    from: `"${campaign.from_name}" <${account.email}>`,
    replyTo: campaign.reply_to ?? account.email,
    to: contact.email,
    subject,
    html: htmlWithTracking,
    text: campaign.text_content ? interpolate(campaign.text_content, contact) : undefined,
    headers: buildHumanHeaders(),
  })

  await sql`
    UPDATE email_accounts SET sent_today = sent_today + 1, last_used_at = now()
    WHERE id = ${account.id}
  `

  return info.messageId
}

export { humanDelay }
