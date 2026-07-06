'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import api from '../../../lib/api'

const RISK_META = {
  green:  { dot: 'bg-emerald-500', label: 'Bajo',  text: 'text-emerald-600' },
  yellow: { dot: 'bg-amber-500',   label: 'Medio', text: 'text-amber-600' },
  red:    { dot: 'bg-red-500',     label: 'Alto',  text: 'text-red-600' },
}

const DAYS = [
  ['mon', 'L'], ['tue', 'M'], ['wed', 'X'], ['thu', 'J'],
  ['fri', 'V'], ['sat', 'S'], ['sun', 'D'],
]

// Perfiles de rampa por CONVERSACIONES/día (se multiplican cada día hasta el tope).
const RAMP_PRESETS = {
  conservador: { conv_start: 20, conv_growth: 1.5, conv_cap: 100, warmup_days: 7, label: 'Conservador' },
  moderado:    { conv_start: 50, conv_growth: 2.0, conv_cap: 200, warmup_days: 7, label: 'Moderado' },
  agresivo:    { conv_start: 100, conv_growth: 2.0, conv_cap: 400, warmup_days: 7, label: 'Agresivo' },
}
function detectProfile(cfg) {
  for (const [k, p] of Object.entries(RAMP_PRESETS)) {
    if (Number(cfg.conv_start) === p.conv_start && Number(cfg.conv_growth) === p.conv_growth &&
        Number(cfg.conv_cap) === p.conv_cap && Number(cfg.warmup_days) === p.warmup_days) return k
  }
  return 'personalizado'
}
// Objetivo de conversaciones el día d (se multiplica, con tope).
function convTarget(cfg, d) {
  const s = Number(cfg.conv_start || 0), g = Number(cfg.conv_growth || 1), cap = Number(cfg.conv_cap || 9999)
  return Math.min(Math.round(s * Math.pow(g, d - 1)), cap)
}
// Estimado de CONVERSACIONES por chip en toda la semana (suma de los días).
function weeklyEstimate(cfg) {
  const days = Number(cfg.warmup_days || 7)
  let sum = 0
  for (let d = 1; d <= days; d++) sum += convTarget(cfg, d)
  return sum
}

const card = 'rounded-2xl border bg-card shadow-sm'
const label = 'text-xs font-semibold text-foreground'
const input = 'mt-1 w-full rounded-xl border border-transparent bg-muted/60 px-3 py-2 text-sm transition-colors focus:border-ring focus:bg-background focus:outline-none'

