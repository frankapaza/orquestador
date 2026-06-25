'use client'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import api from '../../../../lib/api'
import {
  Send, ArrowLeft, Mail, Smartphone, MessageCircle, AlertTriangle, XCircle,
  Eye, Link2, Loader2, CheckCircle, Plus, Star, Trash2, X, Inbox, Circle,
  ArrowDownLeft, ArrowUpRight, Phone, PhoneCall, Copy, Check, AtSign, Calendar, Users,
} from '../../../../components/ui/icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { EmptyState } from '@/components/ui/empty-state'
import { CountryPhoneInput, DEFAULT_COUNTRY, resolveCountry, Flag } from '@/components/ui/phone-input'
import { SelectMenu } from '@/components/ui/select-menu'
import { cn } from '@/lib/utils'

const inputCls =
  'h-[52px] rounded-xl border-transparent bg-muted/60 text-base shadow-none transition-colors focus-visible:border-ring focus-visible:bg-background focus-visible:ring-0'
const selectCls =
  'h-[52px] w-full rounded-xl border border-transparent bg-muted/60 px-4 text-base text-foreground shadow-none transition-colors focus:border-ring focus:bg-background focus:outline-none'

// Agrupa el número nacional de a 3 dígitos para legibilidad (995241264 -> 995 241 264)
function formatNational(n) {
  if (!n) return ''
  return String(n).replace(/\D/g, '').replace(/(\d{3})(?=\d)/g, '$1 ').trim()
}
function fullNumber(p) {
  if (!p?.phone) return ''
  return `${p.phone_dial ?? ''}${p.phone}`
}
// Etiqueta a mostrar: el principal siempre "Principal"; evita duplicar "Principal" en no-principales
function displayLabel(item) {
  if (item.is_primary) return 'Principal'
  return item.label && item.label !== 'Principal' ? item.label : 'Otro'
}

