import { BaseAdapter } from './base.adapter.js'

const BREVO_API = 'https://api.brevo.com/v3'

export class BrevoAdapter extends BaseAdapter {
  get headers() {
    return {
      'api-key':      this.credentials.api_key,
      'Content-Type': 'application/json',
      'Accept':       'application/json',
    }
  }

  async verify() {
    const res = await fetch(`${BREVO_API}/account`, { headers: this.headers })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.message ?? `Brevo error ${res.status}`)
    }
    const account = await res.json()
    return { email: account.email, plan: account.plan?.[0]?.type }
  }

  async send({ campaign, contact, trackingBaseUrl }) {
    const subject = this.interpolate(campaign.subject, contact)
    const html    = this.interpolate(campaign.html_content, contact)
    const text    = campaign.text_content ? this.interpolate(campaign.text_content, contact) : undefined
    const pixel   = campaign.settings?.track_opens !== false
      ? this.trackingPixel(campaign.id, contact.id, trackingBaseUrl)
      : ''

    const payload = {
      sender:  { name: campaign.from_name, email: this.credentials.from_email },
      to:      [{ email: contact.email, name: `${contact.first_name ?? ''} ${contact.last_name ?? ''}`.trim() || contact.email }],
      replyTo: campaign.reply_to ? { email: campaign.reply_to } : undefined,
      subject,
      htmlContent: html + pixel,
      textContent: text,
      // Tracking propio, desactivar el de Brevo
      headers: { 'X-Mailin-custom': `campaign:${campaign.id}` },
    }

    const res = await fetch(`${BREVO_API}/smtp/email`, {
      method:  'POST',
      headers: this.headers,
      body:    JSON.stringify(payload),
    })

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.message ?? `Brevo send error ${res.status}`)
    }

    const data = await res.json()
    return { messageId: data.messageId, provider: 'brevo' }
  }
}
