'use client'
import { useEffect, useState } from 'react'
import api from '../../../lib/api'
import { GuidePanel }  from '../../../components/ui/GuidePanel'
import { HelpTooltip } from '../../../components/ui/HelpTooltip'
import { PageHeader }   from '../../../components/ui/PageHeader'
import { PhoneCall, QrCode, RefreshCw, RotateCcw, Trash2, Save, Zap, Link2, User, Plus, CheckCircle, Loader2 } from '../../../components/ui/icons'

const EMPTY = {
  provider: 'baileys',
  name: '', instance_name: '', evolution_url: '', evolution_api_key: '',
  daily_limit: 200, delay_min: 10, delay_max: 30,
  active_hours_start: '08:00', active_hours_end: '20:00', role: 'campaign',
  assigned_member_id: null,
}

const GUIDE_STEPS = [
  'Instala <strong>Evolution API</strong> en tu servidor usando Docker: <code class="bg-blue-100 px-1 rounded text-xs">docker run -p 8080:8080 atendai/evolution-api</code>',
  'Copia la <strong>URL del servidor</strong> (ej: <em>https://evolution.tuempresa.com</em>) y la <strong>API Key</strong> que configuraste.',
  'Haz clic en <strong>"+ Agregar número"</strong>, completa el formulario y guarda.',
  'Una vez creada la cuenta, haz clic en <strong>"Conectar QR"</strong> y escanea el código con WhatsApp en el teléfono.',
  'Si es una cuenta de asesor, <strong>asígnala al miembro</strong> correspondiente usando el selector. El asesor solo verá su número.',
]

