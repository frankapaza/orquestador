'use client'
import { useEffect, useState } from 'react'
import api from '../../../lib/api'
import { PageHeader } from '../../../components/ui/PageHeader'
import { GuidePanel } from '../../../components/ui/GuidePanel'
import { HelpTooltip } from '../../../components/ui/HelpTooltip'
import { Webhook, RefreshCw, Plus, Save, AlertTriangle } from '../../../components/ui/icons'

const ALL_EVENTS = [
  { value: 'message.received',  label: 'Mensaje recibido',   desc: 'Cuando un contacto te escribe por WA o SMS' },
  { value: 'message.sent',      label: 'Mensaje enviado',    desc: 'Cuando la plataforma envía un mensaje' },
  { value: 'message.delivered', label: 'Mensaje entregado',  desc: 'Cuando el mensaje llega al dispositivo' },
  { value: 'message.read',      label: 'Mensaje leído',      desc: 'Cuando el contacto lee el mensaje (WA)' },
  { value: 'conversation.created', label: 'Nueva conversación', desc: 'Cuando se inicia una conversación nueva' },
]

const GUIDE_STEPS = [
  'En tu CRM o sistema externo, crea un endpoint HTTP que acepte peticiones <strong>POST</strong> con JSON.',
  'Copia la <strong>URL de ese endpoint</strong> y pégala aquí. Ej: <code class="bg-blue-100 px-1 rounded text-xs">https://tucrm.com/api/kubo-webhook</code>',
  'Selecciona los <strong>eventos</strong> que quieres recibir. Solo se enviarán notificaciones de los eventos marcados.',
  'Opcionalmente configura un <strong>Secret</strong>: Kubo firmará cada petición con HMAC-SHA256. Tu CRM puede verificar la firma en el header <code class="bg-blue-100 px-1 rounded text-xs">X-Kubo-Signature</code>.',
  'Usa el botón <strong>"Probar"</strong> para enviar un webhook de prueba y verificar que tu CRM lo recibe correctamente.',
]

const PAYLOAD_EXAMPLE = `// Payload de ejemplo para "message.received"
{
  "event": "message.received",
  "timestamp": "2026-06-04T10:30:00.000Z",
  "payload": {
    "channel": "whatsapp",
    "conversation_id": "uuid-conversacion",
    "message_id": "uuid-mensaje",
    "contact_phone": "+5491112345678",
    "contact_name": "Juan Pérez",
    "body": "Hola, quiero información",
    "received_at": "2026-06-04T10:30:00.000Z"
  }
}`

const EMPTY = { name: '', url: '', events: [], secret: '' }

