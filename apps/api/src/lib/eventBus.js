// Bus de eventos en memoria por client_id.
//
// Cada conexión SSE se registra acá con su clientId. Cuando el backend genera
// un evento (mensaje nuevo, cambio de estado, etc.), se hace bus.emit(clientId, evento)
// y todos los suscriptores de ese client lo reciben.
//
// Limitaciones (intencionales para esta primera versión):
//   - Single-instance: si escalás a >1 proceso del API, agregar Redis pub/sub.
//   - In-memory: si el proceso se reinicia, los suscriptores se reconectan
//     (EventSource lo hace automático), pero los eventos en vuelo se pierden.
//     Para garantizar entrega exactly-once habría que persistir + cursor por client.

class EventBus {
  constructor() {
    /** @type {Map<string, Set<(evento: any) => void>>} */
    this._subs = new Map()
  }

  /**
   * Suscribe un handler a los eventos de un client.
   * Devuelve función de unsubscribe.
   */
  subscribe(clientId, handler) {
    if (!clientId || typeof handler !== 'function') return () => {}
    let set = this._subs.get(clientId)
    if (!set) { set = new Set(); this._subs.set(clientId, set) }
    set.add(handler)
    return () => {
      const s = this._subs.get(clientId)
      if (!s) return
      s.delete(handler)
      if (s.size === 0) this._subs.delete(clientId)
    }
  }

  /**
   * Emite un evento a todos los suscriptores de un client.
   * Si no hay nadie escuchando, no pasa nada (no se persiste).
   */
  emit(clientId, evento) {
    const set = this._subs.get(clientId)
    if (!set || set.size === 0) return
    for (const h of set) {
      try { h(evento) }
      catch (e) { /* un handler caído no debe romper a los demás */ }
    }
  }

  /** Cantidad de conexiones activas (útil para debug / métricas). */
  size(clientId) {
    if (clientId) return this._subs.get(clientId)?.size ?? 0
    let n = 0
    for (const s of this._subs.values()) n += s.size
    return n
  }
}

export const bus = new EventBus()
