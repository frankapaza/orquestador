'use client'
import { useEffect, useState, useCallback } from 'react'
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

const card = 'rounded-2xl border bg-card shadow-sm'
const label = 'text-xs font-semibold text-foreground'
const input = 'mt-1 w-full rounded-xl border border-transparent bg-muted/60 px-3 py-2 text-sm transition-colors focus:border-ring focus:bg-background focus:outline-none'

export default function WarmupPage() {
  const [cfg, setCfg]         = useState(null)
  const [chips, setChips]     = useState([])
  const [catalog, setCatalog] = useState([])
  const [ai, setAi]           = useState(null)
  const [aiBusy, setAiBusy]   = useState(false)
  const [genCount, setGenCount] = useState(20)
  const [chats, setChats]       = useState([])
  const [activeThread, setActiveThread] = useState(null)
  const [threadMsgs, setThreadMsgs] = useState([])
  const [alerts, setAlerts]   = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [msg, setMsg]         = useState(null)

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
    } catch (e) {
      setMsg({ type: 'error', text: 'No se pudo cargar la configuración' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Auto-refresh de la lista de chats cada 6s.
  useEffect(() => {
    const t = setInterval(() => {
      api.get('/whatsapp/warmup/chats').then(r => setChats(r.data)).catch(() => {})
    }, 6000)
    return () => clearInterval(t)
  }, [])

  // Cargar (y refrescar) los mensajes del hilo activo.
  useEffect(() => {
    if (!activeThread) return
    let alive = true
    const fetchMsgs = () => api.get('/whatsapp/warmup/chat', { params: { thread: activeThread } })
      .then(r => { if (alive) setThreadMsgs(r.data) }).catch(() => {})
    fetchMsgs()
    const t = setInterval(fetchMsgs, 6000)
    return () => { alive = false; clearInterval(t) }
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

  function setField(k, v) { setCfg(p => ({ ...p, [k]: v })) }

  function toggleDay(d) {
    const cur = (cfg.active_days ?? '').split(',').filter(Boolean)
    const next = cur.includes(d) ? cur.filter(x => x !== d) : [...cur, d]
    setField('active_days', next.join(','))
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
        ramp_start:         Number(cfg.ramp_start),
        ramp_end:           Number(cfg.ramp_end),
        ramp_mode:          cfg.ramp_mode,
        daily_cap:          Number(cfg.daily_cap),
        internal_ratio:     Number(cfg.internal_ratio),
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
      flash('ok', `${data.generated} conversaciones generadas con ${data.provider}`)
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
                    {a.account_name} · <span className="text-red-600">{a.level === 'banned' ? 'Baneado' : 'Riesgo alto'}</span>
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

        <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <span className={label}>Días de calentamiento</span>
            <input type="number" min={1} max={60} className={input} value={cfg.warmup_days ?? 7}
                   onChange={e => setField('warmup_days', e.target.value)} />
          </div>
          <div>
            <span className={label}>Mensajes/día inicio (rampa)</span>
            <input type="number" min={1} className={input} value={cfg.ramp_start ?? 5}
                   onChange={e => setField('ramp_start', e.target.value)} />
          </div>
          <div>
            <span className={label}>Mensajes/día final (rampa)</span>
            <input type="number" min={1} className={input} value={cfg.ramp_end ?? 40}
                   onChange={e => setField('ramp_end', e.target.value)} />
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
            <span className={label}>Tope diario por chip</span>
            <input type="number" min={1} className={input} value={cfg.daily_cap ?? 50}
                   onChange={e => setField('daily_cap', e.target.value)} />
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
            <span className={label}>Rampa</span>
            <select className={input} value={cfg.ramp_mode ?? 'linear'} onChange={e => setField('ramp_mode', e.target.value)}>
              <option value="linear">Lineal</option>
              <option value="steps">Por escalones</option>
            </select>
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
          <div>
            <span className={label}>% conversaciones internas ({Math.round((cfg.internal_ratio ?? 0.6) * 100)}%)</span>
            <input type="range" min={0} max={100} className="mt-3 w-full accent-jungle-green-600"
                   value={Math.round((cfg.internal_ratio ?? 0.6) * 100)}
                   onChange={e => setField('internal_ratio', Number(e.target.value) / 100)} />
          </div>
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
        <div className="border-b p-5">
          <h2 className="text-sm font-semibold text-foreground">💬 Conversaciones</h2>
          <p className="text-xs text-muted-foreground">Lo que se están diciendo los chips (se actualiza solo · historial de 7 días).</p>
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
                    <p className="truncate text-sm font-medium text-foreground">{t.title}</p>
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
