'use client'
import { useEffect, useState, useRef, useCallback } from 'react'
import api from '../../../lib/api'
import {
  Plus, Send, X, MessageCircle, Smartphone, Search, AlertTriangle, XCircle,
  Paperclip, Download, FileText, Mic, Loader2, Phone, Mail, AtSign, Users,
  Clock, CheckCircle, ExternalLink, RotateCcw, Inbox, PhoneCall, Check, Bot,
} from '../../../components/ui/icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Flag, resolveCountry, nationalNumber, CountryPhoneInput, DEFAULT_COUNTRY } from '@/components/ui/phone-input'
import { SelectMenu } from '@/components/ui/select-menu'
import { cn } from '@/lib/utils'

// ── Utilidades ───────────────────────────────────────────────────────────────
const CHANNEL_LABEL = { whatsapp: 'WhatsApp', sms: 'SMS' }
const CHANNEL_DOT   = { whatsapp: 'bg-green-500', sms: 'bg-violet-500' }
const CHANNEL_TINT  = {
  whatsapp: 'bg-green-100 text-green-700',
  sms:      'bg-violet-100 text-violet-700',
}

function initials(name, phone) {
  if (name) return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  return (phone ?? '?')[1] ?? '?'
}
function formatNational(n) {
  if (!n) return ''
  return String(n).replace(/\D/g, '').replace(/(\d{3})(?=\d)/g, '$1 ').trim()
}
function fullContactPhone(c) {
  if (!c) return null
  if (c.phone) return `${c.phone_dial ?? ''}${c.phone}`
  return null
}
function phoneTypeLabel(ph) {
  if (ph.is_primary) return 'Principal'
  return ph.label && ph.label !== 'Principal' ? ph.label : 'Otro'
}

// Muestra el número (dial + nacional agrupado) resaltando, como un solo bloque
// continuo, el tramo del nacional que coincide con la búsqueda.
function HighlightedNumber({ dial, phone, query }) {
  const d   = dial ?? ''
  const nat = String(phone ?? '')
  const raw = d + nat
  const q   = (query ?? '').replace(/[^\d+]/g, '')

  // Rango coincidente trasladado a coordenadas del número nacional
  let ns = -1, ne = -1
  if (q.length >= 1) {
    const idx = raw.indexOf(q)
    if (idx >= 0) { ns = Math.max(0, idx - d.length); ne = Math.max(0, idx + q.length - d.length) }
  }
  const inMatch = j => j >= ns && j < ne

  let pre = '', mid = '', post = ''
  for (let j = 0; j < nat.length; j++) {
    if (j > 0 && j % 3 === 0) {                 // espacio de agrupación antes del dígito j
      if (inMatch(j - 1) && inMatch(j)) mid += ' '
      else if (j <= ns) pre += ' '
      else post += ' '
    }
    const ch = nat[j]
    if (inMatch(j)) mid += ch
    else if (j < ns) pre += ch
    else post += ch
  }

  return (
    <span className="font-mono text-sm tabular-nums text-foreground">
      <span className="text-muted-foreground">{d}</span>{d && ' '}
      {pre}
      {mid && <span className="rounded bg-jungle-green-100 font-semibold text-jungle-green-800">{mid}</span>}
      {post}
    </span>
  )
}
function timeLabel(dateStr) {
  if (!dateStr) return ''
  const d   = new Date(dateStr)
  const now = new Date()
  const diffH = (now - d) / 3600000
  if (diffH < 24 && d.getDate() === now.getDate())
    return d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
  if (diffH < 48) return 'Ayer'
  return d.toLocaleDateString('es', { day: '2-digit', month: '2-digit' })
}

function Avatar({ name, phone, channel, size = 'md' }) {
  const sz  = size === 'sm' ? 'w-9 h-9 text-xs' : size === 'lg' ? 'w-16 h-16 text-2xl' : 'w-11 h-11 text-sm'
  const clr = channel === 'sms' ? 'bg-violet-100 text-violet-700' : 'bg-green-100 text-green-700'
  return (
    <div className={`${sz} ${clr} rounded-full flex items-center justify-center font-bold shrink-0`}>
      {initials(name, phone)}
    </div>
  )
}

function ChannelBadge({ channel, className }) {
  const Icon = channel === 'sms' ? Smartphone : MessageCircle
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', CHANNEL_TINT[channel] ?? 'bg-muted text-muted-foreground', className)}>
      <Icon size={11} strokeWidth={1.75} /> {CHANNEL_LABEL[channel] ?? channel}
    </span>
  )
}

