'use client'
import { useEffect, useState, useRef, useCallback } from 'react'
import api from '../../../lib/api'
import { Plus, Send, X, MessageCircle, Smartphone, Search, AlertTriangle, XCircle, Paperclip, Download, FileText, Mic } from '../../../components/ui/icons'

// ─── Utilidades ───────────────────────────────────────────────────────────────
const CHANNEL_COLOR = { whatsapp: 'bg-green-500', sms: 'bg-blue-500' }
const CHANNEL_LABEL = { whatsapp: 'WhatsApp', sms: 'SMS' }

function initials(name, phone) {
  if (name) return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  return (phone ?? '?')[1] ?? '?'
}

function Avatar({ name, phone, channel, size = 'md' }) {
  const sz  = size === 'sm' ? 'w-8 h-8 text-xs' : 'w-10 h-10 text-sm'
  const clr = channel === 'whatsapp' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
  return (
    <div className={`${sz} ${clr} rounded-full flex items-center justify-center font-bold flex-shrink-0`}>
      {initials(name, phone)}
    </div>
  )
}

function timeLabel(dateStr) {
  if (!dateStr) return ''
  const d   = new Date(dateStr)
  const now = new Date()
  const diffH = (now - d) / 3600000
  if (diffH < 24 && d.getDate() === now.getDate())
    return d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
  if (diffH < 48)
    return 'Ayer'
  return d.toLocaleDateString('es', { day: '2-digit', month: '2-digit' })
}

