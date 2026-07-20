'use client'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import api from '../../../lib/api'
import { GuidePanel }  from '../../../components/ui/GuidePanel'
import { HelpTooltip } from '../../../components/ui/HelpTooltip'
import { PageHeader }   from '../../../components/ui/PageHeader'
import { SectionCard }  from '@/components/ui/section-card'
import { EmptyState }   from '@/components/ui/empty-state'
import { Button }       from '@/components/ui/button'
import { Input }        from '@/components/ui/input'
import { CountryPhoneInput, Flag, DEFAULT_COUNTRY, resolveCountry, nationalNumber } from '@/components/ui/phone-input'
import { SelectMenu } from '@/components/ui/select-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { PhoneCall, QrCode, RefreshCw, RotateCcw, Trash2, Save, Zap, Link2, User, Plus, CheckCircle, Loader2, Smartphone, Wifi, X, Clock, Gauge, ChevronDown, Megaphone, MessageCircle } from '../../../components/ui/icons'

// Tipo de número: Individual (conversaciones 1 a 1) o Campaña (envíos masivos)
const ROLE_OPTIONS = [
  { value: 'campaign', label: 'Campaña',    Icon: Megaphone,     desc: 'Número dedicado a envíos masivos de campañas.' },
  { value: 'advisor',  label: 'Individual',  Icon: MessageCircle, desc: 'Conversaciones 1 a 1 en el Inbox. Puede asignarse a un asesor.' },
]
const ROLE_META = {
  campaign: { label: 'Campaña',   Icon: Megaphone,     badge: 'bg-violet-100 text-violet-700', tone: 'text-violet-600', desc: 'Números para envíos masivos' },
  advisor:  { label: 'Individual', Icon: MessageCircle, badge: 'bg-blue-100 text-blue-700',     tone: 'text-blue-600',   desc: 'Números para conversaciones 1 a 1' },
}

const EMPTY = {
  provider: 'baileys',
  name: '', instance_name: '', evolution_url: '', evolution_api_key: '',
  daily_limit: 200, delay_min: 10, delay_max: 30,
  active_hours_start: '08:00', active_hours_end: '20:00', role: 'campaign',
  assigned_member_id: null,
}

const GUIDE_STEPS = [
  'Instala <strong>Evolution API</strong> en tu servidor usando Docker: <code class="bg-jungle-green-100 px-1 rounded text-xs">docker run -p 8080:8080 atendai/evolution-api</code>',
  'Copia la <strong>URL del servidor</strong> (ej: <em>https://evolution.tuempresa.com</em>) y la <strong>API Key</strong> que configuraste.',
  'Haz clic en <strong>"+ Agregar número"</strong>, completa el formulario y guarda.',
  'Una vez creada la cuenta, haz clic en <strong>"Conectar QR"</strong> y escanea el código con WhatsApp en el teléfono.',
  'Si es una cuenta de asesor, <strong>asígnala al miembro</strong> correspondiente usando el selector. El asesor solo verá su número.',
]

const inputCls = "h-[52px] rounded-xl border-transparent bg-muted/60 text-base shadow-none transition-colors focus-visible:border-ring focus-visible:bg-background focus-visible:ring-0"
const labelCls = "flex items-center text-xs font-semibold text-foreground"
const selectCls = "mt-1.5 w-full rounded-xl border-transparent bg-muted/60 px-3 py-2.5 text-sm transition-colors focus:border-ring focus:bg-background focus:outline-none focus:ring-0"

// Muestra el número del contacto con bandera + nacional
function PhoneDisplay({ phone, className = '' }) {
  if (!phone) return <span className="text-sm text-muted-foreground">Sin número vinculado</span>
  const c = resolveCountry({ phone })
  const natl = nationalNumber(phone, c)
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      {c && <Flag code={c.code} />}
      <span className="font-mono text-sm font-medium text-foreground">{c ? `${c.dial} ${natl}` : phone}</span>
    </span>
  )
}