// ─────────────────────────────────────────────────────────────────────────────
// Modal enviar mensaje
// ─────────────────────────────────────────────────────────────────────────────
function SendModal({ contact, onClose }) {
  const phones = contact.phones ?? []
  const emails = contact.emails ?? []
  const hasPhone = phones.length > 0
  const hasEmail = emails.length > 0
  const primaryPhone = phones.find(p => p.is_primary) ?? phones[0] ?? null
  const primaryEmail = emails.find(e => e.is_primary) ?? emails[0] ?? null

  const CHANNELS = [
    hasEmail && { key: 'email',    label: 'Email',    Icon: Mail },
    hasPhone && { key: 'whatsapp', label: 'WhatsApp', Icon: MessageCircle },
    hasPhone && { key: 'sms',      label: 'SMS',      Icon: Smartphone },
  ].filter(Boolean)

  const [channel, setChannel]   = useState(CHANNELS[0]?.key ?? 'email')
  const [waAccounts, setWa]     = useState([])
  const [smsAccounts, setSms]   = useState([])
  const [templates, setTemplates] = useState([])
  const [templateId, setTemplateId] = useState('')
  const [accountId, setAccountId] = useState('')
  const [emailAccounts, setEmailAccounts] = useState([])
  const [emailAccountId, setEmailAccountId] = useState('')
  const [toPhoneId, setToPhoneId] = useState(primaryPhone?.id)
  const [toEmail, setToEmail]     = useState(primaryEmail?.email)
  const [form, setForm] = useState({ subject: '', from_name: '', html_content: '', message: '', cc: '', bcc: '' })
  const [sending, setSending] = useState(false)
  const [error, setError]     = useState(null)
  const [sent, setSent]       = useState(false)

  useEffect(() => {
    api.get('/whatsapp/accounts').then(r => setWa(r.data.filter(a => a.is_connected))).catch(() => {})
    api.get('/sms/accounts').then(r => setSms(r.data.filter(a => a.is_online))).catch(() => {})
    api.get('/templates').then(r => setTemplates(r.data)).catch(() => {})
    api.get('/email/accounts').then(r => setEmailAccounts(r.data)).catch(() => {})
  }, [])

  const accounts = channel === 'whatsapp' ? waAccounts : smsAccounts
  useEffect(() => {
    setAccountId(accounts.length ? accounts[0].id : '')
    setError(null)
  }, [channel, waAccounts, smsAccounts])

  const accountOpts = accounts.map(a => ({
    value: a.id,
    label: `${a.name} · ${a.phone_number ?? a.instance_name ?? '—'}`,
    icon: <span className={cn('h-2 w-2 shrink-0 rounded-full', channel === 'sms' ? 'bg-blue-500' : 'bg-jungle-green-500')} />,
  }))
  const templateOpts = [{ value: '', label: 'Sin plantilla' }, ...templates.map(t => ({ value: t.id, label: t.name }))]

  // Cuenta de correo emisora (cuando hay varios dominios/correos configurados).
  useEffect(() => {
    if (channel === 'email' && !emailAccountId && emailAccounts.length) setEmailAccountId(emailAccounts[0].id)
  }, [channel, emailAccounts])
  const emailAccountOpts = emailAccounts.map(a => ({
    value: a.id,
    label: `${a.email}${a.domain ? ' · ' + a.domain : ''}`,
    icon: <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" />,
  }))

  const selectedPhone = phones.find(p => p.id === toPhoneId) ?? primaryPhone
  const toNumber = selectedPhone ? fullNumber(selectedPhone) : ''

  function loadTemplate(id) {
    setTemplateId(id)
    const t = templates.find(t => t.id === id)
    if (t) setForm(f => ({ ...f, subject: t.subject, from_name: t.from_name, html_content: t.html_content }))
  }

  async function send(e) {
    e.preventDefault()
    setSending(true); setError(null)
    try {
      if (channel === 'email') {
        const parseList = s => (s || '').split(/[,;\s]+/).map(x => x.trim()).filter(Boolean)
        const ccList = parseList(form.cc)
        const bccList = parseList(form.bcc)
        await api.post(`/contacts/${contact.id}/send-email`, {
          subject: form.subject, from_name: form.from_name, html_content: form.html_content, to: toEmail,
          account_id: emailAccountId || undefined,
          cc:  ccList.length  ? ccList  : undefined,
          bcc: bccList.length ? bccList : undefined,
        })
      } else {
        if (!accountId) throw new Error('Selecciona una cuenta')
        if (!toNumber)  throw new Error('Selecciona un número')
        await api.post('/messages/send', { channel, account_id: accountId, to: toNumber, message: form.message })
      }
      setSent(true)
    } catch (err) {
      setError(err.response?.data?.error ?? err.message)
    } finally { setSending(false) }
  }

  const f = k => ({ value: form[k] ?? '', onChange: e => setForm(p => ({ ...p, [k]: e.target.value })) })
  const name = [contact.first_name, contact.last_name].filter(Boolean).join(' ') || toNumber || toEmail

  if (typeof document === 'undefined') return null

  if (sent) return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-2xl border bg-card p-8 text-center shadow-xl">
        <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-jungle-green-100 text-jungle-green-600">
          <CheckCircle size={28} strokeWidth={1.75} />
        </span>
        <p className="text-lg font-semibold text-foreground">{channel === 'email' ? 'Email enviado' : 'Mensaje enviado'}</p>
        <p className="mt-1 text-sm text-muted-foreground">A {channel === 'email' ? toEmail : toNumber}</p>
        <Button onClick={onClose} className="mt-6 w-full">Cerrar</Button>
      </div>
    </div>,
    document.body
  )

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border bg-card shadow-xl">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-jungle-green-600 text-sm font-bold text-white">
              {name?.[0]?.toUpperCase() ?? '?'}
            </span>
            <div className="min-w-0">
              <h2 className="font-semibold text-foreground">Enviar mensaje</h2>
              <p className="truncate text-xs text-muted-foreground">Para {name}</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Cerrar"><X size={18} /></Button>
        </div>

        <form onSubmit={send} className="space-y-5 overflow-y-auto p-6">
          {/* Canal */}
          <div className="flex gap-2">
            {CHANNELS.map(c => (
              <button key={c.key} type="button" onClick={() => setChannel(c.key)}
                className={cn('flex flex-1 items-center justify-center gap-1.5 rounded-xl border-2 py-2.5 text-sm font-medium transition-colors',
                  channel === c.key
                    ? c.key === 'sms' ? 'border-blue-500 bg-blue-50 text-blue-700' : c.key === 'email' ? 'border-amber-500 bg-amber-50 text-amber-700' : 'border-jungle-green-500 bg-jungle-green-50 text-jungle-green-700'
                    : 'border-border text-muted-foreground hover:bg-muted/60')}>
                <c.Icon size={16} strokeWidth={1.75} />{c.label}
              </button>
            ))}
          </div>

          {/* Destinatario */}
          {(channel === 'whatsapp' || channel === 'sms') ? (
            <div className="space-y-1.5">
              <Label>Enviar a</Label>
              <div className="space-y-1.5">
                {phones.map(p => {
                  const full   = fullNumber(p)
                  const ct     = resolveCountry({ phone_country: p.phone_country, phone: full })
                  const active = (selectedPhone?.id ?? toPhoneId) === p.id
                  return (
                    <button key={p.id} type="button" onClick={() => setToPhoneId(p.id)}
                      className={cn('flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors',
                        active ? 'border-jungle-green-500 bg-jungle-green-50' : 'border-border hover:bg-muted/50')}>
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                        {ct ? <Flag code={ct.code} className="h-4 w-5" /> : <Phone size={15} className="text-muted-foreground" />}
                      </span>
                      <span className="flex-1 font-mono text-sm tabular-nums text-foreground">
                        <span className="text-muted-foreground">{p.phone_dial}</span> {formatNational(p.phone)}
                      </span>
                      <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium',
                        p.is_primary ? 'bg-jungle-green-100 text-jungle-green-700' : 'border text-muted-foreground')}>
                        {displayLabel(p)}
                      </span>
                      {active && <Check size={16} className="shrink-0 text-jungle-green-600" />}
                    </button>
                  )
                })}
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label>Enviar a</Label>
              <div className="space-y-1.5">
                {emails.map(em => {
                  const active = toEmail === em.email
                  return (
                    <button key={em.id} type="button" onClick={() => setToEmail(em.email)}
                      className={cn('flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors',
                        active ? 'border-jungle-green-500 bg-jungle-green-50' : 'border-border hover:bg-muted/50')}>
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><AtSign size={15} /></span>
                      <span className="flex-1 truncate text-sm text-foreground">{em.email}</span>
                      <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium',
                        em.is_primary ? 'bg-jungle-green-100 text-jungle-green-700' : 'border text-muted-foreground')}>
                        {displayLabel(em)}
                      </span>
                      {active && <Check size={16} className="shrink-0 text-jungle-green-600" />}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Campos por canal */}
          {channel === 'email' ? (
            <>
              <div className="space-y-1.5">
                <Label>Enviar desde</Label>
                {emailAccounts.length === 0 ? (
                  <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
                    <AlertTriangle size={16} strokeWidth={1.75} /> Sin cuentas de correo configuradas; se usará la predeterminada.
                  </div>
                ) : (
                  <SelectMenu value={emailAccountId} onChange={setEmailAccountId} options={emailAccountOpts}
                    leadingIcon={<AtSign size={15} className="shrink-0 text-muted-foreground" />} placeholder="Elegir correo emisor" className="h-[52px]" />
                )}
              </div>
              {templates.length > 0 && (
                <div className="space-y-1.5">
                  <Label>Cargar plantilla (opcional)</Label>
                  <SelectMenu value={templateId} onChange={loadTemplate} options={templateOpts} placeholder="Sin plantilla" className="h-[52px]" />
                </div>
              )}
              <div className="space-y-1.5">
                <Label>Remitente</Label>
                <Input {...f('from_name')} required placeholder="Ej: Equipo de ventas" className={inputCls} />
              </div>
              <div className="space-y-1.5">
                <Label>Asunto</Label>
                <Input {...f('subject')} required placeholder="Asunto del correo" className={inputCls} />
                <p className="text-xs text-muted-foreground">Puedes usar <code className="rounded bg-muted px-1 py-0.5">{'{{first_name}}'}</code></p>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>CC (con copia) — opcional</Label>
                  <Input {...f('cc')} placeholder="correo1@x.com, correo2@y.com" className={inputCls} />
                  <p className="text-xs text-muted-foreground">Visibles; reciben también las respuestas.</p>
                </div>
                <div className="space-y-1.5">
                  <Label>CCO (con copia oculta) — opcional</Label>
                  <Input {...f('bcc')} placeholder="oculto1@x.com, oculto2@y.com" className={inputCls} />
                  <p className="text-xs text-muted-foreground">Ocultos; no ven las respuestas.</p>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Contenido HTML</Label>
                <textarea {...f('html_content')} required rows={6} placeholder="<p>Hola {{first_name}}, ...</p>"
                  className="w-full resize-y rounded-xl border border-transparent bg-muted/60 px-4 py-3 font-mono text-sm shadow-none transition-colors focus:border-ring focus:bg-background focus:outline-none" />
              </div>
            </>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label>Enviar desde</Label>
                {accounts.length === 0 ? (
                  <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
                    <AlertTriangle size={16} strokeWidth={1.75} /> {channel === 'whatsapp' ? 'Sin números WhatsApp conectados' : 'Sin gateways SMS online'}
                  </div>
                ) : (
                  <SelectMenu value={accountId} onChange={setAccountId} options={accountOpts}
                    leadingIcon={<PhoneCall size={15} className="shrink-0 text-muted-foreground" />} placeholder="Elegir cuenta" className="h-[52px]" />
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Mensaje</Label>
                <textarea {...f('message')} required rows={4} placeholder="Escribe tu mensaje..."
                  className="w-full resize-none rounded-xl border border-transparent bg-muted/60 px-4 py-3 text-sm shadow-none transition-colors focus:border-ring focus:bg-background focus:outline-none" />
                <p className="text-right text-xs text-muted-foreground">{form.message.length} caracteres</p>
              </div>
            </>
          )}

          {error && (
            <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <XCircle size={16} strokeWidth={1.75} /> {error}
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <Button type="submit" disabled={sending} className="flex-1">
              {sending ? <><Loader2 size={16} className="animate-spin" /> Enviando...</> : <><Send size={16} /> Enviar</>}
            </Button>
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">Cancelar</Button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Información de contacto — teléfonos y emails
// ─────────────────────────────────────────────────────────────────────────────
const PHONE_LABELS = ['Principal', 'Móvil', 'Trabajo', 'Casa', 'Otro']
const EMAIL_LABELS = ['Principal', 'Trabajo', 'Casa', 'Otro']

function IconBtn({ children, title, onClick, danger }) {
  return (
    <button type="button" title={title} onClick={onClick}
      className={cn('flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-background hover:text-foreground hover:shadow-sm',
        danger && 'hover:text-red-600')}>
      {children}
    </button>
  )
}

function LabelChips({ value, onChange, options }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(o => (
        <button key={o} type="button" onClick={() => onChange(o)}
          className={cn('rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
            value === o
              ? 'border-jungle-green-500 bg-jungle-green-50 text-jungle-green-700'
              : 'border-border text-muted-foreground hover:bg-muted')}>
          {o}
        </button>
      ))}
    </div>
  )
}

function PrimaryBadge({ primary, label }) {
  if (primary) return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-jungle-green-100 px-2 py-0.5 text-[11px] font-semibold text-jungle-green-700">
      <Star size={10} className="fill-jungle-green-500 text-jungle-green-500" /> Principal
    </span>
  )
  return (
    <span className="shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{label}</span>
  )
}

function PhoneRow({ item, selected, onSelect, onPrimary, onRemove }) {
  const [copied, setCopied] = useState(false)
  const full = fullNumber(item)
  const country = resolveCountry({ phone_country: item.phone_country, phone: full })
  function copy() {
    navigator.clipboard?.writeText(full)
    setCopied(true); setTimeout(() => setCopied(false), 1200)
  }
  return (
    <div className={cn('group relative flex items-center rounded-xl transition-colors',
      selected ? 'bg-jungle-green-50 ring-1 ring-jungle-green-300' : 'hover:bg-muted/50')}>
      <button type="button" onClick={() => onSelect(full)} title="Ver solo los mensajes de este número"
        className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2.5 py-2 text-left">
        <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
          selected ? 'bg-jungle-green-100' : 'bg-muted')}>
          {country ? <Flag code={country.code} className="h-4 w-5" /> : <Phone size={15} className="text-muted-foreground" />}
        </span>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="whitespace-nowrap font-mono text-sm font-medium tabular-nums text-foreground">
            <span className="text-muted-foreground">{item.phone_dial}</span> {formatNational(item.phone)}
          </span>
          <PrimaryBadge primary={item.is_primary} label={displayLabel(item)} />
          {selected && (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-jungle-green-700">
              <MessageCircle size={11} /> Viendo mensajes
            </span>
          )}
        </div>
      </button>
      <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5 rounded-lg bg-card px-1 py-0.5 opacity-0 shadow-sm ring-1 ring-border transition-opacity pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto">
        <IconBtn title={copied ? 'Copiado' : 'Copiar'} onClick={copy}>
          {copied ? <Check size={14} className="text-jungle-green-600" /> : <Copy size={14} />}
        </IconBtn>
        {!item.is_primary && <IconBtn title="Marcar como principal" onClick={onPrimary}><Star size={14} /></IconBtn>}
        <IconBtn title="Eliminar" danger onClick={onRemove}><Trash2 size={14} /></IconBtn>
      </div>
    </div>
  )
}

