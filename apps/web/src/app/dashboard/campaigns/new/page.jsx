'use client'
import { useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import api from '../../../../lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { SelectMenu } from '@/components/ui/select-menu'
import {
  Megaphone, RotateCcw, ArrowLeft, ArrowRight, Check, FileText, Mail, MessageCircle,
  Smartphone, Users, Image, ClipboardList, Loader2, Info, AlertTriangle, Send, Bot, Download, CheckCircle,
} from '@/components/ui/icons'
import { cn } from '@/lib/utils'
import { smsSegments } from '@/lib/sms'

const STRATEGIES = [
  { value: 'smtp_own',  label: 'SMTP propio (rotación de cuentas)' },
  { value: 'sendgrid',  label: 'SendGrid' },
  { value: 'brevo',     label: 'Brevo' },
  { value: 'mailchimp', label: 'Mailchimp Transactional (Mandrill)' },
]

const CHANNELS = [
  { key: 'email',       label: 'Email',      desc: 'HTML, plantillas y seguimiento de aperturas',  Icon: Mail,          tint: 'amber' },
  { key: 'whatsapp',    label: 'WhatsApp',   desc: 'Mensaje rotando tus números conectados',        Icon: MessageCircle, tint: 'green' },
  { key: 'whatsapp_ai', label: 'WhatsApp IA',desc: 'Un asistente IA saluda y conversa por ti',       Icon: Bot,           tint: 'teal' },
  { key: 'sms',         label: 'SMS',        desc: 'Texto vía tus gateways SMS',                     Icon: Smartphone,    tint: 'violet' },
]
const CHANNEL_TINT = {
  amber:  { sel: 'border-amber-500 bg-amber-50', icon: 'bg-amber-100 text-amber-700' },
  green:  { sel: 'border-green-500 bg-green-50', icon: 'bg-green-100 text-green-700' },
  teal:   { sel: 'border-teal-500 bg-teal-50', icon: 'bg-teal-100 text-teal-700' },
  violet: { sel: 'border-violet-500 bg-violet-50', icon: 'bg-violet-100 text-violet-700' },
}

const fieldClass = 'h-[52px] rounded-xl border-transparent bg-muted/60 text-base shadow-none transition-colors focus-visible:border-ring focus-visible:bg-background focus-visible:ring-0'

// Número de WhatsApp para mostrar en el SMS anti-baneo. Quita el prefijo país 51
// de Perú cuando queda un móvil local de 9 dígitos (928502009), que es como la
// gente lo reconoce; en cualquier otro caso deja el número tal cual.
function waDisplayNumber(digits) {
  const d = String(digits || '').replace(/\D/g, '')
  return /^51\d{9}$/.test(d) ? d.slice(2) : d
}

function NewCampaignForm() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const fromId       = searchParams.get('from')

  const [step, setStep] = useState(0)
  const [lists, setLists] = useState([])
  const [integrations, setIntegrations] = useState([])
  const [templates, setTemplates] = useState([])
  const [templateId, setTemplateId] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingFrom, setLoadingFrom] = useState(!!fromId)
  const [error, setError] = useState('')

  // WhatsApp IA
  const [isAI, setIsAI] = useState(false)
  const [assistants, setAssistants] = useState([])
  const [waAccounts, setWaAccounts] = useState([])
  const [assistantId, setAssistantId] = useState('')
  const [selectedAccIds, setSelectedAccIds] = useState([])
  const [importInfo, setImportInfo] = useState(null) // { list_id, list_name, total, columns, variables_faltantes }
  const [importing, setImporting] = useState(false)
  const [recipientMode, setRecipientMode] = useState('list') // 'list' | 'upload' (para WA/SMS manual)
  const [templateLoading, setTemplateLoading] = useState(false)

  // SMS de seguimiento anti-baneo (viene de la campaña de origen vía ?channel=sms&list_id=&wame=).
  // NO se usa link wa.me: los operadores bloquean los SMS con URLs (http/https). En su lugar
  // se inserta el número de WhatsApp del asistente en texto plano ({{whatsapp}}), para que el
  // cliente ESCRIBA él mismo (conversación iniciada por el cliente = anti-baneo).
  const [wameNumber, setWameNumber] = useState('')

  const [form, setForm] = useState({
    name: '', channel: 'email',
    subject: '', from_name: '', reply_to: '', strategy: 'smtp_own', html_content: '', text_content: '',
    content_text: '', media_url: '', media_caption: '',
    list_id: '', scheduled_at: '',
    settings: { delay_min_ms: 2000, delay_max_ms: 15000, rotate_accounts: true, track_opens: true, track_clicks: true, integration_id: '', send_to_all: true },
  })

  const isEmail = form.channel === 'email'
  const STEPS = isEmail ? ['Configuración', 'Contenido', 'Envío'] : ['Configuración', isAI ? 'Asistente' : 'Mensaje', 'Envío']

  useEffect(() => {
    api.get('/lists').then(r => setLists(r.data))
    api.get('/integrations').then(r => setIntegrations(r.data))
    api.get('/templates').then(r => setTemplates(r.data)).catch(() => {})

    if (fromId) {
      api.get(`/campaigns/${fromId}`).then(r => {
        const c = r.data
        setForm({
          name: c.name + ' (Reenvío)', channel: c.channel ?? 'email',
          subject: c.subject ?? '', from_name: c.from_name ?? '', reply_to: c.reply_to ?? '',
          strategy: c.strategy ?? 'smtp_own', html_content: c.html_content ?? '', text_content: c.text_content ?? '',
          content_text: c.content_text ?? '', media_url: c.media_url ?? '', media_caption: c.media_caption ?? '',
          list_id: c.list_id, scheduled_at: '',
          settings: {
            delay_min_ms: c.settings?.delay_min_ms ?? 2000, delay_max_ms: c.settings?.delay_max_ms ?? 15000,
            rotate_accounts: c.settings?.rotate_accounts ?? true, track_opens: c.settings?.track_opens ?? true,
            track_clicks: c.settings?.track_clicks ?? true, integration_id: c.settings?.integration_id ?? '',
            send_to_all: c.settings?.send_to_all ?? true,
          },
        })
      }).finally(() => setLoadingFrom(false))
    }
  }, [])

  useEffect(() => {
    if (!isAI) return
    api.get('/whatsapp/assistants')
      .then(r => { setAssistants(r.data.assistants ?? []); setWaAccounts(r.data.accounts ?? []) })
      .catch(() => {})
  }, [isAI])

  // SMS de seguimiento: llega desde el detalle de campaña con ?channel=sms&list_id=<id>&wame=<digits>
  useEffect(() => {
    const listIdParam  = searchParams.get('list_id')
    const channelParam = searchParams.get('channel')
    // Gate por list_id/channel (no por wame): si el número no se pudo resolver la
    // lista igual debe pre-cargarse, no caer al wizard de email por defecto.
    if (!listIdParam && !channelParam) return
    if (channelParam) pickChannel(channelParam)
    if (listIdParam) set('list_id', listIdParam)
    const waParam = searchParams.get('wame') || ''
    setWameNumber(waParam)
    // Mensaje anti-baneo por defecto: pide al cliente que ESCRIBA al WhatsApp (sin link).
    if (waParam) {
      set('content_text', `Hola {{cliente}}, no pudimos contactarte por WhatsApp. Escríbenos al WhatsApp ${waDisplayNumber(waParam)} y continuamos por ahí.`)
    }
  }, [])

  function set(field, value) { setForm(f => ({ ...f, [field]: value })) }
  function setSetting(field, value) { setForm(f => ({ ...f, settings: { ...f.settings, [field]: value } })) }

  function pickChannel(key) {
    const ai = key === 'whatsapp_ai'
    const ch = ai ? 'whatsapp' : key
    setStep(0); setError(''); setIsAI(ai)
    if (!ai) { setAssistantId(''); setSelectedAccIds([]); setImportInfo(null) }
    setForm(f => ({
      ...f, channel: ch,
      settings: {
        ...f.settings,
        // Mensajería usa delays más largos por defecto
        delay_min_ms: ch === 'email' ? 2000 : 8000,
        delay_max_ms: ch === 'email' ? 15000 : 25000,
      },
    }))
  }

  async function downloadTemplate() {
    if (!assistantId || templateLoading) return
    setTemplateLoading(true)
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('kubo_token') : null
      const base  = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1'
      const res   = await fetch(`${base}/whatsapp/assistants/${assistantId}/plantilla.xlsx`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('download failed')
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const asstName = assistants.find(x => x.id === assistantId)?.name ?? 'asistente'
      const link = document.createElement('a')
      link.href     = url
      link.download = `plantilla-${asstName.replace(/[^a-z0-9]/gi, '_')}.xlsx`
      link.click()
      URL.revokeObjectURL(url)
    } catch {
      alert('No se pudo descargar la plantilla')
    } finally { setTemplateLoading(false) }
  }

  async function uploadRecipients(file) {
    if (!file) return
    setImporting(true); setImportInfo(null)
    try {
      const fd = new FormData(); fd.append('file', file)
      const q = `?assistant_id=${assistantId}&name=${encodeURIComponent(form.name || 'Campaña')}`
      const r = await api.post(`/campaigns/import-recipients${q}`, fd)
      setImportInfo(r.data)
      set('list_id', r.data.list_id) // para WA/SMS manual: el envío usa form.list_id
    } catch (err) {
      setError(err?.response?.data?.error ?? 'Error al subir el archivo')
    } finally { setImporting(false) }
  }

  function loadTemplate(id) {
    setTemplateId(id)
    const t = templates.find(t => t.id === id)
    if (t) setForm(f => ({ ...f, subject: t.subject, from_name: t.from_name, html_content: t.html_content, text_content: t.text_content ?? f.text_content }))
  }

  function canGoNext() {
    if (step === 0) {
      if (!form.name) return false
      if (!isAI && !form.list_id) return false
      if (isEmail) {
        if (!form.subject || !form.from_name) return false
        if (form.strategy !== 'smtp_own') return !!form.settings.integration_id
      }
      return true
    }
    if (step === 1) {
      if (isAI) return !!assistantId && !!importInfo?.list_id && selectedAccIds.length > 0
      return isEmail ? form.html_content.trim().length > 0 : form.content_text.trim().length > 0
    }
    return true
  }

  async function submit() {
    if (isAI) {
      if (!assistantId) return setError('Selecciona un asistente')
      if (!importInfo?.list_id) return setError('Sube el Excel de destinatarios')
      if (selectedAccIds.length === 0) return setError('Selecciona al menos un número de WhatsApp')
    }
    setLoading(true); setError('')
    try {
      let payload
      if (isAI) {
        payload = {
          name: form.name, channel: 'whatsapp', assistant_id: assistantId, list_id: importInfo.list_id,
          settings: {
            delay_min_ms: form.settings.delay_min_ms, delay_max_ms: form.settings.delay_max_ms,
            send_to_all: true, wa_account_ids: selectedAccIds,
          },
        }
        if (form.scheduled_at) payload.scheduled_at = new Date(form.scheduled_at).toISOString()
      } else {
        payload = {
          name: form.name, channel: form.channel, list_id: form.list_id,
          settings: { delay_min_ms: form.settings.delay_min_ms, delay_max_ms: form.settings.delay_max_ms, send_to_all: form.settings.send_to_all },
        }
        if (form.scheduled_at) payload.scheduled_at = new Date(form.scheduled_at).toISOString()

        if (isEmail) {
          Object.assign(payload, {
            subject: form.subject, from_name: form.from_name, html_content: form.html_content, strategy: form.strategy,
          })
          if (form.reply_to) payload.reply_to = form.reply_to
          if (form.text_content) payload.text_content = form.text_content
          payload.settings = {
            ...payload.settings,
            rotate_accounts: form.settings.rotate_accounts, track_opens: form.settings.track_opens, track_clicks: form.settings.track_clicks,
          }
          if (form.settings.integration_id) payload.settings.integration_id = form.settings.integration_id
        } else {
          let contentText = form.content_text
          if (wameNumber) {
            // Sin URL (los operadores bloquean http/https). Insertamos el número de
            // WhatsApp en texto plano. {{whatsapp}} es el token nuevo; {{link}} se
            // mantiene como alias para no romper mensajes escritos con el ejemplo viejo.
            const waNum = waDisplayNumber(wameNumber)
            contentText = contentText.replaceAll('{{whatsapp}}', waNum).replaceAll('{{link}}', waNum)
          }
          payload.content_text = contentText
          if (form.channel === 'whatsapp' && form.media_url) {
            payload.media_url = form.media_url
            if (form.media_caption) payload.media_caption = form.media_caption
          }
        }
      }

      await api.post('/campaigns', payload)
      router.push('/dashboard/campaigns')
    } catch (err) {
      setError(err.response?.data?.error ?? err.response?.data?.message ?? 'Error al crear la campaña')
    } finally { setLoading(false) }
  }

  const listOpts  = lists.map(l => ({ value: l.id, label: `${l.name} · ${Number(l.total_count).toLocaleString()} contactos`, icon: <Users size={14} className="shrink-0 text-muted-foreground" /> }))
  const selList   = lists.find(l => l.id === form.list_id)
  const chMeta    = CHANNELS.find(c => c.key === (isAI ? 'whatsapp_ai' : form.channel))
  const linkedAccounts    = waAccounts.filter(w => w.assistant_id === assistantId)
  const connectedAccounts = linkedAccounts.filter(w => w.is_connected)
  const selAssistant      = assistants.find(a => a.id === assistantId)

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href="/dashboard/campaigns" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft size={16} strokeWidth={1.75} /> Campañas
      </Link>

      <div>
        <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight text-foreground">
          {fromId ? <RotateCcw size={22} className="text-jungle-green-600" /> : <Megaphone size={22} className="text-jungle-green-600" />}
          {fromId ? 'Reenviar campaña' : 'Nueva campaña'}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {fromId ? 'Revisa y ajusta los datos cargados antes de volver a enviar.' : 'Elige el canal, define el contenido y prográmala.'}
        </p>
      </div>

      {fromId && (
        <div className="flex items-start gap-3 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-700">
          <ClipboardList size={18} strokeWidth={1.75} className="mt-0.5 shrink-0" />
          <span>Datos de la campaña original cargados. Modifica lo que necesites antes de enviar.</span>
        </div>
      )}

      {loadingFrom ? (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 size={18} className="animate-spin text-jungle-green-600" /> Cargando campaña original...
        </div>
      ) : (
        <>
          {/* Selector de canal */}
          <div>
            <Label className="mb-2 block">Canal</Label>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {CHANNELS.map(c => {
                const sel = c.key === 'whatsapp_ai' ? (form.channel === 'whatsapp' && isAI) : (form.channel === c.key && !isAI)
                const t = CHANNEL_TINT[c.tint]
                return (
                  <button key={c.key} type="button" onClick={() => pickChannel(c.key)}
                    className={cn('flex flex-col items-start gap-2 rounded-2xl border-2 p-4 text-left transition-colors',
                      sel ? t.sel : 'border-border hover:bg-muted/40')}>
                    <span className={cn('flex h-9 w-9 items-center justify-center rounded-xl', t.icon)}><c.Icon size={18} strokeWidth={1.75} /></span>
                    <span className="text-sm font-semibold text-foreground">{c.label}</span>
                    <span className="text-xs leading-snug text-muted-foreground">{c.desc}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Stepper */}
          <div className="flex items-center gap-0">
            {STEPS.map((s, i) => (
              <div key={s} className="flex flex-1 items-center last:flex-none">
                <div className={cn('flex items-center gap-2', i <= step ? 'text-jungle-green-700' : 'text-muted-foreground')}>
                  <div className={cn('flex h-7 w-7 items-center justify-center rounded-full border-2 text-sm font-bold',
                    i < step ? 'border-jungle-green-600 bg-jungle-green-600 text-white' : i === step ? 'border-jungle-green-600 text-jungle-green-700' : 'border-border text-muted-foreground')}>
                    {i < step ? <Check size={15} strokeWidth={2.5} /> : i + 1}
                  </div>
                  <span className="text-sm font-medium">{s}</span>
                </div>
                {i < STEPS.length - 1 && <div className={cn('mx-3 h-0.5 flex-1', i < step ? 'bg-jungle-green-600' : 'bg-border')} />}
              </div>
            ))}
          </div>

          <div className="rounded-2xl border bg-card p-6 shadow-sm">
            <div className="space-y-5">

              {/* STEP 0: Configuración */}
              {step === 0 && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2 space-y-1.5">
                    <Label htmlFor="name">Nombre interno de la campaña *</Label>
                    <Input id="name" value={form.name} onChange={e => set('name', e.target.value)} className={fieldClass} placeholder="Ej: Promo Mayo 2026" />
                  </div>

                  {isEmail && (
                    <>
                      <div className="col-span-2 space-y-1.5">
                        <Label htmlFor="subject">Asunto del correo *</Label>
                        <Input id="subject" value={form.subject} onChange={e => set('subject', e.target.value)} className={fieldClass} placeholder="Ej: {{first_name}}, no te pierdas esto" />
                        <p className="text-xs text-muted-foreground">Puedes usar {'{{first_name}}'}, {'{{last_name}}'}, {'{{email}}'}</p>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="from_name">Nombre del remitente *</Label>
                        <Input id="from_name" value={form.from_name} onChange={e => set('from_name', e.target.value)} className={fieldClass} placeholder="Ej: María de Ventas" />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="reply_to">Responder a (opcional)</Label>
                        <Input id="reply_to" value={form.reply_to} onChange={e => set('reply_to', e.target.value)} type="email" className={fieldClass} placeholder="respuestas@tudominio.com" />
                      </div>
                    </>
                  )}

                  {!isAI && (
                    <div className={cn('space-y-1.5', isEmail ? '' : 'col-span-2')}>
                      <Label>Lista de destinatarios *</Label>
                      {!isEmail && (
                        <div className="mb-1.5 flex gap-2">
                          <button type="button" onClick={() => setRecipientMode('list')}
                            className={cn('rounded-lg px-3 py-1.5 text-xs font-medium transition-colors', recipientMode === 'list' ? 'bg-jungle-green-600 text-white' : 'bg-muted text-muted-foreground hover:bg-muted/70')}>
                            Elegir lista
                          </button>
                          <button type="button" onClick={() => setRecipientMode('upload')}
                            className={cn('rounded-lg px-3 py-1.5 text-xs font-medium transition-colors', recipientMode === 'upload' ? 'bg-jungle-green-600 text-white' : 'bg-muted text-muted-foreground hover:bg-muted/70')}>
                            Subir Excel/CSV
                          </button>
                        </div>
                      )}
                      {(isEmail || recipientMode === 'list') ? (
                        <>
                          <SelectMenu value={form.list_id} onChange={v => set('list_id', v)} options={listOpts} placeholder="Seleccionar lista..." className="h-[52px]" />
                          {lists.length === 0 && <p className="text-xs text-amber-600">No tienes listas. Crea una en Contactos primero.</p>}
                        </>
                      ) : (
                        <>
                          <input id="recipients_file_manual" type="file" accept=".xlsx,.xls,.csv" disabled={importing}
                            onChange={e => uploadRecipients(e.target.files?.[0])}
                            className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-lg file:border-0 file:bg-jungle-green-600 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-jungle-green-700" />
                          <p className="text-xs text-muted-foreground">Excel/CSV con una columna de teléfono (telefono, celular, phone…). Se creará una lista automáticamente. El email es opcional.</p>
                          {importing && <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 size={13} className="animate-spin" /> Subiendo y procesando...</p>}
                          {importInfo && <p className="flex items-center gap-1.5 text-xs text-foreground"><CheckCircle size={14} className="text-jungle-green-600" /> {importInfo.total} destinatarios cargados ({importInfo.list_name}).</p>}
                        </>
                      )}
                    </div>
                  )}
                  {isAI && (
                    <div className="col-span-2 flex items-start gap-2.5 rounded-xl border border-teal-100 bg-teal-50 px-4 py-3 text-sm text-teal-800">
                      <Info size={18} strokeWidth={1.75} className="mt-0.5 shrink-0 text-teal-600" />
                      <span>Los destinatarios se cargan subiendo un Excel en el siguiente paso — no uses una lista de Contactos aquí.</span>
                    </div>
                  )}

                  {isEmail && (
                    <div className="space-y-1.5">
                      <Label>Estrategia de envío</Label>
                      <SelectMenu value={form.strategy} onChange={v => { set('strategy', v); setSetting('integration_id', '') }}
                        options={STRATEGIES.map(s => ({ value: s.value, label: s.label }))} className="h-[52px]" />
                    </div>
                  )}

                  {/* A quién del contacto: principal o todos */}
                  {!isAI && (
                    <div className="col-span-2 space-y-1.5">
                      <Label>¿A quién enviar de cada contacto?</Label>
                      <div className="grid grid-cols-2 gap-2">
                        {[
                          { val: false, title: 'Solo el principal', desc: `Un envío por contacto, a su ${isEmail ? 'correo' : 'número'} principal` },
                          { val: true,  title: `Todos los ${isEmail ? 'correos' : 'números'}`, desc: `Un envío a cada ${isEmail ? 'correo' : 'número'} del contacto` },
                        ].map(o => {
                          const active = form.settings.send_to_all === o.val
                          return (
                            <button key={String(o.val)} type="button" onClick={() => setSetting('send_to_all', o.val)}
                              className={cn('rounded-xl border-2 p-3 text-left transition-colors',
                                active ? 'border-jungle-green-500 bg-jungle-green-50' : 'border-border hover:bg-muted/40')}>
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-sm font-semibold text-foreground">{o.title}</span>
                                {active && <Check size={15} strokeWidth={2.5} className="shrink-0 text-jungle-green-600" />}
                              </div>
                              <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{o.desc}</p>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  <div className="col-span-2 space-y-1.5">
                    <Label htmlFor="scheduled_at">Programar envío (opcional)</Label>
                    <Input id="scheduled_at" type="datetime-local" value={form.scheduled_at} onChange={e => set('scheduled_at', e.target.value)}
                      min={new Date(Date.now() + 60000).toISOString().slice(0, 16)} className={fieldClass} />
                    <p className="text-xs text-muted-foreground">
                      {form.scheduled_at ? `Se enviará el ${new Date(form.scheduled_at).toLocaleString('es')}` : 'Sin fecha, la campaña queda en borrador y la envías manualmente.'}
                    </p>
                  </div>

                  {isEmail && form.strategy !== 'smtp_own' && (
                    <div className="col-span-2 space-y-1.5">
                      <Label>Integración a usar *</Label>
                      {(() => {
                        const available = integrations.filter(i => i.provider === form.strategy && i.is_active)
                        if (available.length === 0) return (
                          <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                            <AlertTriangle size={18} strokeWidth={1.75} className="mt-0.5 shrink-0" />
                            <span>No tienes integraciones activas para {STRATEGIES.find(s => s.value === form.strategy)?.label}. <a href="/dashboard/integrations" className="font-medium underline">Configurar ahora</a></span>
                          </div>
                        )
                        return <SelectMenu value={form.settings.integration_id} onChange={v => setSetting('integration_id', v)}
                          options={available.map(i => ({ value: i.id, label: i.name }))} placeholder="Seleccionar integración..." className="h-[52px]" />
                      })()}
                    </div>
                  )}

                  {!isEmail && !isAI && (
                    <div className="col-span-2 flex items-start gap-2.5 rounded-xl border border-jungle-green-100 bg-jungle-green-50 px-4 py-3 text-sm text-jungle-green-800">
                      <Info size={18} strokeWidth={1.75} className="mt-0.5 shrink-0 text-jungle-green-600" />
                      <span>El envío rota automáticamente entre tus {form.channel === 'whatsapp' ? 'números de WhatsApp de tipo Campaña conectados' : 'gateways SMS online'}, respetando sus límites diarios y horarios.</span>
                    </div>
                  )}
                </div>
              )}

              {/* STEP 1: Contenido (email) / Mensaje (wa/sms) */}
              {step === 1 && isEmail && (
                <>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="html_content">Contenido HTML *</Label>
                      {templates.length > 0 && (
                        <div className="w-56">
                          <SelectMenu value={templateId} onChange={loadTemplate}
                            options={[{ value: '', label: 'Cargar plantilla...' }, ...templates.map(t => ({ value: t.id, label: t.name, icon: <FileText size={14} className="text-muted-foreground" /> }))]}
                            placeholder="Cargar plantilla..." className="h-9" />
                        </div>
                      )}
                    </div>
                    <textarea id="html_content" value={form.html_content} onChange={e => set('html_content', e.target.value)} rows={13}
                      className="w-full rounded-xl border border-transparent bg-muted/60 px-4 py-3 font-mono text-sm shadow-none outline-none transition-colors focus:border-ring focus:bg-background"
                      placeholder={'<h1>Hola {{first_name}}</h1>\n<p>Contenido del correo...</p>'} />
                    <p className="text-xs text-muted-foreground">Variables: {'{{first_name}}'}, {'{{last_name}}'}, {'{{email}}'}</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="text_content">Texto plano (opcional)</Label>
                    <textarea id="text_content" value={form.text_content} onChange={e => set('text_content', e.target.value)} rows={4}
                      className="w-full rounded-xl border border-transparent bg-muted/60 px-4 py-3 text-sm shadow-none outline-none transition-colors focus:border-ring focus:bg-background"
                      placeholder="Versión en texto del correo..." />
                  </div>
                </>
              )}

              {step === 1 && isAI && (
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label>Asistente IA *</Label>
                    <SelectMenu value={assistantId}
                      onChange={v => { setAssistantId(v); setSelectedAccIds([]); setImportInfo(null) }}
                      options={assistants.map(a => ({ value: a.id, label: a.name, icon: <Bot size={14} className="shrink-0 text-muted-foreground" /> }))}
                      placeholder="Selecciona un asistente..." className="h-[52px]" />
                    {assistants.length === 0 && (
                      <p className="text-xs text-amber-600">No tienes asistentes IA. Crea uno en <a href="/dashboard/assistants" className="font-medium underline">Asistentes IA</a>.</p>
                    )}
                    {selAssistant && (
                      <p className="text-xs text-muted-foreground">
                        ⏰ Este asistente responde de <strong>{selAssistant.active_hours_start?.slice(0,5)}–{selAssistant.active_hours_end?.slice(0,5)}</strong> ({selAssistant.active_days}, {selAssistant.timezone}). Fuera de ese horario recibe los mensajes pero no responde hasta volver a su horario.
                      </p>
                    )}
                  </div>

                  {assistantId && (
                    <>
                      <div className="flex items-center justify-between rounded-xl border bg-muted/30 p-4">
                        <div>
                          <p className="text-sm font-medium text-foreground">Plantilla Excel</p>
                          <p className="text-xs text-muted-foreground">Descarga las columnas que necesita este asistente y complétala con tus destinatarios.</p>
                        </div>
                        <Button type="button" variant="outline" size="sm" onClick={downloadTemplate} disabled={templateLoading}>
                          {templateLoading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} strokeWidth={1.75} />} Descargar plantilla
                        </Button>
                      </div>

                      <div className="space-y-1.5">
                        <Label htmlFor="recipients_file">Subir Excel de destinatarios *</Label>
                        <input id="recipients_file" type="file" accept=".xlsx,.xls,.csv" disabled={importing}
                          onChange={e => uploadRecipients(e.target.files?.[0])}
                          className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-lg file:border-0 file:bg-jungle-green-600 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-jungle-green-700" />
                        {importing && <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 size={13} className="animate-spin" /> Subiendo y procesando...</p>}
                      </div>

                      {importInfo && (
                        <div className="rounded-xl border bg-muted/30 p-3 text-sm">
                          <p className="flex items-center gap-1.5 text-foreground"><CheckCircle size={15} className="text-jungle-green-600" /> {importInfo.total} destinatarios cargados ({importInfo.list_name}).</p>
                          {importInfo.variables_faltantes?.length > 0 && (
                            <p className="mt-1 flex items-start gap-1.5 text-amber-600">
                              <AlertTriangle size={14} strokeWidth={1.75} className="mt-0.5 shrink-0" />
                              Faltan columnas para: {importInfo.variables_faltantes.join(', ')} (quedarán vacías en el saludo).
                            </p>
                          )}
                        </div>
                      )}

                      <div className="space-y-1.5">
                        <Label>Números de WhatsApp conectados con este asistente *</Label>
                        {linkedAccounts.length === 0 ? (
                          <p className="text-xs text-red-600">Ningún número tiene este asistente vinculado. Vincúlalo en Asistentes IA.</p>
                        ) : connectedAccounts.length === 0 ? (
                          <p className="text-xs text-red-600">Los números con este asistente están desconectados. Conéctalos en WhatsApp (escanea el QR) antes de enviar.</p>
                        ) : (
                          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                            {connectedAccounts.map(w => (
                              <label key={w.id} className="flex cursor-pointer items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-sm">
                                <input type="checkbox" className="h-4 w-4 accent-jungle-green-600" checked={selectedAccIds.includes(w.id)}
                                  onChange={e => setSelectedAccIds(ids => e.target.checked ? [...ids, w.id] : ids.filter(x => x !== w.id))} />
                                <span className="truncate">{w.name} <span className="text-xs text-muted-foreground">{w.phone_number ?? ''}</span></span>
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}

              {step === 1 && !isEmail && !isAI && (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="content_text">Mensaje *</Label>
                    <textarea id="content_text" value={form.content_text} onChange={e => set('content_text', e.target.value)} rows={7}
                      className="w-full resize-none rounded-xl border border-transparent bg-muted/60 px-4 py-3 text-sm shadow-none outline-none transition-colors focus:border-ring focus:bg-background"
                      placeholder={form.channel === 'whatsapp' ? 'Escribe tu mensaje de WhatsApp...' : 'Escribe tu SMS (máx. ~160 caracteres por segmento)...'} />
                    {form.channel === 'sms' ? (() => {
                      const s = smsSegments(form.content_text)
                      return (
                        <p className={`text-right text-xs mt-1 ${s.segments > 1 ? 'text-amber-600' : 'text-muted-foreground'}`}>
                          {s.length} caracteres · {s.segments} segmento{s.segments !== 1 ? 's' : ''} ({s.encoding === 'UCS2' ? 'Unicode 70/seg' : 'GSM 160/seg'})
                          {s.segments > 1 && ' — supera un SMS: se enviará en varios mensajes por teléfono.'}
                        </p>
                      )
                    })() : (
                      <p className="text-right text-xs text-muted-foreground">{form.content_text.length} caracteres</p>
                    )}
                  </div>
                  {wameNumber && (
                    <div className="space-y-1 rounded-xl border bg-muted/30 p-4 text-xs text-muted-foreground">
                      <p>Usa <code>{'{{whatsapp}}'}</code> en tu mensaje para insertar el WhatsApp del asistente (<strong className="text-foreground">{waDisplayNumber(wameNumber)}</strong>).</p>
                      <p>Ej: "Hola {'{{cliente}}'}, escríbenos al WhatsApp {'{{whatsapp}}'}"</p>
                      <p className="text-amber-600">⚠️ No pongas enlaces (http/https): los operadores bloquean los SMS con links. Por eso pedimos que el cliente escriba al número — además así la conversación la inicia el cliente (anti-baneo).</p>
                    </div>
                  )}
                  {form.channel === 'whatsapp' && (
                    <div className="grid grid-cols-1 gap-4 rounded-xl border bg-muted/30 p-4">
                      <p className="flex items-center gap-2 text-xs font-semibold text-muted-foreground"><Image size={14} /> Adjuntar media (opcional)</p>
                      <div className="space-y-1.5">
                        <Label htmlFor="media_url">URL de imagen / archivo</Label>
                        <Input id="media_url" value={form.media_url} onChange={e => set('media_url', e.target.value)} className={fieldClass} placeholder="https://..." />
                      </div>
                      {form.media_url && (
                        <div className="space-y-1.5">
                          <Label htmlFor="media_caption">Pie de foto (opcional)</Label>
                          <Input id="media_caption" value={form.media_caption} onChange={e => set('media_caption', e.target.value)} className={fieldClass} placeholder="Descripción del adjunto" />
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}

              {/* STEP 2: Envío */}
              {step === 2 && (
                <div className="space-y-5">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="delay_min">Delay mínimo (ms)</Label>
                      <Input id="delay_min" type="number" value={form.settings.delay_min_ms} onChange={e => setSetting('delay_min_ms', parseInt(e.target.value) || 0)} className={fieldClass} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="delay_max">Delay máximo (ms)</Label>
                      <Input id="delay_max" type="number" value={form.settings.delay_max_ms} onChange={e => setSetting('delay_max_ms', parseInt(e.target.value) || 0)} className={fieldClass} />
                    </div>
                  </div>
                  <p className="-mt-2 text-xs text-muted-foreground">Pausa aleatoria entre cada envío para un ritmo natural. {Math.round(form.settings.delay_min_ms / 1000)}s a {Math.round(form.settings.delay_max_ms / 1000)}s.</p>

                  {isEmail && (
                    <div className="space-y-3">
                      {[
                        { key: 'rotate_accounts', label: 'Rotar cuentas SMTP', desc: 'Cada correo sale de una cuenta diferente' },
                        { key: 'track_opens', label: 'Rastrear aperturas', desc: 'Inserta un pixel de seguimiento invisible' },
                        { key: 'track_clicks', label: 'Rastrear clics', desc: 'Redirige los enlaces para contabilizar clics' },
                      ].map(opt => (
                        <label key={opt.key} className="flex cursor-pointer items-start gap-3 rounded-xl border bg-muted/40 px-4 py-3 transition-colors hover:bg-muted/60">
                          <Checkbox checked={form.settings[opt.key]} onCheckedChange={v => setSetting(opt.key, v === true)} className="mt-0.5" />
                          <div>
                            <p className="text-sm font-medium text-foreground">{opt.label}</p>
                            <p className="text-xs text-muted-foreground">{opt.desc}</p>
                          </div>
                        </label>
                      ))}
                    </div>
                  )}

                  {/* Resumen */}
                  <div className="rounded-xl border bg-muted/30 p-4 text-sm">
                    <p className="mb-3 flex items-center gap-2 font-semibold text-foreground"><Info size={16} strokeWidth={1.75} className="text-jungle-green-600" /> Resumen</p>
                    <dl className="grid grid-cols-1 gap-y-1.5">
                      <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Canal</dt><dd className="flex items-center gap-1.5 font-medium text-foreground">{chMeta && <chMeta.Icon size={14} />} {chMeta?.label}</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Nombre</dt><dd className="truncate font-medium text-foreground">{form.name || '—'}</dd></div>
                      {isEmail && <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Asunto</dt><dd className="truncate font-medium text-foreground">{form.subject || '—'}</dd></div>}
                      {isAI ? (
                        <>
                          <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Asistente</dt><dd className="truncate font-medium text-foreground">{assistants.find(a => a.id === assistantId)?.name ?? '—'}</dd></div>
                          <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Destinatarios</dt><dd className="truncate font-medium text-foreground">{importInfo ? `${importInfo.total} (${importInfo.list_name})` : '—'}</dd></div>
                          <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Números</dt><dd className="font-medium text-foreground">{selectedAccIds.length} seleccionado{selectedAccIds.length !== 1 ? 's' : ''}</dd></div>
                        </>
                      ) : (
                        <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Lista</dt><dd className="truncate font-medium text-foreground">{selList ? `${selList.name} · ${Number(selList.total_count).toLocaleString()}` : '—'}</dd></div>
                      )}
                      {isEmail && <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Estrategia</dt><dd className="font-medium text-foreground">{STRATEGIES.find(s => s.value === form.strategy)?.label}</dd></div>}
                      <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Envío</dt><dd className="font-medium text-foreground">{form.scheduled_at ? new Date(form.scheduled_at).toLocaleString('es') : 'Manual (borrador)'}</dd></div>
                    </dl>
                  </div>
                </div>
              )}

              {error && <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}

              <div className="flex justify-between pt-2">
                <Button variant="outline" onClick={() => setStep(s => s - 1)} disabled={step === 0} className={step === 0 ? 'opacity-0' : ''}>
                  <ArrowLeft size={16} strokeWidth={1.75} /> Atrás
                </Button>
                {step < STEPS.length - 1 ? (
                  <Button onClick={() => setStep(s => s + 1)} disabled={!canGoNext()}>Siguiente <ArrowRight size={16} strokeWidth={1.75} /></Button>
                ) : (
                  <Button onClick={submit} disabled={loading || !canGoNext()}>
                    {loading ? <><Loader2 size={16} className="animate-spin" /> Guardando...</> : <><Send size={16} strokeWidth={1.75} /> {form.scheduled_at ? 'Programar campaña' : 'Crear campaña'}</>}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default function NewCampaignPage() {
  return (
    <Suspense fallback={
      <div className="flex h-64 items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 size={18} className="animate-spin text-jungle-green-600" /> Cargando...
      </div>
    }>
      <NewCampaignForm />
    </Suspense>
  )
}
