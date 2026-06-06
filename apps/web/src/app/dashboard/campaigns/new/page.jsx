'use client'
import { useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import api from '../../../../lib/api'

const STRATEGIES = [
  { value: 'smtp_own',  label: 'SMTP propio (rotacion de cuentas)' },
  { value: 'sendgrid',  label: 'SendGrid' },
  { value: 'brevo',     label: 'Brevo' },
  { value: 'mailchimp', label: 'Mailchimp Transactional (Mandrill)' },
]

const STEPS = ['Configuracion', 'Contenido', 'Envio']

function NewCampaignForm() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const fromId       = searchParams.get('from') // ID de campaña a duplicar

  const [step, setStep] = useState(0)
  const [lists, setLists] = useState([])
  const [integrations, setIntegrations] = useState([])
  const [templates, setTemplates] = useState([])
  const [showTemplates, setShowTemplates] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingFrom, setLoadingFrom] = useState(!!fromId)
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    name: '',
    subject: '',
    from_name: '',
    reply_to: '',
    list_id: '',
    strategy: 'smtp_own',
    scheduled_at: '',
    html_content: '',
    text_content: '',
    settings: {
      delay_min_ms: 2000,
      delay_max_ms: 15000,
      rotate_accounts: true,
      track_opens: true,
      track_clicks: true,
      integration_id: '',
    },
  })

  useEffect(() => {
    api.get('/lists').then(r => setLists(r.data))
    api.get('/integrations').then(r => setIntegrations(r.data))
    api.get('/templates').then(r => setTemplates(r.data)).catch(() => {})

    // Si viene de un reenvío, cargar los datos de la campaña original
    if (fromId) {
      api.get(`/campaigns/${fromId}`)
        .then(r => {
          const c = r.data
          setForm({
            name:         c.name + ' (Reenvío)',
            subject:      c.subject,
            from_name:    c.from_name,
            reply_to:     c.reply_to ?? '',
            list_id:      c.list_id,
            strategy:     c.strategy,
            scheduled_at: '',
            html_content: c.html_content ?? '',
            text_content: c.text_content ?? '',
            settings: {
              delay_min_ms:    c.settings?.delay_min_ms    ?? 2000,
              delay_max_ms:    c.settings?.delay_max_ms    ?? 15000,
              rotate_accounts: c.settings?.rotate_accounts ?? true,
              track_opens:     c.settings?.track_opens     ?? true,
              track_clicks:    c.settings?.track_clicks    ?? true,
              integration_id:  c.settings?.integration_id  ?? '',
            },
          })
        })
        .finally(() => setLoadingFrom(false))
    }
  }, [])

  function set(field, value) {
    setForm(f => ({ ...f, [field]: value }))
  }

  function setSetting(field, value) {
    setForm(f => ({ ...f, settings: { ...f.settings, [field]: value } }))
  }

  function canGoNext() {
    if (step === 0) {
      const base = form.name && form.subject && form.from_name && form.list_id
      if (!base) return false
      if (form.strategy !== 'smtp_own') return !!form.settings.integration_id
      return true
    }
    if (step === 1) return form.html_content.trim().length > 0
    return true
  }

  async function submit() {
    setLoading(true)
    setError('')
    try {
      const payload = { ...form }

      // Limpiar campos opcionales vacíos
      if (!payload.scheduled_at) delete payload.scheduled_at
      else payload.scheduled_at = new Date(payload.scheduled_at).toISOString()

      if (!payload.reply_to) delete payload.reply_to
      if (!payload.text_content) delete payload.text_content

      // Limpiar settings opcionales
      const settings = { ...payload.settings }
      if (!settings.integration_id) delete settings.integration_id
      payload.settings = settings

      await api.post('/campaigns', payload)
      router.push('/dashboard/campaigns')
    } catch (err) {
      const msg = err.response?.data?.error
               ?? err.response?.data?.message
               ?? 'Error al crear la campaña'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/dashboard/campaigns" className="text-gray-400 hover:text-gray-600 text-sm">← Campanas</Link>
        <h1 className="text-2xl font-bold">
          {fromId ? '↩ Reenviar campaña' : 'Nueva campaña'}
        </h1>
      </div>
      {fromId && (
        <div className="bg-purple-50 border border-purple-200 rounded-xl px-4 py-3 text-sm text-purple-700">
          📋 Los datos de la campaña original se han cargado. Puedes modificar lo que necesites antes de enviar.
        </div>
      )}
      {loadingFrom && (
        <div className="text-center py-8 text-gray-400">Cargando campaña original...</div>
      )}

      {/* Stepper */}
      <div className="flex items-center gap-0">
        {STEPS.map((s, i) => (
          <div key={s} className="flex items-center flex-1 last:flex-none">
            <div className={`flex items-center gap-2 ${i <= step ? 'text-blue-600' : 'text-gray-400'}`}>
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold border-2 ${i < step ? 'bg-blue-600 border-blue-600 text-white' : i === step ? 'border-blue-600 text-blue-600' : 'border-gray-300'}`}>
                {i < step ? '✓' : i + 1}
              </div>
              <span className="text-sm font-medium">{s}</span>
            </div>
            {i < STEPS.length - 1 && <div className={`flex-1 h-0.5 mx-3 ${i < step ? 'bg-blue-600' : 'bg-gray-200'}`} />}
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl shadow-sm p-6 space-y-5">

        {/* STEP 0: Configuracion */}
        {step === 0 && (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Nombre interno de la campana *</label>
                <input value={form.name} onChange={e => set('name', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Ej: Promo Mayo 2026" />
              </div>

              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Asunto del correo *</label>
                <input value={form.subject} onChange={e => set('subject', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Ej: {{first_name}}, no te pierdas esta oferta" />
                <p className="text-xs text-gray-400 mt-1">Puedes usar {'{{first_name}}'}, {'{{last_name}}'}, {'{{email}}'}</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nombre del remitente *</label>
                <input value={form.from_name} onChange={e => set('from_name', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Ej: Maria de Ventas" />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Responder a (opcional)</label>
                <input value={form.reply_to} onChange={e => set('reply_to', e.target.value)}
                  type="email"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="respuestas@tudominio.com" />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Lista de destinatarios *</label>
                <select value={form.list_id} onChange={e => set('list_id', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">Seleccionar lista...</option>
                  {lists.map(l => (
                    <option key={l.id} value={l.id}>{l.name} ({Number(l.total_count).toLocaleString()} contactos)</option>
                  ))}
                </select>
                {lists.length === 0 && <p className="text-xs text-amber-500 mt-1">No tienes listas. Crea una en Contactos primero.</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Estrategia de envio</label>
                <select value={form.strategy} onChange={e => { set('strategy', e.target.value); setSetting('integration_id', '') }}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {STRATEGIES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>

              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Programar envio (opcional)</label>
                <input type="datetime-local" value={form.scheduled_at}
                  onChange={e => set('scheduled_at', e.target.value)}
                  min={new Date(Date.now() + 60000).toISOString().slice(0, 16)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <p className="text-xs text-gray-400 mt-1">
                  {form.scheduled_at
                    ? `Se enviara el ${new Date(form.scheduled_at).toLocaleString('es')}`
                    : 'Si no seleccionas una fecha, la campana quedara en borrador y la envias manualmente'}
                </p>
              </div>

              {form.strategy !== 'smtp_own' && (
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Integracion a usar *</label>
                  {(() => {
                    const available = integrations.filter(i => i.provider === form.strategy && i.is_active)
                    if (available.length === 0) return (
                      <div className="border border-amber-200 bg-amber-50 rounded-lg px-3 py-2 text-sm text-amber-700">
                        No tienes integraciones activas para {STRATEGIES.find(s => s.value === form.strategy)?.label}.{' '}
                        <a href="/dashboard/integrations" className="underline font-medium">Configurar ahora →</a>
                      </div>
                    )
                    return (
                      <select value={form.settings.integration_id} onChange={e => setSetting('integration_id', e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                        <option value="">Seleccionar integracion...</option>
                        {available.map(i => (
                          <option key={i.id} value={i.id}>{i.name}</option>
                        ))}
                      </select>
                    )
                  })()}
                </div>
              )}
            </div>
          </>
        )}

        {/* STEP 1: Contenido */}
        {step === 1 && (
          <>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium text-gray-700">Contenido HTML *</label>
                {templates.length > 0 && (
                  <button type="button" onClick={() => setShowTemplates(true)}
                    className="text-xs text-blue-600 hover:underline font-medium">
                    📋 Cargar plantilla
                  </button>
                )}
              </div>
              {showTemplates && (
                <div className="mb-3 bg-blue-50 border border-blue-200 rounded-xl p-3">
                  <p className="text-xs font-semibold text-blue-700 mb-2">Selecciona una plantilla:</p>
                  <div className="grid grid-cols-2 gap-2">
                    {templates.map(t => (
                      <button key={t.id} type="button"
                        onClick={() => {
                          set('subject',      t.subject)
                          set('from_name',    t.from_name)
                          set('html_content', t.html_content)
                          if (t.text_content) set('text_content', t.text_content)
                          setShowTemplates(false)
                        }}
                        className="text-left border border-blue-200 bg-white rounded-lg p-2.5 hover:border-blue-500 hover:bg-blue-50 transition-colors">
                        <p className="text-sm font-medium text-gray-800">{t.name}</p>
                        <p className="text-xs text-gray-500 truncate mt-0.5">{t.subject}</p>
                      </button>
                    ))}
                  </div>
                  <button type="button" onClick={() => setShowTemplates(false)}
                    className="mt-2 text-xs text-gray-500 hover:text-gray-700">
                    Cancelar
                  </button>
                </div>
              )}
              <textarea
                value={form.html_content}
                onChange={e => set('html_content', e.target.value)}
                rows={14}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder={'<h1>Hola {{first_name}}</h1>\n<p>Contenido del correo...</p>\n<a href="https://tulink.com">Ver oferta</a>'}
              />
              <p className="text-xs text-gray-400 mt-1">HTML completo del correo. Variables disponibles: {'{{first_name}}'}, {'{{last_name}}'}, {'{{email}}'}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Texto plano (opcional, para clientes sin HTML)</label>
              <textarea
                value={form.text_content}
                onChange={e => set('text_content', e.target.value)}
                rows={4}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Version en texto del correo..."
              />
            </div>
          </>
        )}

        {/* STEP 2: Configuracion de envio */}
        {step === 2 && (
          <>
            <div className="space-y-4">
              <h3 className="font-medium text-gray-800">Configuracion de envio</h3>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Delay minimo entre correos (ms)</label>
                  <input type="number" value={form.settings.delay_min_ms}
                    onChange={e => setSetting('delay_min_ms', parseInt(e.target.value))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  <p className="text-xs text-gray-400 mt-1">2000 = 2 segundos</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Delay maximo entre correos (ms)</label>
                  <input type="number" value={form.settings.delay_max_ms}
                    onChange={e => setSetting('delay_max_ms', parseInt(e.target.value))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  <p className="text-xs text-gray-400 mt-1">15000 = 15 segundos</p>
                </div>
              </div>

              <div className="space-y-3 pt-2">
                {[
                  { key: 'rotate_accounts', label: 'Rotar cuentas SMTP', desc: 'Cada correo sale de una cuenta diferente' },
                  { key: 'track_opens', label: 'Rastrear aperturas', desc: 'Inserta pixel de seguimiento invisible' },
                  { key: 'track_clicks', label: 'Rastrear clicks', desc: 'Redirige links para contabilizar clicks' },
                ].map(opt => (
                  <label key={opt.key} className="flex items-start gap-3 cursor-pointer">
                    <input type="checkbox" checked={form.settings[opt.key]}
                      onChange={e => setSetting(opt.key, e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600" />
                    <div>
                      <p className="text-sm font-medium text-gray-700">{opt.label}</p>
                      <p className="text-xs text-gray-400">{opt.desc}</p>
                    </div>
                  </label>
                ))}
              </div>

              <div className="bg-blue-50 rounded-lg p-4 text-sm text-blue-700">
                <p className="font-medium mb-1">Resumen de la campana</p>
                <p>Nombre: <span className="font-medium">{form.name}</span></p>
                <p>Asunto: <span className="font-medium">{form.subject}</span></p>
                <p>Lista: <span className="font-medium">{lists.find(l => l.id === form.list_id)?.name ?? '-'} ({Number(lists.find(l => l.id === form.list_id)?.total_count ?? 0).toLocaleString()} contactos)</span></p>
                <p>Estrategia: <span className="font-medium">{STRATEGIES.find(s => s.value === form.strategy)?.label}</span></p>
                {form.strategy !== 'smtp_own' && (
                  <p>Integracion: <span className="font-medium">{integrations.find(i => i.id === form.settings.integration_id)?.name ?? '-'}</span></p>
                )}
                <p>Envio: <span className="font-medium">
                  {form.scheduled_at ? new Date(form.scheduled_at).toLocaleString('es') : 'Manual (borrador)'}
                </span></p>
              </div>
            </div>
          </>
        )}

        {error && <p className="text-red-500 text-sm bg-red-50 p-3 rounded-lg">{error}</p>}

        <div className="flex justify-between pt-2">
          <button
            onClick={() => setStep(s => s - 1)}
            disabled={step === 0}
            className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-0"
          >
            Atras
          </button>

          {step < STEPS.length - 1 ? (
            <button
              onClick={() => setStep(s => s + 1)}
              disabled={!canGoNext()}
              className="px-6 py-2 text-sm bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              Siguiente
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={loading || !canGoNext()}
              className="px-6 py-2 text-sm bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50"
            >
              {loading ? 'Guardando...' : form.scheduled_at ? 'Programar campana' : 'Crear campana'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default function NewCampaignPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64 text-gray-400">Cargando...</div>}>
      <NewCampaignForm />
    </Suspense>
  )
}
