export class EvolutionAdapter {
  constructor(account) {
    this.url = account.evolution_url.replace(/\/$/, '')
    this.apiKey = account.evolution_api_key
    this.instance = account.instance_name
  }

  #headers() {
    return { 'Content-Type': 'application/json', apikey: this.apiKey }
  }

  async #request(method, path, body) {
    const res = await fetch(`${this.url}${path}`, {
      method,
      headers: this.#headers(),
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw Object.assign(new Error(data.message ?? 'Evolution API error'), { status: res.status, data })
    return data
  }

  async sendText({ to, body }) {
    return this.#request('POST', `/message/sendText/${this.instance}`, {
      number: to,
      text: body,
    })
  }

  async sendMedia({ to, mediaUrl, mediaType, caption }) {
    const typeMap = { image: 'image', video: 'video', audio: 'audio', document: 'document' }
    return this.#request('POST', `/message/sendMedia/${this.instance}`, {
      number: to,
      mediatype: typeMap[mediaType] ?? 'image',
      media: mediaUrl,
      caption: caption ?? '',
    })
  }

  async send({ to, body, mediaUrl, mediaType, mediaCaption }) {
    if (mediaUrl) return this.sendMedia({ to, mediaUrl, mediaType: mediaType ?? 'image', caption: mediaCaption })
    return this.sendText({ to, body })
  }

  async getQr() {
    return this.#request('GET', `/instance/connect/${this.instance}`)
  }

  async getStatus() {
    return this.#request('GET', `/instance/connectionState/${this.instance}`)
  }

  async createInstance() {
    return this.#request('POST', `/instance/create`, {
      instanceName: this.instance,
      qrcode: true,
      integration: 'WHATSAPP-BAILEYS',
    })
  }

  async deleteInstance() {
    return this.#request('DELETE', `/instance/delete/${this.instance}`)
  }
}
