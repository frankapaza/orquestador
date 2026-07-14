'use client'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import api from '../../../lib/api'
import { GuidePanel } from '../../../components/ui/GuidePanel'
import { HelpTooltip } from '../../../components/ui/HelpTooltip'
import { PageHeader } from '../../../components/ui/PageHeader'
import { SectionCard } from '../../../components/ui/section-card'
import { EmptyState } from '../../../components/ui/empty-state'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import { CountryPhoneInput, Flag, DEFAULT_COUNTRY, resolveCountry, nationalNumber } from '@/components/ui/phone-input'
import { SelectMenu } from '@/components/ui/select-menu'
import {
  Smartphone, Pencil, Trash2, RefreshCw, Save, Globe, User, Plus,
  Loader2, Webhook, ChevronDown, ChevronUp, CheckCircle, XCircle, Users, X, Clock, Gauge,
} from '../../../components/ui/icons'

const EMPTY = {
  name: '', gateway_url: '', api_key: '',
  daily_limit: 100, delay_min: 5, delay_max: 15,
  active_hours_start: '08:00', active_hours_end: '20:00',
  assigned_member_id: null,
}

const GUIDE_STEPS = [
  'Descarga e instala <strong>Android SMS Gateway</strong> en el teléfono corporativo desde <a href="https://github.com/capcom6/android-sms-gateway/releases" target="_blank" class="underline text-jungle-green-700">GitHub Releases</a> (archivo .apk).',
  'Abre la app en el teléfono. Verás la <strong>URL local</strong> del gateway (ej: <code class="bg-muted px-1 rounded text-xs">http://192.168.1.50:8080</code>). Si necesitas acceso desde internet, usa un túnel como <strong>ngrok</strong>.',
  'Si configuraste un <strong>usuario y contraseña</strong> en la app, genera un token Bearer en la sección de autenticación de la app y cópialo como API Key.',
  'En Kubo, haz clic en <strong>"+ Agregar teléfono"</strong>, completa los datos y guarda. El sistema verificará automáticamente si el gateway responde.',
  'Configura el <strong>webhook de SMS entrantes</strong> en la app Android apuntando a: <code class="bg-muted px-1 rounded text-xs">https://tu-servidor/webhooks/sms/{id-de-la-cuenta}</code>',
]