function EmailRow({ item, selected, onSelect, onPrimary, onRemove }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    navigator.clipboard?.writeText(item.email)
    setCopied(true); setTimeout(() => setCopied(false), 1200)
  }
  return (
    <div className={cn('group relative flex items-center rounded-xl transition-colors',
      selected ? 'bg-jungle-green-50 ring-1 ring-jungle-green-300' : 'hover:bg-muted/50')}>
      <button type="button" onClick={() => onSelect(item.email)} title="Ver solo la actividad de este correo"
        className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2.5 py-2 text-left">
        <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground',
          selected ? 'bg-jungle-green-100' : 'bg-muted')}>
          <AtSign size={15} />
        </span>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate text-sm font-medium text-foreground">{item.email}</span>
          <PrimaryBadge primary={item.is_primary} label={displayLabel(item)} />
          {selected && (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-jungle-green-700">
              <Mail size={11} /> Viendo actividad
            </span>
          )}
        </div>
      </button>
      <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5 rounded-lg bg-card px-1 py-0.5 opacity-0 shadow-sm ring-1 ring-border transition-opacity pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto">
        <IconBtn title={copied ? 'Copiado' : 'Copiar'} onClick={copy}>
          {copied ? <Check size={14} className="text-jungle-green-600" /> : <Copy size={14} />}
        </IconBtn>
        {!item.is_primary && <IconBtn title="Marcar como principal" onClick={onPrimary}><Star size={14} /></IconBtn>}
        <IconBtn title="Eliminar" danger onClick={onRemove}><Trash2 size={14} /></IconBtn>
      </div>
    </div>
  )
}

