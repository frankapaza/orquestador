export class BaseAdapter {
  constructor(credentials) {
    this.credentials = credentials
  }

  async send({ campaign, contact, trackingBaseUrl }) {
    throw new Error('send() not implemented')
  }

  async verify() {
    throw new Error('verify() not implemented')
  }

  interpolate(template, contact) {
    if (!template) return ''
    return template
      .replace(/\{\{first_name\}\}/g, contact.first_name ?? '')
      .replace(/\{\{last_name\}\}/g,  contact.last_name  ?? '')
      .replace(/\{\{email\}\}/g,      contact.email      ?? '')
      .replace(/\{\{(\w+)\}\}/g, (_, key) => contact.metadata?.[key] ?? '')
  }

  trackingPixel(campaignId, contactId, baseUrl) {
    return `<img src="${baseUrl}/track/open/${campaignId}/${contactId}" width="1" height="1" style="display:none" />`
  }
}
