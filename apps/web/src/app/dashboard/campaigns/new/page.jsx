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
  Smartphone, Users, Image, ClipboardList, Loader2, Info, AlertTriangle, Send,
} from '@/components/ui/icons'
import { cn } from '@/lib/utils'

const STRATEGIES = [
  { value: 'smtp_own',  label: 'SMTP propio (rotación de cuentas)' },
  { value: 'sendgrid',  label: 'SendGrid' },
  { value: 'brevo',     label: 'Brevo' },
  { value: 'mailchimp', label: 'Mailchimp Transactional (Mandrill)' },
]

const CHANNELS = [
  { key: 'email',    label: 'Email',    desc: 'HTML, plantillas y seguimiento de aperturas', Icon: Mail,          tint: 'amber' },
  { key: 'whatsapp', label: 'WhatsApp', desc: 'Mensaje rotando tus números conectados',       Icon: MessageCircle, tint: 'green' },
  { key: 'sms',      label: 'SMS',      desc: 'Texto vía tus gateways SMS',                    Icon: Smartphone,    tint: 'blue'  },
]
const CHANNEL_TINT = {
  amber: { sel: 'border-amber-500 bg-amber-50', icon: 'bg-amber-100 text-amber-700' },
  green: { sel: 'border-jungle-green-500 bg-jungle-green-50', icon: 'bg-jungle-green-100 text-jungle-green-700' },
  blue:  { sel: 'border-blue-500 bg-blue-50', icon: 'bg-blue-100 text-blue-700' },
}

const fieldClass = 'h-[52px] rounded-xl border-transparent bg-muted/60 text-base shadow-none transition-colors focus-visible:border-ring focus-visible:bg-background focus-visible:ring-0'

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

  const [form, setForm] = useState({
    name: '', channel: 'email',
    subject: '', from_name: '', reply_to: '', strategy: 'smtp_own', html_content: '', text_content: '',
    content_text: '', media_url: '', media_caption: '',
    list_id: '', scheduled_at: '',
    settings: { delay_min_ms: 2000, delay_max_ms: 15000, rotate_accounts: true, track_opens: true, track_clicks: true, integration_id: '', send_to_all: true },
  })

  const isEmail = form.channel === 'email'
  const STEPS = isEmail ? ['Configuración', 'Contenido', 'Envío'] : ['Configuración', 'Mensaje', 'Envío']

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

  function set(field, value) { setForm(f => ({ ...f, [field]: value })) }
  function setSetting(field, value) { setForm(f => ({ ...f, settings: { ...f.settings, [field]: value } })) }

  function pickChannel(ch) {
    setStep(0); setError('')
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

  function loadTemplate(id) {
    setTemplateId(id)
    const t = templates.find(t => t.id === id)
    if (t) setForm(f => ({ ...f, subject: t.subject, from_name: t.from_name, html_content: t.html_content, text_content: t.text_content ?? f.text_content }))
  }

  function canGoNext() {
    if (step === 0) {
      if (!form.name || !form.list_id) return false
      if (isEmail) {
        if (!form.subject || !form.from_name) return false
        if (form.strategy !== 'smtp_own') return !!form.settings.integration_id
      }
      return true
    }
    if (step === 1) return isEmail ? form.html_content.trim().length > 0 : form.content_text.trim().length > 0
    return true
  }

  async function submit() {
    setLoading(true); setError('')
    try {
      const payload = {
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
        payload.content_text = form.content_text
        if (form.channel === 'whatsapp' && form.media_url) {
          payload.media_url = form.media_url
          if (form.media_caption) payload.media_caption = form.media_caption
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
  const chMeta    = CHANNELS.find(c => c.key === form.channel)

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
            <div className="grid grid-cols-3 gap-3">
              {CHANNELS.map(c => {
                const sel = form.channel === c.key
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

                  <div className={cn('space-y-1.5', isEmail ? '' : 'col-span-2')}>
                    <Label>Lista de destinatarios *</Label>
                    <SelectMenu value={form.list_id} onChange={v => set('list_id', v)} options={listOpts} placeholder="Seleccionar lista..." className="h-[52px]" />
                    {lists.length === 0 && <p className="text-xs text-amber-600">No tienes listas. Crea una en Contactos primero.</p>}
                  </div>

                  {isEmail && (
                    <div className="space-y-1.5">
                      <Label>Estrategia de envío</Label>
                      <SelectMenu value={form.strategy} onChange={v => { set('strategy', v); setSetting('integration_id', '') }}
                        options={STRATEGIES.map(s => ({ value: s.value, label: s.label }))} className="h-[52px]" />
                    </div>
                  )}

                  {/* A quién del contacto: principal o todos */}
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

                  {!isEmail && (
                    <div className="col-span-2 flex items-start gap-2.5 rounded-xl border border-jungle-green-100 bg-jungle-green-50 px-4 py-3 text-sm text-jungle-green-800">
                      <Info size={18} strokeWidth={1.75} className="mt-0.5 shrink-0 text-jungle-green-600" />
                      <span>El envío rota automáticamente entre tus {form.channel === 'whatsapp' ? 'números de WhatsApp conectados' : 'gateways SMS online'}, respetando sus límites diarios y horarios.</span>
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

              {step === 1 && !isEmail && (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="content_text">Mensaje *</Label>
                    <textarea id="content_text" value={form.content_text} onChange={e => set('content_text', e.target.value)} rows={7}
                      className="w-full resize-none rounded-xl border border-transparent bg-muted/60 px-4 py-3 text-sm shadow-none outline-none transition-colors focus:border-ring focus:bg-background"
                      placeholder={form.channel === 'whatsapp' ? 'Escribe tu mensaje de WhatsApp...' : 'Escribe tu SMS (máx. ~160 caracteres por segmento)...'} />
                    <p className="text-right text-xs text-muted-foreground">{form.content_text.length} caracteres</p>
                  </div>
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
                      <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Lista</dt><dd className="truncate font-medium text-foreground">{selList ? `${selList.name} · ${Number(selList.total_count).toLocaleString()}` : '—'}</dd></div>
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
