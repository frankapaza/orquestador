import { BaseAdapter } from './base.adapter.js'

// Mailchimp Transactional (Mandrill) — para envio individual por contacto
const MANDRILL_API = 'https://mandrillapp.com/api/1.0'

export class MailchimpAdapter extends BaseAdapter {
  async callMandrill(endpoint, body) {
    const res = await fetch(`${MANDRILL_API}${endpoint}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ key: this.credentials.api_key, ...body }),
    })
    const data = await res.json()
    if (!res.ok || data.status === 'error') {
      throw new Error(data.message ?? `Mandrill error ${res.status}`)
    }
    return data
  }

  async verify() {
    const data = await this.callMandrill('/users/info', {})
    return { username: data.username, reputation: data.reputation }
  }

  async send({ campaign, contact, trackingBaseUrl }) {
    const subject = this.interpolate(campaign.subject, contact)
    const html    = this.interpolate(campaign.html_content, contact)
    const text    = campaign.text_content ? this.interpolate(campaign.text_content, contact) : undefined
    const pixel   = campaign.settings?.track_opens !== false
      ? this.trackingPixel(campaign.id, contact.id, trackingBaseUrl)
      : ''

    const result = await this.callMandrill('/messages/send', {
      message: {
        html:       html + pixel,
        text:       text,
        subject,
        from_email: this.credentials.from_email,
        from_name:  campaign.from_name,
        to: [{
          email: contact.email,
          name:  `${contact.first_name ?? ''} ${contact.last_name ?? ''}`.trim() || contact.email,
          type:  'to',
        }],
        headers:         { 'Reply-To': campaign.reply_to ?? this.credentials.from_email },
        track_opens:     false,
        track_clicks:    false,
        tags:            [`campaign-${campaign.id}`],
      },
    })

    const info = Array.isArray(result) ? result[0] : result
    if (info.status === 'rejected') {
      throw new Error(`Mandrill rejected: ${info.reject_reason}`)
    }

    return { messageId: info._id ?? `mc-${Date.now()}`, provider: 'mailchimp' }
  }
}