function ChannelSection({ contactId, items, type, onRefresh, selectedPhone, onSelectPhone, selectedEmail, onSelectEmail }) {
  const isPhone = type === 'phones'
  const apiBase = isPhone ? 'phones' : 'emails'
  const labels  = isPhone ? PHONE_LABELS : EMAIL_LABELS

  const [adding, setAdding]   = useState(false)
  const [country, setCountry] = useState(DEFAULT_COUNTRY)
  const [num, setNum]         = useState('')
  const [email, setEmail]     = useState('')
  const [label, setLabel]     = useState(isPhone ? 'Móvil' : 'Trabajo')
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState(null)

  function reset() {
    setNum(''); setEmail(''); setCountry(DEFAULT_COUNTRY)
    setLabel(isPhone ? 'Móvil' : 'Trabajo'); setError(null)
  }

  async function add(e) {
    e.preventDefault()
    setSaving(true); setError(null)
    try {
      const payload = isPhone
        ? { phone: num.replace(/\D/g, ''), phone_dial: country.dial, phone_country: country.code, label }
        : { email, label }
      const r = await api.post(`/contacts/${contactId}/${apiBase}`, payload)
      // Emails: "Principal" no es exclusivo en backend; lo forzamos como primario aquí.
      if (!isPhone && label === 'Principal' && r.data?.id) {
        await api.patch(`/contacts/${contactId}/emails/${r.data.id}/primary`).catch(() => {})
      }
      reset(); setAdding(false); onRefresh()
    } catch (err) { setError(err.response?.data?.error ?? err.message) }
    finally { setSaving(false) }
  }

  async function remove(itemId) {
    if (!confirm('¿Eliminar este registro?')) return
    await api.delete(`/contacts/${contactId}/${apiBase}/${itemId}`)
    onRefresh()
  }
  async function setPrimary(itemId) {
    await api.patch(`/contacts/${contactId}/${apiBase}/${itemId}/primary`)
    onRefresh()
  }

  const list = items ?? []

  return (
    <div className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-jungle-green-50 text-jungle-green-600">
            {isPhone ? <Phone size={14} /> : <Mail size={14} />}
          </span>
          <h3 className="text-sm font-semibold text-foreground">{isPhone ? 'Teléfonos' : 'Correos'}</h3>
          {list.length > 0 && (
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">
              {list.length}
            </span>
          )}
        </div>
        <button onClick={() => { setAdding(a => !a); setError(null) }}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-jungle-green-700 transition-colors hover:bg-jungle-green-50">
          {adding ? <X size={13} strokeWidth={2} /> : <Plus size={13} strokeWidth={2} />}
          {adding ? 'Cerrar' : 'Agregar'}
        </button>
      </div>

      {list.length > 0 && (isPhone ? onSelectPhone : onSelectEmail) && (
        <p className="mb-1.5 flex items-center gap-1 text-[11px] text-muted-foreground">
          {isPhone ? <MessageCircle size={11} /> : <Mail size={11} />}
          {isPhone ? 'Toca un número para ver solo sus mensajes' : 'Toca un correo para ver solo su actividad'}
        </p>
      )}

      <div className="space-y-0.5">
        {list.map(item => isPhone
          ? <PhoneRow key={item.id} item={item}
              selected={selectedPhone === fullNumber(item)}
              onSelect={onSelectPhone}
              onPrimary={() => setPrimary(item.id)} onRemove={() => remove(item.id)} />
          : <EmailRow key={item.id} item={item}
              selected={selectedEmail === item.email}
              onSelect={onSelectEmail}
              onPrimary={() => setPrimary(item.id)} onRemove={() => remove(item.id)} />
        )}
        {list.length === 0 && !adding && (
          <button onClick={() => setAdding(true)}
            className="flex w-full items-center gap-2 rounded-xl border border-dashed px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:border-jungle-green-300 hover:text-jungle-green-700">
            <Plus size={14} /> Agregar {isPhone ? 'teléfono' : 'correo'}
          </button>
        )}
      </div>

      {adding && (
        <form onSubmit={add} className="mt-3 space-y-3 rounded-xl border bg-muted/30 p-3">
          {isPhone ? (
            <CountryPhoneInput country={country} setCountry={setCountry} number={num} setNumber={setNum} placeholder="995 241 264" />
          ) : (
            <Input value={email} onChange={e => setEmail(e.target.value)} required type="email"
              placeholder="correo@ejemplo.com" className={inputCls} />
          )}
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Etiqueta</p>
            <LabelChips value={label} onChange={setLabel} options={labels} />
            {label === 'Principal' && (
              <p className="text-[11px] text-jungle-green-700">Reemplazará al principal actual.</p>
            )}
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={saving} className="flex-1">
              {saving ? <Loader2 size={14} className="animate-spin" /> : 'Guardar'}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => { setAdding(false); reset() }}>Cancelar</Button>
          </div>
        </form>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Métricas
// ─────────────────────────────────────────────────────────────────────────────
function MetricGroup({ title, icon: Icon, metrics }) {
  return (
    <div className="rounded-2xl border bg-card p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        <Icon size={15} className="text-muted-foreground" />
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {metrics.map(m => (
          <div key={m.label}>
            <p className="text-2xl font-bold tabular-nums text-foreground">{m.value ?? 0}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{m.label}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Timeline
// ─────────────────────────────────────────────────────────────────────────────
const CHANNEL_ICON  = { whatsapp: <MessageCircle size={14} />, sms: <Smartphone size={14} />, email: <Mail size={14} /> }
const CHANNEL_NAME  = { whatsapp: 'WhatsApp', sms: 'SMS', email: 'Email' }
const CHANNEL_COLOR = {
  whatsapp: 'bg-jungle-green-100 text-jungle-green-700 border-jungle-green-200',
  sms:      'bg-blue-100 text-blue-700 border-blue-200',
  email:    'bg-amber-100 text-amber-700 border-amber-200',
}
const STATUS_LABEL = {
  sent:      { text: 'Enviado',   cls: 'bg-blue-50 text-blue-700' },
  delivered: { text: 'Entregado', cls: 'bg-jungle-green-50 text-jungle-green-700' },
  read:      { text: 'Leído',     cls: 'bg-jungle-green-100 text-jungle-green-700' },
  received:  { text: 'Recibido',  cls: 'bg-jungle-green-50 text-jungle-green-700' },
  failed:    { text: 'Falló',     cls: 'bg-red-50 text-red-700' },
  queued:    { text: 'En cola',   cls: 'bg-muted text-muted-foreground' },
  pending:   { text: 'En cola',   cls: 'bg-muted text-muted-foreground' },
}

// Devuelve {icon,label,color, who, origin} explicando el evento de forma clara.
function describeEvent(event, contactName) {
  const chName = CHANNEL_NAME[event.channel] ?? 'Mensaje'
  switch (event.event_type) {
    case 'email_sent':
      return {
        icon: <ArrowUpRight size={13} />, color: 'text-amber-600', label: 'Email enviado',
        who: `Para ${event.email ?? contactName}`,
        origin: event.reference === 'Correo individual'
          ? 'Correo individual'
          : (event.reference ? `Campaña «${event.reference}»` : null),
      }
    case 'email_received':
      return {
        icon: <ArrowDownLeft size={13} />, color: 'text-jungle-green-600', label: 'Respuesta de correo',
        who: `De ${event.email ?? contactName}`,
        origin: event.subject ? `Asunto: ${event.subject}` : 'Respuesta del cliente',
      }
    case 'open':
      return { icon: <Eye size={13} />, color: 'text-violet-600', label: 'Abrió el email',
        who: `Por ${contactName}`, origin: event.reference ? `Campaña «${event.reference}»` : null }
    case 'click':
      return { icon: <Link2 size={13} />, color: 'text-indigo-600', label: 'Hizo clic en un enlace',
        who: `Por ${contactName}`, origin: event.reference ? `Campaña «${event.reference}»` : null }
    case 'unsub':
      return { icon: <XCircle size={13} />, color: 'text-red-600', label: 'Se desuscribió',
        who: `${contactName}`, origin: null }
    case 'msg_received':
      return {
        icon: <ArrowDownLeft size={13} />, color: 'text-jungle-green-600', label: `${chName} recibido`,
        who: `De ${contactName}`, number: event.from_number,
        account: event.account_phone ? { dir: 'Recibido en', name: event.account_name, phone: event.account_phone } : null,
        origin: 'Conversación directa',
      }
    default: // msg_sent
      return {
        icon: <ArrowUpRight size={13} />, color: 'text-blue-600', label: `${chName} enviado`,
        who: `Para ${contactName}`, number: event.to_number,
        account: event.account_phone ? { dir: 'Enviado desde', name: event.account_name, phone: event.account_phone } : null,
        origin: event.reference ? `Campaña «${event.reference}»` : 'Mensaje directo',
      }
  }
}

function TimelineItem({ event, last, contactName }) {
  const meta = describeEvent(event, contactName)
  const chColor = CHANNEL_COLOR[event.channel] ?? 'bg-muted text-muted-foreground border-border'
  const st = STATUS_LABEL[event.status]

  return (
    <div className="group flex gap-4">
      <div className="flex flex-col items-center">
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-sm ${chColor}`}>
          {CHANNEL_ICON[event.channel] ?? <Circle size={13} />}
        </div>
        {!last && <div className="mt-1 w-px flex-1 bg-border" />}
      </div>

      <div className="min-w-0 flex-1 pb-6">
        <div className="flex items-start justify-between gap-2">
          <span className={`inline-flex items-center gap-1.5 text-sm font-semibold ${meta.color}`}>
            {meta.icon} {meta.label}
          </span>
          <span className="mt-0.5 shrink-0 text-xs tabular-nums text-muted-foreground">
            {event.created_at ? new Date(event.created_at).toLocaleString('es', {
              day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
            }) : '...'}
          </span>
        </div>

        {/* Quién / a quién */}
        {meta.who && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {meta.who}
            {meta.number && <span className="font-mono"> · {meta.number}</span>}
          </p>
        )}

        {/* Cuenta/número nuestro con el que se envió o recibió */}
        {meta.account && (
          <p className="mt-1 inline-flex items-center gap-1.5 rounded-md bg-muted/60 px-2 py-1 text-xs text-muted-foreground">
            <PhoneCall size={12} className="text-jungle-green-600" />
            <span className="font-medium text-foreground">{meta.account.dir}:</span>
            {meta.account.name && <span>{meta.account.name}</span>}
            <span className="font-mono">{meta.account.phone}</span>
          </p>
        )}

        {/* Cuerpo del mensaje / asunto */}
        {event.body && (
          <p className="mt-1.5 line-clamp-3 rounded-lg bg-muted/50 px-3 py-2 text-sm text-foreground">
            {event.body}
          </p>
        )}

        {/* Estado + origen */}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {st && <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${st.cls}`}>{st.text}</span>}
          {meta.origin && (
            <span className="rounded-full border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{meta.origin}</span>
          )}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Página
// ─────────────────────────────────────────────────────────────────────────────
export default function Contact360Page() {
  const { id }  = useParams()
  const router  = useRouter()
  const [data, setData]           = useState(null)
  const [loading, setLoading]     = useState(true)
  const [filter, setFilter]       = useState('all')
  const [selected, setSelected]   = useState(null) // { kind:'phone'|'email', value } o null = todos
  const [showSend, setShowSend]   = useState(false)

  function load() {
    api.get(`/contacts/${id}/360`)
      .then(r => setData(r.data))
      .catch(() => router.push('/dashboard/contacts'))
      .finally(() => setLoading(false))
  }

  // Seleccionar un teléfono o correo filtra el timeline; volver a tocarlo lo quita.
  function toggleSelect(kind, value) {
    setSelected(prev => (prev && prev.kind === kind && prev.value === value ? null : { kind, value }))
    setFilter('all')
  }

  useEffect(() => { load() }, [id])

  // Tiempo real: cuando llega una respuesta de correo de este contacto (IMAP IDLE → SSE),
  // refresca el 360 para que la respuesta aparezca al instante en el timeline.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const token = localStorage.getItem('kubo_token')
    if (!token) return
    const base = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1').replace(/\/$/, '')
    let es
    try {
      es = new EventSource(`${base}/events?token=${encodeURIComponent(token)}`)
      es.addEventListener('email:inbound', e => {
        try {
          const ev = JSON.parse(e.data)
          if (String(ev.contact_id) === String(id)) load()
        } catch {}
      })
    } catch {}
    return () => { try { es && es.close() } catch {} }
  }, [id])

  if (loading) return (
    <div className="flex h-64 items-center justify-center">
      <Loader2 size={32} className="animate-spin text-jungle-green-600" />
    </div>
  )
  if (!data) return null

  const { contact, stats, timeline } = data
  const name = [contact.first_name, contact.last_name].filter(Boolean).join(' ')
    || fullNumber(contact) || contact.email || 'Contacto'
  const created = contact.created_at
    ? new Date(contact.created_at).toLocaleDateString('es', { day: '2-digit', month: 'long', year: 'numeric' })
    : null

  const filtered = timeline.filter(e => {
    const passChannel = filter === 'all' ? true : filter === 'email' ? e.channel === 'email' : e.channel === filter
    if (!passChannel) return false
    if (selected?.kind === 'phone') {
      if (e.channel === 'email') return false
      const num = e.direction === 'inbound' ? e.from_number : e.to_number
      return num === selected.value
    }
    if (selected?.kind === 'email') {
      return e.channel === 'email' && e.email === selected.value
    }
    return true
  })

  const FILTERS = [
    { key: 'all',      label: 'Todo',  Icon: null },
    { key: 'email',    label: 'Email', Icon: Mail },
    { key: 'whatsapp', label: 'WA',    Icon: MessageCircle },
    { key: 'sms',      label: 'SMS',   Icon: Smartphone },
  ]

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/dashboard/contacts" className="flex items-center gap-1 transition-colors hover:text-jungle-green-700">
          <ArrowLeft size={14} /> Contactos
        </Link>
        <span className="text-border">/</span>
        <span className="font-medium text-foreground">{name}</span>
      </div>

      {/* Hero header */}
      <div className="relative overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-br from-jungle-green-500/10 via-jungle-green-500/5 to-transparent" />
        <div className="relative flex flex-col gap-5 p-6 sm:flex-row sm:items-center">
          <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-jungle-green-600 text-3xl font-bold text-white shadow-lg shadow-jungle-green-600/20 ring-4 ring-background">
            {name?.[0]?.toUpperCase() ?? '?'}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-2xl font-bold tracking-tight text-foreground">{name}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              {contact.email && (
                <span className="inline-flex items-center gap-1.5"><AtSign size={13} /> {contact.email}</span>
              )}
              {created && (
                <span className="inline-flex items-center gap-1.5"><Calendar size={13} /> Desde {created}</span>
              )}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {(contact.lists ?? []).map(l => (
                <span key={l.id} className="inline-flex items-center gap-1 rounded-full bg-jungle-green-50 px-2.5 py-1 text-xs font-medium text-jungle-green-700">
                  <Users size={11} /> {l.name}
                </span>
              ))}
              {contact.is_subscribed === false
                ? <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-700">Desuscrito</span>
                : <span className="inline-flex items-center gap-1 rounded-full bg-jungle-green-50 px-2.5 py-1 text-xs font-medium text-jungle-green-700"><CheckCircle size={11} /> Suscrito</span>}
            </div>
          </div>
          <Button onClick={() => setShowSend(true)} size="lg" className="shrink-0">
            <Send size={16} /> Enviar mensaje
          </Button>
        </div>
      </div>

      {/* Dos columnas */}
      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        {/* Columna izquierda — información de contacto */}
        <div className="lg:sticky lg:top-6 lg:self-start">
          <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
            <div className="border-b px-5 py-4">
              <h2 className="text-sm font-semibold text-foreground">Información de contacto</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">Teléfonos y correos del contacto</p>
            </div>
            <div className="divide-y">
              <ChannelSection contactId={id} items={contact.phones} type="phones" onRefresh={load}
                selectedPhone={selected?.kind === 'phone' ? selected.value : null}
                onSelectPhone={v => toggleSelect('phone', v)} />
              <ChannelSection contactId={id} items={contact.emails} type="emails" onRefresh={load}
                selectedEmail={selected?.kind === 'email' ? selected.value : null}
                onSelectEmail={v => toggleSelect('email', v)} />
            </div>
          </div>
        </div>

        {/* Columna derecha — métricas + timeline */}
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <MetricGroup title="Email" icon={Mail} metrics={[
              { label: 'Enviados',  value: stats.email?.total_sent },
              { label: 'Aperturas', value: stats.email?.opens },
              { label: 'Clics',     value: stats.email?.clicks },
            ]} />
            <MetricGroup title="Mensajería" icon={MessageCircle} metrics={[
              { label: 'WhatsApp',   value: stats.messages?.whatsapp },
              { label: 'SMS',        value: stats.messages?.sms },
              { label: 'Respuestas', value: stats.messages?.received },
            ]} />
          </div>

          <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Línea de tiempo</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Toda la actividad con {name.split(' ')[0]}: mensajes de WhatsApp/SMS, emails de campañas y aperturas/clics.
                </p>
              </div>
              <div className="flex gap-0.5 rounded-lg bg-muted p-0.5">
                {FILTERS.map(ff => (
                  <button key={ff.key} onClick={() => setFilter(ff.key)}
                    className={cn('flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                      filter === ff.key ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
                    {ff.Icon && <ff.Icon size={12} strokeWidth={1.75} />}{ff.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Filtro activo (teléfono o correo) */}
            {selected && (
              <div className="flex items-center gap-2 border-b bg-jungle-green-50/60 px-5 py-2.5 text-xs">
                {selected.kind === 'phone'
                  ? <MessageCircle size={13} className="shrink-0 text-jungle-green-600" />
                  : <Mail size={13} className="shrink-0 text-jungle-green-600" />}
                <span className="text-muted-foreground">
                  Mostrando solo {selected.kind === 'phone' ? 'mensajes' : 'actividad'} de
                </span>
                <span className="truncate font-mono font-semibold text-foreground">{selected.value}</span>
                <button onClick={() => setSelected(null)}
                  className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 font-medium text-jungle-green-700 transition-colors hover:bg-jungle-green-100">
                  <X size={12} /> Ver todo
                </button>
              </div>
            )}

            <div className="p-6">
              {filtered.length === 0 ? (
                <EmptyState
                  icon={Inbox}
                  title="Sin actividad registrada"
                  description={filter !== 'all' ? 'No hay eventos para este canal.' : 'Cuando envíes o recibas mensajes aparecerán aquí.'}
                  action={filter !== 'all'
                    ? <Button variant="outline" size="sm" onClick={() => setFilter('all')}>Ver todo</Button>
                    : undefined}
                />
              ) : (
                <div>
                  {filtered.map((event, i) => (
                    <TimelineItem key={i} event={event} last={i === filtered.length - 1} contactName={name} />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {showSend && <SendModal contact={contact} onClose={() => setShowSend(false)} />}
    </div>
  )
}