export default function WhatsappAccountsPage() {
  const [accounts, setAccounts]       = useState([])
  const [members, setMembers]         = useState([])
  const [showForm, setShowForm]       = useState(false)
  const [form, setForm]               = useState(EMPTY)
  const [qrData, setQrData]             = useState(null)
  const [loadingQr, setLoadingQr]       = useState(false)
  const [qrPolling, setQrPolling]       = useState(null)
  const [pairingPhone, setPairingPhone] = useState('')
  const [pairingLoading, setPairingLoading] = useState(false)
  const [pairingError, setPairingError] = useState(null)
  const [linkMethod, setLinkMethod]     = useState('qr')
  const [verifying, setVerifying]       = useState(null)  // accountId en verificación
  const [reconnecting, setReconnecting] = useState(null)  // accountId reconectando
  const [assigningId, setAssigningId] = useState(null)
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState(null)

  const load = async () => {
    const [accsRes, membersRes] = await Promise.all([
      api.get('/whatsapp/accounts'),
      api.get('/settings/team').catch(() => ({ data: [] })),
    ])
    setAccounts(accsRes.data)
    // Filtrar solo miembros del equipo (excluir el dueño que tiene is_owner: true)
    setMembers((membersRes.data ?? []).filter(m => !m.is_owner))

    // Sincronizar estado real de sesiones Baileys en background
    accsRes.data
      .filter(a => a.provider === 'baileys')
      .forEach(a => {
        api.get(`/whatsapp/accounts/${a.id}/status`)
          .then(r => {
            if (r.data.is_connected !== a.is_connected) {
              setAccounts(prev => prev.map(acc =>
                acc.id === a.id
                  ? { ...acc, is_connected: r.data.is_connected, baileys_status: r.data.status }
                  : acc
              ))
            }
          })
          .catch(() => {})
      })
  }

  useEffect(() => { load() }, [])

  async function submit(e) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const payload = {
        provider:     form.provider,
        name:               form.name,
        instance_name:      form.instance_name.toLowerCase().trim(),
        phone_number:       form.phone_number || undefined,
        daily_limit:        Number(form.daily_limit),
        delay_min:          Number(form.delay_min),
        delay_max:          Number(form.delay_max),
        active_hours_start: form.active_hours_start,
        active_hours_end:   form.active_hours_end,
        role:               form.role,
        assigned_member_id: form.assigned_member_id || null,
        ...(form.provider === 'evolution' ? {
          evolution_url:     form.evolution_url,
          evolution_api_key: form.evolution_api_key,
        } : {}),
      }
      const r = await api.post('/whatsapp/accounts', payload)
      setShowForm(false)
      setForm(EMPTY)
      load()
      if (form.provider === 'baileys') {
        setTimeout(() => showQr(r.data.id, r.data), 1000)
      }
    } catch (err) {
      const msg = err.response?.data?.error
               ?? err.response?.data?.message
               ?? JSON.stringify(err.response?.data)
               ?? err.message
               ?? 'Error al guardar'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  async function assign(accountId, memberId) {
    setAssigningId(accountId)
    try {
      await api.patch(`/whatsapp/accounts/${accountId}/assign`, { member_id: memberId || null })
      load()
    } catch {}
    setAssigningId(null)
  }

  function stopQrPolling() {
    if (qrPolling) { clearInterval(qrPolling); setQrPolling(null) }
  }

  async function pollQr(id) {
    try {
      const r = await api.get(`/whatsapp/accounts/${id}/qr`)
      const d = r.data
      if (d.status === 'connected') {
        stopQrPolling()
        setQrData(prev => ({ ...prev, status: 'connected' }))
        load()
        return
      }
      setQrData(prev => ({
        ...prev,
        status:      d.status,
        qrBase64:    d.qrBase64 ?? prev?.qrBase64 ?? null,
        pairingCode: d.pairingCode ?? prev?.pairingCode ?? null,
      }))
    } catch {}
  }

  async function showQr(id, acc) {
    stopQrPolling()
    setLoadingQr(id)
    setLinkMethod('qr')
    setPairingError(null)
    setPairingPhone(acc?.phone_number ?? '')
    setQrData({ accountId: id, status: 'starting', qrBase64: null, pairingCode: null, account: acc })
    await pollQr(id)
    setLoadingQr(null)
    const interval = setInterval(() => pollQr(id), 3000)
    setQrPolling(interval)
  }

  async function requestPairingCode() {
    const phone = pairingPhone.trim()
    if (!phone) { setPairingError('Ingresa el número de teléfono'); return }
    setPairingLoading(true)
    setPairingError(null)
    stopQrPolling()
    try {
      const r = await api.post(`/whatsapp/accounts/${qrData.accountId}/pairing-code`, { phone_number: phone })
      setQrData(prev => ({ ...prev, pairingCode: r.data.pairing_code, status: 'awaiting_code' }))
      // Seguir polling para detectar cuando conecta
      const interval = setInterval(() => pollQr(qrData.accountId), 3000)
      setQrPolling(interval)
    } catch (err) {
      setPairingError(err.response?.data?.error ?? 'Error al obtener código')
    } finally {
      setPairingLoading(false)
    }
  }

  async function disconnectAndReset(id) {
    stopQrPolling()
    await api.post(`/whatsapp/accounts/${id}/disconnect`)
    await new Promise(r => setTimeout(r, 1500))
    setQrData(prev => ({ ...prev, status: 'starting', qrBase64: null, pairingCode: null }))
    await pollQr(id)
    const interval = setInterval(() => pollQr(id), 3000)
    setQrPolling(interval)
    load()
  }

  function closeQrModal() {
    stopQrPolling()
    setQrData(null)
    setPairingError(null)
  }

  async function checkStatus(id) {
    setVerifying(id)
    try {
      await api.get(`/whatsapp/accounts/${id}/status`)
      load()
    } catch {}
    setVerifying(null)
  }

  async function reconnect(id) {
    setReconnecting(id)
    try {
      await api.post(`/whatsapp/accounts/${id}/reconnect`)
      // Esperar 5s y verificar
      await new Promise(r => setTimeout(r, 5000))
      await api.get(`/whatsapp/accounts/${id}/status`)
      load()
    } catch {}
    setReconnecting(null)
  }

  async function deleteAccount(id, name) {
    if (!confirm(`¿Eliminar la cuenta "${name}"? Esta acción no se puede deshacer.`)) return
    await api.delete(`/whatsapp/accounts/${id}`)
    load()
  }

  const field = k => ({ value: form[k] ?? '', onChange: e => setForm(f => ({ ...f, [k]: e.target.value })) })

  const stats = {
    total:     accounts.length,
    connected: accounts.filter(a => a.is_connected).length,
    assigned:  accounts.filter(a => a.assigned_member_id).length,
  }

  return (
    <div>
      <PageHeader
        icon={PhoneCall}
        title="Cuentas WhatsApp"
        description="Gestión de números conectados via Evolution API — solo el administrador puede crear y asignar números"
        action={
          <button onClick={() => setShowForm(true)}
            className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 flex items-center gap-2">
            <Plus size={14} /> Agregar número
          </button>
        }
      />

      <GuidePanel
        title="¿Cómo configurar WhatsApp?"
        steps={GUIDE_STEPS}
        note="WhatsApp puede suspender números que envíen mensajes masivos sin delays. Configura siempre un delay mínimo de 10 segundos entre mensajes para simular comportamiento humano."
      />

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Total números', value: stats.total,     color: 'blue'  },
          { label: 'Conectados',    value: stats.connected, color: 'green' },
          { label: 'Asignados',     value: stats.assigned,  color: 'purple'},
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
              <h2 className="text-lg font-semibold text-gray-900">Nueva cuenta WhatsApp</h2>
              <p className="text-sm text-gray-500 mt-1">Conecta un número via Evolution API. Tras guardar podrás escanear el QR.</p>
            </div>
            {error && (
              <div className="mx-6 mt-4 bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg">{error}</div>
            )}
            <form onSubmit={submit} className="p-6 space-y-4">

              {/* Selector de proveedor */}
              <div>
                <label className="text-xs font-semibold text-gray-700 mb-2 block flex items-center">
                  Motor de conexión <HelpTooltip text="Baileys se integra directo en Kubo sin servidor extra. Evolution API requiere un servicio separado." />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { value: 'baileys',   label: 'Baileys',      Icon: Zap,   desc: 'Integrado en Kubo. Sin configuración extra.' },
                    { value: 'evolution', label: 'Evolution API', Icon: Link2, desc: 'Servidor externo. Más control.' },
                  ].map(p => (
                    <button key={p.value} type="button"
                      onClick={() => setForm(f => ({ ...f, provider: p.value }))}
                      className={`rounded-xl border-2 p-3 text-left transition-all ${
                        form.provider === p.value
                          ? 'border-green-500 bg-green-50'
                          : 'border-gray-200 bg-white hover:border-gray-300'
                      }`}>
                      <p className="mb-1"><p.Icon size={20} /></p>
                      <p className="text-sm font-semibold text-gray-800">{p.label}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{p.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-gray-700 flex items-center">
                    Nombre descriptivo <HelpTooltip text="Nombre interno. Ej: 'Asesor Juan' o 'Línea ventas'" />
                  </label>
                  <input {...field('name')} required placeholder="Ej: Asesor Juan" className="mt-1.5 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-green-500 focus:outline-none" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-700 flex items-center">
                    ID de instancia <HelpTooltip text="Identificador único. Solo letras minúsculas, números y guiones. Ej: asesor-juan" />
                  </label>
                  <input
                    value={form.instance_name}
                    onChange={e => setForm(f => ({ ...f, instance_name: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '-') }))}
                    required placeholder="asesor-juan"
                    className="mt-1.5 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-green-500 focus:outline-none font-mono" />
                  <p className="text-xs text-gray-400 mt-1">Solo minúsculas, números y guiones</p>
                </div>
              </div>

              {/* Campos Evolution API (condicional) */}
              {form.provider === 'evolution' && (
                <>
                  <div>
                    <label className="text-xs font-semibold text-gray-700 flex items-center">
                      URL del servidor Evolution API <HelpTooltip text="URL donde corre tu Evolution API. Ej: https://evolution.tuempresa.com" />
                    </label>
                    <input {...field('evolution_url')} required type="url" placeholder="https://evolution.tuempresa.com" className="mt-1.5 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-green-500 focus:outline-none" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-700 flex items-center">
                      API Key de Evolution <HelpTooltip text="AUTHENTICATION_API_KEY del .env de Evolution" />
                    </label>
                    <input {...field('evolution_api_key')} required type="password" placeholder="••••••••" className="mt-1.5 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-green-500 focus:outline-none" />
                  </div>
                </>
              )}

              <div>
                <label className="text-xs font-semibold text-gray-700 flex items-center">
                  Número de teléfono <HelpTooltip text="El número con código de país. Ej: +51910462070. Para Baileys es necesario si quieres usar el código de 8 dígitos en vez del QR." />
                </label>
                <input {...field('phone_number')} type="tel" placeholder="+51910462070"
                  className="mt-1.5 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-green-500 focus:outline-none" />
              </div>

              {form.provider === 'baileys' && (
                <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-sm text-green-700">
                  ⚡ <strong>Baileys</strong> corre dentro de Kubo. Al guardar podrás vincular por <strong>QR</strong> o por <strong>código de 8 dígitos</strong>.
                </div>
              )}

              <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Límites y horarios de envío</p>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs text-gray-600 flex items-center">
                      Límite diario <HelpTooltip text="Máximo de mensajes que puede enviar este número por día. Recomendado: 200 para números nuevos." />
                    </label>
                    <input {...field('daily_limit')} type="number" min="1" className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-600 flex items-center">
                      Delay mín (seg) <HelpTooltip text="Segundos mínimos de espera entre mensajes. Simula comportamiento humano para evitar bloqueos." />
                    </label>
                    <input {...field('delay_min')} type="number" min="0" className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-600 flex items-center">
                      Delay máx (seg) <HelpTooltip text="Segundos máximos de espera. El sistema elige un valor aleatorio entre mín y máx." />
                    </label>
                    <input {...field('delay_max')} type="number" min="0" className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs text-gray-600 flex items-center">
                      Hora inicio <HelpTooltip text="El sistema solo enviará mensajes a partir de esta hora (horario local del servidor)." />
                    </label>
                    <input {...field('active_hours_start')} type="time" className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-600 flex items-center">
                      Hora fin <HelpTooltip text="El sistema dejará de enviar mensajes pasada esta hora." />
                    </label>
                    <input {...field('active_hours_end')} type="time" className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-600 flex items-center">
                      Tipo de cuenta <HelpTooltip text="'Asesor': número personal de un asesor. 'Campaña': número dedicado a envíos masivos." />
                    </label>
                    <select {...field('role')} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                      <option value="campaign">📢 Campaña</option>
                      <option value="advisor">Asesor</option>
                    </select>
                  </div>
                </div>
              </div>

              {form.role === 'advisor' && members.length > 0 && (
                <div>
                  <label className="text-xs font-semibold text-gray-700 flex items-center">
                    Asignar a asesor <HelpTooltip text="El asesor seleccionado podrá ver este número en 'Mi teléfono' y escanear el QR por su cuenta." />
                  </label>
                  <select
                    value={form.assigned_member_id ?? ''}
                    onChange={e => setForm(f => ({ ...f, assigned_member_id: e.target.value || null }))}
                    className="mt-1.5 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                    <option value="">— Sin asignar —</option>
                    {members.map(m => (
                      <option key={m.id} value={m.id}>{m.name} ({m.email})</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button type="submit" disabled={loading}
                  className="flex-1 bg-green-600 text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-1.5">
                  {loading ? 'Guardando...' : <><Save size={14} /> Guardar cuenta</>}
                </button>
                <button type="button" onClick={() => { setShowForm(false); setError(null) }}
                  className="flex-1 border border-gray-300 py-2.5 rounded-xl text-sm text-gray-700 hover:bg-gray-50">
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal QR */}
      {qrData && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={closeQrModal}>
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full mx-4" onClick={e => e.stopPropagation()}>

            {/* ── Conectado ── */}
            {qrData.status === 'connected' ? (
              <div className="text-center py-6">
                <p className="text-6xl mb-4">✅</p>
                <p className="text-xl font-bold text-green-700">¡Conectado!</p>
                <p className="text-sm text-gray-500 mt-2">WhatsApp vinculado correctamente</p>
                <button onClick={closeQrModal} className="mt-6 w-full bg-green-600 text-white py-2.5 rounded-xl text-sm font-medium hover:bg-green-700">Cerrar</button>
              </div>
            ) : (
              <>
                <h2 className="text-lg font-semibold text-center mb-4">Vincular WhatsApp</h2>

                {/* Selector de método */}
                <div className="flex gap-2 mb-5">
                  {[['qr','Escanear QR'],['code','Código de 8 dígitos']].map(([m, lbl]) => (
                    <button key={m} type="button" onClick={() => setLinkMethod(m)}
                      className={`flex-1 py-2 rounded-xl text-xs font-medium border-2 transition-colors ${
                        linkMethod === m ? 'border-green-500 bg-green-50 text-green-700' : 'border-gray-200 text-gray-500 hover:border-gray-300'
                      }`}>
                      {lbl}
                    </button>
                  ))}
                </div>

                {/* ── Método QR ── */}
                {linkMethod === 'qr' && (
                  <>
                    <p className="text-xs text-gray-500 text-center mb-3">
                      WhatsApp → <strong>Dispositivos vinculados</strong> → <strong>Vincular dispositivo</strong> → escanea
                    </p>
                    {!qrData.qrBase64 ? (
                      <div className="flex flex-col items-center justify-center h-44 gap-3">
                        <div className="w-10 h-10 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
                        <p className="text-sm text-gray-500">Generando QR...</p>
                      </div>
                    ) : (
                      <img src={qrData.qrBase64} alt="QR" className="w-full rounded-xl border-2 border-gray-200" />
                    )}
                    <p className="text-xs text-center text-gray-400 mt-2">El QR se actualiza automáticamente cada 20s</p>
                  </>
                )}

                {/* ── Método código ── */}
                {linkMethod === 'code' && (
                  <>
                    <p className="text-xs text-gray-500 text-center mb-3">
                      WhatsApp → <strong>Dispositivos vinculados</strong> → <strong>Vincular con número</strong> → ingresa el código
                    </p>

                    {!qrData.pairingCode ? (
                      <div className="space-y-3">
                        <div>
                          <label className="text-xs font-semibold text-gray-700 block mb-1">
                            Número del teléfono a vincular
                          </label>
                          <input
                            value={pairingPhone}
                            onChange={e => setPairingPhone(e.target.value)}
                            placeholder="+51910462070"
                            className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-green-500 focus:outline-none"
                          />
                          <p className="text-xs text-gray-400 mt-1">El número del celular que vas a vincular</p>
                        </div>
                        {pairingError && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{pairingError}</p>}
                        <button onClick={requestPairingCode} disabled={pairingLoading}
                          className="w-full bg-green-600 text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-green-700 disabled:opacity-50">
                          {pairingLoading ? 'Generando código...' : 'Obtener código'}
                        </button>
                      </div>
                    ) : (
                      <div className="text-center">
                        <p className="text-xs text-gray-500 mb-3">Ingresa este código en WhatsApp</p>
                        <div className="bg-gray-900 text-green-400 font-mono text-3xl font-bold tracking-widest py-4 px-6 rounded-xl mb-3">
                          {qrData.pairingCode}
                        </div>
                        <p className="text-xs text-gray-400">Tienes ~60 segundos para ingresarlo</p>
                        <button onClick={() => setQrData(prev => ({ ...prev, pairingCode: null }))}
                          className="mt-3 text-xs text-gray-500 underline">
                          Pedir otro código
                        </button>
                      </div>
                    )}
                  </>
                )}

                <div className="flex gap-2 mt-4">
                  <button onClick={() => disconnectAndReset(qrData.accountId)}
                    className="flex-1 text-xs border border-gray-200 text-gray-600 py-2 rounded-xl hover:bg-gray-50 flex items-center justify-center gap-1">
                    <RotateCcw size={12} /> Reiniciar sesión
                  </button>
                  <button onClick={closeQrModal}
                    className="flex-1 text-xs border border-gray-200 text-gray-600 py-2 rounded-xl hover:bg-gray-50">
                    Cerrar
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Cards de cuentas */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
        {accounts.map(acc => (
          <div key={acc.id} className={`bg-white rounded-xl border-2 p-5 ${acc.is_connected ? 'border-green-200' : 'border-gray-200'}`}>
            {/* Header de la card */}
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${acc.is_connected ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-500'}`}>
                  {acc.is_connected ? <CheckCircle size={20} /> : <PhoneCall size={20} />}
                </div>
                <div>
                  <p className="font-semibold text-gray-900 text-sm">{acc.name}</p>
                  <p className="text-xs text-gray-400">{acc.instance_name}</p>
                </div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${acc.is_connected ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  {acc.is_connected ? '● Conectado' : '○ Sin conectar'}
                </span>
                <span className={`text-xs px-2 py-0.5 rounded-full flex items-center gap-1 ${acc.role === 'advisor' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
                  {acc.role === 'advisor' ? <><User size={10} /> Asesor</> : '📢 Campaña'}
                </span>
              </div>
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

            {/* Asignación a asesor */}
            <div className="mb-4">
              <label className="text-xs text-gray-500 flex items-center gap-1 mb-1">
                Asignado a <HelpTooltip text="El asesor asignado puede escanear el QR desde su vista 'Mi teléfono'" />
              </label>
              <div className="flex items-center gap-2">
                <select
                  value={acc.assigned_member_id ?? ''}
                  onChange={e => assign(acc.id, e.target.value)}
                  disabled={assigningId === acc.id}
                  className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none">
                  <option value="">— Sin asignar —</option>
                  {members.map(m => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
                {acc.assigned_member_name && (
                  <span className="text-xs text-blue-600 font-medium">{assigningId === acc.id ? '...' : ''}</span>
                )}
              </div>
              {acc.assigned_member_name && (
                <p className="text-xs text-blue-600 mt-1 flex items-center gap-1"><User size={12} /> {acc.assigned_member_name}</p>
              )}
            </div>

            {/* Acciones */}
            <div className="space-y-2">
              {/* Fila principal */}
              <div className="flex gap-2">
                {!acc.is_connected ? (
                  <button onClick={() => showQr(acc.id, acc)} disabled={loadingQr === acc.id}
                    className="flex-1 bg-green-600 text-white text-xs py-2 rounded-lg hover:bg-green-700 disabled:opacity-50 font-medium flex items-center justify-center">
                    {loadingQr === acc.id ? 'Cargando...' : <><QrCode size={14} className="mr-1.5" />Vincular</>}
                  </button>
                ) : (
                  <div className="flex-1 flex items-center justify-center gap-1 bg-green-50 border border-green-200 rounded-lg py-2">
                    <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                    <span className="text-xs text-green-700 font-medium">Conectado</span>
                  </div>
                )}
                <button onClick={() => deleteAccount(acc.id, acc.name)}
                  className="border border-red-200 text-red-500 text-xs py-2 px-3 rounded-lg hover:bg-red-50">
                  <Trash2 size={14} />
                </button>
              </div>

              {/* Fila secundaria: Verificar + Reconectar */}
              <div className="flex gap-2">
                <button onClick={() => checkStatus(acc.id)} disabled={verifying === acc.id}
                  className="flex-1 border border-gray-200 text-gray-600 text-xs py-1.5 rounded-lg hover:bg-gray-50 disabled:opacity-50 font-medium flex items-center justify-center">
                  {verifying === acc.id ? 'Verificando...' : <><RefreshCw size={14} className="mr-1.5" />Verificar</>}
                </button>
                {acc.provider === 'baileys' && (
                  <button onClick={() => reconnect(acc.id)} disabled={reconnecting === acc.id}
                    className="flex-1 border border-blue-200 text-blue-600 text-xs py-1.5 rounded-lg hover:bg-blue-50 disabled:opacity-50 font-medium flex items-center justify-center">
                    {reconnecting === acc.id ? 'Reconectando...' : <><RotateCcw size={14} className="mr-1.5" />Reconectar</>}
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}

        {accounts.length === 0 && (
          <div className="col-span-3 text-center py-20">
            <p className="text-5xl mb-4">📱</p>
            <p className="text-lg font-semibold text-gray-700">Sin números WhatsApp configurados</p>
            <p className="text-sm text-gray-400 mt-2 max-w-md mx-auto">
              Agrega el primer número haciendo clic en "Agregar número". Necesitarás tener Evolution API instalado en tu servidor.
            </p>
            <button onClick={() => setShowForm(true)}
              className="mt-6 bg-green-600 text-white px-6 py-2.5 rounded-xl text-sm font-medium hover:bg-green-700">
              + Agregar primer número
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