// Hora peruana (America/Lima) para las marcas de tiempo del chat.
function fmtTime(iso) {
  if (!iso) return ''
  try { return new Date(iso).toLocaleTimeString('es-PE', { timeZone: 'America/Lima', hour: '2-digit', minute: '2-digit' }) }
  catch { return '' }
}
function fmtWhen(iso) {
  if (!iso) return ''
  try { return new Date(iso).toLocaleString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) }
  catch { return '' }
}
// Cuenta regresiva legible a partir de milisegundos restantes.
function fmtCountdown(ms) {
  const s = Math.max(0, Math.floor((ms ?? 0) / 1000))
  if (s <= 0) return 'ahora…'
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${String(sec).padStart(2, '0')}s`
  return `${sec}s`
}

export default function WarmupPage() {
  const [cfg, setCfg]         = useState(null)
  const [chips, setChips]     = useState([])
  const [catalog, setCatalog] = useState([])
  const [ai, setAi]           = useState(null)
  const [aiBusy, setAiBusy]   = useState(false)
  const [genCount, setGenCount] = useState(40)
  const [chats, setChats]       = useState([])
  const [activeThread, setActiveThread] = useState(null)
  const [threadMsgs, setThreadMsgs] = useState([])
  const [alerts, setAlerts]   = useState([])
  const [nextConv, setNextConv] = useState(null)
  const [ctrlBusy, setCtrlBusy] = useState(false)
  const [nowTs, setNowTs]     = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [msg, setMsg]         = useState(null)

  // Refs para que los handlers de SSE/ticker lean el valor actual sin re-suscribir.
  const activeThreadRef = useRef(null)
  const nextConvRef     = useRef(null)
  const lastRefreshRef  = useRef(0)
  useEffect(() => { activeThreadRef.current = activeThread }, [activeThread])
  useEffect(() => { nextConvRef.current = nextConv }, [nextConv])

  // Refresco puntual (usado por SSE y cuando la cuenta regresiva llega a 0).
  const refreshLive = useCallback(() => {
    lastRefreshRef.current = Date.now()
    api.get('/whatsapp/warmup/chats').then(r => setChats(r.data)).catch(() => {})
    api.get('/whatsapp/warmup/next').then(r => setNextConv(r.data)).catch(() => {})
    const th = activeThreadRef.current
    if (th) api.get('/whatsapp/warmup/chat', { params: { thread: th } }).then(r => setThreadMsgs(r.data)).catch(() => {})
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [c, s, cat, aiRes, ch, al] = await Promise.all([
        api.get('/whatsapp/warmup/config'),
        api.get('/whatsapp/warmup/status'),
        api.get('/whatsapp/warmup/catalog'),
        api.get('/whatsapp/warmup/ai'),
        api.get('/whatsapp/warmup/chats'),
        api.get('/whatsapp/warmup/alerts'),
      ])
      setCfg(c.data)
      setChips(s.data)
      setCatalog(cat.data)
      setAi(aiRes.data)
      setChats(ch.data)
      setAlerts(al.data)
      api.get('/whatsapp/warmup/next').then(r => setNextConv(r.data)).catch(() => {})
    } catch (e) {
      setMsg({ type: 'error', text: 'No se pudo cargar la configuración' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Tiempo real vía SSE (mismo canal /events que usa el Inbox). Al recibir un
  // mensaje de warmup, refresca chat + próxima conversación al instante.
  // Fallback a polling solo si el SSE se cae.
  useEffect(() => {
    const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1'
    const token = typeof window !== 'undefined' ? localStorage.getItem('kubo_token') : null
    if (!token) return
    let es = null, poll = null, closed = false
    const open = () => {
      if (closed) return
      try {
        es = new EventSource(`${base}/events?token=${encodeURIComponent(token)}`)
        es.addEventListener('warmup:message', () => refreshLive())
        es.onerror = () => { if (!poll) poll = setInterval(refreshLive, 20000) }
        es.onopen  = () => { if (poll) { clearInterval(poll); poll = null } }
      } catch {}
    }
    open()
    return () => { closed = true; es?.close(); if (poll) clearInterval(poll) }
  }, [refreshLive])

  // Ticker de 1s: mueve la cuenta regresiva y, al llegar a 0, refresca.
  useEffect(() => {
    setNowTs(Date.now())
    const t = setInterval(() => {
      const n = Date.now()
      setNowTs(n)
      const na = nextConvRef.current?.next_at
      if (na && n >= new Date(na).getTime() && n - lastRefreshRef.current > 8000) refreshLive()
    }, 1000)
    return () => clearInterval(t)
  }, [refreshLive])

  // Abrir automáticamente la conversación más reciente al entrar.
  useEffect(() => {
    if (!activeThread && chats.length > 0) setActiveThread(chats[0].thread_key)
  }, [chats, activeThread])

  // Cargar los mensajes al cambiar de hilo (las actualizaciones llegan por SSE).
  useEffect(() => {
    if (!activeThread) return
    let alive = true
    api.get('/whatsapp/warmup/chat', { params: { thread: activeThread } })
      .then(r => { if (alive) setThreadMsgs(r.data) }).catch(() => {})
    return () => { alive = false }
  }, [activeThread])

  function flash(type, text) {
    setMsg({ type, text })
    setTimeout(() => setMsg(null), 3500)
  }

  async function ackAlert(id) {
    try {
      await api.post(`/whatsapp/warmup/alerts/${id}/ack`)
      setAlerts(a => a.filter(x => x.id !== id))
    } catch { flash('error', 'No se pudo marcar la alerta') }
  }

  async function control(action, okText) {
    setCtrlBusy(true)
    try {
      await api.post(`/whatsapp/warmup/${action}`)
      await load()
      flash('ok', okText)
    } catch (e) {
      flash('error', e.response?.data?.error ?? 'No se pudo completar la acción')
    } finally { setCtrlBusy(false) }
  }

  function setField(k, v) { setCfg(p => ({ ...p, [k]: v })) }

  function toggleDay(d) {
    const cur = (cfg.active_days ?? '').split(',').filter(Boolean)
    const next = cur.includes(d) ? cur.filter(x => x !== d) : [...cur, d]
    setField('active_days', next.join(','))
  }

  function applyPreset(name) {
    const p = RAMP_PRESETS[name]
    if (!p) return  // "personalizado": no toca nada, el usuario edita a mano
    setCfg(c => ({ ...c, conv_start: p.conv_start, conv_growth: p.conv_growth, conv_cap: p.conv_cap, warmup_days: p.warmup_days }))
  }

  async function saveConfig() {
    setSaving(true)
    try {
      const payload = {
        is_enabled:         !!cfg.is_enabled,
        warmup_days:        Number(cfg.warmup_days),
        delay_min_sec:      Number(cfg.delay_min_sec),
        delay_max_sec:      Number(cfg.delay_max_sec),
        active_hours_start: cfg.active_hours_start?.slice(0, 5),
        active_hours_end:   cfg.active_hours_end?.slice(0, 5),
        active_days:        cfg.active_days,
        timezone:           cfg.timezone || 'America/Lima',
        conv_start:         Number(cfg.conv_start),
        conv_growth:        Number(cfg.conv_growth),
        conv_cap:           Number(cfg.conv_cap),
        internal_ratio:     Number(cfg.internal_ratio),
        allow_external:     !!cfg.allow_external,
        simulate_typing:    !!cfg.simulate_typing,
        mark_read:          !!cfg.mark_read,
      }
      const { data } = await api.put('/whatsapp/warmup/config', payload)
      setCfg(data)
      flash('ok', 'Configuración guardada')
    } catch (e) {
      flash('error', e.response?.data?.error ?? 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  async function toggleChip(chip) {
    try {
      await api.patch(`/whatsapp/accounts/${chip.id}/warmup`, { warmup_enabled: !chip.warmup_enabled })
      setChips(cs => cs.map(c => c.id === chip.id ? { ...c, warmup_enabled: !c.warmup_enabled } : c))
    } catch (e) {
      flash('error', e.response?.data?.error ?? 'No se pudo cambiar el chip')
    }
  }

  async function recomputeRisk() {
    try {
      await api.post('/whatsapp/warmup/risk/recompute')
      await load()
      flash('ok', 'Riesgo recalculado')
    } catch { flash('error', 'Error al recalcular riesgo') }
  }

  async function seedCatalog() {
    try {
      const { data } = await api.post('/whatsapp/warmup/catalog/seed')
      await load()
      flash('ok', data.seeded ? `${data.seeded} conversaciones agregadas` : 'El catálogo ya tenía conversaciones')
    } catch { flash('error', 'Error al sembrar el catálogo') }
  }

  async function generateAi() {
    setAiBusy(true)
    try {
      const { data } = await api.post('/whatsapp/warmup/catalog/generate', { count: Number(genCount) })
      await load()
      flash('ok', `${data.generated} conversaciones nuevas con ${data.provider}${data.skipped ? ` (${data.skipped} repetidas descartadas)` : ''}`)
    } catch (e) {
      flash('error', e.response?.data?.error ?? 'Error al generar con IA')
    } finally { setAiBusy(false) }
  }

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Cargando…</div>

  const enabledCount = chips.filter(c => c.warmup_enabled).length
  const redCount     = chips.filter(c => c.risk_level === 'red' || c.banned_at).length

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-foreground">
            🔥 Calentamiento de chips
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Genera conversaciones automáticas para madurar los números y evitar baneos.
          </p>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-muted-foreground">{enabledCount} en calentamiento</span>
          {redCount > 0 && <span className="font-medium text-red-600">⚠️ {redCount} en riesgo</span>}
        </div>
      </div>

      {/* Controles: Iniciar / Pausar / Detener */}
      <section className={`${card} flex flex-wrap items-center gap-3 p-4`}>
        <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${cfg.is_enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-muted text-muted-foreground'}`}>
          <span className={`h-2 w-2 rounded-full ${cfg.is_enabled ? 'bg-emerald-500' : 'bg-gray-400'}`} />
          {cfg.is_enabled ? 'En marcha' : 'Detenido'}
        </span>
        <button onClick={() => control('start', 'Calentamiento iniciado — generando conversaciones')} disabled={ctrlBusy}
          className="inline-flex items-center gap-1.5 rounded-xl bg-jungle-green-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-jungle-green-700 disabled:opacity-60">
          ▶ Iniciar / generar ahora
        </button>
        <button onClick={() => control('pause', 'Calentamiento pausado')} disabled={ctrlBusy || !cfg.is_enabled}
          className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-amber-600 disabled:opacity-50">
          ⏸ Pausar
        </button>
        <button onClick={() => { if (confirm('¿Detener el calentamiento? Se reinicia la rampa y se vacía la cola de mensajes pendientes.')) control('stop', 'Calentamiento detenido y rampa reiniciada') }} disabled={ctrlBusy}
          className="inline-flex items-center gap-1.5 rounded-xl bg-red-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-600 disabled:opacity-60">
          ⏹ Detener
        </button>
        {nextConv && cfg.is_enabled && (
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700">
            🕒 Próxima conversación:{' '}
            <span className="font-mono font-semibold tabular-nums">
              {nextConv.next_at
                ? `en ${fmtCountdown(new Date(nextConv.next_at).getTime() - nowTs)}`
                : (nextConv.label ?? '—')}
            </span>
          </span>
        )}
      </section>

      {msg && (
        <div className={`rounded-xl px-4 py-2.5 text-sm ${msg.type === 'error' ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>
          {msg.text}
        </div>
      )}

      {alerts.length > 0 && (
        <section className="rounded-2xl border border-red-200 bg-red-50 p-4">
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-red-700">
            🚨 {alerts.length} alerta(s) de riesgo
          </p>
          <ul className="space-y-2">
            {alerts.map(a => (
              <li key={a.id} className="flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">
                    {a.account_name} · <span className={a.level === 'logout' ? 'text-amber-600' : 'text-red-600'}>
                      {a.level === 'banned' ? 'Baneado' : a.level === 'logout' ? 'Sesión cerrada' : 'Riesgo alto'}
                    </span>
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{a.reason}</p>
                </div>
                <button onClick={() => ackAlert(a.id)}
                  className="shrink-0 rounded-lg border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted">
                  Marcar leída
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Configuración global */}
      <section className={card}>
        <div className="flex items-center justify-between border-b p-5">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Configuración global</h2>
            <p className="text-xs text-muted-foreground">Aplica a todos los chips (cada uno puede ajustarse aparte).</p>
          </div>
          <label className="flex cursor-pointer items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">{cfg.is_enabled ? 'Activo' : 'Inactivo'}</span>
            <input type="checkbox" className="h-5 w-5 accent-jungle-green-600" checked={!!cfg.is_enabled}
                   onChange={e => setField('is_enabled', e.target.checked)} />
          </label>
        </div>

        {/* Perfil de rampa (combo) — conversaciones/día que se multiplican */}
        <div className="flex flex-wrap items-end gap-4 border-b bg-muted/20 p-5">
          <div className="min-w-[220px]">
            <span className={label}>Perfil de rampa</span>
            <select className={input} value={detectProfile(cfg)} onChange={e => applyPreset(e.target.value)}>
              <option value="conservador">Conservador (20/día ×1.5)</option>
              <option value="moderado">Moderado (50/día ×2)</option>
              <option value="agresivo">Agresivo (100/día ×2)</option>
              <option value="personalizado">Personalizado</option>
            </select>
          </div>
          <div className="rounded-xl bg-background px-4 py-2 text-sm">
            <span className="text-muted-foreground">Conversaciones por chip/semana: </span>
            <span className="font-semibold text-foreground">~{weeklyEstimate(cfg)}</span>
            <span className="text-muted-foreground"> · {chips.filter(c => c.warmup_enabled).length} chips ≈ ~{weeklyEstimate(cfg) * Math.max(1, chips.filter(c => c.warmup_enabled).length)}</span>
          </div>
          <p className="w-full text-xs text-muted-foreground">
            Flujo <b className="text-foreground">continuo</b> durante el día (tiempos aleatorios). Conversaciones/día por chip: <b className="text-foreground">{Array.from({ length: Math.min(7, Number(cfg.warmup_days ?? 7)) }, (_, i) => convTarget(cfg, i + 1)).join(' → ')}</b>. “Personalizado” = ajusta abajo.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <span className={label}>Días de calentamiento</span>
            <input type="number" min={1} max={60} className={input} value={cfg.warmup_days ?? 7}
                   onChange={e => setField('warmup_days', e.target.value)} />
          </div>
          <div>
            <span className={label}>Conversaciones/día (inicio)</span>
            <input type="number" min={1} className={input} value={cfg.conv_start ?? 50}
                   onChange={e => setField('conv_start', e.target.value)} />
          </div>
          <div>
            <span className={label}>Multiplicador diario (×)</span>
            <input type="number" min={1} max={10} step={0.1} className={input} value={cfg.conv_growth ?? 2}
                   onChange={e => setField('conv_growth', e.target.value)} />
          </div>
          <div>
            <span className={label}>Tope conversaciones/día</span>
            <input type="number" min={1} className={input} value={cfg.conv_cap ?? 200}
                   onChange={e => setField('conv_cap', e.target.value)} />
          </div>
          <div>
            <span className={label}>Delay mínimo (seg)</span>
            <input type="number" min={5} className={input} value={cfg.delay_min_sec ?? 30}
                   onChange={e => setField('delay_min_sec', e.target.value)} />
          </div>
          <div>
            <span className={label}>Delay máximo (seg)</span>
            <input type="number" min={10} className={input} value={cfg.delay_max_sec ?? 300}
                   onChange={e => setField('delay_max_sec', e.target.value)} />
          </div>
          <div>
            <span className={label}>Hora inicio</span>
            <input type="time" className={input} value={cfg.active_hours_start?.slice(0, 5) ?? '08:00'}
                   onChange={e => setField('active_hours_start', e.target.value)} />
          </div>
          <div>
            <span className={label}>Hora fin</span>
            <input type="time" className={input} value={cfg.active_hours_end?.slice(0, 5) ?? '20:00'}
                   onChange={e => setField('active_hours_end', e.target.value)} />
          </div>
          <div>
            <span className={label}>Zona horaria</span>
            <select className={input} value={cfg.timezone || 'America/Lima'} onChange={e => setField('timezone', e.target.value)}>
              <option value="America/Lima">Perú (Lima) UTC−5</option>
              <option value="America/Bogota">Colombia (Bogotá) UTC−5</option>
              <option value="America/Mexico_City">México (CDMX) UTC−6</option>
              <option value="America/Santiago">Chile (Santiago)</option>
              <option value="America/Argentina/Buenos_Aires">Argentina (Bs. As.) UTC−3</option>
              <option value="UTC">UTC</option>
            </select>
          </div>
          <div>
            <span className={label}>Números externos</span>
            <label className="mt-1 flex cursor-pointer items-center gap-2 rounded-xl bg-muted/60 px-3 py-2.5 text-sm">
              <input type="checkbox" className="h-4 w-4 accent-jungle-green-600" checked={!!cfg.allow_external}
                     onChange={e => setField('allow_external', e.target.checked)} />
              Permitir conversar con externos
            </label>
          </div>
          <div className="sm:col-span-2">
            <span className={label}>Días activos</span>
            <div className="mt-1 flex gap-1.5">
              {DAYS.map(([d, ltr]) => {
                const on = (cfg.active_days ?? '').split(',').includes(d)
                return (
                  <button key={d} type="button" onClick={() => toggleDay(d)}
                    className={`h-9 w-9 rounded-lg text-xs font-medium transition-colors ${on ? 'bg-jungle-green-600 text-white' : 'bg-muted/60 text-muted-foreground hover:bg-muted'}`}>
                    {ltr}
                  </button>
                )
              })}
            </div>
          </div>
          {cfg.allow_external ? (
            <div>
              <span className={label}>% conversaciones internas ({Math.round((cfg.internal_ratio ?? 0.6) * 100)}%)</span>
              <input type="range" min={0} max={100} className="mt-3 w-full accent-jungle-green-600"
                     value={Math.round((cfg.internal_ratio ?? 0.6) * 100)}
                     onChange={e => setField('internal_ratio', Number(e.target.value) / 100)} />
              <p className="mt-1 text-[11px] text-muted-foreground">El resto va a números externos.</p>
            </div>
          ) : (
            <div className="sm:col-span-2 lg:col-span-3">
              <p className="rounded-xl bg-jungle-green-50 px-3 py-2 text-xs text-jungle-green-700">
                🔒 Solo conversaciones <b>entre tus chips activos</b> (más seguro). Activa “Permitir externos” para incluir contactos reales.
              </p>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-5 border-t px-5 py-4">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-jungle-green-600" checked={!!cfg.simulate_typing}
                   onChange={e => setField('simulate_typing', e.target.checked)} />
            Simular “escribiendo…”
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-jungle-green-600" checked={!!cfg.mark_read}
                   onChange={e => setField('mark_read', e.target.checked)} />
            Marcar leídos
          </label>
          <button onClick={saveConfig} disabled={saving}
            className="ml-auto rounded-xl bg-jungle-green-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-jungle-green-700 disabled:opacity-60">
            {saving ? 'Guardando…' : 'Guardar configuración'}
          </button>
        </div>
      </section>

      {/* Selección de chips */}
      <section className={card}>
        <div className="flex items-center justify-between border-b p-5">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Chips a calentar</h2>
            <p className="text-xs text-muted-foreground">Marca solo los números que quieres calentar.</p>
          </div>
          <button onClick={recomputeRisk}
            className="rounded-lg border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted">
            Recalcular riesgo
          </button>
        </div>

        {chips.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No hay números WhatsApp (Baileys) registrados.</div>
        ) : (
          <ul className="divide-y">
            {chips.map(chip => {
              const risk = RISK_META[chip.risk_level ?? 'green'] ?? RISK_META.green
              return (
                <li key={chip.id} className="flex flex-wrap items-center gap-4 p-4">
                  <label className="flex cursor-pointer items-center">
                    <input type="checkbox" className="h-5 w-5 accent-jungle-green-600" checked={!!chip.warmup_enabled}
                           disabled={!!chip.banned_at} onChange={() => toggleChip(chip)} />
                  </label>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{chip.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{chip.phone_number ?? 'Sin número'}</p>
                  </div>

                  <div className="flex items-center gap-1.5 text-xs">
                    <span className={`h-2.5 w-2.5 rounded-full ${chip.connected ? 'bg-emerald-500' : 'bg-gray-300'}`} />
                    <span className="text-muted-foreground">{chip.connected ? 'Conectado' : 'Sin conexión'}</span>
                  </div>

                  {chip.warmup_enabled && (
                    <span className="rounded-full bg-orange-100 px-2.5 py-1 text-xs font-medium text-orange-700">
                      🔥 día {chip.warmup_day || 1}
                    </span>
                  )}

                  <div className="text-right text-xs text-muted-foreground">
                    <div>↑ {chip.sent_today} · ↓ {chip.received_today}</div>
                    <div>hoy</div>
                  </div>

                  <div className="flex w-24 items-center justify-end gap-1.5">
                    {chip.banned_at ? (
                      <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-700">Baneado</span>
                    ) : (
                      <>
                        <span className={`h-2.5 w-2.5 rounded-full ${risk.dot}`} />
                        <span className={`text-xs font-medium ${risk.text}`}>{risk.label}</span>
                      </>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* Conversaciones (chat) */}
      <section className={card}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b p-5">
          <div>
            <h2 className="text-sm font-semibold text-foreground">💬 Conversaciones</h2>
            <p className="text-xs text-muted-foreground">Lo que se están diciendo los chips (se actualiza solo · historial de 7 días).</p>
          </div>
          {chats.length > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
              Última actividad: {fmtWhen(chats[0].last_at)}
            </span>
          )}
        </div>
        {chats.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Aún no hay mensajes de calentamiento.</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-[240px_1fr]">
            {/* Lista de hilos */}
            <ul className="max-h-96 divide-y overflow-y-auto border-r">
              {chats.map(t => (
                <li key={t.thread_key}>
                  <button onClick={() => setActiveThread(t.thread_key)}
                    className={`w-full px-4 py-3 text-left transition-colors hover:bg-muted/50 ${activeThread === t.thread_key ? 'bg-muted/60' : ''}`}>
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="truncate text-sm font-medium text-foreground">{t.title}</p>
                      <span className="shrink-0 text-[10px] text-muted-foreground">{fmtTime(t.last_at)}</span>
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{t.last_text}</p>
                  </button>
                </li>
              ))}
            </ul>
            {/* Burbujas del hilo activo */}
            <div className="max-h-96 space-y-2 overflow-y-auto p-4">
              {!activeThread ? (
                <p className="pt-8 text-center text-sm text-muted-foreground">Elige una conversación para verla.</p>
              ) : threadMsgs.length === 0 ? (
                <p className="pt-8 text-center text-sm text-muted-foreground">Sin mensajes.</p>
              ) : (
                threadMsgs.map((m) => {
                  // Alinear por emisor: el primer emisor del hilo va a la izquierda.
                  const leftId = threadMsgs[0].from_account_id
                  const mine = m.from_account_id === leftId
                  return (
                    <div key={m.id} className={`flex ${mine ? 'justify-start' : 'justify-end'}`}>
                      <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${mine ? 'bg-muted text-foreground' : 'bg-jungle-green-600 text-white'}`}>
                        <p className="mb-0.5 text-[10px] opacity-70">{m.from_name ?? 'Chip'}</p>
                        {m.text}
                        <p className={`mt-0.5 text-right text-[10px] ${mine ? 'text-muted-foreground' : 'text-white/70'}`}>{fmtTime(m.created_at)}</p>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        )}
      </section>

      {/* Catálogo */}
      <section className={card}>
        <div className="flex flex-wrap items-center justify-between gap-3 p-5">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Catálogo de conversaciones</h2>
            <p className="text-xs text-muted-foreground">
              {catalog.length} conversación(es) · {catalog.filter(c => c.source === 'ai').length} por IA · {catalog.filter(c => c.source !== 'ai').length} base
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={seedCatalog}
              className="rounded-lg border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted">
              Sembrar catálogo base
            </button>
            <input type="number" min={1} max={50} value={genCount} onChange={e => setGenCount(e.target.value)}
              className="w-16 rounded-lg border border-transparent bg-muted/60 px-2 py-1.5 text-xs focus:border-ring focus:bg-background focus:outline-none" />
            <button onClick={generateAi} disabled={aiBusy || !ai?.has_ai_key}
              title={ai?.has_ai_key ? 'Generar diálogos con IA' : 'Configura el Agente IA en Configuración'}
              className="rounded-lg bg-orange-500 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-orange-600 disabled:opacity-50">
              {aiBusy ? 'Generando…' : '🤖 Generar con IA'}
            </button>
          </div>
        </div>
        {!ai?.has_ai_key && (
          <p className="border-t px-5 py-3 text-xs text-muted-foreground">
            Para generar diálogos con IA, configura el proveedor y la API key en <b className="text-foreground">Configuración → Agente IA</b>.
          </p>
        )}
      </section>
    </div>
  )
}