export default function WebhookSubscriptionsPage() {
  const [subs, setSubs]         = useState([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm]         = useState(EMPTY)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState(null)
  const [testing, setTesting]   = useState(null)
  const [testResult, setTestResult] = useState(null)
  const [showPayload, setShowPayload] = useState(false)

  const load = () => api.get('/webhook-subscriptions').then(r => setSubs(r.data))
  useEffect(() => { load() }, [])

  function toggleEvent(val) {
    setForm(f => ({
      ...f,
      events: f.events.includes(val)
        ? f.events.filter(e => e !== val)
        : [...f.events, val],
    }))
  }

  async function submit(e) {
    e.preventDefault()
    if (form.events.length === 0) { setError('Selecciona al menos un evento'); return }
    setLoading(true)
    setError(null)
    try {
      await api.post('/webhook-subscriptions', {
        name:   form.name,
        url:    form.url,
        events: form.events,
        secret: form.secret || undefined,
      })
      setShowForm(false)
      setForm(EMPTY)
      load()
    } catch (err) {
      setError(err.response?.data?.error ?? 'Error al guardar')
    } finally {
      setLoading(false)
    }
  }

  async function testWebhook(id) {
    setTesting(id)
    setTestResult(null)
    try {
      const r = await api.post(`/webhook-subscriptions/${id}/test`)
      setTestResult({ id, ok: r.data.ok, status: r.data.status, error: r.data.error })
    } catch (err) {
      setTestResult({ id, ok: false, error: err.response?.data?.error ?? err.message })
    } finally {
      setTesting(null)
    }
  }

  async function toggleActive(sub) {
    await api.patch(`/webhook-subscriptions/${sub.id}`, { is_active: !sub.is_active })
    load()
  }

  async function deleteSub(id, name) {
    if (!confirm(`¿Eliminar la suscripción "${name}"?`)) return
    await api.delete(`/webhook-subscriptions/${id}`)
    load()
  }

  return (
    <div>
      <PageHeader
        icon={Webhook}
        title="Webhooks"
        description="Notifica a tu CRM u otros sistemas cuando ocurren eventos en tiempo real"
        action={
          <button onClick={() => setShowForm(true)}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 flex items-center gap-2">
            <Plus size={14} /> Nueva suscripción
          </button>
        }
      />

      <GuidePanel
        title="¿Cómo integrar tu CRM con Kubo via Webhooks?"
        steps={GUIDE_STEPS}
        note="Tu endpoint debe responder con HTTP 200 en menos de 8 segundos. Si no responde, Kubo no reintenta el envío."
      />

      {/* Ejemplo de payload */}
      <div className="bg-gray-900 rounded-xl mb-6 overflow-hidden">
        <button
          onClick={() => setShowPayload(o => !o)}
          className="w-full flex items-center justify-between px-5 py-3 text-left">
          <div className="flex items-center gap-2">
            <span className="text-green-400">{'{ }'}</span>
            <span className="text-sm font-medium text-gray-300">Ejemplo de payload JSON que recibirá tu CRM</span>
          </div>
          <span className="text-gray-500 text-xs">{showPayload ? '▲ Ocultar' : '▼ Ver ejemplo'}</span>
        </button>
        {showPayload && (
          <pre className="px-5 pb-5 text-xs text-green-300 overflow-x-auto border-t border-gray-800 pt-4">
            {PAYLOAD_EXAMPLE}
          </pre>
        )}
      </div>

      {/* Modal crear suscripción */}
      {showForm && (
        <div className="modal-overlay fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-y-auto max-h-[90vh]">
            <div className="p-6 border-b border-gray-100">
              <h2 className="text-lg font-semibold">Nueva suscripción de webhook</h2>
              <p className="text-sm text-gray-500 mt-1">Kubo hará un POST a tu URL cuando ocurran los eventos seleccionados.</p>
            </div>
            {error && (
              <div className="mx-6 mt-4 bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg">{error}</div>
            )}
            <form onSubmit={submit} className="p-6 space-y-4">
              <div>
                <label className="text-xs font-semibold text-gray-700">
                  Nombre <HelpTooltip text="Nombre descriptivo para identificar este webhook. Ej: 'CRM Principal' o 'Power BI'" />
                </label>
                <input
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  required placeholder="Ej: CRM C# Producción"
                  className="mt-1.5 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-700 flex items-center">
                  URL del endpoint <HelpTooltip text="URL completa donde Kubo enviará los eventos. Debe ser accesible desde internet y aceptar POST con JSON." />
                </label>
                <input
                  value={form.url}
                  onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
                  required type="url" placeholder="https://tucrm.com/api/kubo/webhook"
                  className="mt-1.5 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-700 flex items-center">
                  Secret (opcional) <HelpTooltip text="Clave secreta para verificar que el webhook viene de Kubo. Se enviará como HMAC-SHA256 en el header X-Kubo-Signature." />
                </label>
                <input
                  value={form.secret}
                  onChange={e => setForm(f => ({ ...f, secret: e.target.value }))}
                  type="password" placeholder="Dejar vacío si no necesitas verificación de firma"
                  className="mt-1.5 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-700 flex items-center mb-2">
                  Eventos a suscribir <HelpTooltip text="Selecciona qué eventos quieres recibir. Solo se enviarán notificaciones de los eventos marcados." />
                </label>
                <div className="space-y-2 bg-gray-50 rounded-xl p-3">
                  {ALL_EVENTS.map(ev => (
                    <label key={ev.value} className="flex items-start gap-3 cursor-pointer group">
                      <input
                        type="checkbox"
                        checked={form.events.includes(ev.value)}
                        onChange={() => toggleEvent(ev.value)}
                        className="mt-0.5 rounded border-gray-300 text-blue-600"
                      />
                      <div>
                        <p className="text-sm font-medium text-gray-800 group-hover:text-blue-700">{ev.label}</p>
                        <p className="text-xs text-gray-400">{ev.desc}</p>
                      </div>
                    </label>
                  ))}
                </div>
                {form.events.length === 0 && (
                  <p className="text-xs text-amber-600 mt-1 flex items-center gap-1"><AlertTriangle size={12} /> Selecciona al menos un evento</p>
                )}
              </div>

              <div className="flex gap-3 pt-2">
                <button type="submit" disabled={loading}
                  className="flex-1 bg-blue-600 text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-1.5">
                  {loading ? 'Guardando...' : <><Save size={14} /> Guardar suscripción</>}
                </button>
                <button type="button" onClick={() => { setShowForm(false); setError(null); setForm(EMPTY) }}
                  className="flex-1 border border-gray-300 py-2.5 rounded-xl text-sm text-gray-700 hover:bg-gray-50">
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Lista de suscripciones */}
      <div className="space-y-3">
        {subs.map(sub => (
          <div key={sub.id} className={`bg-white rounded-xl border-2 p-5 ${sub.is_active ? 'border-gray-200' : 'border-gray-100 opacity-60'}`}>
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <p className="font-semibold text-gray-900">{sub.name}</p>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${sub.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {sub.is_active ? '● Activo' : '○ Pausado'}
                  </span>
                </div>
                <p className="text-xs text-gray-400 truncate mb-2 flex items-center gap-1" title={sub.url}>
                  <Webhook size={11} className="flex-shrink-0" /> {sub.url}
                </p>
                <div className="flex flex-wrap gap-1">
                  {(sub.events ?? []).map(ev => {
                    const found = ALL_EVENTS.find(e => e.value === ev)
                    return (
                      <span key={ev} className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full border border-blue-100">
                        {found?.label ?? ev}
                      </span>
                    )
                  })}
                </div>
              </div>

              <div className="flex flex-col gap-2 flex-shrink-0">
                <button
                  onClick={() => testWebhook(sub.id)}
                  disabled={testing === sub.id}
                  className="text-xs border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50 text-gray-700 font-medium flex items-center gap-1">
                  {testing === sub.id ? 'Probando...' : <><RefreshCw size={12} />Probar</>}
                </button>
                <button onClick={() => toggleActive(sub)}
                  className="text-xs border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50 text-gray-700">
                  {sub.is_active ? 'Pausar' : 'Activar'}
                </button>
                <button onClick={() => deleteSub(sub.id, sub.name)}
                  className="text-xs border border-red-200 text-red-500 px-3 py-1.5 rounded-lg hover:bg-red-50">
                  Eliminar
                </button>
              </div>
            </div>

            {/* Resultado del test */}
            {testResult?.id === sub.id && (
              <div className={`mt-3 rounded-lg px-4 py-2.5 text-sm flex items-center gap-2 ${testResult.ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                {testResult.ok
                  ? `✅ Webhook enviado correctamente (HTTP ${testResult.status})`
                  : `❌ Error: ${testResult.error ?? 'No se pudo conectar con el endpoint'}`}
              </div>
            )}
          </div>
        ))}

        {subs.length === 0 && (
          <div className="text-center py-20 bg-white rounded-xl border-2 border-dashed border-gray-200">
            <p className="text-5xl mb-4">🔗</p>
            <p className="text-lg font-semibold text-gray-700">Sin webhooks configurados</p>
            <p className="text-sm text-gray-400 mt-2 max-w-md mx-auto">
              Configura un webhook para que tu CRM reciba notificaciones en tiempo real cuando lleguen mensajes o cambien estados.
            </p>
            <button onClick={() => setShowForm(true)}
              className="mt-6 bg-blue-600 text-white px-6 py-2.5 rounded-xl text-sm font-medium hover:bg-blue-700 flex items-center gap-1.5 mx-auto">
              <Plus size={14} /> Crear primera suscripción
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