// ── Modal nuevo mensaje ──────────────────────────────────────────────────────
function NewMessageModal({ onClose, onSent, initialChannel, initialPhone, initialAccountId }) {
  const initCountry = initialPhone ? (resolveCountry({ phone: initialPhone }) ?? DEFAULT_COUNTRY) : DEFAULT_COUNTRY
  const [channel, setChannel]         = useState(initialChannel ?? 'whatsapp')
  const [waAccounts, setWaAccounts]   = useState([])
  const [smsAccounts, setSmsAccounts] = useState([])
  // Hereda la "vía" filtrada en el Inbox; si no hay, cae al primero disponible.
  const [accountId, setAccountId]     = useState(initialAccountId ?? '')
  const [mode, setMode]               = useState(initialPhone ? 'manual' : 'search') // 'search' | 'manual'
  const [query, setQuery]             = useState('')
  const [results, setResults]         = useState([])
  const [selected, setSelected]       = useState(null)
  const [manualCountry, setManualCountry] = useState(initCountry)
  const [manualNumber, setManualNumber]   = useState(initialPhone ? nationalNumber(initialPhone, initCountry) : '')
  const [message, setMessage]         = useState('')
  const [sending, setSending]         = useState(false)
  const [error, setError]             = useState(null)
  const searchRef = useRef(null)

  useEffect(() => {
    api.get('/whatsapp/accounts').then(r => {
      setWaAccounts(r.data.filter(a => a.is_connected))
    }).catch(() => {})
    api.get('/sms/accounts').then(r => {
      setSmsAccounts(r.data.filter(a => a.is_online))
    }).catch(() => {})
  }, [])

  // Mantiene la cuenta elegida mientras siga siendo válida para el canal actual
  // (así no se pierde la vía heredada del filtro). Si no hay una válida: con un
  // único número se autoselecciona; con varios se deja vacío para que el usuario
  // elija a conciencia y no se envíe desde un número arbitrario.
  useEffect(() => {
    const list = channel === 'whatsapp' ? waAccounts : smsAccounts
    setAccountId(prev => {
      if (list.some(a => a.id === prev)) return prev
      return list.length === 1 ? list[0].id : ''
    })
  }, [channel, waAccounts, smsAccounts])

  useEffect(() => {
    if (mode !== 'search' || query.length < 1) { setResults([]); return }
    const t = setTimeout(() => {
      api.get(`/contacts/search?q=${encodeURIComponent(query)}&limit=8`)
        .then(r => setResults(r.data)).catch(() => {})
    }, 250)
    return () => clearTimeout(t)
  }, [query, mode])

  const accounts       = channel === 'whatsapp' ? waAccounts : smsAccounts
  const noAccounts     = accounts.length === 0
  const selectedAccount = accounts.find(a => a.id === accountId) ?? null
  const accountOpts = accounts.map(a => ({
    value: a.id,
    label: `${a.name} · ${a.phone_number ?? a.instance_name ?? '—'}`,
    icon: <span className={cn('h-2 w-2 shrink-0 rounded-full', channel === 'sms' ? 'bg-violet-500' : 'bg-green-500')} />,
  }))

  const manualDigits = manualNumber.replace(/\D/g, '')
  const manualFull   = manualDigits.length >= 6 ? `${manualCountry.dial}${manualDigits}` : null
  const selFull      = selected ? fullContactPhone(selected) : null
  const destination  = mode === 'search' ? selFull : manualFull

  function switchMode(m) { setMode(m); setError(null); setSelected(null); setQuery('') }

  async function send(e) {
    e.preventDefault()
    if (!destination) { setError(mode === 'search' ? 'Selecciona un contacto' : 'Ingresa un número válido'); return }
    if (!accountId)   { setError('Elige el número desde el que quieres enviar'); return }
    setSending(true); setError(null)
    try {
      const r = await api.post('/messages/send', {
        channel, account_id: accountId, to: destination, message: message.trim(),
      })
      onSent(r.data.conversation); onClose()
    } catch (err) {
      setError(err.response?.data?.error ?? err.message)
    } finally { setSending(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-2xl border bg-card shadow-xl">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <h2 className="flex items-center gap-2 font-semibold text-foreground"><Send size={16} strokeWidth={1.75} /> Nuevo mensaje</h2>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8 text-muted-foreground"><X size={18} strokeWidth={1.75} /></Button>
        </div>

        <form onSubmit={send} className="space-y-4 p-5">
          {/* Canal */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">Canal</label>
            <div className="flex gap-2">
              {[{ ch: 'whatsapp', lbl: 'WhatsApp', Icon: MessageCircle }, { ch: 'sms', lbl: 'SMS', Icon: Smartphone }].map(({ ch, lbl, Icon }) => (
                <button key={ch} type="button" onClick={() => { setChannel(ch); setError(null) }}
                  className={cn('flex flex-1 items-center justify-center gap-2 rounded-xl border-2 py-2.5 text-sm font-medium transition-colors',
                    channel === ch
                      ? ch === 'whatsapp' ? 'border-green-500 bg-green-50 text-green-700' : 'border-violet-500 bg-violet-50 text-violet-700'
                      : 'border-border text-muted-foreground hover:bg-muted/60')}>
                  <Icon size={15} strokeWidth={1.75} />{lbl}
                </button>
              ))}
            </div>
          </div>

          {/* Enviar desde (cuenta/vía) */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">Enviar desde</label>
            {noAccounts ? (
              <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                <AlertTriangle size={14} strokeWidth={1.75} /> {channel === 'whatsapp' ? 'Ningún número WhatsApp conectado' : 'Ningún gateway SMS online'}
              </div>
            ) : (
              <>
                <SelectMenu value={accountId} onChange={setAccountId} options={accountOpts}
                  leadingIcon={<PhoneCall size={15} className="shrink-0 text-muted-foreground" />} placeholder="Elegir número..." />
                {selectedAccount ? (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {channel === 'sms' ? 'El SMS saldrá desde' : 'El mensaje saldrá desde'}{' '}
                    <span className="font-mono font-medium text-foreground">
                      {selectedAccount.phone_number ?? selectedAccount.instance_name ?? '—'}
                    </span>
                  </p>
                ) : (
                  <p className="mt-1.5 flex items-start gap-1.5 text-xs text-amber-700">
                    <AlertTriangle size={13} strokeWidth={1.75} className="mt-px shrink-0" />
                    Tienes {accounts.length} números disponibles: elige desde cuál enviar.
                  </p>
                )}
              </>
            )}
          </div>

          {/* Para (destinatario) */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-xs font-semibold text-muted-foreground">Para</label>
              <div className="flex gap-0.5 rounded-lg bg-muted p-0.5">
                {[{ k: 'search', t: 'Buscar contacto' }, { k: 'manual', t: 'Número nuevo' }].map(({ k, t }) => (
                  <button key={k} type="button" onClick={() => switchMode(k)}
                    className={cn('rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors',
                      mode === k ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
                    {t}
                  </button>
                ))}
              </div>
            </div>

            {mode === 'manual' ? (
              <CountryPhoneInput country={manualCountry} setCountry={setManualCountry} number={manualNumber} setNumber={setManualNumber} placeholder="986 095 857" />
            ) : selected ? (
              (() => {
                const selName = [selected.first_name, selected.last_name].filter(Boolean).join(' ')
                const selCt   = selFull ? resolveCountry({ phone_country: selected.phone_country, phone: selFull }) : null
                return (
                  <div className="flex items-center gap-3 rounded-xl border-2 border-jungle-green-500 bg-jungle-green-50 px-3 py-2.5">
                    <Avatar name={selName} phone={selFull} channel={channel} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">{selName || selFull}</p>
                      <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                        {selCt && <Flag code={selCt.code} className="h-2.5 w-3.5" />}
                        <span className="font-mono">{selFull}</span>
                        {selected.label && <span className="rounded-full bg-jungle-green-100 px-1.5 py-0.5 text-[10px] font-medium text-jungle-green-700">{phoneTypeLabel(selected)}</span>}
                      </p>
                    </div>
                    <button type="button" onClick={() => { setSelected(null); searchRef.current?.focus() }} className="shrink-0 text-muted-foreground hover:text-foreground"><X size={16} strokeWidth={1.75} /></button>
                  </div>
                )
              })()
            ) : (
              <div className="relative">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground" strokeWidth={1.75} />
                <Input ref={searchRef} autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="Nombre, número o correo..."
                  className="h-[52px] rounded-xl border-transparent bg-muted/60 pl-11 text-base shadow-none transition-colors focus-visible:border-ring focus-visible:bg-background focus-visible:ring-0" />
                {results.length > 0 && (
                  <div className="absolute top-full z-10 mt-1 max-h-80 w-full overflow-y-auto rounded-xl border bg-card p-1.5 shadow-lg">
                    {results.map(c => {
                      const fullname = [c.first_name, c.last_name].filter(Boolean).join(' ')
                      const phones   = c.phones ?? []
                      return (
                        <div key={c.id} className="flex gap-2.5 rounded-lg px-2 py-1.5">
                          <Avatar name={fullname} phone={phones[0] ? `${phones[0].phone_dial ?? ''}${phones[0].phone}` : null} channel={channel} size="sm" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-foreground">{fullname || c.email || 'Contacto'}</p>
                            {c.email && fullname && <p className="truncate text-[11px] text-muted-foreground">{c.email}{c.list_name ? ` · ${c.list_name}` : ''}</p>}
                            {phones.length > 0 ? (
                              <div className="mt-1 space-y-0.5">
                                {phones.map((ph, i) => {
                                  const full = `${ph.phone_dial ?? ''}${ph.phone}`
                                  const ct   = resolveCountry({ phone_country: ph.phone_country, phone: full })
                                  return (
                                    <button key={i} type="button"
                                      onClick={() => { setSelected({ first_name: c.first_name, last_name: c.last_name, email: c.email, ...ph }); setResults([]) }}
                                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-jungle-green-50">
                                      {ct ? <Flag code={ct.code} className="h-3 w-4 shrink-0" /> : <Phone size={13} className="shrink-0 text-muted-foreground" />}
                                      <HighlightedNumber dial={ph.phone_dial} phone={ph.phone} query={query} />
                                      <span className={cn('ml-auto shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                                        ph.is_primary ? 'bg-jungle-green-100 text-jungle-green-700' : 'border text-muted-foreground')}>
                                        {phoneTypeLabel(ph)}
                                      </span>
                                    </button>
                                  )
                                })}
                              </div>
                            ) : (
                              <p className="mt-0.5 text-[11px] text-muted-foreground">Sin teléfono registrado</p>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
                {query.length > 0 && results.length === 0 && (
                  <p className="mt-1.5 text-xs text-muted-foreground">Sin resultados. Usa <button type="button" onClick={() => switchMode('manual')} className="font-medium text-jungle-green-700 hover:underline">Número nuevo</button> para escribir un número.</p>
                )}
              </div>
            )}
          </div>

          {/* Mensaje */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">Mensaje</label>
            <textarea value={message} onChange={e => setMessage(e.target.value)} required rows={3} placeholder="Escribe tu mensaje..."
              className="w-full resize-none rounded-xl border-transparent bg-muted/60 px-3.5 py-2.5 text-sm text-foreground shadow-none transition-colors focus:border-ring focus:bg-background focus:outline-none" />
            <p className="mt-1 text-right text-xs text-muted-foreground">{message.length} caracteres</p>
          </div>

          {error && <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"><XCircle size={14} strokeWidth={1.75} /> {error}</div>}

          <div className="flex gap-3">
            <Button type="submit" disabled={sending || noAccounts || !accountId || !message.trim() || !destination} className="flex-1">
              {sending ? <><Loader2 size={14} className="animate-spin" /> Enviando...</> : <><Send size={14} strokeWidth={1.75} /> Enviar</>}
            </Button>
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">Cancelar</Button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Modal resumen IA ─────────────────────────────────────────────────────────
function AiSummaryModal({ loading, error, summary, onClose, onRegenerate }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-2xl border bg-card shadow-xl">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <h2 className="flex items-center gap-2 font-semibold text-foreground"><Bot size={16} strokeWidth={1.75} /> Resumen IA</h2>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8 text-muted-foreground"><X size={18} strokeWidth={1.75} /></Button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 size={16} className="animate-spin" /> Generando resumen…
            </div>
          )}
          {!loading && error && (
            <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <XCircle size={14} strokeWidth={1.75} /> {error}
            </div>
          )}
          {!loading && !error && summary && (
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{summary}</p>
          )}
        </div>

        <div className="flex gap-3 border-t p-4">
          <Button type="button" variant="outline" onClick={onRegenerate} disabled={loading} className="flex-1">
            {loading ? <><Loader2 size={14} className="animate-spin" /> Generando...</> : <><RotateCcw size={14} strokeWidth={1.75} /> Regenerar</>}
          </Button>
          <Button type="button" variant="outline" onClick={onClose} className="flex-1">Cerrar</Button>
        </div>
      </div>
    </div>
  )
}

// ── Panel derecho: detalle del contacto/conversación ─────────────────────────
function PanelRow({ icon: Icon, label, children }) {
  return (
    <div className="flex items-start gap-2.5 text-sm">
      <Icon size={15} className="mt-0.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
        <div className="text-foreground">{children}</div>
      </div>
    </div>
  )
}

function ContactPanel({ conversation, messages, onNewMessage, onClose }) {
  const [contact, setContact] = useState(null)
  useEffect(() => {
    if (!conversation?.contact_phone) { setContact(null); return }
    api.get(`/contacts/by-phone/${encodeURIComponent(conversation.contact_phone)}`)
      .then(r => setContact(r.data)).catch(() => setContact(null))
  }, [conversation?.contact_phone])

  if (!conversation) return null

  const name = contact
    ? [contact.first_name, contact.last_name].filter(Boolean).join(' ')
    : conversation.contact_name ?? ''
  const convCountry = resolveCountry({ phone: conversation.contact_phone })
  const inCount  = messages.filter(m => m.direction === 'inbound').length
  const outCount = messages.filter(m => m.direction === 'outbound').length
  const started  = conversation.created_at
    ? new Date(conversation.created_at).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' })
    : null

  return (
    <div className="flex w-80 shrink-0 flex-col overflow-y-auto border-l bg-card">
      {/* Cabecera */}
      <div className="border-b p-5 text-center">
        <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-jungle-green-600 text-2xl font-bold text-white shadow-lg shadow-jungle-green-600/20">
          {initials(name, conversation.contact_phone)}
        </div>
        <p className="font-semibold text-foreground">{name || (conversation.is_group ? 'Grupo' : conversation.contact_phone)}</p>
        <div className="mt-1 flex items-center justify-center gap-1.5 text-sm text-muted-foreground">
          {conversation.is_group ? (
            <span className="inline-flex items-center gap-1">👥 Grupo</span>
          ) : (
            <>
              {convCountry && <Flag code={convCountry.code} className="h-3 w-4" />}
              <span className="font-mono">{conversation.contact_phone}</span>
            </>
          )}
        </div>
        <div className="mt-2.5 flex items-center justify-center gap-2">
          <ChannelBadge channel={conversation.channel} />
          {contact?.is_subscribed === false
            ? <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700">Desuscrito</span>
            : contact && <span className="inline-flex items-center gap-1 rounded-full bg-jungle-green-50 px-2 py-0.5 text-[11px] font-medium text-jungle-green-700"><CheckCircle size={10} /> Suscrito</span>}
        </div>
      </div>

      {/* Datos de la conversación */}
      <div className="space-y-3 border-b p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Conversación</p>
        <PanelRow icon={PhoneCall} label="Cuenta usada">
          {conversation.account_name
            ? <span>{conversation.account_name} {conversation.account_phone && <span className="font-mono text-xs text-muted-foreground">· {conversation.account_phone}</span>}</span>
            : <span className="text-muted-foreground">—</span>}
        </PanelRow>
        {started && <PanelRow icon={Clock} label="Iniciada">{started}</PanelRow>}
        <PanelRow icon={MessageCircle} label="Mensajes">
          <span>{messages.length} <span className="text-xs text-muted-foreground">· {inCount} recibidos · {outCount} enviados</span></span>
        </PanelRow>
      </div>

      {/* Información de contacto */}
      {contact && (contact.phones?.length > 0 || contact.emails?.length > 0) && (
        <div className="space-y-2 border-b p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Información de contacto</p>
          {contact.phones?.map(p => {
            const ct = resolveCountry({ phone_country: p.phone_country, phone: `${p.phone_dial ?? ''}${p.phone}` })
            return (
              <div key={p.id} className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
                  {ct ? <Flag code={ct.code} className="h-3.5 w-5" /> : <Phone size={14} className="text-muted-foreground" />}
                </span>
                <span className="flex-1 truncate font-mono text-sm text-foreground">
                  <span className="text-muted-foreground">{p.phone_dial}</span> {formatNational(p.phone)}
                </span>
                {p.is_primary && <span className="rounded-full bg-jungle-green-100 px-1.5 py-0.5 text-[10px] font-semibold text-jungle-green-700">Principal</span>}
              </div>
            )
          })}
          {contact.emails?.map(em => (
            <div key={em.id} className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground"><AtSign size={14} /></span>
              <span className="flex-1 truncate text-sm text-foreground">{em.email}</span>
              {em.is_primary && <span className="rounded-full bg-jungle-green-100 px-1.5 py-0.5 text-[10px] font-semibold text-jungle-green-700">Principal</span>}
            </div>
          ))}
        </div>
      )}

      {/* Listas */}
      {contact?.lists?.length > 0 && (
        <div className="border-b p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Listas</p>
          <div className="flex flex-wrap gap-1.5">
            {contact.lists.map(l => (
              <span key={l.id} className="inline-flex items-center gap-1 rounded-full bg-jungle-green-50 px-2 py-1 text-xs font-medium text-jungle-green-700"><Users size={11} /> {l.name}</span>
            ))}
          </div>
        </div>
      )}

      {/* Acciones rápidas */}
      <div className="space-y-2 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Enviar mensaje</p>
        <button onClick={() => onNewMessage('whatsapp', conversation.contact_phone)}
          className="flex w-full items-center gap-2 rounded-xl bg-jungle-green-50 px-3 py-2.5 text-sm font-medium text-jungle-green-700 transition-colors hover:bg-jungle-green-100">
          <MessageCircle size={15} strokeWidth={1.75} /> WhatsApp <span className="ml-auto text-xs">Enviar →</span>
        </button>
        <button onClick={() => onNewMessage('sms', conversation.contact_phone)}
          className="flex w-full items-center gap-2 rounded-xl bg-blue-50 px-3 py-2.5 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-100">
          <Smartphone size={15} strokeWidth={1.75} /> SMS <span className="ml-auto text-xs">Enviar →</span>
        </button>
      </div>

      {/* Ver 360 / agregar */}
      <div className="mt-auto border-t p-4">
        {contact ? (
          <Button asChild variant="outline" className="w-full">
            <a href={`/dashboard/contacts/${contact.id}`}><ExternalLink size={14} strokeWidth={1.75} /> Ver perfil 360°</a>
          </Button>
        ) : (
          <div className="rounded-xl border border-amber-100 bg-amber-50 p-3 text-xs text-amber-700">
            Este número no está en tus listas de contactos.
            <a href="/dashboard/contacts" className="mt-1 block font-medium underline">Agregar a contactos →</a>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Renderizador de media ────────────────────────────────────────────────────
function MediaContent({ msg, isOut }) {
  if (!msg.media_url && !msg.media_type) return null
  const url  = msg.media_url
  const type = msg.media_type ?? 'image'

  if (type === 'image' || type === 'sticker') {
    return url
      ? <img src={url} alt="imagen" className="mb-1 max-h-[300px] max-w-[240px] cursor-pointer rounded-xl object-cover" onClick={() => window.open(url, '_blank')} />
      : <div className="mb-1 flex h-32 w-48 items-center justify-center rounded-xl bg-black/10 text-2xl">🖼️</div>
  }
  if (type === 'audio') {
    return url
      ? <audio controls src={url} className="mb-1 max-w-[240px]" style={{ height: 36 }} />
      : <div className={`mb-1 flex items-center gap-2 rounded-xl px-3 py-2 ${isOut ? 'bg-jungle-green-500' : 'bg-muted'}`}><Mic size={16} strokeWidth={1.75} className={isOut ? 'text-white' : 'text-muted-foreground'} /><span className={`text-xs ${isOut ? 'text-jungle-green-100' : 'text-muted-foreground'}`}>Mensaje de voz</span></div>
  }
  if (type === 'video') {
    return url
      ? <video controls src={url} className="mb-1 max-h-[200px] max-w-[240px] rounded-xl" />
      : <div className="mb-1 flex h-32 w-48 items-center justify-center rounded-xl bg-black/10 text-2xl">🎥</div>
  }
  if (type === 'document') {
    return (
      <a href={url ?? '#'} target="_blank" rel="noreferrer"
        className={`mb-1 flex items-center gap-2 rounded-xl px-3 py-2 no-underline ${isOut ? 'bg-jungle-green-500' : 'bg-muted'}`}>
        <FileText size={16} strokeWidth={1.75} className={isOut ? 'text-white' : 'text-muted-foreground'} />
        <span className={`max-w-[160px] truncate text-xs font-medium ${isOut ? 'text-white' : 'text-foreground'}`}>{msg.media_caption || 'Documento'}</span>
        {url && <Download size={13} strokeWidth={1.75} className={isOut ? 'text-jungle-green-100' : 'text-muted-foreground'} />}
      </a>
    )
  }
  return null
}

// Indicador de estado del mensaje saliente, idéntico al de WhatsApp.
//   sending (optimista, sin ACK)  →  reloj
//   sent     (server lo aceptó)   →  ✓ gris
//   delivered (llegó al device)   →  ✓✓ gris
//   read     (el contacto lo leyó)→  ✓✓ azul, un poco más juntas
//   failed   (rebote)             →  ! rojo
function MessageStatus({ status }) {
  // El color se hereda del contenedor (text-jungle-green-100 dentro de la burbuja
  // verde, text-muted-foreground en el sidebar). Solo el 'read' fuerza azul.
  if (status === 'failed') {
    return <span className="text-xs font-bold text-red-400" title="Error al enviar">!</span>
  }
  if (status === 'sending' || !status) {
    return <Clock size={13} strokeWidth={1.75} className="opacity-70" title="Enviando…" />
  }
  if (status === 'sent') {
    // Un solo check
    return (
      <svg viewBox="0 0 16 11" width="16" height="11" title="Enviado" aria-label="Enviado">
        <path fill="currentColor" d="M11.071 1.0L4.95 7.121 1.929 4.1.515 5.514l4.435 4.435L12.485 2.414z" />
      </svg>
    )
  }
  if (status === 'delivered' || status === 'read') {
    // Dos checks superpuestos (estilo WhatsApp). En 'read' forzamos azul WhatsApp.
    const sty = status === 'read' ? { color: '#53bdeb' } : undefined
    return (
      <svg viewBox="0 0 18 11" width="18" height="11" style={sty} title={status === 'read' ? 'Visto' : 'Entregado'} aria-label={status}>
        <path fill="currentColor" d="M11.071 1.0L4.95 7.121 1.929 4.1.515 5.514l4.435 4.435L12.485 2.414z" />
        <path fill="currentColor" transform="translate(4 0)" d="M11.071 1.0L4.95 7.121 1.929 4.1.515 5.514l4.435 4.435L12.485 2.414z" />
      </svg>
    )
  }
  return null
}

// Etiqueta de presencia tipo WhatsApp ("en línea", "escribiendo...", "últ. vez hoy 14:30").
function PresenceLabel({ presence }) {
  if (!presence) return null
  const { presence: p, last_seen_at } = presence
  if (p === 'composing') return <span className="flex items-center gap-1 text-jungle-green-600"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-jungle-green-600" />escribiendo…</span>
  if (p === 'recording') return <span className="flex items-center gap-1 text-jungle-green-600"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-jungle-green-600" />grabando audio…</span>
  if (p === 'available') return <span className="flex items-center gap-1 text-jungle-green-600"><span className="h-1.5 w-1.5 rounded-full bg-jungle-green-500" />en línea</span>
  if (last_seen_at) {
    const d = new Date(last_seen_at)
    const ahora = new Date()
    const hoy = d.toDateString() === ahora.toDateString()
    const txt = hoy
      ? `hoy ${d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}`
      : d.toLocaleDateString('es', { day: '2-digit', month: '2-digit' }) + ` ${d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}`
    return <span>últ. vez {txt}</span>
  }
  return null
}

// ── Página principal ─────────────────────────────────────────────────────────
const STATUS_FILTERS = [
  { key: 'open',   label: 'Abiertas' },
  { key: 'closed', label: 'Cerradas' },
  { key: 'all',    label: 'Todas' },
]
const CHANNEL_FILTERS = [
  { key: '',         label: 'Todos', Icon: null },
  { key: 'whatsapp', label: 'WhatsApp', Icon: MessageCircle },
  { key: 'sms',      label: 'SMS', Icon: Smartphone },
]

export default function InboxPage() {
  const [conversations, setConversations] = useState([])
  const [selected, setSelected]           = useState(null)
  const [messages, setMessages]           = useState([])
  const [replyText, setReplyText]         = useState('')
  const [sending, setSending]             = useState(false)
  const [channelFilter, setChannelFilter] = useState('')
  const [statusFilter, setStatusFilter]   = useState('open')
  const [accountFilter, setAccountFilter] = useState('')
  const [unreadOnly, setUnreadOnly]       = useState(false)
  const [search, setSearch]               = useState('')
  const [accounts, setAccounts]           = useState([])
  const [showNew, setShowNew]             = useState(false)
  const [newMsgOpts, setNewMsgOpts]       = useState(null)
  const messagesEndRef  = useRef(null)
  const inputRef        = useRef(null)
  const fileInputRef    = useRef(null)
  const selectedIdRef   = useRef(null)
  const [attachPreview, setAttachPreview] = useState(null)
  const [uploading, setUploading]         = useState(false)
  const [presence, setPresence]           = useState(null) // { presence, last_seen_at }
  const [showAiSummary, setShowAiSummary]       = useState(false)
  const [aiSummaryLoading, setAiSummaryLoading] = useState(false)
  const [aiSummaryError, setAiSummaryError]     = useState(null)
  const [aiSummaryText, setAiSummaryText]       = useState(null)
  const [statusActionError, setStatusActionError] = useState(null)

  const loadConversations = useCallback(() => {
    const params = new URLSearchParams()
    if (channelFilter) params.set('channel', channelFilter)
    if (accountFilter) params.set('account', accountFilter)
    params.set('status', statusFilter)
    api.get(`/conversations?${params.toString()}`).then(r => setConversations(r.data)).catch(() => {})
  }, [channelFilter, statusFilter, accountFilter])

  useEffect(() => { loadConversations() }, [loadConversations])

  // Cuentas (números) disponibles para el filtro "vía"
  useEffect(() => {
    Promise.all([
      api.get('/whatsapp/accounts').catch(() => ({ data: [] })),
      api.get('/sms/accounts').catch(() => ({ data: [] })),
    ]).then(([wa, sms]) => {
      setAccounts([
        ...wa.data.map(a => ({ ...a, channel: 'whatsapp' })),
        ...sms.data.map(a => ({ ...a, channel: 'sms' })),
      ])
    })
  }, [])
  // SSE: push del backend en vez de polling. Reconecta solo si la pestaña vuelve
  // a estar visible. Fallback de polling cada 60s por si el stream se rompe.
  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('kubo_token') : null
    if (!token) return

    const base = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1').replace(/\/$/, '')
    let es = null
    let pollFallback = null
    let cerrado = false

    function aplicarEventoMensajeNuevo(payload) {
      const convId = payload.conversation_id
      const msg    = payload.message
      // Si la conv abierta es la del mensaje, lo agrego al stream sin pedir nada.
      if (selectedIdRef.current === convId && msg) {
        setMessages(prev => {
          if (prev.some(m => m.id === msg.id)) return prev
          setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
          return [...prev, msg]
        })
      }
      // Actualizar la lista en memoria: mover conv arriba + refrescar preview/unread.
      if (msg) {
        setConversations(prev => {
          const idx = prev.findIndex(c => c.id === convId)
          if (idx < 0) { loadConversations(); return prev } // no la tenemos cargada, fallback
          const c = {
            ...prev[idx],
            last_body:      msg.body,
            last_direction: msg.direction,
            last_status:    msg.status,
            last_message_at: msg.created_at ?? new Date().toISOString(),
            unread_count:   msg.direction === 'inbound' && selectedIdRef.current !== convId
                              ? (prev[idx].unread_count ?? 0) + 1
                              : prev[idx].unread_count ?? 0,
          }
          const sin = prev.filter((_, i) => i !== idx)
          return [c, ...sin]
        })
      } else {
        loadConversations()
      }
    }

    function aplicarEventoEstado(payload) {
      const { message_id, conversation_id, status, delivered_at, read_at } = payload
      setMessages(prev => prev.map(m =>
        m.id === message_id ? { ...m, status, delivered_at, read_at } : m
      ))
      // Sincroniza el sidebar: si este msg es el último de la conv, refleja el ✓/✓✓/✓✓ azul.
      setConversations(prev => prev.map(c =>
        c.id === conversation_id ? { ...c, last_status: status } : c
      ))
    }

    function aplicarEventoConvLeida(payload) {
      setConversations(prev => prev.map(c =>
        c.id === payload.conversation_id ? { ...c, unread_count: 0 } : c
      ))
    }

    function aplicarPresencia(payload) {
      // Filtramos al contacto que esté abierto en el chat
      const selPhone = selectedRef.current?.contact_phone
      if (selPhone && selPhone === payload.contact_phone) {
        setPresence({ presence: payload.presence, last_seen_at: payload.last_seen_at })
      }
    }

    function abrir() {
      if (cerrado) return
      try {
        es = new EventSource(`${base}/events?token=${encodeURIComponent(token)}`)
        es.addEventListener('message:new',     e => aplicarEventoMensajeNuevo(JSON.parse(e.data)))
        es.addEventListener('message:status',  e => aplicarEventoEstado(JSON.parse(e.data)))
        es.addEventListener('conversation:read', e => aplicarEventoConvLeida(JSON.parse(e.data)))
        es.addEventListener('presence:update', e => aplicarPresencia(JSON.parse(e.data)))
        es.onerror = () => {
          // EventSource reintenta solo. Si lo hace muchas veces, activamos fallback de polling
          // mientras tanto para no quedar a ciegas.
          if (!pollFallback) {
            pollFallback = setInterval(() => {
              loadConversations()
              const convId = selectedIdRef.current
              if (convId) api.get(`/conversations/${convId}`).then(r => setMessages(r.data.messages ?? [])).catch(() => {})
            }, 60000)
          }
        }
        es.onopen = () => {
          if (pollFallback) { clearInterval(pollFallback); pollFallback = null }
        }
      } catch {}
    }

    abrir()

    function onVisibilityChange() {
      if (document.hidden) {
        es?.close(); es = null
        if (pollFallback) { clearInterval(pollFallback); pollFallback = null }
      } else if (!es) {
        loadConversations() // refresco al volver
        abrir()
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      cerrado = true
      document.removeEventListener('visibilitychange', onVisibilityChange)
      es?.close()
      if (pollFallback) clearInterval(pollFallback)
    }
  }, [loadConversations])

  const selectedRef = useRef(null)
  useEffect(() => {
    selectedIdRef.current = selected?.id ?? null
    selectedRef.current = selected ?? null
  }, [selected])

  async function openConversation(conv) {
    setSelected(conv)
    setPresence(null) // reset hasta confirmar
    setShowAiSummary(false); setAiSummaryText(null); setAiSummaryError(null) // reset resumen IA al cambiar de chat
    setStatusActionError(null)
    const r = await api.get(`/conversations/${conv.id}`)
    setSelected(r.data)
    setMessages(r.data.messages ?? [])
    // Marca inbound como leídos POR el operador. El backend además emite
    // conversation:read para sincronizar otras pestañas / agentes.
    api.post(`/conversations/${conv.id}/read`).catch(() => {})
    // Solo WhatsApp tiene presencia. Le decimos a Baileys "avisame de este contacto".
    if (conv.channel === 'whatsapp') {
      api.post(`/conversations/${conv.id}/presence-subscribe`)
        .then(res => setPresence({ presence: res.data?.presence, last_seen_at: res.data?.last_seen_at }))
        .catch(() => {})
    }
    setTimeout(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); inputRef.current?.focus() }, 100)
  }

  async function handleFileSelect(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const preview = URL.createObjectURL(file)
    const type = file.type.startsWith('image/') ? 'image' : file.type.startsWith('audio/') ? 'audio' : file.type.startsWith('video/') ? 'video' : 'document'
    setAttachPreview({ localUrl: preview, type, file, filename: file.name })
  }
  function clearAttach() { setAttachPreview(null); if (fileInputRef.current) fileInputRef.current.value = '' }

  async function sendReply(e) {
    e.preventDefault()
    if (!replyText.trim() && !attachPreview) return
    if (!selected) return
    setSending(true)
    try {
      let mediaUrl = null, mediaType = null, mediaCaption = null
      if (attachPreview) {
        setUploading(true)
        const fd = new FormData()
        fd.append('file', attachPreview.file, attachPreview.filename)
        const r = await api.post('/media/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
        mediaUrl = r.data.url; mediaType = r.data.type; mediaCaption = replyText.trim() || attachPreview.filename
        setUploading(false)
      }
      const r = await api.post(`/conversations/${selected.id}/reply`, {
        body: attachPreview ? undefined : replyText.trim(),
        media_url: mediaUrl ?? undefined, media_type: mediaType ?? undefined, media_caption: mediaCaption ?? undefined,
      })
      setReplyText(''); clearAttach()
      // Agrega el msg al stream sin esperar el SSE (que igual llegará y se dedupa por id).
      if (r?.data?.id) {
        setMessages(prev => prev.some(m => m.id === r.data.id) ? prev : [...prev, r.data])
      }
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
    } catch (err) {
      alert('Error: ' + (err.response?.data?.error ?? err.message))
    } finally { setSending(false); setUploading(false) }
  }

  async function generateAiSummary() {
    if (!selected) return
    setAiSummaryLoading(true); setAiSummaryError(null)
    try {
      const r = await api.post(`/conversations/${selected.id}/summary`)
      setAiSummaryText(r.data.summary)
    } catch (err) {
      setAiSummaryError(err.response?.data?.error ?? err.message)
    } finally {
      setAiSummaryLoading(false)
    }
  }
  function openAiSummary() {
    setShowAiSummary(true)
    generateAiSummary()
  }

  async function setConvStatus(status) {
    setStatusActionError(null)
    try {
      await api.patch(`/conversations/${selected.id}/status`, { status })
      if (status === 'closed' && statusFilter === 'open') { setSelected(null); setMessages([]) }
      else setSelected(s => ({ ...s, status }))
      loadConversations()
    } catch (err) {
      setStatusActionError(err.response?.data?.error ?? err.message)
    }
  }

  const filtered = conversations.filter(c => {
    if (unreadOnly && !(c.unread_count > 0)) return false
    if (!search) return true
    const q = search.toLowerCase()
    return (c.contact_name ?? '').toLowerCase().includes(q) || (c.contact_phone ?? '').includes(q)
  })
  const totalUnread = conversations.reduce((a, c) => a + (c.unread_count > 0 ? 1 : 0), 0)

  // Número activo: filtra la lista Y es el emisor de los mensajes nuevos. La lista
  // `accounts` ya viene filtrada por rol desde la API (un asesor solo ve los suyos,
  // el administrador los ve todos).
  const activeAccount = accounts.find(a => a.id === accountFilter) ?? null

  // Tabs de canal y selector de número se sincronizan para no dejar combinaciones
  // imposibles (p.ej. gateway SMS + tab WhatsApp = 0 chats siempre).
  const accountOptions = accounts.filter(a => !channelFilter || a.channel === channelFilter)

  function pickAccount(id) {
    setAccountFilter(id)
    const acc = accounts.find(a => a.id === id)
    if (acc) setChannelFilter(acc.channel) // el número define el canal
  }

  function pickChannel(key) {
    setChannelFilter(key)
    // Si el número activo no es de ese canal, se vuelve a "Todas las vías".
    if (key && activeAccount && activeAccount.channel !== key) setAccountFilter('')
  }

  return (
    <div className="-m-6 flex overflow-hidden" style={{ height: 'calc(100vh - 49px)' }}>

      {/* ── Panel izquierdo: lista ── */}
      <div className="flex w-[340px] shrink-0 flex-col border-r bg-card">
        {/* Título */}
        <div className="flex items-center justify-between px-4 pb-2 pt-4">
          <div className="flex items-center gap-2">
            <h2 className="text-[15px] font-semibold tracking-tight text-foreground">Bandeja de entrada</h2>
            {totalUnread > 0 && <span className="rounded-full bg-jungle-green-100 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-jungle-green-700">{totalUnread}</span>}
          </div>
          <Button size="sm" className="h-8 gap-1.5 px-3" onClick={() => { setNewMsgOpts(null); setShowNew(true) }}>
            <Plus size={14} strokeWidth={2} /> Nuevo
          </Button>
        </div>

        {/* Número activo: filtra los chats Y es el emisor de los mensajes nuevos */}
        <div className="px-4 pb-3">
          <SelectMenu
            value={accountFilter}
            onChange={pickAccount}
            className="h-10"
            leadingIcon={<PhoneCall size={15} className="shrink-0 text-muted-foreground" />}
            placeholder="Todas las vías"
            options={[
              { value: '', label: channelFilter ? `Todas las vías de ${CHANNEL_LABEL[channelFilter]}` : 'Todas las vías', icon: <PhoneCall size={14} className="shrink-0 text-muted-foreground" /> },
              ...accountOptions.map(a => ({
                value: a.id,
                label: `${a.name} · ${a.phone_number ?? a.instance_name ?? '—'}`,
                icon: <span className={cn('h-2 w-2 shrink-0 rounded-full', a.channel === 'sms' ? 'bg-violet-500' : 'bg-green-500')} />,
              })),
            ]}
          />
          <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
            {activeAccount ? (
              <>Ves solo los chats de este número y escribes desde{' '}
                <span className="font-mono font-medium text-foreground">{activeAccount.phone_number ?? activeAccount.instance_name ?? '—'}</span>.</>
            ) : channelFilter ? (
              <>Ves todos tus chats de {CHANNEL_LABEL[channelFilter]}. Cada uno responde desde su propio número.</>
            ) : (
              <>Ves todos los chats. Cada uno responde desde su propio número.</>
            )}
          </p>
        </div>

        {/* Pestañas de estado */}
        <div className="flex gap-4 border-b px-4">
          {STATUS_FILTERS.map(({ key, label }) => (
            <button key={key} onClick={() => setStatusFilter(key)}
              className={cn('relative -mb-px border-b-2 pb-2.5 pt-0.5 text-[13px] font-medium transition-colors',
                statusFilter === key ? 'border-jungle-green-600 text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}>
              {label}
            </button>
          ))}
        </div>

        {/* Filtros */}
        <div className="space-y-2.5 border-b p-3">
          <div className="relative">
            <Search size={16} strokeWidth={1.75} className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar conversación..."
              className="h-10 rounded-xl border-transparent bg-muted/60 pl-9 text-sm shadow-none transition-colors focus-visible:border-ring focus-visible:bg-background focus-visible:ring-0" />
          </div>

          {/* Canal + no leídos */}
          <div className="flex items-center gap-2">
            <div className="flex flex-1 gap-0.5 rounded-lg bg-muted p-0.5">
              {CHANNEL_FILTERS.map(({ key, label, Icon }) => (
                <button key={key} onClick={() => pickChannel(key)}
                  className={cn('flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors',
                    channelFilter === key ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
                  {Icon && <Icon size={12} strokeWidth={1.75} />}{label}
                </button>
              ))}
            </div>
            <button onClick={() => setUnreadOnly(u => !u)}
              className={cn('flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors',
                unreadOnly ? 'border-jungle-green-500 bg-jungle-green-50 text-jungle-green-700' : 'border-border text-muted-foreground hover:bg-muted')}>
              <span className={cn('h-1.5 w-1.5 rounded-full', unreadOnly ? 'bg-jungle-green-500' : 'bg-muted-foreground/50')} /> No leídos
            </button>
          </div>
        </div>

        {/* Lista */}
        <div className="flex-1 space-y-0.5 overflow-y-auto p-2">
          {filtered.length === 0 && (
            <div className="px-6 py-16 text-center text-muted-foreground">
              <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted"><Inbox size={22} strokeWidth={1.75} /></span>
              <p className="text-sm font-medium text-foreground">{search || unreadOnly || accountFilter ? 'Sin resultados' : 'Sin conversaciones'}</p>
              {!search && !unreadOnly && !accountFilter && <p className="mt-2 text-xs">Usa <strong>Nuevo</strong> para enviar el primer mensaje</p>}
            </div>
          )}
          {filtered.map(conv => {
            const active = selected?.id === conv.id
            const unread = conv.unread_count > 0
            return (
              <button key={conv.id} onClick={() => openConversation(conv)}
                className={cn('flex w-full items-start gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors',
                  active ? 'bg-jungle-green-50 ring-1 ring-jungle-green-200' : 'hover:bg-muted/60')}>
                <div className="relative shrink-0">
                  <Avatar name={conv.contact_name} phone={conv.contact_phone} channel={conv.channel} />
                  <span className={`absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full border-2 border-card ${CHANNEL_DOT[conv.channel]}`}>
                    {conv.channel === 'whatsapp' ? <MessageCircle size={7} className="text-white" /> : <Smartphone size={7} className="text-white" />}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5">
                      {unread && <span className="h-2 w-2 shrink-0 rounded-full bg-jungle-green-500" />}
                      <span className={cn('truncate text-sm text-foreground', unread ? 'font-semibold' : 'font-medium')}>{conv.contact_name ?? conv.contact_phone}</span>
                    </span>
                    <span className={cn('shrink-0 text-[11px] tabular-nums', unread ? 'font-medium text-jungle-green-700' : 'text-muted-foreground')}>{timeLabel(conv.last_message_at)}</span>
                  </div>
                  <div className="mt-0.5 flex items-center justify-between gap-2">
                    <p className={cn('flex min-w-0 items-center gap-1 truncate text-xs', unread ? 'text-foreground' : 'text-muted-foreground')}>
                      {conv.last_direction === 'outbound' && (
                        <span className={conv.last_status === 'read' ? 'text-[#53bdeb]' : 'text-muted-foreground'}>
                          <MessageStatus status={conv.last_status ?? 'sent'} />
                        </span>
                      )}
                      <span className="truncate">{conv.last_body ?? '📎 Archivo'}</span>
                    </p>
                    {unread && <span className="flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-jungle-green-600 px-1 text-[11px] font-semibold text-white">{conv.unread_count}</span>}
                  </div>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', conv.channel === 'sms' ? 'bg-violet-500' : 'bg-green-500')} />
                    <span className="truncate text-[11px] text-muted-foreground">{conv.account_name ?? CHANNEL_LABEL[conv.channel]}</span>
                    {conv.status === 'closed' && <span className="ml-auto shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">Cerrada</span>}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Panel central: chat ── */}
      <div className="flex min-w-0 flex-1 flex-col bg-muted/40"
        style={{ backgroundImage: 'radial-gradient(circle, hsl(var(--border)) 1px, transparent 1px)', backgroundSize: '20px 20px' }}>
        {!selected ? (
          <div className="flex flex-1 items-center justify-center p-6">
            <div className="rounded-2xl border bg-card p-12 text-center shadow-sm">
              <span className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-jungle-green-50 text-jungle-green-700"><MessageCircle size={30} strokeWidth={1.75} /></span>
              <p className="text-lg font-semibold text-foreground">Selecciona un chat</p>
              <p className="mb-6 mt-2 text-sm text-muted-foreground">o inicia una nueva conversación</p>
              <Button onClick={() => { setNewMsgOpts(null); setShowNew(true) }}><Plus size={14} strokeWidth={1.75} /> Nuevo mensaje</Button>
            </div>
          </div>
        ) : (
          <>
            {/* Header del chat */}
            <div className="flex shrink-0 items-center justify-between border-b bg-card px-5 py-3 shadow-sm">
              <div className="flex min-w-0 items-center gap-3">
                <Avatar name={selected.contact_name} phone={selected.contact_phone} channel={selected.channel} size="sm" />
                <div className="min-w-0">
                  <p className="flex items-center gap-2 truncate text-sm font-semibold text-foreground">
                    {selected.contact_name ?? (selected.is_group ? 'Grupo' : selected.contact_phone)}
                    {selected.status && (
                      <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium',
                        selected.status === 'closed' ? 'bg-muted text-muted-foreground'
                        : selected.status === 'pending' ? 'bg-amber-100 text-amber-700'
                        : 'bg-jungle-green-100 text-jungle-green-700')}>
                        {selected.status === 'closed' ? 'Cerrada' : selected.status === 'pending' ? 'En espera' : 'Abierta'}
                      </span>
                    )}
                  </p>
                  <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    <span className="font-mono">{selected.is_group ? '👥 Grupo' : selected.contact_phone}</span>
                    {selected.account_name && (
                      <span className="flex items-center gap-1" title="Número desde el que salen tus respuestas en esta conversación">
                        <PhoneCall size={10} /> vía {selected.account_name}
                        {selected.account_phone && <span className="font-mono">· {selected.account_phone}</span>}
                      </span>
                    )}
                    {selected.channel === 'whatsapp' && <PresenceLabel presence={presence} />}
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {statusActionError && <span className="text-xs text-red-600">{statusActionError}</span>}
                <Button variant="outline" size="sm" onClick={openAiSummary}><Bot size={12} strokeWidth={1.75} /> Resumen IA</Button>
                {selected.status === 'closed'
                  ? <Button variant="outline" size="sm" onClick={() => setConvStatus('open')}><RotateCcw size={12} strokeWidth={1.75} /> Reabrir</Button>
                  : <Button variant="outline" size="sm" onClick={() => setConvStatus('closed')}><X size={12} strokeWidth={1.75} /> Cerrar</Button>}
              </div>
            </div>

            {/* Mensajes */}
            <div className="flex-1 space-y-1 overflow-y-auto px-4 py-4">
              {messages.length === 0 && <div className="py-8 text-center text-sm text-muted-foreground">Aún no hay mensajes, escribe el primero 👇</div>}
              {messages.map((msg, i) => {
                const isOut    = msg.direction === 'outbound'
                const showDate = i === 0 || new Date(msg.created_at).toDateString() !== new Date(messages[i-1].created_at).toDateString()
                return (
                  <div key={msg.id}>
                    {showDate && (
                      <div className="my-3 flex justify-center">
                        <span className="rounded-full border bg-card px-3 py-1 text-xs text-muted-foreground shadow-sm">
                          {new Date(msg.created_at).toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' })}
                        </span>
                      </div>
                    )}
                    <div className={`mb-0.5 flex ${isOut ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-xs rounded-2xl px-3.5 py-2 shadow-sm lg:max-w-sm xl:max-w-md ${isOut ? 'rounded-br-sm bg-jungle-green-600 text-white' : 'rounded-bl-sm border bg-card text-foreground'}`}>
                        <MediaContent msg={msg} isOut={isOut} />
                        {msg.body && <p className="break-words text-sm leading-relaxed">{msg.body}</p>}
                        <div className={`mt-0.5 flex items-center justify-end gap-1 ${isOut ? 'text-jungle-green-100' : 'text-muted-foreground'}`}>
                          <span className="text-xs">{new Date(msg.created_at).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}</span>
                          {isOut && <MessageStatus status={msg.status} />}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="shrink-0 border-t bg-card px-4 py-3">
              {attachPreview && (
                <div className="mb-2 flex items-center gap-2 rounded-xl border border-jungle-green-100 bg-jungle-green-50 px-3 py-2">
                  {attachPreview.type === 'image'
                    ? <img src={attachPreview.localUrl} alt="" className="h-10 w-10 rounded-lg object-cover" />
                    : attachPreview.type === 'audio'
                    ? <Mic size={18} strokeWidth={1.75} className="shrink-0 text-jungle-green-600" />
                    : <FileText size={18} strokeWidth={1.75} className="shrink-0 text-jungle-green-600" />}
                  <p className="flex-1 truncate text-xs text-foreground">{attachPreview.filename}</p>
                  <button type="button" onClick={clearAttach} className="shrink-0 text-muted-foreground hover:text-red-500"><X size={14} strokeWidth={1.75} /></button>
                </div>
              )}
              <form onSubmit={sendReply} className="flex items-end gap-2">
                {selected.channel === 'whatsapp' && (
                  <>
                    <input ref={fileInputRef} type="file" accept="image/*,audio/*,video/*,.pdf,.doc,.docx,.txt" className="hidden" onChange={handleFileSelect} />
                    <button type="button" onClick={() => fileInputRef.current?.click()} disabled={sending || uploading} title="Adjuntar"
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border text-muted-foreground transition-colors hover:border-jungle-green-300 hover:bg-jungle-green-50 hover:text-jungle-green-700">
                      <Paperclip size={16} strokeWidth={1.75} />
                    </button>
                  </>
                )}
                <textarea ref={inputRef} value={replyText} onChange={e => setReplyText(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply(e) } }}
                  placeholder={attachPreview ? 'Pie de foto o descripción (opcional)...' : `Responder por ${CHANNEL_LABEL[selected.channel]}...`}
                  rows={1} disabled={sending || uploading}
                  className="flex-1 resize-none rounded-xl border-transparent bg-muted/60 px-4 py-2.5 text-sm text-foreground shadow-none transition-colors focus:border-ring focus:bg-background focus:outline-none"
                  style={{ maxHeight: '120px', overflowY: 'auto' }} />
                <button type="submit" disabled={sending || uploading || (!replyText.trim() && !attachPreview)}
                  className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors',
                    (replyText.trim() || attachPreview) && !sending && !uploading ? 'bg-jungle-green-600 text-white hover:bg-jungle-green-700' : 'bg-muted text-muted-foreground')}>
                  {(sending || uploading) ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} strokeWidth={1.75} />}
                </button>
              </form>
              <p className="mt-1 text-center text-xs text-muted-foreground">
                Enter para enviar · Shift+Enter nueva línea{selected.channel === 'whatsapp' && ' · 📎 para adjuntar'}
              </p>
            </div>
          </>
        )}
      </div>

      {/* ── Panel derecho ── */}
      {selected && (
        <div className="hidden lg:flex">
          <ContactPanel
            conversation={selected}
            messages={messages}
            onNewMessage={(channel, phone) => { setNewMsgOpts({ channel, phone }); setShowNew(true) }}
          />
        </div>
      )}

      {showAiSummary && selected && (
        <AiSummaryModal
          loading={aiSummaryLoading}
          error={aiSummaryError}
          summary={aiSummaryText}
          onClose={() => setShowAiSummary(false)}
          onRegenerate={generateAiSummary}
        />
      )}

      {showNew && (
        <NewMessageModal
          // Hereda la vía filtrada (y su canal) para que el mensaje salga del
          // mismo número que estás viendo. En "Todas las vías" no fuerza nada.
          initialAccountId={accountFilter || undefined}
          initialChannel={newMsgOpts?.channel ?? accounts.find(a => a.id === accountFilter)?.channel}
          initialPhone={newMsgOpts?.phone}
          onClose={() => { setShowNew(false); setNewMsgOpts(null) }}
          onSent={async (conv) => { setShowNew(false); setNewMsgOpts(null); await loadConversations(); if (conv) openConversation(conv) }}
        />
      )}
    </div>
  )
}
