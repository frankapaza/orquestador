import sgMail from '@sendgrid/mail'
import { BaseAdapter } from './base.adapter.js'

export class SendGridAdapter extends BaseAdapter {
  constructor(credentials) {
    super(credentials)
    sgMail.setApiKey(credentials.api_key)
  }

  async verify() {
    // Valida la API key intentando listar senders (endpoint de solo lectura)
    const response = await fetch('https://api.sendgrid.com/v3/verified_senders', {
      headers: { Authorization: `Bearer ${this.credentials.api_key}` },
    })
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      throw new Error(body.errors?.[0]?.message ?? `SendGrid error ${response.status}`)
    }
    return true
  }

  async send({ campaign, contact, trackingBaseUrl }) {
    const subject  = this.interpolate(campaign.subject, contact)
    const html     = this.interpolate(campaign.html_content, contact)
    const text     = campaign.text_content ? this.interpolate(campaign.text_content, contact) : undefined
    const pixel    = campaign.settings?.track_opens !== false
      ? this.trackingPixel(campaign.id, contact.id, trackingBaseUrl)
      : ''

    const msg = {
      to:       contact.email,
      from:     { name: campaign.from_name, email: this.credentials.from_email ?? campaign.reply_to },
      replyTo:  campaign.reply_to ?? undefined,
      subject,
      html:     html + pixel,
      text,
      // SendGrid tracking nativo (desactivado para usar el nuestro)
      trackingSettings: {
        clickTracking:  { enable: false },
        openTracking:   { enable: false },
      },
    }

    const [response] = await sgMail.send(msg)
    const messageId  = response.headers['x-message-id'] ?? `sg-${Date.now()}`
    return { messageId, provider: 'sendgrid' }
  }
}
