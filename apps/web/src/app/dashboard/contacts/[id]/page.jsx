'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import api from '../../../../lib/api'
import { Send, ArrowLeft, Mail, Smartphone, MessageCircle, AlertTriangle, XCircle, Eye, Link2 } from '../../../../components/ui/icons'

// ─── Modal enviar mensaje ─────────────────────────────────────────────────────
function SendModal({ contact, onClose }) {
  const [channel, setChannel]     = useState(contact.email ? 'email' : contact.phone ? 'whatsapp' : 'email')
  const [waAccounts, setWa]       = useState([])
  const [smsAccounts, setSms]     = useState([])
  const [templates, setTemplates] = useState([])
  const [accountId, setAccountId] = useState('')
  const [form, setForm] = useState({
    subject:      '',
    from_name:    '',
    html_content: '',
    message:      '',
  })
  const [sending, setSending] = useState(false)
  const [error, setError]     = useState(null)
  const [sent, setSent]       = useState(false)

  useEffect(() => {
    api.get('/whatsapp/accounts').then(r => {
      const c = r.data.filter(a => a.is_connected)
      setWa(c)
      if (c.length && channel === 'whatsapp') setAccountId(c[0].id)
    }).catch(() => {})
    api.get('/sms/accounts').then(r => {
      const c = r.data.filter(a => a.is_online)
      setSms(c)
      if (c.length && channel === 'sms') setAccountId(c[0].id)
    }).catch(() => {})
    api.get('/templates').then(r => setTemplates(r.data)).catch(() => {})
  }, [])

  useEffect(() => {
    const list = channel === 'whatsapp' ? waAccounts : smsAccounts
    if (list.length) setAccountId(list[0].id)
    else setAccountId('')
    setError(null)
  }, [channel])

  function loadTemplate(t) {
    setForm(f => ({ ...f, subject: t.subject, from_name: t.from_name, html_content: t.html_content }))
  }

  async function send(e) {
    e.preventDefault()
    setSending(true); setError(null)
    try {
      if (channel === 'email') {
        await api.post(`/contacts/${contact.id}/send-email`, {
          subject:      form.subject,
          from_name:    form.from_name,
          html_content: form.html_content,
        })
      } else {
        if (!accountId) throw new Error('Selecciona una cuenta')
        await api.post('/messages/send', {
          channel,
          account_id: accountId,
          to:         contact.phone,
          message:    form.message,
        })
      }
      setSent(true)
    } catch (err) {
      setError(err.response?.data?.error ?? err.message)
    } finally { setSending(false) }
  }

  const f = k => ({ value: form[k] ?? '', onChange: e => setForm(p => ({ ...p, [k]: e.target.value })) })

  if (sent) return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-sm w-full text-center">
        <p className="text-5xl mb-4">✅</p>
        <p className="text-xl font-bold text-green-700">
          {channel === 'email' ? 'Email enviado' : 'Mensaje enviado'}
        </p>
        <p className="text-sm text-gray-500 mt-2">
          {channel === 'email' ? `A ${contact.email}` : `A ${contact.phone}`}
        </p>
        <button onClick={onClose} className="mt-6 w-full bg-green-600 text-white py-2.5 rounded-xl text-sm font-medium hover:bg-green-700">
          Cerrar
        </button>
      </div>
    </div>
  )

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div>
            <h2 className="font-semibold text-gray-900">Enviar mensaje</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Para: {[contact.first_name, contact.last_name].filter(Boolean).join(' ') || contact.phone || contact.email}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
        </div>

        <form onSubmit={send} className="p-6 space-y-4">
          {/* Selector de canal */}
          <div className="flex gap-2">
            {[
              contact.email && { key: 'email',    label: 'Email',     Icon: Mail },
              contact.phone && { key: 'whatsapp', label: 'WhatsApp',  Icon: MessageCircle },
              contact.phone && { key: 'sms',      label: 'SMS',       Icon: Smartphone },
            ].filter(Boolean).map(c => (
              <button key={c.key} type="button" onClick={() => setChannel(c.key)}
                className={`flex-1 py-2 rounded-xl text-sm font-medium border-2 transition-colors flex items-center justify-center gap-1.5 ${
                  channel === c.key ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-500 hover:border-gray-300'
                }`}>
                <c.Icon size={14} />{c.label}
              </button>
            ))}
          </div>

          {/* Email */}
          {channel === 'email' && (
            <>
              {templates.length > 0 && (
                <div>
                  <label className="text-xs font-semibold text-gray-700 block mb-1">Cargar plantilla (opcional)</label>
                  <select onChange={e => { const t = templates.find(t => t.id === e.target.value); if (t) loadTemplate(t) }}
                    defaultValue=""
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none">
                    <option value="">— Sin plantilla —</option>
                    {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1">Remitente</label>
                <input {...f('from_name')} required placeholder="Ej: Equipo de ventas"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1">Asunto</label>
                <input {...f('subject')} required placeholder="Asunto del correo"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                <p className="text-xs text-gray-400 mt-1">Puedes usar <code className="bg-gray-100 px-1 rounded">{'{{first_name}}'}</code></p>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1">Contenido HTML</label>
                <textarea {...f('html_content')} required rows={6}
                  placeholder="<p>Hola {{first_name}}, ...</p>"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:outline-none resize-y" />
              </div>
            </>
          )}

          {/* WhatsApp / SMS */}
          {(channel === 'whatsapp' || channel === 'sms') && (
            <>
              {(() => {
                const accounts = channel === 'whatsapp' ? waAccounts : smsAccounts
                return accounts.length === 0 ? (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-700 flex items-center gap-2">
                    <AlertTriangle size={14} /> {channel === 'whatsapp' ? 'Sin números WhatsApp conectados' : 'Sin gateways SMS online'}
                  </div>
                ) : (
                  <div>
                    <label className="text-xs font-semibold text-gray-700 block mb-1">
                      {channel === 'whatsapp' ? 'Número WhatsApp' : 'Gateway SMS'}
                    </label>
                    <select value={accountId} onChange={e => setAccountId(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none bg-gray-50">
                      {accounts.map(a => <option key={a.id} value={a.id}>{a.name} — {a.phone_number ?? a.instance_name}</option>)}
                    </select>
                  </div>
                )
              })()}
              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1">Mensaje</label>
                <textarea {...f('message')} required rows={4}
                  placeholder="Escribe tu mensaje..."
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none resize-none" />
                <p className="text-xs text-gray-400 mt-1 text-right">{form.message.length} caracteres</p>
              </div>
            </>
          )}

          {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-xl flex items-center gap-2"><XCircle size={14} /> {error}</div>}

          <div className="flex gap-3 pt-1">
            <button type="submit" disabled={sending}
              className="flex-1 bg-blue-600 text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-1.5">
              {sending ? 'Enviando...' : <><Send size={14} /> Enviar</>}
            </button>
            <button type="button" onClick={onClose}
              className="flex-1 border border-gray-300 py-2.5 rounded-xl text-sm text-gray-700 hover:bg-gray-50">
              Cancelar
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

const CHANNEL_ICON  = { whatsapp: <MessageCircle size={14} />, sms: <Smartphone size={14} />, email: <Mail size={14} /> }
const CHANNEL_COLOR = {
  whatsapp: 'bg-green-100 text-green-700 border-green-200',
  sms:      'bg-blue-100 text-blue-700 border-blue-200',
  email:    'bg-orange-100 text-orange-700 border-orange-200',
}
const EVENT_LABEL = {
  email_sent:    { icon: <Mail size={13} />,         label: 'Email enviado',       color: 'text-orange-600' },
  msg_sent:      { icon: '↗',                        label: 'Mensaje enviado',     color: 'text-blue-600'   },
  msg_received:  { icon: '↙',                        label: 'Mensaje recibido',    color: 'text-green-600'  },
  open:          { icon: <Eye size={13} />,           label: 'Abrió el email',      color: 'text-purple-600' },
  click:         { icon: <Link2 size={13} />,         label: 'Clic en enlace',      color: 'text-indigo-600' },
  unsub:         { icon: '🚫',                        label: 'Se desuscribió',      color: 'text-red-600'    },
}

function StatBadge({ icon, value, label, color }) {
  const colors = { green:'bg-green-50 text-green-700', blue:'bg-blue-50 text-blue-700', orange:'bg-orange-50 text-orange-700', gray:'bg-gray-50 text-gray-600', purple:'bg-purple-50 text-purple-700' }
  return (
    <div className={`rounded-xl p-4 text-center ${colors[color]}`}>
      <div className="flex justify-center mb-1">{icon}</div>
      <p className="text-2xl font-bold">{value ?? 0}</p>
      <p className="text-xs opacity-70 mt-0.5">{label}</p>
    </div>
  )
}

function TimelineItem({ event }) {
  const type = event.event_type === 'email_sent' ? 'email_sent'
             : event.direction === 'inbound'     ? 'msg_received'
             : event.event_type === 'open'        ? 'open'
             : event.event_type === 'click'       ? 'click'
             : event.event_type === 'unsub'       ? 'unsub'
             : 'msg_sent'

  const meta = EVENT_LABEL[type] ?? { icon: '●', label: type, color: 'text-gray-500' }
  const chColor = CHANNEL_COLOR[event.channel] ?? 'bg-gray-100 text-gray-600 border-gray-200'

  return (
    <div className="flex gap-4 group">
      {/* Línea vertical */}
      <div className="flex flex-col items-center">
        <div className={`w-8 h-8 rounded-full border flex items-center justify-center text-sm flex-shrink-0 ${chColor}`}>
          {CHANNEL_ICON[event.channel] ?? '●'}
        </div>
        <div className="w-0.5 bg-gray-200 flex-1 mt-1 group-last:hidden" />
      </div>

      {/* Contenido */}
      <div className="pb-5 flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-sm font-semibold ${meta.color}`}>
                {meta.icon} {meta.label}
              </span>
              {event.reference && (
                <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full truncate max-w-[200px]">
                  {event.reference}
                </span>
              )}
            </div>
            {event.body && (
              <p className="text-sm text-gray-600 mt-1 line-clamp-2">{event.body}</p>
            )}
          </div>
          <span className="text-xs text-gray-400 flex-shrink-0 mt-0.5">
            {event.created_at ? new Date(event.created_at).toLocaleString('es', {
              day: '2-digit', month: '2-digit', year: '2-digit',
              hour: '2-digit', minute: '2-digit'
            }) : '—'}
          </span>
        </div>
      </div>
    </div>
  )
}

const LABELS = ['Principal', 'Trabajo', 'Casa', 'Celular', 'Otro']

function ChannelList({ contactId, items, type, onRefresh }) {
  const [adding, setAdding]   = useState(false)
  const [value, setValue]     = useState('')
  const [label, setLabel]     = useState('Principal')
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState(null)

  const isPhone = type === 'phones'
  const apiBase = isPhone ? 'phones' : 'emails'

  async function add(e) {
    e.preventDefault()
    setSaving(true); setError(null)
    try {
      await api.post(`/contacts/${contactId}/${apiBase}`, { [isPhone ? 'phone' : 'email']: value, label })
      setValue(''); setLabel('Principal'); setAdding(false)
      onRefresh()
    } catch (err) { setError(err.response?.data?.error ?? err.message) }
    finally { setSaving(false) }
  }

  async function remove(itemId) {
    if (!confirm('¿Eliminar?')) return
    await api.delete(`/contacts/${contactId}/${apiBase}/${itemId}`)
    onRefresh()
  }

  async function setPrimary(itemId) {
    await api.patch(`/contacts/${contactId}/${apiBase}/${itemId}/primary`)
    onRefresh()
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
          {isPhone ? 'Teléfonos' : 'Emails'}
        </p>
        <button onClick={() => setAdding(a => !a)}
          className="text-xs text-blue-600 hover:text-blue-700 font-medium">
          + Agregar
        </button>
      </div>

      <div className="space-y-1.5">
        {(items ?? []).map(item => (
          <div key={item.id} className="flex items-center gap-2 group">
            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${item.is_primary ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
              {item.label}
            </span>
            <span className="text-sm text-gray-800 flex-1 truncate">
              {isPhone ? item.phone : item.email}
            </span>
            <div className="hidden group-hover:flex items-center gap-1">
              {!item.is_primary && (
                <button onClick={() => setPrimary(item.id)} title="Marcar como principal"
                  className="text-xs text-blue-500 hover:text-blue-700">★</button>
              )}
              <button onClick={() => remove(item.id)} title="Eliminar"
                className="text-xs text-red-400 hover:text-red-600">×</button>
            </div>
          </div>
        ))}
        {(!items || items.length === 0) && (
          <p className="text-xs text-gray-400">Sin {isPhone ? 'teléfonos' : 'emails'} registrados</p>
        )}
      </div>

      {adding && (
        <form onSubmit={add} className="mt-2 flex gap-2 flex-wrap">
          <input value={value} onChange={e => setValue(e.target.value)} required
            placeholder={isPhone ? '+51999...' : 'correo@ejemplo.com'}
            type={isPhone ? 'tel' : 'email'}
            className="flex-1 min-w-0 border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" />
          <select value={label} onChange={e => setLabel(e.target.value)}
            className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white">
            {LABELS.map(l => <option key={l}>{l}</option>)}
          </select>
          <button type="submit" disabled={saving}
            className="bg-blue-600 text-white text-xs px-3 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50">
            {saving ? '...' : 'Guardar'}
          </button>
          <button type="button" onClick={() => { setAdding(false); setError(null) }}
            className="text-xs text-gray-500 hover:text-gray-700 px-2">
            Cancelar
          </button>
          {error && <p className="w-full text-xs text-red-600">{error}</p>}
        </form>
      )}
    </div>
  )
}

export default function Contact360Page() {
  const { id }  = useParams()
  const router  = useRouter()
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter]   = useState('all')
  const [showSend, setShowSend] = useState(false)

  function load() {
    api.get(`/contacts/${id}/360`)
      .then(r => setData(r.data))
      .catch(() => router.push('/dashboard/contacts'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [id])

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )
  if (!data) return null

  const { contact, stats, timeline } = data
  const name = [contact.first_name, contact.last_name].filter(Boolean).join(' ') || contact.phone || contact.email

  const filtered = timeline.filter(e =>
    filter === 'all' ? true :
    filter === 'email' ? e.channel === 'email' :
    e.channel === filter
  )

  return (
    <div className="max-w-4xl mx-auto">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500 mb-6">
        <Link href="/dashboard/contacts" className="hover:text-blue-600 flex items-center gap-1"><ArrowLeft size={14} /> Contactos</Link>
        <span>/</span>
        <span className="text-gray-800 font-medium">{name}</span>
      </div>

      {/* Header del contacto */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-6">
        <div className="flex items-start gap-5">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-2xl font-bold flex-shrink-0">
            {name?.[0]?.toUpperCase() ?? '?'}
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold text-gray-900">{name}</h1>
            <div className="flex flex-wrap gap-2 mt-2">
              {(contact.lists ?? []).map(l => (
                <span key={l.id} className="text-xs bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-full">
                  {l.name}
                </span>
              ))}
              {contact.is_subscribed === false && (
                <span className="text-xs bg-red-50 text-red-600 border border-red-200 px-2 py-0.5 rounded-full">
                  Desuscrito
                </span>
              )}
            </div>
          </div>
          <button onClick={() => setShowSend(true)}
            className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white text-sm rounded-xl hover:bg-blue-700 font-semibold flex-shrink-0">
            <Send size={14} /> Enviar mensaje
          </button>
        </div>

        {/* Teléfonos y emails gestionables */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mt-5 pt-5 border-t border-gray-100">
          <ChannelList contactId={id} items={contact.phones} type="phones" onRefresh={load} />
          <ChannelList contactId={id} items={contact.emails} type="emails" onRefresh={load} />
        </div>
      </div>

      {/* Estadísticas */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mb-6">
        <StatBadge icon={<Mail size={18} />}        value={stats.email?.total_sent}  label="Emails enviados"  color="orange" />
        <StatBadge icon={<Eye size={18} />}           value={stats.email?.opens}       label="Aperturas"         color="purple" />
        <StatBadge icon={<Link2 size={18} />}        value={stats.email?.clicks}      label="Clics"             color="blue"   />
        <StatBadge icon={<MessageCircle size={18}/>} value={stats.messages?.whatsapp} label="Msgs WhatsApp"     color="green"  />
        <StatBadge icon={<Smartphone size={18} />}  value={stats.messages?.sms}      label="Msgs SMS"          color="blue"   />
        <StatBadge icon={<span>↙</span>}            value={stats.messages?.received}  label="Respuestas"        color="gray"   />
      </div>

      {/* Timeline */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Línea de tiempo</h2>
          <div className="flex gap-1">
            {[
              { key: 'all',      label: 'Todo',  Icon: null },
              { key: 'email',    label: 'Email', Icon: Mail },
              { key: 'whatsapp', label: 'WA',    Icon: MessageCircle },
              { key: 'sms',      label: 'SMS',   Icon: Smartphone },
            ].map(f => (
              <button key={f.key} onClick={() => setFilter(f.key)}
                className={`text-xs px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1 ${
                  filter === f.key ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}>
                {f.Icon && <f.Icon size={11} />}{f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="p-6">
          {filtered.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <p className="text-4xl mb-3">📭</p>
              <p className="font-medium">Sin actividad registrada</p>
              {filter !== 'all' && (
                <button onClick={() => setFilter('all')} className="mt-2 text-sm text-blue-600 hover:underline">
                  Ver todo
                </button>
              )}
            </div>
          ) : (
            <div>
              {filtered.map((event, i) => (
                <TimelineItem key={i} event={event} />
              ))}
            </div>
          )}
        </div>
      </div>

      {showSend && (
        <SendModal contact={contact} onClose={() => setShowSend(false)} />
      )}
    </div>
  )
}