const WEBHOOK_EXAMPLE = `// Configurar en Android SMS Gateway -> Webhooks:
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

// Número con bandera + nacional
function PhoneDisplay({ phone }) {
  if (!phone) return <span className="text-sm text-muted-foreground">Sin número</span>
  const c = resolveCountry({ phone })
  const natl = nationalNumber(phone, c)
  return (
    <span className="inline-flex items-center gap-2">
      {c && <Flag code={c.code} />}
      <span className="font-mono text-sm font-medium text-foreground">{c ? `${c.dial} ${natl}` : phone}</span>
    </span>
  )
}

export default function SmsAccountsPage() {
  const [accounts, setAccounts]       = useState([])
  const [members, setMembers]         = useState([])
  const [showForm, setShowForm]       = useState(false)
  const [editingId, setEditingId]     = useState(null)
  const [form, setForm]               = useState(EMPTY)
  const [phoneCountry, setPhoneCountry] = useState(DEFAULT_COUNTRY)
  const [phoneNum, setPhoneNum]         = useState('')
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState(null)
  const [pinging, setPinging]         = useState(null)
  const [pingResult, setPingResult]   = useState({})
  const [whBusy, setWhBusy]           = useState(null)
  const [whResult, setWhResult]       = useState({})
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
      gateway_url:        acc.gateway_url,
      api_key:            '',
      daily_limit:        acc.daily_limit,
      delay_min:          acc.delay_min,
      delay_max:          acc.delay_max,
      active_hours_start: acc.active_hours_start?.slice(0, 5) ?? '08:00',
      active_hours_end:   acc.active_hours_end?.slice(0, 5)   ?? '20:00',
      assigned_member_id: acc.assigned_member_id ?? null,
    })
    const c = resolveCountry({ phone: acc.phone_number }) ?? DEFAULT_COUNTRY
    setPhoneCountry(c)
    setPhoneNum(nationalNumber(acc.phone_number ?? '', c))
    setEditingId(acc.id)
    setShowForm(true)
    setError(null)
  }

  function closeForm() {
    setShowForm(false)
    setEditingId(null)
    setForm(EMPTY)
    setPhoneCountry(DEFAULT_COUNTRY)
    setPhoneNum('')
    setError(null)
  }

  async function submit(e) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const digits = phoneNum.replace(/\D/g, '')
      const payload = {
        name:               form.name,
        phone_number:       `${phoneCountry.dial}${digits}`,
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

  async function registerWebhook(id) {
    setWhBusy(id)
    setWhResult(r => ({ ...r, [id]: null }))
    try {
      const r = await api.post(`/sms/accounts/${id}/webhook/register`)
      setWhResult(prev => ({ ...prev, [id]: { ok: true, url: r.data.url } }))
    } catch (err) {
      const d = err.response?.data
      setWhResult(prev => ({ ...prev, [id]: { ok: false, url: d?.url, error: d?.error ?? 'No se pudo registrar el webhook' } }))
    } finally {
      setWhBusy(null)
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
    total:    accounts.length,
    online:   accounts.filter(a => a.is_online).length,
    assigned: accounts.filter(a => a.assigned_member_id).length,
  }

  const inputCls = 'h-[52px] rounded-xl border-transparent bg-muted/60 text-base shadow-none transition-colors focus-visible:border-ring focus-visible:bg-background focus-visible:ring-0'
  const selectCls = 'flex h-[52px] w-full rounded-xl border-transparent bg-muted/60 px-4 text-base text-foreground shadow-none transition-colors focus-visible:border-ring focus-visible:bg-background focus-visible:outline-none focus-visible:ring-0'

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        icon={Smartphone}
        title="Cuentas SMS"
        description="Teléfonos Android corporativos con Android SMS Gateway. El administrador configura y asigna los números."
        action={
          <Button onClick={() => setShowForm(true)}>
            <Plus size={16} strokeWidth={2} /> Agregar teléfono
          </Button>
        }
      />

      <GuidePanel
        title="¿Cómo configurar el gateway SMS en un teléfono Android?"
        steps={GUIDE_STEPS}
        note="El teléfono debe permanecer encendido, conectado a internet y con la app abierta para que el gateway funcione. Se recomienda desactivar el ahorro de batería para la app."
      />

      {/* Instrucciones webhook entrante */}
      <SectionCard noPadding>
        <button onClick={() => setShowWebhook(o => !o)} className="flex w-full items-center justify-between px-5 py-4 text-left">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-jungle-green-50 text-jungle-green-600">
              <Webhook size={18} strokeWidth={2} />
            </span>
            <span className="text-sm font-medium text-foreground">Cómo configurar SMS entrantes (respuestas al inbox)</span>
          </div>
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            {showWebhook ? <><ChevronUp size={14} /> Ocultar</> : <><ChevronDown size={14} /> Ver instrucciones</>}
          </span>
        </button>
        {showWebhook && (
          <pre className="overflow-x-auto border-t bg-muted/40 px-5 py-4 text-xs leading-relaxed text-muted-foreground">{WEBHOOK_EXAMPLE}</pre>
        )}
      </SectionCard>

      {/* Resumen compacto */}
      <div className="grid grid-cols-3 divide-x overflow-hidden rounded-2xl border bg-card">
        {[
          { Icon: Smartphone, label: 'Teléfonos', value: stats.total, tone: 'bg-jungle-green-50 text-jungle-green-600' },
          { Icon: RefreshCw, label: 'Online ahora', value: stats.online, tone: 'bg-blue-50 text-blue-600' },
          { Icon: Users, label: 'Asignados', value: stats.assigned, tone: 'bg-violet-50 text-violet-600' },
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

      {/* ── Modal crear/editar ─────────────────────────────────────────────── */}
      {showForm && createPortal(
        <div className="modal-overlay fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div className="modal-content flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border bg-card shadow-xl">
            <div className="flex items-center gap-3 border-b px-6 py-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-jungle-green-50 text-jungle-green-600">
                {editingId ? <Pencil size={18} strokeWidth={1.75} /> : <Smartphone size={20} strokeWidth={1.75} />}
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-semibold text-foreground">{editingId ? 'Editar teléfono SMS' : 'Nuevo teléfono SMS'}</h2>
                <p className="truncate text-xs text-muted-foreground">
                  {editingId ? 'Deja API Key vacío para no cambiarla.' : 'Necesitas Android SMS Gateway corriendo en el teléfono.'}
                </p>
              </div>
              <Button variant="ghost" size="icon" onClick={closeForm} aria-label="Cerrar"><X size={18} strokeWidth={1.75} /></Button>
            </div>

            {error && (
              <div className="mx-6 mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
            )}

            <form onSubmit={submit} className="space-y-5 overflow-y-auto p-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="flex items-center text-foreground">Nombre descriptivo <HelpTooltip text="Nombre interno. Ej: 'Celular corporativo 1' o 'Asesor María'" /></Label>
                  <Input {...field('name')} required placeholder="Ej: Celular corporativo 1" className={inputCls} />
                </div>
                <div className="space-y-1.5">
                  <Label className="flex items-center text-foreground">Número de teléfono <HelpTooltip text="El número de la SIM. Selecciona el país y escribe el número sin el código." /></Label>
                  <CountryPhoneInput country={phoneCountry} setCountry={setPhoneCountry} number={phoneNum} setNumber={setPhoneNum} placeholder="911 123 456" />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="flex items-center text-foreground">URL del gateway <HelpTooltip text="La URL que muestra la app Android SMS Gateway. En red local usa la IP interna; para internet usa ngrok." /></Label>
                <div className="relative">
                  <Globe className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground" />
                  <Input {...field('gateway_url')} required type="url" placeholder="http://192.168.1.50:8080" className={`${inputCls} pl-11`} />
                </div>
                <p className="text-xs text-muted-foreground">
                  Para acceso externo: <span className="rounded bg-muted px-1 font-mono">ngrok http 8080</span> y copia la URL pública
                </p>
              </div>

              <div className="space-y-1.5">
                <Label className="flex items-center text-foreground">API Key <HelpTooltip text="Token de la app. En Android SMS Gateway → Configuración → API Key. Déjalo vacío si no tiene autenticación." /></Label>
                <Input {...field('api_key')} type="password" placeholder="Dejar vacío si no tiene autenticación" className={inputCls} />
              </div>

              <div className="space-y-3 rounded-xl bg-muted/40 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Límites y horarios de envío</p>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <Label className="flex items-center text-xs text-muted-foreground">Límite diario <HelpTooltip text="Máximo de SMS por día. Depende del plan de la SIM." /></Label>
                    <Input {...field('daily_limit')} type="number" min="1" className={inputCls} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="flex items-center text-xs text-muted-foreground">Delay mín (seg) <HelpTooltip text="Segundos mínimos entre SMS." /></Label>
                    <Input {...field('delay_min')} type="number" min="0" className={inputCls} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="flex items-center text-xs text-muted-foreground">Delay máx (seg) <HelpTooltip text="El sistema elige un valor aleatorio entre mín y máx." /></Label>
                    <Input {...field('delay_max')} type="number" min="0" className={inputCls} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="flex items-center text-xs text-muted-foreground">Hora inicio <HelpTooltip text="Solo enviará SMS a partir de esta hora." /></Label>
                    <Input {...field('active_hours_start')} type="time" className={inputCls} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="flex items-center text-xs text-muted-foreground">Hora fin <HelpTooltip text="Hora límite para envíos." /></Label>
                    <Input {...field('active_hours_end')} type="time" className={inputCls} />
                  </div>
                </div>
              </div>

              {members.length > 0 && (
                <div className="space-y-1.5">
                  <Label className="flex items-center text-foreground">Asignar a asesor <HelpTooltip text="El asesor podrá ver el estado en 'Mi teléfono'. Sin asignar = solo campañas." /></Label>
                  <select
                    value={form.assigned_member_id ?? ''}
                    onChange={e => setForm(f => ({ ...f, assigned_member_id: e.target.value || null }))}
                    className={selectCls}>
                    <option value="">Sin asignar (solo campañas)</option>
                    {members.map(m => (<option key={m.id} value={m.id}>{m.name} ({m.email})</option>))}
                  </select>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <Button type="submit" disabled={loading} className="flex-1">
                  {loading ? <><Loader2 size={16} className="animate-spin" /> Guardando...</> : <><Save size={16} strokeWidth={2} /> {editingId ? 'Guardar cambios' : 'Guardar teléfono'}</>}
                </Button>
                <Button type="button" variant="outline" onClick={closeForm} className="flex-1">Cancelar</Button>
              </div>
            </form>
          </div>
        </div>,
        document.body,
      )}

      {/* ── Cards ──────────────────────────────────────────────────────────── */}
      {accounts.length === 0 ? (
        <SectionCard>
          <EmptyState
            icon={Smartphone}
            title="Sin teléfonos SMS configurados"
            description="Instala Android SMS Gateway en un teléfono corporativo y agrégalo aquí para empezar a enviar y recibir SMS."
            action={
              <Button onClick={() => setShowForm(true)}>
                <Plus size={16} strokeWidth={2} /> Agregar primer teléfono
              </Button>
            }
          />
        </SectionCard>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {accounts.map(acc => (
            <div key={acc.id} className={`flex flex-col overflow-hidden rounded-2xl border bg-card shadow-sm transition-all hover:shadow-md ${acc.is_online ? 'border-jungle-green-200' : 'border-border'}`}>
              {/* Cabecera */}
              <div className="flex items-start justify-between gap-2 p-5 pb-4">
                <div className="flex min-w-0 items-center gap-3">
                  <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${acc.is_online ? 'bg-jungle-green-100 text-jungle-green-600' : 'bg-muted text-muted-foreground'}`}>
                    <Smartphone size={20} strokeWidth={1.75} />
                  </div>
                  <p className="truncate text-sm font-semibold text-foreground">{acc.name}</p>
                </div>
              </div>

              {/* Número + estado */}
              <div className="mx-5 mb-4 flex items-center justify-between gap-2 rounded-xl bg-muted/40 px-4 py-3">
                <PhoneDisplay phone={acc.phone_number} />
                <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${acc.is_online ? 'bg-jungle-green-100 text-jungle-green-700' : 'bg-muted text-muted-foreground'}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${acc.is_online ? 'animate-pulse bg-jungle-green-500' : 'bg-muted-foreground/40'}`} />
                  {acc.is_online ? 'Online' : 'Offline'}
                </span>
              </div>

              {/* Alerta: credenciales (api_key) duplicadas → mismo teléfono/SIM */}
              {acc.shares_apikey && (
                <div className="mx-5 mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  <span aria-hidden>⚠</span>
                  <span>Comparte credenciales (api_key) con <strong>{acc.shares_with.join(', ')}</strong> → todas envían desde el mismo teléfono/SIM. Usa credenciales distintas por número.</span>
                </div>
              )}

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

              {/* URL gateway */}
              <div className="mx-5 mb-4 flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2">
                <Globe size={14} className="shrink-0 text-muted-foreground" />
                <p className="truncate font-mono text-xs text-muted-foreground" title={acc.gateway_url}>{acc.gateway_url}</p>
              </div>

              {/* Asignación */}
              <div className="mx-5 mb-4">
                <label className="mb-1.5 flex items-center gap-1 text-xs font-medium text-muted-foreground">
                  Asignado a <HelpTooltip text="Asesor que usa este número. Lo ve desde 'Mi teléfono'." />
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

              {/* Webhook entrante */}
              <div className="mx-5 mb-4 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2">
                <p className="mb-0.5 text-xs font-medium text-amber-700">URL para SMS entrantes:</p>
                <p className="break-all font-mono text-xs text-amber-600">/webhooks/sms/{acc.id}</p>
              </div>

              {/* Resultado del ping */}
              {pingResult[acc.id] !== undefined && pingResult[acc.id] !== null && (
                <div className={`mx-5 mb-3 flex items-start gap-1.5 rounded-lg px-3 py-2 text-xs ${pingResult[acc.id] ? 'border border-jungle-green-200 bg-jungle-green-50 text-jungle-green-700' : 'border border-red-200 bg-red-50 text-red-700'}`}>
                  {pingResult[acc.id] ? <><CheckCircle size={14} className="mt-0.5 shrink-0" /> Gateway responde correctamente</> : <><XCircle size={14} className="mt-0.5 shrink-0" /> El gateway no responde, verifica que la app esté abierta y conectada</>}
                </div>
              )}

              {/* Resultado del registro de webhook (muestra la URL real que quedó
                  registrada en el gateway → si sale localhost, TRACKING_BASE_URL está mal) */}
              {whResult[acc.id] && (
                <div className={`mx-5 mb-3 rounded-lg px-3 py-2 text-xs ${whResult[acc.id].ok ? 'border border-jungle-green-200 bg-jungle-green-50 text-jungle-green-700' : 'border border-red-200 bg-red-50 text-red-700'}`}>
                  <p className="flex items-start gap-1.5">
                    {whResult[acc.id].ok
                      ? <><CheckCircle size={14} className="mt-0.5 shrink-0" /> Webhook registrado en el gateway</>
                      : <><XCircle size={14} className="mt-0.5 shrink-0" /> {whResult[acc.id].error}</>}
                  </p>
                  {whResult[acc.id].url && <p className="mt-1 break-all font-mono text-[11px] opacity-80">{whResult[acc.id].url}</p>}
                </div>
              )}

              {/* Acciones */}
              <div className="mt-auto space-y-2 border-t bg-muted/20 p-4">
                <Button variant="outline" size="sm" className="w-full" onClick={() => ping(acc.id)} disabled={pinging === acc.id}>
                  {pinging === acc.id ? <><Loader2 size={14} className="animate-spin" /> Verificando...</> : <><RefreshCw size={14} /> Verificar conexión</>}
                </Button>
                <Button variant="outline" size="sm" className="w-full" onClick={() => registerWebhook(acc.id)} disabled={whBusy === acc.id}>
                  {whBusy === acc.id ? <><Loader2 size={14} className="animate-spin" /> Registrando...</> : <><Webhook size={14} /> Registrar webhook entrante</>}
                </Button>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => openEdit(acc)}>
                    <Pencil size={14} /> Editar
                  </Button>
                  <Button variant="outline" size="sm" className="border-red-200 px-3 text-red-500 hover:bg-red-50 hover:text-red-600" onClick={() => deleteAccount(acc.id, acc.name)} aria-label="Eliminar">
                    <Trash2 size={14} />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
