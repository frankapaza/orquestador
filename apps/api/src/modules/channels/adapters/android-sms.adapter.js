// El gateway (sms-gate.app / Android SMS Gateway) exige el número destino en
// formato E.164 con "+" (ej. +51986095857). Sin el "+" responde "invalid phone
// number". Normaliza cualquier entrada (con o sin "+", con espacios/guiones).
function toE164(n) {
  const s = String(n ?? '').trim()
  const digits = (s.startsWith('+') ? s.slice(1) : s).replace(/\D/g, '')
  return digits ? '+' + digits : ''
}

// Soporta dos modos:
// - Cloud (api.sms-gate.app): Basic Auth, ruta /3rdparty/v1/
// - Local (IP local):         Bearer token, ruta /api/v1/
export class AndroidSmsAdapter {
  constructor(account) {
    this.url    = account.gateway_url.replace(/\/$/, '')
    this.apiKey = account.api_key ?? ''
    this.isCloud = this.url.includes('api.sms-gate.app')
  }

  #basePath() {
    return this.isCloud ? '/3rdparty/v1' : '/api/v1'
  }

  #headers() {
    const h = { 'Content-Type': 'application/json' }
    if (!this.apiKey) return h

    if (this.isCloud) {
      // Cloud usa Basic Auth con formato "usuario:contraseña"
      const encoded = Buffer.from(this.apiKey).toString('base64')
      h['Authorization'] = `Basic ${encoded}`
    } else {
      // Local usa Bearer token
      h['Authorization'] = `Bearer ${this.apiKey}`
    }
    return h
  }

  async #request(method, path, body) {
    const res = await fetch(`${this.url}${this.#basePath()}${path}`, {
      method,
      headers: this.#headers(),
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw Object.assign(
      new Error(data.message ?? `SMS Gateway error ${res.status}`),
      { status: res.status, data }
    )
    return data
  }

  async send({ to, body }) {
    return this.#request('POST', '/message', {
      message:      body,
      phoneNumbers: [toE164(to)],
    })
  }

  async getStatus(id) {
    return this.#request('GET', `/message/${id}`)
  }

  async ping() {
    // Cloud no tiene /health, usamos GET /message con parámetro vacío
    // que retorna 200 aunque no haya mensajes
    if (this.isCloud) {
      return this.#request('GET', '/message?limit=1')
    }
    return this.#request('GET', '/health')
  }

  // ── Webhooks del gateway (SMS entrantes) ──────────────────────────────
  // El gateway (cloud o local) reenvía cada SMS recibido a la URL que le
  // registremos aquí. Kubo la registra apuntando a /webhooks/sms/<accountId>.

  async listWebhooks() {
    return this.#request('GET', '/webhooks')
  }

  // Idempotente: si ya existe un webhook con la misma url+event no lo duplica.
  async registerWebhook(url, event = 'sms:received') {
    const existing = await this.listWebhooks().catch(() => [])
    if (Array.isArray(existing)) {
      const dup = existing.find(w => w.url === url && w.event === event)
      if (dup) return dup
    }
    return this.#request('POST', '/webhooks', { url, event })
  }

  // Borra del gateway todos los webhooks que apunten a esa URL.
  async deleteWebhookByUrl(url) {
    const existing = await this.listWebhooks().catch(() => [])
    if (!Array.isArray(existing)) return
    for (const w of existing.filter(w => w.url === url)) {
      await this.#request('DELETE', `/webhooks/${w.id}`).catch(() => {})
    }
  }
}
