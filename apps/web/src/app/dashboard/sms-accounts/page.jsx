'use client'
import { useEffect, useState } from 'react'
import api from '../../../lib/api'
import { GuidePanel } from '../../../components/ui/GuidePanel'
import { HelpTooltip } from '../../../components/ui/HelpTooltip'
import { PageHeader } from '../../../components/ui/PageHeader'
import { Smartphone, Pencil, Trash2, RefreshCw, Save, Globe, User, Plus } from '../../../components/ui/icons'

const EMPTY = {
  name: '', phone_number: '', gateway_url: '', api_key: '',
  daily_limit: 100, delay_min: 5, delay_max: 15,
  active_hours_start: '08:00', active_hours_end: '20:00',
  assigned_member_id: null,
}

const GUIDE_STEPS = [
  'Descarga e instala <strong>Android SMS Gateway</strong> en el teléfono corporativo desde <a href="https://github.com/capcom6/android-sms-gateway/releases" target="_blank" class="underline text-blue-700">GitHub Releases</a> (archivo .apk).',
  'Abre la app en el teléfono. Verás la <strong>URL local</strong> del gateway (ej: <code class="bg-blue-100 px-1 rounded text-xs">http://192.168.1.50:8080</code>). Si necesitas acceso desde internet, usa un túnel como <strong>ngrok</strong>.',
  'Si configuraste un <strong>usuario y contraseña</strong> en la app, genera un token Bearer en la sección de autenticación de la app y cópialo como API Key.',
  'En Kubo, haz clic en <strong>"+ Agregar teléfono"</strong>, completa los datos y guarda. El sistema verificará automáticamente si el gateway responde.',
  'Configura el <strong>webhook de SMS entrantes</strong> en la app Android apuntando a: <code class="bg-blue-100 px-1 rounded text-xs">https://tu-servidor/webhooks/sms/{id-de-la-cuenta}</code>',
]

const WEBHOOK_EXAMPLE = `// Configurar en Android SMS Gateway → Webhooks:
// URL: https://tu-servidor.com/webhooks/sms/{account_id}
// Evento: sms:received

// Payload que enviará la app al recibir un SMS:
{
  "event": "sms:received",
  "payload": {
    "phoneNumber": "+5491112345678",
    "message": "Hola, quiero información del producto",
    "receivedAt": "2026-06-04T10:30:00.000Z",
    "id": "msg_abc123"
  }
}`

