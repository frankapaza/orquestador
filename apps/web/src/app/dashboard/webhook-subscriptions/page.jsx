'use client'
import { useEffect, useState } from 'react'
import api from '../../../lib/api'
import { PageHeader } from '../../../components/ui/PageHeader'
import { GuidePanel } from '../../../components/ui/GuidePanel'
import { HelpTooltip } from '../../../components/ui/HelpTooltip'
import { SectionCard } from '../../../components/ui/section-card'
import { EmptyState } from '../../../components/ui/empty-state'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { Checkbox } from '../../../components/ui/checkbox'
import {
  Webhook, RefreshCw, Plus, Save, AlertTriangle,
  ChevronDown, ChevronUp, FileText, CheckCircle, XCircle,
} from '../../../components/ui/icons'

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
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        icon={Webhook}
        title="Webhooks"
        description="Notifica a tu CRM u otros sistemas cuando ocurren eventos en tiempo real"
        action={
          <Button onClick={() => setShowForm(true)}>
            <Plus size={16} strokeWidth={2} /> Nueva suscripción
          </Button>
        }
      />

      <GuidePanel
        title="¿Cómo integrar tu CRM con Kubo via Webhooks?"
        steps={GUIDE_STEPS}
        note="Tu endpoint debe responder con HTTP 200 en menos de 8 segundos. Si no responde, Kubo no reintenta el envío."
      />

      {/* Ejemplo de payload */}
      <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
        <button
          onClick={() => setShowPayload(o => !o)}
          className="flex w-full items-center justify-between px-5 py-4 text-left transition-colors hover:bg-muted/40">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-jungle-green-50 text-jungle-green-600">
              <FileText size={16} strokeWidth={2} />
            </span>
            <span className="text-sm font-medium text-foreground">Ejemplo de payload JSON que recibirá tu CRM</span>
          </div>
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            {showPayload
              ? <><ChevronUp size={14} strokeWidth={2} /> Ocultar</>
              : <><ChevronDown size={14} strokeWidth={2} /> Ver ejemplo</>}
          </span>
        </button>
        {showPayload && (
          <pre className="overflow-x-auto border-t bg-muted/40 px-5 py-4 text-xs leading-relaxed text-foreground">
            {PAYLOAD_EXAMPLE}
          </pre>
        )}
      </div>

      {/* Modal crear suscripción */}
      {showForm && (
        <div className="modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border bg-card shadow-lg">
            <div className="border-b px-6 py-5">
              <h2 className="text-base font-semibold text-foreground">Nueva suscripción de webhook</h2>
              <p className="mt-1 text-sm text-muted-foreground">Kubo hará un POST a tu URL cuando ocurran los eventos seleccionados.</p>
            </div>
            {error && (
              <div className="mx-6 mt-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                <AlertTriangle size={16} strokeWidth={2} className="shrink-0" /> {error}
              </div>
            )}
            <form onSubmit={submit} className="space-y-5 p-6">
              <div className="space-y-1.5">
                <label className="flex items-center text-xs font-semibold text-foreground">
                  Nombre <HelpTooltip text="Nombre descriptivo para identificar este webhook. Ej: 'CRM Principal' o 'Power BI'" />
                </label>
                <Input
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  required placeholder="Ej: CRM C# Producción"
                  className="h-[52px] rounded-xl border-transparent bg-muted/60 text-base shadow-none transition-colors focus-visible:border-ring focus-visible:bg-background focus-visible:ring-0"
                />
              </div>

              <div className="space-y-1.5">
                <label className="flex items-center text-xs font-semibold text-foreground">
                  URL del endpoint <HelpTooltip text="URL completa donde Kubo enviará los eventos. Debe ser accesible desde internet y aceptar POST con JSON." />
                </label>
                <Input
                  value={form.url}
                  onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
                  required type="url" placeholder="https://tucrm.com/api/kubo/webhook"
                  className="h-[52px] rounded-xl border-transparent bg-muted/60 text-base shadow-none transition-colors focus-visible:border-ring focus-visible:bg-background focus-visible:ring-0"
                />
              </div>

              <div className="space-y-1.5">
                <label className="flex items-center text-xs font-semibold text-foreground">
                  Secret (opcional) <HelpTooltip text="Clave secreta para verificar que el webhook viene de Kubo. Se enviará como HMAC-SHA256 en el header X-Kubo-Signature." />
                </label>
                <Input
                  value={form.secret}
                  onChange={e => setForm(f => ({ ...f, secret: e.target.value }))}
                  type="password" placeholder="Dejar vacío si no necesitas verificación de firma"
                  className="h-[52px] rounded-xl border-transparent bg-muted/60 text-base shadow-none transition-colors focus-visible:border-ring focus-visible:bg-background focus-visible:ring-0"
                />
              </div>

              <div>
                <label className="mb-2 flex items-center text-xs font-semibold text-foreground">
                  Eventos a suscribir <HelpTooltip text="Selecciona qué eventos quieres recibir. Solo se enviarán notificaciones de los eventos marcados." />
                </label>
                <div className="space-y-1 rounded-xl bg-muted/40 p-2">
                  {ALL_EVENTS.map(ev => {
                    const checked = form.events.includes(ev.value)
                    return (
                      <label
                        key={ev.value}
                        className="flex cursor-pointer items-start gap-3 rounded-lg p-2.5 transition-colors hover:bg-background">
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => toggleEvent(ev.value)}
                          className="mt-0.5"
                        />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground">{ev.label}</p>
                          <p className="text-xs text-muted-foreground">{ev.desc}</p>
                        </div>
                      </label>
                    )
                  })}
                </div>
                {form.events.length === 0 && (
                  <p className="mt-1.5 flex items-center gap-1 text-xs text-amber-600">
                    <AlertTriangle size={12} strokeWidth={2} /> Selecciona al menos un evento
                  </p>
                )}
              </div>

              <div className="flex gap-3 pt-1">
                <Button type="submit" disabled={loading} className="flex-1">
                  {loading ? 'Guardando...' : <><Save size={16} strokeWidth={2} /> Guardar suscripción</>}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  onClick={() => { setShowForm(false); setError(null); setForm(EMPTY) }}>
                  Cancelar
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Lista de suscripciones */}
      <div className="space-y-4">
        {subs.map(sub => (
          <div
            key={sub.id}
            className={`rounded-xl border bg-card p-5 shadow-sm transition-opacity ${sub.is_active ? '' : 'opacity-60'}`}>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="mb-1.5 flex items-center gap-2">
                  <p className="font-semibold text-foreground">{sub.name}</p>
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${sub.is_active ? 'bg-jungle-green-100 text-jungle-green-700' : 'bg-muted text-muted-foreground'}`}>
                    {sub.is_active ? 'Activo' : 'Pausado'}
                  </span>
                </div>
                <p className="mb-3 flex items-center gap-1.5 truncate text-xs text-muted-foreground" title={sub.url}>
                  <Webhook size={12} strokeWidth={2} className="shrink-0" /> {sub.url}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {(sub.events ?? []).map(ev => {
                    const found = ALL_EVENTS.find(e => e.value === ev)
                    return (
                      <span key={ev} className="inline-flex rounded-full bg-jungle-green-50 px-2 py-0.5 text-xs font-medium text-jungle-green-700">
                        {found?.label ?? ev}
                      </span>
                    )
                  })}
                </div>
              </div>

              <div className="flex shrink-0 flex-col gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => testWebhook(sub.id)}
                  disabled={testing === sub.id}>
                  {testing === sub.id ? 'Probando...' : <><RefreshCw size={14} strokeWidth={2} /> Probar</>}
                </Button>
                <Button variant="outline" size="sm" onClick={() => toggleActive(sub)}>
                  {sub.is_active ? 'Pausar' : 'Activar'}
                </Button>
                <Button variant="outline" size="sm" className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700" onClick={() => deleteSub(sub.id, sub.name)}>
                  Eliminar
                </Button>
              </div>
            </div>

            {/* Resultado del test */}
            {testResult?.id === sub.id && (
              <div className={`mt-4 flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm ${testResult.ok ? 'border-jungle-green-200 bg-jungle-green-50 text-jungle-green-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
                {testResult.ok
                  ? <><CheckCircle size={16} strokeWidth={2} className="shrink-0" /> Webhook enviado correctamente (HTTP {testResult.status})</>
                  : <><XCircle size={16} strokeWidth={2} className="shrink-0" /> Error: {testResult.error ?? 'No se pudo conectar con el endpoint'}</>}
              </div>
            )}
          </div>
        ))}

        {subs.length === 0 && (
          <SectionCard>
            <EmptyState
              icon={Webhook}
              title="Sin webhooks configurados"
              description="Configura un webhook para que tu CRM reciba notificaciones en tiempo real cuando lleguen mensajes o cambien estados."
              action={
                <Button onClick={() => setShowForm(true)}>
                  <Plus size={16} strokeWidth={2} /> Crear primera suscripción
                </Button>
              }
            />
          </SectionCard>
        )}
      </div>
    </div>
  )
}