// ─── Modal nuevo mensaje ──────────────────────────────────────────────────────
function NewMessageModal({ onClose, onSent, initialChannel, initialPhone }) {
  const [channel, setChannel]         = useState(initialChannel ?? 'whatsapp')
  const [waAccounts, setWaAccounts]   = useState([])
  const [smsAccounts, setSmsAccounts] = useState([])
  const [accountId, setAccountId]     = useState('')
  const [query, setQuery]             = useState(initialPhone ?? '')
  const [results, setResults]         = useState([])
  const [selected, setSelected]       = useState(null) // contacto elegido
  const [message, setMessage]         = useState('')
  const [sending, setSending]         = useState(false)
  const [error, setError]             = useState(null)
  const searchRef = useRef(null)

  useEffect(() => {
    api.get('/whatsapp/accounts').then(r => {
      const c = r.data.filter(a => a.is_connected)
      setWaAccounts(c)
      if (c.length && channel === 'whatsapp') setAccountId(c[0].id)
    }).catch(() => {})
    api.get('/sms/accounts').then(r => {
      const c = r.data.filter(a => a.is_online)
      setSmsAccounts(c)
      if (c.length && channel === 'sms') setAccountId(c[0].id)
    }).catch(() => {})
    searchRef.current?.focus()
  }, [])

  useEffect(() => {
    const accounts = channel === 'whatsapp' ? waAccounts : smsAccounts
    if (accounts.length) setAccountId(accounts[0].id)
    else setAccountId('')
  }, [channel])

  useEffect(() => {
    if (query.length < 1) { setResults([]); return }
    const t = setTimeout(() => {
      api.get(`/contacts/search?q=${encodeURIComponent(query)}&limit=8`)
        .then(r => setResults(r.data))
        .catch(() => {})
    }, 250)
    return () => clearTimeout(t)
  }, [query])

  const accounts    = channel === 'whatsapp' ? waAccounts : smsAccounts
  const noAccounts  = accounts.length === 0
  const destination = selected?.phone ?? (query.match(/^\+?\d{6,}$/) ? query : null)

  async function send(e) {
    e.preventDefault()
    if (!destination) { setError('Selecciona un contacto o escribe un número válido'); return }
    if (!accountId)   { setError('No hay cuentas disponibles para este canal'); return }
    setSending(true); setError(null)
    try {
      const r = await api.post('/messages/send', {
        channel, account_id: accountId,
        to: destination, message: message.trim(),
      })
      onSent(r.data.conversation)
      onClose()
    } catch (err) {
      setError(err.response?.data?.error ?? err.message)
    } finally { setSending(false) }
  }

  return (
    <div className="modal-overlay fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="modal-content bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2"><Plus size={16} /> Nuevo mensaje</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
        </div>

        <form onSubmit={send} className="p-5 space-y-4">
          {/* Canal */}
          <div className="flex gap-2">
            {[
              { ch: 'whatsapp', lbl: 'WhatsApp', Icon: MessageCircle },
              { ch: 'sms',      lbl: 'SMS',       Icon: Smartphone },
            ].map(({ ch, lbl, Icon }) => (
              <button key={ch} type="button" onClick={() => { setChannel(ch); setError(null) }}
                className={`flex-1 py-2 rounded-xl text-sm font-medium border-2 transition-colors flex items-center justify-center gap-2 ${
                  channel === ch
                    ? ch === 'whatsapp' ? 'border-green-500 bg-green-50 text-green-700' : 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-200 text-gray-500 hover:border-gray-300'
                }`}>
                <Icon size={14} />{lbl}
              </button>
            ))}
          </div>

          {/* Cuenta */}
          {noAccounts ? (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-700 flex items-center gap-2">
              <AlertTriangle size={14} /> {channel === 'whatsapp' ? 'Ningún número WhatsApp conectado' : 'Ningún gateway SMS online'}
            </div>
          ) : (
            <select value={accountId} onChange={e => setAccountId(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none bg-gray-50">
              {accounts.map(a => (
                <option key={a.id} value={a.id}>{a.name} — {a.phone_number ?? a.instance_name}</option>
              ))}
            </select>
          )}

          {/* Buscador de contactos */}
          <div className="relative">
            <label className="text-xs font-semibold text-gray-600 mb-1.5 block">Para</label>
            {selected ? (
              <div className="flex items-center gap-3 border-2 border-blue-500 rounded-xl px-3 py-2.5 bg-blue-50">
                <Avatar name={`${selected.first_name ?? ''} ${selected.last_name ?? ''}`.trim()} phone={selected.phone} channel={channel} size="sm" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {[selected.first_name, selected.last_name].filter(Boolean).join(' ') || selected.phone}
                  </p>
                  <p className="text-xs text-gray-500">{selected.phone}</p>
                </div>
                <button type="button" onClick={() => { setSelected(null); setQuery(''); searchRef.current?.focus() }}
                  className="text-gray-400 hover:text-gray-600 flex-shrink-0">×</button>
              </div>
            ) : (
              <div className="relative">
                <input ref={searchRef} value={query} onChange={e => setQuery(e.target.value)}
                  placeholder="Buscar contacto o escribir +51..."
                  className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                {results.length > 0 && (
                  <div className="absolute z-10 top-full mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
                    {results.map(c => (
                      <button key={c.id} type="button"
                        onClick={() => { setSelected(c); setQuery(''); setResults([]) }}
                        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 text-left">
                        <Avatar name={`${c.first_name ?? ''} ${c.last_name ?? ''}`.trim()} phone={c.phone} channel={channel} size="sm" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">
                            {[c.first_name, c.last_name].filter(Boolean).join(' ') || c.phone}
                          </p>
                          <p className="text-xs text-gray-400">{c.phone ?? c.email} · {c.list_name}</p>
                        </div>
                      </button>
                    ))}
                    {query.match(/^\+?\d{6,}$/) && (
                      <button type="button"
                        onClick={() => { setSelected({ phone: query }); setQuery(''); setResults([]) }}
                        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-blue-50 text-left border-t border-gray-100">
                        <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center text-gray-500 text-xs">+</div>
                        <p className="text-sm text-blue-600 font-medium">Usar número: {query}</p>
                      </button>
                    )}
                  </div>
                )}
                {query.length > 0 && results.length === 0 && !query.match(/^\+?\d{6,}$/) && (
                  <p className="text-xs text-gray-400 mt-1">Sin resultados — escribe un número con +código de país para continuar</p>
                )}
              </div>
            )}
          </div>

          {/* Mensaje */}
          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1.5 block">Mensaje</label>
            <textarea value={message} onChange={e => setMessage(e.target.value)}
              required rows={3} placeholder="Escribe tu mensaje..."
              className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none resize-none" />
            <p className="text-xs text-gray-400 text-right">{message.length} caracteres</p>
          </div>

          {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-xl flex items-center gap-2"><XCircle size={14} /> {error}</div>}

          <div className="flex gap-3">
            <button type="submit" disabled={sending || noAccounts || !message.trim() || !destination}
              className="flex-1 bg-blue-600 text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-40 flex items-center justify-center gap-1.5">
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

// ─── Panel derecho: info del contacto ────────────────────────────────────────
function ContactPanel({ conversation, onNewMessage }) {
  const [contact, setContact] = useState(null)

  useEffect(() => {
    if (!conversation?.contact_phone) { setContact(null); return }
    api.get(`/contacts/by-phone/${encodeURIComponent(conversation.contact_phone)}`)
      .then(r => setContact(r.data))
      .catch(() => setContact(null))
  }, [conversation?.contact_phone])

  if (!conversation) return null

  const name = contact
    ? [contact.first_name, contact.last_name].filter(Boolean).join(' ')
    : conversation.contact_name ?? ''

  return (
    <div className="w-72 border-l border-gray-200 bg-white flex flex-col flex-shrink-0 overflow-y-auto">
      {/* Header */}
      <div className="p-5 border-b border-gray-100 text-center">
        <div className="w-16 h-16 rounded-full mx-auto mb-3 flex items-center justify-center text-2xl font-bold
          bg-gradient-to-br from-blue-100 to-blue-200 text-blue-700">
          {initials(name, conversation.contact_phone)}
        </div>
        <p className="font-semibold text-gray-900">{name || conversation.contact_phone}</p>
        <p className="text-sm text-gray-500 font-mono mt-0.5">{conversation.contact_phone}</p>
        {contact?.email && (
          <p className="text-xs text-gray-400 mt-1 truncate">{contact.email}</p>
        )}
      </div>

      {/* Canales disponibles */}
      <div className="p-4 border-b border-gray-100">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Canales disponibles</p>
        <div className="space-y-2">
          {contact?.phone && (
            <>
              <button onClick={() => onNewMessage('whatsapp', contact.phone)}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-green-50 text-green-700 text-sm hover:bg-green-100 transition-colors">
                <MessageCircle size={14} />
                <span className="font-medium">WhatsApp</span>
                <span className="ml-auto text-xs text-green-500">Enviar →</span>
              </button>
              <button onClick={() => onNewMessage('sms', contact.phone)}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-50 text-blue-700 text-sm hover:bg-blue-100 transition-colors">
                <Smartphone size={14} />
                <span className="font-medium">SMS</span>
                <span className="ml-auto text-xs text-blue-500">Enviar →</span>
              </button>
            </>
          )}
          {contact?.email && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-50 text-gray-500 text-sm">
              <span className="text-gray-400">✉</span>
              <span>Email</span>
            </div>
          )}
          {!contact && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-50 text-gray-500 text-sm">
              {conversation.channel === 'whatsapp' ? <MessageCircle size={14} /> : <Smartphone size={14} />}
              <span>{CHANNEL_LABEL[conversation.channel]}</span>
            </div>
          )}
        </div>
      </div>

      {/* Listas */}
      {contact?.lists?.length > 0 && (
        <div className="p-4 border-b border-gray-100">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Listas</p>
          <div className="space-y-1">
            {contact.lists.map(l => (
              <div key={l.id} className="flex items-center gap-2 text-sm text-gray-600">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400 flex-shrink-0" />
                {l.name}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Ver 360° */}
      {contact && (
        <div className="p-4 border-t border-gray-100">
          <a href={`/dashboard/contacts/${contact.id}`}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 border-purple-200 text-purple-700 bg-purple-50 hover:bg-purple-100 transition-colors text-sm font-semibold">
            <Search size={14} /> Ver perfil 360°
          </a>
        </div>
      )}

      {/* Sin contacto en BD */}
      {!contact && (
        <div className="p-4">
          <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 text-xs text-amber-700">
            Este número no está en tus listas de contactos.
            <a href="/dashboard/contacts" className="block mt-1 text-amber-600 underline font-medium">
              Agregar a contactos →
            </a>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Renderizador de media ────────────────────────────────────────────────────
function MediaContent({ msg, isOut }) {
  if (!msg.media_url && !msg.media_type) return null

  const url  = msg.media_url
  const type = msg.media_type ?? 'image'

  if (type === 'image' || type === 'sticker') {
    return url
      ? <img src={url} alt="imagen" className="rounded-xl mb-1 max-w-[240px] max-h-[300px] object-cover cursor-pointer" onClick={() => window.open(url, '_blank')} />
      : <div className="bg-black/10 rounded-xl mb-1 w-48 h-32 flex items-center justify-center text-2xl">🖼️</div>
  }

  if (type === 'audio') {
    return url
      ? <audio controls src={url} className="mb-1 max-w-[240px]" style={{ height: 36 }} />
      : <div className={`flex items-center gap-2 mb-1 px-3 py-2 rounded-xl ${isOut ? 'bg-blue-500' : 'bg-gray-100'}`}>
          <Mic size={16} className={isOut ? 'text-white' : 'text-gray-500'} />
          <span className={`text-xs ${isOut ? 'text-blue-100' : 'text-gray-500'}`}>Mensaje de voz</span>
        </div>
  }

  if (type === 'video') {
    return url
      ? <video controls src={url} className="rounded-xl mb-1 max-w-[240px] max-h-[200px]" />
      : <div className="bg-black/10 rounded-xl mb-1 w-48 h-32 flex items-center justify-center text-2xl">🎥</div>
  }

  if (type === 'document') {
    return (
      <a href={url ?? '#'} target="_blank" rel="noreferrer"
        className={`flex items-center gap-2 mb-1 px-3 py-2 rounded-xl no-underline ${isOut ? 'bg-blue-500' : 'bg-gray-100'}`}>
        <FileText size={16} className={isOut ? 'text-white' : 'text-gray-500'} />
        <span className={`text-xs font-medium ${isOut ? 'text-white' : 'text-gray-700'} truncate max-w-[160px]`}>
          {msg.media_caption || 'Documento'}
        </span>
        {url && <Download size={13} className={isOut ? 'text-blue-200' : 'text-gray-400'} />}
      </a>
    )
  }

  return null
}

// ─── Página principal ─────────────────────────────────────────────────────────
export default function InboxPage() {
  const [conversations, setConversations] = useState([])
  const [selected, setSelected]           = useState(null)
  const [messages, setMessages]           = useState([])
  const [replyText, setReplyText]         = useState('')
  const [sending, setSending]             = useState(false)
  const [channelFilter, setChannelFilter] = useState('')
  const [search, setSearch]               = useState('')
  const [showNew, setShowNew]             = useState(false)
  const [newMsgOpts, setNewMsgOpts]       = useState(null) // { channel, phone }
  const messagesEndRef  = useRef(null)
  const inputRef        = useRef(null)
  const fileInputRef    = useRef(null)
  const selectedIdRef   = useRef(null)
  const [attachPreview, setAttachPreview] = useState(null) // { url, type, file, filename }
  const [uploading, setUploading]         = useState(false)

  const loadConversations = useCallback(() => {
    const params = channelFilter ? `?channel=${channelFilter}` : ''
    api.get(`/conversations${params}`).then(r => setConversations(r.data)).catch(() => {})
  }, [channelFilter])

  useEffect(() => { loadConversations() }, [loadConversations])

  // Polling lista de conversaciones cada 5s
  useEffect(() => {
    const t = setInterval(loadConversations, 5000)
    return () => clearInterval(t)
  }, [loadConversations])

  // Polling mensajes del chat activo cada 3s
  useEffect(() => {
    const t = setInterval(async () => {
      const convId = selectedIdRef.current
      if (!convId) return
      try {
        const r = await api.get(`/conversations/${convId}`)
        const newMsgs = r.data.messages ?? []
        setMessages(prev => {
          // Solo actualizar si hay mensajes nuevos
          if (newMsgs.length === prev.length) return prev
          // Scroll solo si llegó un mensaje nuevo (inbound)
          const hasNew = newMsgs.length > prev.length
          if (hasNew) {
            setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
            loadConversations() // refrescar sidebar también
          }
          return newMsgs
        })
      } catch {}
    }, 3000)
    return () => clearInterval(t)
  }, [loadConversations])

  // Sincronizar ref con el estado
  useEffect(() => {
    selectedIdRef.current = selected?.id ?? null
  }, [selected])

  async function openConversation(conv) {
    setSelected(conv)
    const r = await api.get(`/conversations/${conv.id}`)
    setMessages(r.data.messages ?? [])
    loadConversations()
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
      inputRef.current?.focus()
    }, 100)
  }

  async function handleFileSelect(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const preview = URL.createObjectURL(file)
    const type    = file.type.startsWith('image/') ? 'image'
                  : file.type.startsWith('audio/') ? 'audio'
                  : file.type.startsWith('video/') ? 'video'
                  : 'document'
    setAttachPreview({ localUrl: preview, type, file, filename: file.name })
  }

  function clearAttach() {
    setAttachPreview(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function sendReply(e) {
    e.preventDefault()
    if (!replyText.trim() && !attachPreview) return
    if (!selected) return
    setSending(true)
    try {
      let mediaUrl = null, mediaType = null, mediaCaption = null

      // Si hay archivo adjunto, subirlo primero
      if (attachPreview) {
        setUploading(true)
        const fd = new FormData()
        fd.append('file', attachPreview.file, attachPreview.filename)
        const r = await api.post('/media/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
        mediaUrl     = r.data.url
        mediaType    = r.data.type
        mediaCaption = replyText.trim() || attachPreview.filename
        setUploading(false)
      }

      await api.post(`/conversations/${selected.id}/reply`, {
        body:          attachPreview ? undefined : replyText.trim(),
        media_url:     mediaUrl     ?? undefined,
        media_type:    mediaType    ?? undefined,
        media_caption: mediaCaption ?? undefined,
      })
      setReplyText('')
      clearAttach()
      const r = await api.get(`/conversations/${selected.id}`)
      setMessages(r.data.messages ?? [])
      loadConversations()
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
    } catch (err) {
      alert('Error: ' + (err.response?.data?.error ?? err.message))
    } finally { setSending(false); setUploading(false) }
  }

  async function closeConv() {
    await api.patch(`/conversations/${selected.id}/status`, { status: 'closed' })
    setSelected(null); setMessages([])
    loadConversations()
  }

  function handleNewFromPanel(channel, phone) {
    setNewMsgOpts({ channel, phone })
    setShowNew(true)
  }

  const filtered = conversations.filter(c => {
    if (!search) return true
    const q = search.toLowerCase()
    return (c.contact_name ?? '').toLowerCase().includes(q) ||
           (c.contact_phone ?? '').includes(q)
  })

  return (
    <div className="h-full -m-6 flex overflow-hidden" style={{ height: 'calc(100vh - 49px)' }}>

      {/* ── Panel izquierdo: lista de conversaciones ── */}
      <div className="w-80 flex-shrink-0 border-r border-gray-200 bg-white flex flex-col">
        {/* Cabecera */}
        <div className="p-4 border-b border-gray-200 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-gray-900 text-lg">Mensajes</h2>
            <button onClick={() => { setNewMsgOpts(null); setShowNew(true) }}
              className="bg-blue-600 hover:bg-blue-700 text-white text-xs px-3 py-1.5 rounded-lg font-medium flex items-center gap-1">
              <Plus size={14} /> Nuevo
            </button>
          </div>
          {/* Búsqueda */}
          <div className="relative">
            <Search size={14} className="absolute left-3 top-2.5 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Buscar chats..."
              className="w-full border border-gray-200 rounded-xl pl-8 pr-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none bg-gray-50" />
          </div>
          {/* Filtros */}
          <div className="flex gap-1">
            {[
              { ch: '', lbl: 'Todos', Icon: null },
              { ch: 'whatsapp', lbl: 'WA', Icon: MessageCircle },
              { ch: 'sms', lbl: 'SMS', Icon: Smartphone },
            ].map(({ ch, lbl, Icon }) => (
              <button key={ch} onClick={() => setChannelFilter(ch)}
                className={`flex-1 text-xs py-1.5 rounded-lg font-medium transition-colors flex items-center justify-center gap-1 ${
                  channelFilter === ch ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}>
                {Icon && <Icon size={11} />}{lbl}
              </button>
            ))}
          </div>
        </div>

        {/* Lista */}
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 && (
            <div className="text-center py-16 px-6 text-gray-400">
              <p className="text-4xl mb-3">💬</p>
              <p className="text-sm font-medium">{search ? 'Sin resultados' : 'Sin conversaciones'}</p>
              {!search && (
                <p className="text-xs mt-2">
                  Usa <strong>Nuevo</strong> para enviar el primer mensaje
                </p>
              )}
            </div>
          )}
          {filtered.map(conv => (
            <button key={conv.id} onClick={() => openConversation(conv)}
              className={`w-full text-left px-4 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors flex items-start gap-3 ${
                selected?.id === conv.id ? 'bg-blue-50 border-l-2 border-l-blue-600' : ''
              }`}>
              <div className="relative flex-shrink-0">
                <Avatar
                  name={conv.contact_name}
                  phone={conv.contact_phone}
                  channel={conv.channel}
                />
                <span className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full ${CHANNEL_COLOR[conv.channel]} border-2 border-white flex items-center justify-center`}>
                  {conv.channel === 'whatsapp'
                    ? <MessageCircle size={7} className="text-white" />
                    : <Smartphone size={7} className="text-white" />}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-0.5">
                  <span className={`text-sm truncate ${conv.unread_count > 0 ? 'font-bold text-gray-900' : 'font-medium text-gray-800'}`}>
                    {conv.contact_name ?? conv.contact_phone}
                  </span>
                  <span className="text-xs text-gray-400 flex-shrink-0 ml-2">
                    {timeLabel(conv.last_message_at)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <p className={`text-xs truncate ${conv.unread_count > 0 ? 'text-gray-700' : 'text-gray-500'}`}>
                    {conv.last_direction === 'outbound' ? '✓ ' : ''}{conv.last_body ?? '📎 Archivo'}
                  </p>
                  {conv.unread_count > 0 && (
                    <span className="bg-blue-600 text-white text-xs rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 ml-1 flex-shrink-0 font-medium">
                      {conv.unread_count}
                    </span>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* ── Panel central: chat ── */}
      <div className="flex-1 flex flex-col min-w-0 bg-gray-50"
        style={{ backgroundImage: 'radial-gradient(circle, #e5e7eb 1px, transparent 1px)', backgroundSize: '20px 20px' }}>
        {!selected ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center bg-white rounded-2xl p-12 shadow-sm border border-gray-200">
              <p className="text-6xl mb-4">💬</p>
              <p className="text-lg font-semibold text-gray-700">Selecciona un chat</p>
              <p className="text-sm text-gray-400 mt-2 mb-6">o inicia una nueva conversación</p>
              <button onClick={() => { setNewMsgOpts(null); setShowNew(true) }}
                className="bg-blue-600 text-white px-6 py-2.5 rounded-xl text-sm font-medium hover:bg-blue-700 flex items-center gap-2">
                <Plus size={14} /> Nuevo mensaje
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Header del chat */}
            <div className="bg-white border-b border-gray-200 px-5 py-3.5 flex items-center justify-between flex-shrink-0 shadow-sm">
              <div className="flex items-center gap-3">
                <Avatar name={selected.contact_name} phone={selected.contact_phone} channel={selected.channel} />
                <div>
                  <p className="font-semibold text-gray-900 text-sm">
                    {selected.contact_name ?? selected.contact_phone}
                  </p>
                  <div className="flex items-center gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full ${CHANNEL_COLOR[selected.channel]}`} />
                    <p className="text-xs text-gray-500">
                      {selected.contact_phone} · {CHANNEL_LABEL[selected.channel]}
                    </p>
                  </div>
                </div>
              </div>
              <button onClick={closeConv}
                className="text-xs border border-gray-200 px-3 py-1.5 rounded-lg text-gray-600 hover:bg-gray-50 flex items-center gap-1">
                <X size={12} /> Cerrar
              </button>
            </div>

            {/* Mensajes */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1">
              {messages.length === 0 && (
                <div className="text-center py-8 text-gray-400 text-sm">
                  Aún no hay mensajes — escribe el primero 👇
                </div>
              )}
              {messages.map((msg, i) => {
                const isOut    = msg.direction === 'outbound'
                const showDate = i === 0 || new Date(msg.created_at).toDateString() !== new Date(messages[i-1].created_at).toDateString()
                return (
                  <div key={msg.id}>
                    {showDate && (
                      <div className="flex justify-center my-3">
                        <span className="bg-white text-gray-500 text-xs px-3 py-1 rounded-full shadow-sm border border-gray-200">
                          {new Date(msg.created_at).toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' })}
                        </span>
                      </div>
                    )}
                    <div className={`flex ${isOut ? 'justify-end' : 'justify-start'} mb-0.5`}>
                      <div className={`max-w-xs lg:max-w-sm xl:max-w-md rounded-2xl px-3.5 py-2 shadow-sm ${
                        isOut
                          ? 'bg-blue-600 text-white rounded-br-sm'
                          : 'bg-white text-gray-900 border border-gray-200 rounded-bl-sm'
                      }`}>
                        <MediaContent msg={msg} isOut={isOut} />
                        {msg.body && <p className="text-sm leading-relaxed break-words">{msg.body}</p>}
                        <div className={`flex items-center justify-end gap-1 mt-0.5 ${isOut ? 'text-blue-200' : 'text-gray-400'}`}>
                          <span className="text-xs">
                            {new Date(msg.created_at).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          {isOut && (
                            <span className="text-xs" title={msg.status}>
                              {msg.status === 'read'      ? <span className="text-blue-300">✓✓</span>
                             : msg.status === 'delivered' ? <span className="text-blue-200">✓✓</span>
                             : msg.status === 'sent'      ? <span className="text-blue-300 opacity-70">✓</span>
                             : msg.status === 'failed'    ? <span className="text-red-400">✕</span>
                             :                              <span className="opacity-50">⏳</span>}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="bg-white border-t border-gray-200 px-4 py-3 flex-shrink-0">
              {/* Preview adjunto */}
              {attachPreview && (
                <div className="mb-2 flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-xl px-3 py-2">
                  {attachPreview.type === 'image'
                    ? <img src={attachPreview.localUrl} alt="" className="w-10 h-10 rounded-lg object-cover" />
                    : attachPreview.type === 'audio'
                    ? <Mic size={18} className="text-blue-500 flex-shrink-0" />
                    : <FileText size={18} className="text-blue-500 flex-shrink-0" />
                  }
                  <p className="text-xs text-gray-700 flex-1 truncate">{attachPreview.filename}</p>
                  <button type="button" onClick={clearAttach} className="text-gray-400 hover:text-red-500 flex-shrink-0">
                    <X size={14} />
                  </button>
                </div>
              )}
              <form onSubmit={sendReply} className="flex items-end gap-2">
                {selected.channel === 'whatsapp' && (
                  <>
                    <input ref={fileInputRef} type="file"
                      accept="image/*,audio/*,video/*,.pdf,.doc,.docx,.txt"
                      className="hidden" onChange={handleFileSelect} />
                    <button type="button" onClick={() => fileInputRef.current?.click()}
                      disabled={sending || uploading}
                      title="Adjuntar imagen, audio o documento"
                      className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center border border-gray-200 text-gray-400 hover:text-blue-600 hover:border-blue-300 hover:bg-blue-50 transition-colors">
                      <Paperclip size={16} />
                    </button>
                  </>
                )}
                <textarea
                  ref={inputRef}
                  value={replyText}
                  onChange={e => setReplyText(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply(e) }
                  }}
                  placeholder={attachPreview ? 'Pie de foto o descripción (opcional)...' : `Responder por ${CHANNEL_LABEL[selected.channel]}...`}
                  rows={1}
                  disabled={sending || uploading}
                  className="flex-1 border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  style={{ maxHeight: '120px', overflowY: 'auto' }}
                />
                <button type="submit"
                  disabled={sending || uploading || (!replyText.trim() && !attachPreview)}
                  className={`flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${
                    ((replyText.trim() || attachPreview) && !sending && !uploading)
                      ? 'bg-blue-600 hover:bg-blue-700 text-white'
                      : 'bg-gray-100 text-gray-400'
                  }`}>
                  {(sending || uploading)
                    ? <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                    : <Send size={16} />}
                </button>
              </form>
              <p className="text-xs text-gray-400 mt-1 text-center">
                Enter para enviar · Shift+Enter nueva línea
                {selected.channel === 'whatsapp' && ' · 📎 para adjuntar'}
              </p>
            </div>
          </>
        )}
      </div>

      {/* ── Panel derecho: info contacto ── */}
      {selected && (
        <ContactPanel
          conversation={selected}
          onNewMessage={(channel, phone) => { setNewMsgOpts({ channel, phone }); setShowNew(true) }}
        />
      )}

      {/* Modal nuevo mensaje */}
      {showNew && (
        <NewMessageModal
          initialChannel={newMsgOpts?.channel}
          initialPhone={newMsgOpts?.phone}
          onClose={() => { setShowNew(false); setNewMsgOpts(null) }}
          onSent={async (conv) => {
            setShowNew(false)
            setNewMsgOpts(null)
            await loadConversations()
            if (conv) openConversation(conv)
          }}
        />
      )}
    </div>
  )
}
