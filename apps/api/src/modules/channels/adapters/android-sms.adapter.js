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
      phoneNumbers: [to],
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
}