export default function SmsAccountsPage() {
  const [accounts, setAccounts]       = useState([])
  const [members, setMembers]         = useState([])
  const [showForm, setShowForm]       = useState(false)
  const [editingId, setEditingId]     = useState(null)
  const [form, setForm]               = useState(EMPTY)
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState(null)
  const [pinging, setPinging]         = useState(null)
  const [pingResult, setPingResult]   = useState({})
  const [showWebhook, setShowWebhook] = useState(false)
  const [assigningId, setAssigningId] = useState(null)

  const load = () => Promise.all([
    api.get('/sms/accounts').then(r => setAccounts(r.data)),
    api.get('/settings/team').then(r => setMembers((r.data ?? []).filter(m => !m.is_owner))).catch(() => {}),
  ])

  useEffect(() => { load() }, [])

  function openEdit(acc) {
    setForm({
      name:               acc.name,
      phone_number:       acc.phone_number,
      gateway_url:        acc.gateway_url,
      api_key:            '',         // nunca mostramos la key guardada
      daily_limit:        acc.daily_limit,
      delay_min:          acc.delay_min,
      delay_max:          acc.delay_max,
      active_hours_start: acc.active_hours_start?.slice(0, 5) ?? '08:00',
      active_hours_end:   acc.active_hours_end?.slice(0, 5)   ?? '20:00',
      assigned_member_id: acc.assigned_member_id ?? null,
    })
    setEditingId(acc.id)
    setShowForm(true)
    setError(null)
  }

  function closeForm() {
    setShowForm(false)
    setEditingId(null)
    setForm(EMPTY)
    setError(null)
  }

  async function submit(e) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const payload = {
        name:               form.name,
        phone_number:       form.phone_number,
        gateway_url:        form.gateway_url,
        daily_limit:        Number(form.daily_limit),
        delay_min:          Number(form.delay_min),
        delay_max:          Number(form.delay_max),
        active_hours_start: form.active_hours_start,
        active_hours_end:   form.active_hours_end,
        ...(form.api_key ? { api_key: form.api_key } : {}),
      }
      if (editingId) {
        await api.patch(`/sms/accounts/${editingId}`, payload)
      } else {
        await api.post('/sms/accounts', {
          ...payload,
          assigned_member_id: form.assigned_member_id || null,
        })
      }
      closeForm()
      load()
    } catch (err) {
      setError(err.response?.data?.error ?? 'Error al guardar')
    } finally {
      setLoading(false)
    }
  }

  async function ping(id) {
    setPinging(id)
    setPingResult(r => ({ ...r, [id]: null }))
    try {
      const r = await api.get(`/sms/accounts/${id}/ping`)
      setPingResult(prev => ({ ...prev, [id]: r.data.online }))
      load()
    } catch {
      setPingResult(prev => ({ ...prev, [id]: false }))
    } finally {
      setPinging(null)
    }
  }

  async function assign(accountId, memberId) {
    setAssigningId(accountId)
    try {
      await api.patch(`/sms/accounts/${accountId}/assign`, { member_id: memberId || null })
      load()
    } catch {}
    setAssigningId(null)
  }

  async function deleteAccount(id, name) {
    if (!confirm(`¿Eliminar la cuenta "${name}"? Esta acción no se puede deshacer.`)) return
    await api.delete(`/sms/accounts/${id}`)
    load()
  }

  const field = k => ({ value: form[k] ?? '', onChange: e => setForm(f => ({ ...f, [k]: e.target.value })) })

  const stats = {
    total:   accounts.length,
    online:  accounts.filter(a => a.is_online).length,
    assigned: accounts.filter(a => a.assigned_member_id).length,
  }

  return (
    <div>
      <PageHeader
        icon={Smartphone}
        title="Cuentas SMS"
        description="Teléfonos Android corporativos con Android SMS Gateway — el administrador configura y asigna los números"
        action={
          <button onClick={() => setShowForm(true)}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 flex items-center gap-2">
            <Plus size={14} /> Agregar teléfono
          </button>
        }
      />

      <GuidePanel
        title="¿Cómo configurar el gateway SMS en un teléfono Android?"
        steps={GUIDE_STEPS}
        note="El teléfono debe permanecer encendido, conectado a internet y con la app abierta para que el gateway funcione. Se recomienda desactivar el ahorro de batería para la app."
      />

      {/* Instrucciones webhook entrante */}
      <div className="bg-gray-900 rounded-xl mb-6 overflow-hidden">
        <button
          onClick={() => setShowWebhook(o => !o)}
          className="w-full flex items-center justify-between px-5 py-3 text-left">
          <div className="flex items-center gap-2">
            <span className="text-blue-400">{'{ }'}</span>
            <span className="text-sm font-medium text-gray-300">Cómo configurar SMS entrantes (respuestas al inbox)</span>
          </div>
          <span className="text-gray-500 text-xs">{showWebhook ? '▲ Ocultar' : '▼ Ver instrucciones'}</span>
        </button>
        {showWebhook && (
          <pre className="px-5 pb-5 text-xs text-blue-300 overflow-x-auto border-t border-gray-800 pt-4 leading-relaxed">
            {WEBHOOK_EXAMPLE}
          </pre>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Total teléfonos', value: stats.total,    color: 'blue'  },
          { label: 'Online ahora',    value: stats.online,   color: 'green' },
          { label: 'Asignados',       value: stats.assigned, color: 'purple'},
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <p className={`text-2xl font-bold text-${s.color}-600`}>{s.value}</p>
            <p className="text-xs text-gray-500 mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Modal crear cuenta */}
      {showForm && (
        <div className="modal-overlay fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="modal-content bg-white rounded-2xl shadow-2xl w-full max-w-xl overflow-y-auto max-h-[90vh]">
            <div className="p-6 border-b border-gray-100">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                {editingId ? <><Pencil size={16} /> Editar teléfono SMS</> : 'Nuevo teléfono SMS'}
              </h2>
              <p className="text-sm text-gray-500 mt-1">
                {editingId
                  ? 'Modifica la configuración. Deja el campo API Key vacío para no cambiarla.'
                  : <>Asegúrate de tener <a href="https://github.com/capcom6/android-sms-gateway" target="_blank" className="text-blue-600 underline">Android SMS Gateway</a> instalado y corriendo en el teléfono.</>
                }
              </p>
            </div>

            {error && (
              <div className="mx-6 mt-4 bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg">{error}</div>
            )}

            <form onSubmit={submit} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-gray-700 flex items-center">
                    Nombre descriptivo <HelpTooltip text="Nombre interno para identificar este teléfono. Ej: 'Celular corporativo 1' o 'Asesor María'" />
                  </label>
                  <input {...field('name')} required placeholder="Ej: Celular corporativo 1"
                    className="mt-1.5 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-700 flex items-center">
                    Número de teléfono <HelpTooltip text="El número de la SIM en formato internacional. Ej: +5491112345678" />
                  </label>
                  <input {...field('phone_number')} required placeholder="+54911..."
                    className="mt-1.5 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-700 flex items-center">
                  URL del gateway <HelpTooltip text="La URL que muestra la app Android SMS Gateway. Si el teléfono está en la misma red local usa la IP interna. Para acceso desde internet usa ngrok u otro túnel." />
                </label>
                <input {...field('gateway_url')} required type="url" placeholder="http://192.168.1.50:8080"
                  className="mt-1.5 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                <p className="text-xs text-gray-400 mt-1">
                  💡 Para acceso externo: <span className="font-mono bg-gray-100 px-1 rounded">ngrok http 8080</span> y copia la URL pública
                </p>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-700 flex items-center">
                  API Key <HelpTooltip text="Token de autenticación de la app. Encuéntralo en Android SMS Gateway → Configuración → API Key. Déjalo vacío si la app no tiene autenticación." />
                </label>
                <input {...field('api_key')} type="password" placeholder="Dejar vacío si no tiene autenticación"
                  className="mt-1.5 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" />
              </div>

              <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Límites y horarios de envío</p>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs text-gray-600 flex items-center">
                      Límite diario <HelpTooltip text="Máximo de SMS que puede enviar este teléfono por día. Depende del plan de la SIM." />
                    </label>
                    <input {...field('daily_limit')} type="number" min="1"
                      className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-600 flex items-center">
                      Delay mín (seg) <HelpTooltip text="Segundos mínimos entre SMS. Los operadores pueden bloquear envíos demasiado rápidos." />
                    </label>
                    <input {...field('delay_min')} type="number" min="0"
                      className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-600 flex items-center">
                      Delay máx (seg) <HelpTooltip text="El sistema elige un tiempo aleatorio entre mínimo y máximo para simular comportamiento humano." />
                    </label>
                    <input {...field('delay_max')} type="number" min="0"
                      className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-600 flex items-center">
                      Hora inicio <HelpTooltip text="El sistema solo enviará SMS a partir de esta hora para no molestar fuera del horario laboral." />
                    </label>
                    <input {...field('active_hours_start')} type="time"
                      className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-600 flex items-center">
                      Hora fin <HelpTooltip text="Hora límite para envíos. Mensajes programados fuera de este rango quedan en cola para el día siguiente." />
                    </label>
                    <input {...field('active_hours_end')} type="time"
                      className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                  </div>
                </div>
              </div>

              {members.length > 0 && (
                <div>
                  <label className="text-xs font-semibold text-gray-700 flex items-center">
                    Asignar a asesor <HelpTooltip text="El asesor podrá ver el estado de este teléfono en su sección 'Mi teléfono'. Déjalo sin asignar para uso exclusivo en campañas." />
                  </label>
                  <select
                    value={form.assigned_member_id ?? ''}
                    onChange={e => setForm(f => ({ ...f, assigned_member_id: e.target.value || null }))}
                    className="mt-1.5 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                    <option value="">— Sin asignar (solo campañas) —</option>
                    {members.map(m => (
                      <option key={m.id} value={m.id}>{m.name} ({m.email})</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button type="submit" disabled={loading}
                  className="flex-1 bg-blue-600 text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-1.5">
                  {loading ? 'Guardando...' : editingId ? <><Save size={14} /> Guardar cambios</> : <><Save size={14} /> Guardar teléfono</>}
                </button>
                <button type="button" onClick={closeForm}
                  className="flex-1 border border-gray-300 py-2.5 rounded-xl text-sm text-gray-700 hover:bg-gray-50">
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
        {accounts.map(acc => (
          <div key={acc.id} className={`bg-white rounded-xl border-2 p-5 ${acc.is_online ? 'border-blue-200' : 'border-gray-200'}`}>
            {/* Header */}
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${acc.is_online ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-500'}`}>
                  <Smartphone size={20} />
                </div>
                <div>
                  <p className="font-semibold text-gray-900 text-sm">{acc.name}</p>
                  <p className="text-xs text-gray-400 font-mono">{acc.phone_number}</p>
                </div>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex items-center gap-1 ${acc.is_online ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${acc.is_online ? 'bg-blue-500 animate-pulse' : 'bg-gray-400'}`} />
                {acc.is_online ? 'Online' : 'Offline'}
              </span>
            </div>

            {/* Métricas */}
            <div className="grid grid-cols-3 gap-2 mb-4">
              <div className="bg-gray-50 rounded-lg p-2 text-center">
                <p className="text-xs text-gray-400">Hoy</p>
                <p className="text-sm font-bold text-gray-900">{acc.sent_today}/{acc.daily_limit}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-2 text-center">
                <p className="text-xs text-gray-400">Delay</p>
                <p className="text-sm font-bold text-gray-900">{acc.delay_min}–{acc.delay_max}s</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-2 text-center">
                <p className="text-xs text-gray-400">Horario</p>
                <p className="text-sm font-bold text-gray-900">{acc.active_hours_start?.slice(0,5)}–{acc.active_hours_end?.slice(0,5)}</p>
              </div>
            </div>

            {/* URL del gateway */}
            <div className="bg-gray-50 rounded-lg px-3 py-2 mb-4 flex items-center gap-2">
              <Globe size={12} className="text-gray-400 flex-shrink-0" />
              <p className="text-xs text-gray-500 font-mono truncate" title={acc.gateway_url}>{acc.gateway_url}</p>
            </div>

            {/* Asignación */}
            <div className="mb-4">
              <label className="text-xs text-gray-500 flex items-center gap-1 mb-1">
                Asignado a <HelpTooltip text="Asesor que usa este número. Puede ver su estado desde 'Mi teléfono'." />
              </label>
              <select
                value={acc.assigned_member_id ?? ''}
                onChange={e => assign(acc.id, e.target.value)}
                disabled={assigningId === acc.id}
                className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none">
                <option value="">— Sin asignar —</option>
                {members.map(m => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
              {acc.assigned_member_name && (
                <p className="text-xs text-blue-600 mt-1 flex items-center gap-1"><User size={12} /> {acc.assigned_member_name}</p>
              )}
            </div>

            {/* Webhook URL hint */}
            <div className="bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mb-4">
              <p className="text-xs text-amber-700 font-medium mb-0.5">URL para SMS entrantes:</p>
              <p className="text-xs text-amber-600 font-mono break-all">
                /webhooks/sms/{acc.id}
              </p>
            </div>

            {/* Resultado del ping */}
            {pingResult[acc.id] !== undefined && pingResult[acc.id] !== null && (
              <div className={`rounded-lg px-3 py-2 text-xs mb-3 flex items-start gap-1.5 ${pingResult[acc.id] ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                {pingResult[acc.id] ? <><RefreshCw size={12} className="flex-shrink-0 mt-0.5" /> Gateway responde correctamente</> : <>❌ El gateway no responde — verifica que la app esté abierta y conectada</>}
              </div>
            )}

            {/* Acciones */}
            <div className="space-y-2">
              <div className="flex gap-2">
                {acc.is_online ? (
                  <div className="flex-1 flex items-center justify-center gap-1.5 bg-blue-50 border border-blue-200 rounded-lg py-2">
                    <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                    <span className="text-xs text-blue-700 font-medium">Gateway online</span>
                  </div>
                ) : (
                  <div className="flex-1 flex items-center justify-center gap-1.5 bg-gray-50 border border-gray-200 rounded-lg py-2">
                    <span className="w-2 h-2 rounded-full bg-gray-400" />
                    <span className="text-xs text-gray-500 font-medium">Sin conexión</span>
                  </div>
                )}
                <button onClick={() => openEdit(acc)}
                  className="border border-gray-200 text-gray-600 text-xs py-2 px-3 rounded-lg hover:bg-gray-50">
                  <Pencil size={14} />
                </button>
                <button onClick={() => deleteAccount(acc.id, acc.name)}
                  className="border border-red-200 text-red-500 text-xs py-2 px-3 rounded-lg hover:bg-red-50">
                  <Trash2 size={14} />
                </button>
              </div>
              <button onClick={() => ping(acc.id)} disabled={pinging === acc.id}
                className="w-full border border-gray-200 text-gray-600 text-xs py-1.5 rounded-lg hover:bg-gray-50 disabled:opacity-50 font-medium flex items-center justify-center">
                {pinging === acc.id ? 'Verificando...' : <><RefreshCw size={14} className="mr-1.5" />Verificar conexión</>}
              </button>
            </div>
          </div>
        ))}

        {accounts.length === 0 && (
          <div className="col-span-3 text-center py-20 bg-white rounded-xl border-2 border-dashed border-gray-200">
            <p className="text-5xl mb-4">📲</p>
            <p className="text-lg font-semibold text-gray-700">Sin teléfonos SMS configurados</p>
            <p className="text-sm text-gray-400 mt-2 max-w-md mx-auto">
              Instala <strong>Android SMS Gateway</strong> en un teléfono corporativo y agrégalo aquí para empezar a enviar y recibir SMS.
            </p>
            <button onClick={() => setShowForm(true)}
              className="mt-6 bg-blue-600 text-white px-6 py-2.5 rounded-xl text-sm font-medium hover:bg-blue-700">
              + Agregar primer teléfono
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
