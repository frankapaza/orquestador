'use client'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import api from '../../../lib/api'
import { PageHeader } from '../../../components/ui/PageHeader'
import { SectionCard } from '@/components/ui/section-card'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Zap, Plus, Pencil, Trash2, Save, X, Loader2, CheckCircle } from '../../../components/ui/icons'

const DAYS = [['mon','L'],['tue','M'],['wed','X'],['thu','J'],['fri','V'],['sat','S'],['sun','D']]

const EMPTY = {
  name: '', greeting: '', system_prompt: '',
  active_hours_start: '09:00', active_hours_end: '18:00',
  timezone: 'America/Lima', active_days: 'mon,tue,wed,thu,fri',
  handoff_number: '', handoff_triggers: 'asesor,humano,persona,operador,ejecutivo',
  handoff_timeout_min: 5, history_limit: 12, inactivity_close_hours: 24, ai_model: '', is_active: true,
}

const input = 'w-full rounded-xl border border-transparent bg-muted/60 px-3 py-2 text-sm transition-colors focus:border-ring focus:bg-background focus:outline-none'
const label = 'text-xs font-semibold text-foreground'

export default function AssistantsPage() {
  const [assistants, setAssistants] = useState([])
  const [accounts, setAccounts]     = useState([])
  const [showForm, setShowForm]     = useState(false)
  const [editingId, setEditingId]   = useState(null)
  const [form, setForm]             = useState(EMPTY)
  const [accIds, setAccIds]         = useState([])
  const [loading, setLoading]       = useState(true)
  const [saving, setSaving]         = useState(false)
  const [error, setError]           = useState(null)
  const [msg, setMsg]               = useState(null)

  async function load() {
    setLoading(true)
    try {
      const { data } = await api.get('/whatsapp/assistants')
      setAssistants(data.assistants ?? [])
      setAccounts(data.accounts ?? [])
    } catch { setMsg('No se pudo cargar') }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  function flash(text) { setMsg(text); setTimeout(() => setMsg(null), 3500) }
  function setField(k, v) { setForm(f => ({ ...f, [k]: v })) }
  function toggleDay(d) {
    const cur = (form.active_days ?? '').split(',').filter(Boolean)
    setField('active_days', (cur.includes(d) ? cur.filter(x => x !== d) : [...cur, d]).join(','))
  }
  function toggleAcc(id) { setAccIds(a => a.includes(id) ? a.filter(x => x !== id) : [...a, id]) }

  function openNew() { setForm(EMPTY); setAccIds([]); setEditingId(null); setError(null); setShowForm(true) }
  function openEdit(a) {
    setForm({
      name: a.name ?? '', greeting: a.greeting ?? '', system_prompt: a.system_prompt ?? '',
      active_hours_start: a.active_hours_start?.slice(0,5) ?? '09:00',
      active_hours_end:   a.active_hours_end?.slice(0,5)   ?? '18:00',
      timezone: a.timezone ?? 'America/Lima', active_days: a.active_days ?? 'mon,tue,wed,thu,fri',
      handoff_number: a.handoff_number ?? '', handoff_triggers: a.handoff_triggers ?? '',
      handoff_timeout_min: a.handoff_timeout_min ?? 5, history_limit: a.history_limit ?? 12,
      inactivity_close_hours: a.inactivity_close_hours ?? 24,
      ai_model: a.ai_model ?? '', is_active: a.is_active !== false,
    })
    setAccIds(a.account_ids ?? [])
    setEditingId(a.id); setError(null); setShowForm(true)
  }

  async function submit(e) {
    e.preventDefault()
    setSaving(true); setError(null)
    try {
      const payload = {
        name: form.name, greeting: form.greeting || null, system_prompt: form.system_prompt,
        active_hours_start: form.active_hours_start, active_hours_end: form.active_hours_end,
        timezone: form.timezone, active_days: form.active_days,
        handoff_number: form.handoff_number || null, handoff_triggers: form.handoff_triggers || null,
        handoff_timeout_min: Number(form.handoff_timeout_min), history_limit: Number(form.history_limit),
        inactivity_close_hours: Number(form.inactivity_close_hours),
        ai_model: form.ai_model || null, is_active: !!form.is_active,
      }
      const id = editingId
        ? (await api.patch(`/whatsapp/assistants/${editingId}`, payload)).data.id
        : (await api.post('/whatsapp/assistants', payload)).data.id
      await api.put(`/whatsapp/assistants/${id}/accounts`, { account_ids: accIds })
      setShowForm(false); load(); flash(editingId ? 'Asistente actualizado' : 'Asistente creado')
    } catch (err) {
      setError(err.response?.data?.error ?? 'Error al guardar')
    } finally { setSaving(false) }
  }

  async function remove(a) {
    if (!confirm(`¿Eliminar el asistente "${a.name}"?`)) return
    await api.delete(`/whatsapp/assistants/${a.id}`); load()
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        icon={Zap}
        title="Asistentes IA"
        description="Bots de WhatsApp con IA: un saludo y prompt con variables {{ }}, asociados a un número. Responden a los mensajes entrantes."
        action={<Button onClick={openNew}><Plus size={16} strokeWidth={2} /> Nuevo asistente</Button>}
      />

      {msg && <div className="rounded-xl bg-emerald-50 px-4 py-2.5 text-sm text-emerald-700">{msg}</div>}

      {loading ? (
        <div className="p-6 text-sm text-muted-foreground">Cargando…</div>
      ) : assistants.length === 0 ? (
        <SectionCard>
          <EmptyState icon={Zap} title="Sin asistentes"
            description="Crea un asistente, escribe su prompt con variables y asócialo a un número para que responda solo."
            action={<Button onClick={openNew}><Plus size={16} /> Crear el primero</Button>} />
        </SectionCard>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {assistants.map(a => {
            const nums = accounts.filter(w => (a.account_ids ?? []).includes(w.id))
            return (
              <div key={a.id} className="flex flex-col rounded-2xl border bg-card p-5 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">{a.name}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {a.active_hours_start?.slice(0,5)}–{a.active_hours_end?.slice(0,5)} · {(a.active_days ?? '').split(',').length} días
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${a.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-muted text-muted-foreground'}`}>
                    {a.is_active ? 'Activo' : 'Inactivo'}
                  </span>
                </div>
                <p className="mt-3 line-clamp-2 text-xs text-muted-foreground">{a.system_prompt}</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {nums.length === 0
                    ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700">Sin número asociado</span>
                    : nums.map(n => <span key={n.id} className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{n.name}</span>)}
                </div>
                <div className="mt-4 flex gap-2 border-t pt-3">
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => openEdit(a)}><Pencil size={14} /> Editar</Button>
                  <Button variant="outline" size="sm" className="border-red-200 px-3 text-red-500 hover:bg-red-50" onClick={() => remove(a)}><Trash2 size={14} /></Button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modal crear/editar */}
      {showForm && createPortal(
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border bg-card shadow-xl">
            <div className="flex items-center justify-between border-b px-6 py-4">
              <h2 className="text-base font-semibold text-foreground">{editingId ? 'Editar asistente' : 'Nuevo asistente'}</h2>
              <Button variant="ghost" size="icon" onClick={() => setShowForm(false)}><X size={18} /></Button>
            </div>

            {error && <div className="mx-6 mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

            <form onSubmit={submit} className="space-y-5 overflow-y-auto p-6">
              <div>
                <span className={label}>Nombre</span>
                <Input className={`mt-1 ${input}`} value={form.name} onChange={e => setField('name', e.target.value)} required placeholder="Ej: Cobranza cartera A" />
              </div>

              <div>
                <span className={label}>Saludo inicial (opcional)</span>
                <textarea className={`mt-1 ${input} min-h-[64px]`} value={form.greeting} onChange={e => setField('greeting', e.target.value)}
                  placeholder="Buenos días, le saluda el asistente de {{ENTIDAD}}. ¿Hablo con {{NOMBRE_CLIENTE}}?" />
              </div>

              <div>
                <span className={label}>Prompt del asistente</span>
                <textarea className={`mt-1 ${input} min-h-[140px]`} value={form.system_prompt} onChange={e => setField('system_prompt', e.target.value)} required
                  placeholder="Eres un asistente de cobranza. Recuerda al cliente {{NOMBRE_CLIENTE}} su pago de {{MONTO}} con fecha {{FECHA_PAGO}}..." />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Variables: <b>{'{{NOMBRE_CLIENTE}}'}</b>, <b>{'{{TELEFONO}}'}</b>, y cualquier columna del Excel de la campaña en MAYÚSCULAS (ej. <b>{'{{MONTO}}'}</b>, <b>{'{{FECHA_PAGO}}'}</b>, <b>{'{{ENTIDAD}}'}</b>).
                </p>
              </div>

              <div>
                <span className={label}>Números que usan este asistente</span>
                <div className="mt-1 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {accounts.length === 0
                    ? <p className="text-xs text-muted-foreground">No hay números WhatsApp. Agrégalos en Cuentas WhatsApp.</p>
                    : accounts.map(w => (
                      <label key={w.id} className="flex cursor-pointer items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-sm">
                        <input type="checkbox" className="h-4 w-4 accent-jungle-green-600" checked={accIds.includes(w.id)} onChange={() => toggleAcc(w.id)} />
                        <span className="truncate">{w.name} <span className="text-xs text-muted-foreground">{w.phone_number ?? ''}</span></span>
                      </label>
                    ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div><span className={label}>Hora inicio</span><input type="time" className={`mt-1 ${input}`} value={form.active_hours_start} onChange={e => setField('active_hours_start', e.target.value)} /></div>
                <div><span className={label}>Hora fin</span><input type="time" className={`mt-1 ${input}`} value={form.active_hours_end} onChange={e => setField('active_hours_end', e.target.value)} /></div>
                <div>
                  <span className={label}>Zona horaria</span>
                  <select className={`mt-1 ${input}`} value={form.timezone} onChange={e => setField('timezone', e.target.value)}>
                    <option value="America/Lima">Perú (Lima)</option>
                    <option value="America/Bogota">Colombia</option>
                    <option value="America/Mexico_City">México</option>
                    <option value="America/Argentina/Buenos_Aires">Argentina</option>
                  </select>
                </div>
                <div><span className={label}>Contexto (msgs)</span><input type="number" min={2} max={40} className={`mt-1 ${input}`} value={form.history_limit} onChange={e => setField('history_limit', e.target.value)} /></div>
              </div>

              <div>
                <span className={label}>Cerrar conversación tras (horas sin actividad)</span>
                <input type="number" min={0} max={720} className={`mt-1 ${input}`} value={form.inactivity_close_hours} onChange={e => setField('inactivity_close_hours', e.target.value)} />
                <p className="mt-1 text-[11px] text-muted-foreground">0 = nunca cerrar por inactividad. Default 24h.</p>
              </div>

              <div>
                <span className={label}>Días activos</span>
                <div className="mt-1 flex gap-1.5">
                  {DAYS.map(([d, ltr]) => {
                    const on = (form.active_days ?? '').split(',').includes(d)
                    return <button key={d} type="button" onClick={() => toggleDay(d)}
                      className={`h-9 w-9 rounded-lg text-xs font-medium transition-colors ${on ? 'bg-jungle-green-600 text-white' : 'bg-muted/60 text-muted-foreground hover:bg-muted'}`}>{ltr}</button>
                  })}
                </div>
              </div>

              <details className="rounded-xl bg-muted/30 p-4">
                <summary className="cursor-pointer text-xs font-semibold text-muted-foreground">Derivación a asesor (Fase 2) y modelo</summary>
                <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div><span className={label}>Número de derivación</span><Input className={`mt-1 ${input}`} value={form.handoff_number} onChange={e => setField('handoff_number', e.target.value)} placeholder="+51986095857" /></div>
                  <div><span className={label}>Timeout derivación (min)</span><input type="number" min={1} max={120} className={`mt-1 ${input}`} value={form.handoff_timeout_min} onChange={e => setField('handoff_timeout_min', e.target.value)} /></div>
                  <div className="sm:col-span-2"><span className={label}>Palabras que piden asesor</span><Input className={`mt-1 ${input}`} value={form.handoff_triggers} onChange={e => setField('handoff_triggers', e.target.value)} placeholder="asesor,humano,persona" /></div>
                  <div className="sm:col-span-2"><span className={label}>Modelo IA (opcional)</span><Input className={`mt-1 ${input}`} value={form.ai_model} onChange={e => setField('ai_model', e.target.value)} placeholder="hereda el Agente IA global" /></div>
                </div>
              </details>

              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4 accent-jungle-green-600" checked={!!form.is_active} onChange={e => setField('is_active', e.target.checked)} />
                Asistente activo (responde a entrantes)
              </label>

              <div className="flex gap-3 pt-1">
                <Button type="submit" disabled={saving} className="flex-1">
                  {saving ? <><Loader2 size={16} className="animate-spin" /> Guardando…</> : <><Save size={16} /> {editingId ? 'Guardar cambios' : 'Crear asistente'}</>}
                </Button>
                <Button type="button" variant="outline" onClick={() => setShowForm(false)} className="flex-1">Cancelar</Button>
              </div>
            </form>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