// Esqueleto de card mientras cargan los números
function SkeletonCard() {
  return (
    <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <div className="flex items-center gap-3 p-5 pb-4">
        <Skeleton className="h-11 w-11 rounded-xl" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3.5 w-28" />
          <Skeleton className="h-3 w-20" />
        </div>
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
      <Skeleton className="mx-5 mb-4 h-12 rounded-xl" />
      <div className="mx-5 mb-4 grid grid-cols-3 gap-2">
        <Skeleton className="h-12 rounded-lg" />
        <Skeleton className="h-12 rounded-lg" />
        <Skeleton className="h-12 rounded-lg" />
      </div>
      <div className="mx-5 mb-4 space-y-1.5">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-11 rounded-xl" />
      </div>
      <div className="space-y-2 border-t bg-muted/20 p-4">
        <div className="flex gap-2">
          <Skeleton className="h-9 flex-1 rounded-lg" />
          <Skeleton className="h-9 w-11 rounded-lg" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 flex-1 rounded-lg" />
          <Skeleton className="h-9 flex-1 rounded-lg" />
        </div>
      </div>
    </div>
  )
}

export default function WhatsappAccountsPage() {
  const [accounts, setAccounts]       = useState([])
  const [members, setMembers]         = useState([])
  const [showForm, setShowForm]       = useState(false)
  const [form, setForm]               = useState(EMPTY)
  const [phoneCountry, setPhoneCountry] = useState(DEFAULT_COUNTRY)
  const [phoneNum, setPhoneNum]         = useState('')
  const [qrData, setQrData]             = useState(null)
  const [loadingQr, setLoadingQr]       = useState(false)
  const [qrPolling, setQrPolling]       = useState(null)
  const [pairCountry, setPairCountry]   = useState(DEFAULT_COUNTRY)
  const [pairNum, setPairNum]           = useState('')
  const [pairingLoading, setPairingLoading] = useState(false)
  const [pairingError, setPairingError] = useState(null)
  const [linkMethod, setLinkMethod]     = useState('qr')
  const [verifying, setVerifying]       = useState(null)
  const [reconnecting, setReconnecting] = useState(null)
  const [assigningId, setAssigningId]   = useState(null)
  const [loading, setLoading]           = useState(false)
  const [error, setError]               = useState(null)
  const [loadingAccounts, setLoadingAccounts] = useState(true)

  const load = async () => {
    const [accsRes, membersRes] = await Promise.all([
      api.get('/whatsapp/accounts'),
      api.get('/settings/team').catch(() => ({ data: [] })),
    ])
    setAccounts(accsRes.data)
    setMembers((membersRes.data ?? []).filter(m => !m.is_owner))

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

  useEffect(() => { load().finally(() => setLoadingAccounts(false)) }, [])

  async function submit(e) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const pdigits = phoneNum.replace(/\D/g, '')
      const payload = {
        provider:     form.provider,
        name:               form.name,
        instance_name:      form.instance_name.toLowerCase().trim(),
        phone_number:       pdigits ? `${phoneCountry.dial}${pdigits}` : undefined,
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
      setForm(EMPTY); setPhoneNum(''); setPhoneCountry(DEFAULT_COUNTRY)
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
    const c = resolveCountry({ phone: acc?.phone_number }) ?? DEFAULT_COUNTRY
    setPairCountry(c)
    setPairNum(nationalNumber(acc?.phone_number ?? '', c))
    setQrData({ accountId: id, status: 'starting', qrBase64: null, pairingCode: null, account: acc })
    await pollQr(id)
    setLoadingQr(null)
    const interval = setInterval(() => pollQr(id), 3000)
    setQrPolling(interval)
  }

  async function requestPairingCode() {
    const digits = pairNum.replace(/\D/g, '')
    const phone = digits ? `${pairCountry.dial}${digits}` : ''
    if (!phone) { setPairingError('Ingresa el número de teléfono'); return }
    setPairingLoading(true)
    setPairingError(null)
    stopQrPolling()
    try {
      const r = await api.post(`/whatsapp/accounts/${qrData.accountId}/pairing-code`, { phone_number: phone })
      setQrData(prev => ({ ...prev, pairingCode: r.data.pairing_code, status: 'awaiting_code' }))
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
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        icon={PhoneCall}
        title="Cuentas WhatsApp"
        description="Números conectados para enviar y recibir mensajes. Solo el administrador puede crearlos y asignarlos."
        action={
          <Button onClick={() => setShowForm(true)}>
            <Plus size={16} strokeWidth={2} /> Agregar número
          </Button>
        }
      />

      <GuidePanel
        title="¿Cómo configurar WhatsApp?"
        steps={GUIDE_STEPS}
        note="WhatsApp puede suspender números que envíen mensajes masivos sin delays. Configura siempre un delay mínimo de 10 segundos entre mensajes para simular comportamiento humano."
      />

      {/* Resumen compacto */}
      <div className="grid grid-cols-3 divide-x overflow-hidden rounded-2xl border bg-card">
        {[
          { Icon: Smartphone, label: 'Números', value: stats.total, tone: 'bg-jungle-green-50 text-jungle-green-600' },
          { Icon: Wifi, label: 'Conectados', value: stats.connected, tone: 'bg-jungle-green-50 text-jungle-green-600' },
          { Icon: User, label: 'Asignados', value: stats.assigned, tone: 'bg-violet-50 text-violet-600' },
        ].map(s => (
          <div key={s.label} className="flex items-center gap-3 p-5">
            <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${s.tone}`}>
              <s.Icon size={20} strokeWidth={2} />
            </span>
            <div>
              <p className="text-2xl font-bold leading-none tabular-nums text-foreground">{s.value}</p>
              <p className="mt-1 text-xs text-muted-foreground">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ── Modal crear cuenta ─────────────────────────────────────────────── */}
      {showForm && createPortal(
        <div className="modal-overlay fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div className="modal-content flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border bg-card shadow-xl">
            <div className="flex items-center gap-3 border-b px-6 py-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-jungle-green-50 text-jungle-green-600">
                <PhoneCall size={20} strokeWidth={1.75} />
              </span>
              <div className="flex-1">
                <h2 className="text-base font-semibold text-foreground">Nueva cuenta WhatsApp</h2>
                <p className="text-xs text-muted-foreground">Tras guardar podrás vincular el número por QR o código.</p>
              </div>
              <Button variant="ghost" size="icon" onClick={() => { setShowForm(false); setError(null) }} aria-label="Cerrar">
                <X size={18} strokeWidth={1.75} />
              </Button>
            </div>

            {error && (
              <div className="mx-6 mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
            )}

            <form onSubmit={submit} className="space-y-5 overflow-y-auto p-6">
              {/* Tipo de número: Individual o Campaña */}
              <div>
                <label className={`${labelCls} mb-2`}>
                  ¿Para qué usarás este número? <HelpTooltip text="Individual: conversaciones 1 a 1 en el Inbox (asignable a un asesor). Campaña: número dedicado a envíos masivos." />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {ROLE_OPTIONS.map(r => (
                    <button key={r.value} type="button"
                      onClick={() => setForm(f => ({ ...f, role: r.value, assigned_member_id: r.value === 'campaign' ? null : f.assigned_member_id }))}
                      className={`rounded-xl border-2 p-3 text-left transition-all ${
                        form.role === r.value ? 'border-jungle-green-500 bg-jungle-green-50' : 'border-border bg-card hover:border-jungle-green-200'
                      }`}>
                      <span className={`mb-1 block ${form.role === r.value ? 'text-jungle-green-600' : 'text-muted-foreground'}`}><r.Icon size={20} strokeWidth={1.75} /></span>
                      <p className="text-sm font-semibold text-foreground">{r.label}</p>
                      <p className="mt-0.5 text-xs leading-tight text-muted-foreground">{r.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Motor de conexión */}
              <div>
                <label className={`${labelCls} mb-2`}>
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
                          ? 'border-jungle-green-500 bg-jungle-green-50'
                          : 'border-border bg-card hover:border-jungle-green-200'
                      }`}>
                      <span className={`mb-1 block ${form.provider === p.value ? 'text-jungle-green-600' : 'text-muted-foreground'}`}><p.Icon size={20} strokeWidth={1.75} /></span>
                      <p className="text-sm font-semibold text-foreground">{p.label}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{p.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>
                    Nombre descriptivo <HelpTooltip text="Nombre interno. Ej: 'Asesor Juan' o 'Línea ventas'" />
                  </label>
                  <Input {...field('name')} required placeholder="Ej: Asesor Juan" className={`mt-1.5 ${inputCls}`} />
                </div>
                <div>
                  <label className={labelCls}>
                    ID de instancia <HelpTooltip text="Identificador único. Solo letras minúsculas, números y guiones. Ej: asesor-juan" />
                  </label>
                  <Input
                    value={form.instance_name}
                    onChange={e => setForm(f => ({ ...f, instance_name: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '-') }))}
                    required placeholder="asesor-juan"
                    className={`mt-1.5 font-mono ${inputCls}`} />
                  <p className="mt-1 text-xs text-muted-foreground">Solo minúsculas, números y guiones</p>
                </div>
              </div>

              {form.provider === 'evolution' && (
                <>
                  <div>
                    <label className={labelCls}>
                      URL del servidor Evolution API <HelpTooltip text="URL donde corre tu Evolution API. Ej: https://evolution.tuempresa.com" />
                    </label>
                    <Input {...field('evolution_url')} required type="url" placeholder="https://evolution.tuempresa.com" className={`mt-1.5 ${inputCls}`} />
                  </div>
                  <div>
                    <label className={labelCls}>
                      API Key de Evolution <HelpTooltip text="AUTHENTICATION_API_KEY del .env de Evolution" />
                    </label>
                    <Input {...field('evolution_api_key')} required type="password" placeholder="••••••••" className={`mt-1.5 ${inputCls}`} />
                  </div>
                </>
              )}

              <div>
                <label className={`${labelCls} mb-1.5`}>
                  Número de teléfono <HelpTooltip text="El número del WhatsApp. Necesario para vincular con el código de 8 dígitos en vez del QR." />
                </label>
                <CountryPhoneInput country={phoneCountry} setCountry={setPhoneCountry} number={phoneNum} setNumber={setPhoneNum} placeholder="910 462 070" />
              </div>

              {form.provider === 'baileys' && (
                <div className="rounded-xl border border-jungle-green-200 bg-jungle-green-50 px-4 py-3 text-sm text-jungle-green-700">
                  <Zap size={16} strokeWidth={2} className="mr-1 inline" /> <strong>Baileys</strong> corre dentro de Kubo. Al guardar podrás vincular por <strong>QR</strong> o por <strong>código de 8 dígitos</strong>.
                </div>
              )}

              <div className="space-y-3 rounded-xl bg-muted/40 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Límites y horarios de envío</p>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="flex items-center text-xs text-muted-foreground">Límite diario <HelpTooltip text="Máximo de mensajes por día. Recomendado: 200 para números nuevos." /></label>
                    <Input {...field('daily_limit')} type="number" min="1" className={`mt-1 ${inputCls}`} />
                  </div>
                  <div>
                    <label className="flex items-center text-xs text-muted-foreground">Delay mín (seg) <HelpTooltip text="Segundos mínimos entre mensajes. Simula comportamiento humano." /></label>
                    <Input {...field('delay_min')} type="number" min="0" className={`mt-1 ${inputCls}`} />
                  </div>
                  <div>
                    <label className="flex items-center text-xs text-muted-foreground">Delay máx (seg) <HelpTooltip text="Segundos máximos. El sistema elige un valor aleatorio entre mín y máx." /></label>
                    <Input {...field('delay_max')} type="number" min="0" className={`mt-1 ${inputCls}`} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="flex items-center text-xs text-muted-foreground">Hora inicio <HelpTooltip text="Solo enviará mensajes a partir de esta hora." /></label>
                    <Input {...field('active_hours_start')} type="time" className={`mt-1 ${inputCls}`} />
                  </div>
                  <div>
                    <label className="flex items-center text-xs text-muted-foreground">Hora fin <HelpTooltip text="Dejará de enviar mensajes pasada esta hora." /></label>
                    <Input {...field('active_hours_end')} type="time" className={`mt-1 ${inputCls}`} />
                  </div>
                </div>
              </div>

              {form.role === 'advisor' && members.length > 0 && (
                <div>
                  <label className={labelCls}>
                    Asignar a asesor <HelpTooltip text="El asesor podrá ver este número en 'Mi teléfono' y escanear el QR." />
                  </label>
                  <select
                    value={form.assigned_member_id ?? ''}
                    onChange={e => setForm(f => ({ ...f, assigned_member_id: e.target.value || null }))}
                    className={selectCls}>
                    <option value="">Sin asignar</option>
                    {members.map(m => (<option key={m.id} value={m.id}>{m.name} ({m.email})</option>))}
                  </select>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <Button type="submit" disabled={loading} className="flex-1">
                  {loading ? <><Loader2 size={16} className="animate-spin" /> Guardando...</> : <><Save size={16} strokeWidth={2} /> Guardar cuenta</>}
                </Button>
                <Button type="button" variant="outline" onClick={() => { setShowForm(false); setError(null) }} className="flex-1">
                  Cancelar
                </Button>
              </div>
            </form>
          </div>
        </div>,
        document.body,
      )}

      {/* ── Modal QR / vinculación ─────────────────────────────────────────── */}
      {qrData && createPortal(
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" onClick={closeQrModal}>
          <div className="w-full max-w-sm rounded-2xl border bg-card p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            {qrData.status === 'connected' ? (
              <div className="py-6 text-center">
                <span className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-jungle-green-100 text-jungle-green-600">
                  <CheckCircle size={36} strokeWidth={1.75} />
                </span>
                <p className="text-xl font-bold text-jungle-green-700">¡Conectado!</p>
                <p className="mt-2 text-sm text-muted-foreground">WhatsApp vinculado correctamente</p>
                <Button onClick={closeQrModal} className="mt-6 w-full">Cerrar</Button>
              </div>
            ) : (
              <>
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-base font-semibold text-foreground">Vincular WhatsApp</h2>
                  <Button variant="ghost" size="icon" onClick={closeQrModal} aria-label="Cerrar"><X size={18} strokeWidth={1.75} /></Button>
                </div>

                <div className="mb-5 grid grid-cols-2 gap-2">
                  {[['qr','Escanear QR'],['code','Código de 8 dígitos']].map(([m, lbl]) => (
                    <button key={m} type="button" onClick={() => setLinkMethod(m)}
                      className={`rounded-xl border-2 py-2 text-xs font-medium transition-colors ${
                        linkMethod === m ? 'border-jungle-green-500 bg-jungle-green-50 text-jungle-green-700' : 'border-border text-muted-foreground hover:border-jungle-green-200'
                      }`}>
                      {lbl}
                    </button>
                  ))}
                </div>

                {linkMethod === 'qr' && (
                  <>
                    <p className="mb-3 text-center text-xs text-muted-foreground">
                      WhatsApp, <strong>Dispositivos vinculados</strong>, <strong>Vincular dispositivo</strong>, escanea
                    </p>
                    {!qrData.qrBase64 ? (
                      <div className="flex h-44 flex-col items-center justify-center gap-3">
                        <Loader2 size={40} className="animate-spin text-jungle-green-600" />
                        <p className="text-sm text-muted-foreground">Generando QR...</p>
                      </div>
                    ) : (
                      <img src={qrData.qrBase64} alt="QR" className="w-full rounded-xl border-2 border-border" />
                    )}
                    <p className="mt-2 text-center text-xs text-muted-foreground">El QR se actualiza automáticamente cada 20s</p>
                  </>
                )}

                {linkMethod === 'code' && (
                  <>
                    <p className="mb-3 text-center text-xs text-muted-foreground">
                      WhatsApp, <strong>Dispositivos vinculados</strong>, <strong>Vincular con número</strong>, ingresa el código
                    </p>
                    {!qrData.pairingCode ? (
                      <div className="space-y-3">
                        <div>
                          <label className="mb-1.5 block text-xs font-semibold text-foreground">Número del teléfono a vincular</label>
                          <CountryPhoneInput country={pairCountry} setCountry={setPairCountry} number={pairNum} setNumber={setPairNum} placeholder="910 462 070" />
                        </div>
                        {pairingError && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{pairingError}</p>}
                        <Button onClick={requestPairingCode} disabled={pairingLoading} className="w-full">
                          {pairingLoading ? <><Loader2 size={16} className="animate-spin" /> Generando código...</> : 'Obtener código'}
                        </Button>
                      </div>
                    ) : (
                      <div className="text-center">
                        <p className="mb-3 text-xs text-muted-foreground">Ingresa este código en WhatsApp</p>
                        <div className="mb-3 rounded-xl bg-foreground px-6 py-4 font-mono text-3xl font-bold tracking-widest text-jungle-green-400">
                          {qrData.pairingCode}
                        </div>
                        <p className="text-xs text-muted-foreground">Tienes ~60 segundos para ingresarlo</p>
                        <button onClick={() => setQrData(prev => ({ ...prev, pairingCode: null }))}
                          className="mt-3 text-xs text-muted-foreground underline">Pedir otro código</button>
                      </div>
                    )}
                  </>
                )}

                <div className="mt-4 flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => disconnectAndReset(qrData.accountId)} className="flex-1">
                    <RotateCcw size={14} /> Reiniciar sesión
                  </Button>
                  <Button variant="outline" size="sm" onClick={closeQrModal} className="flex-1">Cerrar</Button>
                </div>
              </>
            )}
          </div>
        </div>,
        document.body,
      )}

      {/* ── Cards de cuentas ───────────────────────────────────────────────── */}
      {loadingAccounts ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map(i => <SkeletonCard key={i} />)}
        </div>
      ) : accounts.length === 0 ? (
        <SectionCard>
          <EmptyState
            icon={Smartphone}
            title="Sin números WhatsApp configurados"
            description="Agrega el primer número. Podrás vincularlo por QR o por código de 8 dígitos."
            action={
              <Button onClick={() => setShowForm(true)}>
                <Plus size={16} strokeWidth={2} /> Agregar primer número
              </Button>
            }
          />
        </SectionCard>
      ) : (
        <div className="space-y-8">
          {['campaign', 'advisor'].map(role => {
            const list = accounts.filter(a => (a.role ?? 'campaign') === role)
            if (!list.length) return null
            const gm = ROLE_META[role]
            return (
              <div key={role} className="space-y-4">
                <div className="flex items-center gap-2">
                  <gm.Icon size={18} strokeWidth={1.75} className={gm.tone} />
                  <h2 className="text-base font-semibold text-foreground">{gm.label}</h2>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">{list.length}</span>
                  <span className="hidden text-xs text-muted-foreground sm:inline">· {gm.desc}</span>
                </div>
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
                  {list.map(acc => (
                    <div key={acc.id} className={`flex flex-col overflow-hidden rounded-2xl border bg-card shadow-sm transition-all hover:shadow-md ${acc.is_connected ? 'border-jungle-green-200' : 'border-border'}`}>
              {/* Cabecera */}
              <div className="flex items-start justify-between gap-2 p-5 pb-4">
                <div className="flex min-w-0 items-center gap-3">
                  <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${acc.is_connected ? 'bg-jungle-green-100 text-jungle-green-600' : 'bg-muted text-muted-foreground'}`}>
                    <PhoneCall size={20} strokeWidth={1.75} />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">{acc.name}</p>
                    <p className="truncate font-mono text-xs text-muted-foreground">{acc.instance_name}</p>
                  </div>
                </div>
                {(() => { const rm = ROLE_META[acc.role] ?? ROLE_META.campaign; return (
                  <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${rm.badge}`}>
                    <rm.Icon size={10} strokeWidth={2} /> {rm.label}
                  </span>
                )})()}
              </div>

              {/* Número de teléfono (destacado) + estado */}
              <div className="mx-5 mb-4 flex items-center justify-between gap-2 rounded-xl bg-muted/40 px-4 py-3">
                <PhoneDisplay phone={acc.phone_number} />
                <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${acc.is_connected ? 'bg-jungle-green-100 text-jungle-green-700' : 'bg-muted text-muted-foreground'}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${acc.is_connected ? 'animate-pulse bg-jungle-green-500' : 'bg-muted-foreground/40'}`} />
                  {acc.is_connected ? 'Conectado' : 'Sin conectar'}
                </span>
              </div>

              {/* Métricas */}
              <div className="mx-5 mb-4 grid grid-cols-3 gap-2">
                <div className="rounded-lg bg-muted/40 p-2 text-center">
                  <p className="flex items-center justify-center gap-1 text-[11px] text-muted-foreground"><Gauge size={11} /> Hoy</p>
                  <p className="text-sm font-bold tabular-nums text-foreground">{acc.sent_today}/{acc.daily_limit}</p>
                </div>
                <div className="rounded-lg bg-muted/40 p-2 text-center">
                  <p className="text-[11px] text-muted-foreground">Delay</p>
                  <p className="text-sm font-bold tabular-nums text-foreground">{acc.delay_min}-{acc.delay_max}s</p>
                </div>
                <div className="rounded-lg bg-muted/40 p-2 text-center">
                  <p className="flex items-center justify-center gap-1 text-[11px] text-muted-foreground"><Clock size={11} /> Horario</p>
                  <p className="text-sm font-bold tabular-nums text-foreground">{acc.active_hours_start?.slice(0,5)}-{acc.active_hours_end?.slice(0,5)}</p>
                </div>
              </div>

              {/* Asignación */}
              <div className="mx-5 mb-4">
                <label className="mb-1.5 flex items-center gap-1 text-xs font-medium text-muted-foreground">
                  Asignado a <HelpTooltip text="El asesor asignado puede escanear el QR desde 'Mi teléfono'" />
                </label>
                <SelectMenu
                  value={acc.assigned_member_id ?? ''}
                  onChange={v => assign(acc.id, v)}
                  disabled={assigningId === acc.id}
                  loading={assigningId === acc.id}
                  placeholder="Sin asignar"
                  leadingIcon={
                    <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${acc.assigned_member_id ? 'bg-jungle-green-100 text-jungle-green-700' : 'bg-muted text-muted-foreground'}`}>
                      <User size={13} strokeWidth={2} />
                    </span>
                  }
                  options={[
                    { value: '', label: 'Sin asignar' },
                    ...members.map(m => ({
                      value: m.id,
                      label: m.name,
                      icon: <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-jungle-green-100 text-[11px] font-semibold uppercase text-jungle-green-700">{m.name?.[0] ?? '?'}</span>,
                    })),
                  ]}
                />
              </div>

              {/* Acciones */}
              <div className="mt-auto space-y-2 border-t bg-muted/20 p-4">
                <div className="flex gap-2">
                  {!acc.is_connected ? (
                    <Button onClick={() => showQr(acc.id, acc)} disabled={loadingQr === acc.id} size="sm" className="flex-1">
                      {loadingQr === acc.id ? <><Loader2 size={14} className="animate-spin" /> Cargando...</> : <><QrCode size={14} /> Vincular</>}
                    </Button>
                  ) : (
                    <Button variant="outline" size="sm" onClick={() => showQr(acc.id, acc)} className="flex-1 border-jungle-green-200 text-jungle-green-700 hover:bg-jungle-green-50">
                      <QrCode size={14} /> Ver vínculo
                    </Button>
                  )}
                  <Button variant="outline" size="sm" onClick={() => deleteAccount(acc.id, acc.name)}
                    className="border-red-200 px-3 text-red-500 hover:bg-red-50 hover:text-red-600" aria-label="Eliminar">
                    <Trash2 size={14} />
                  </Button>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => checkStatus(acc.id)} disabled={verifying === acc.id} className="flex-1">
                    {verifying === acc.id ? <><Loader2 size={14} className="animate-spin" /> Verificando...</> : <><RefreshCw size={14} /> Verificar</>}
                  </Button>
                  {acc.provider === 'baileys' && (
                    <Button variant="outline" size="sm" onClick={() => reconnect(acc.id)} disabled={reconnecting === acc.id}
                      className="flex-1 border-blue-200 text-blue-600 hover:bg-blue-50 hover:text-blue-700">
                      {reconnecting === acc.id ? <><Loader2 size={14} className="animate-spin" /> Reconectando...</> : <><RotateCcw size={14} /> Reconectar</>}
                    </Button>
                  )}
                </div>
              </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
