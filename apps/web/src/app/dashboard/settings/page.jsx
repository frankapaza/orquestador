'use client'
import { useEffect, useState } from 'react'
import api from '../../../lib/api'
import { PageHeader } from '@/components/ui/PageHeader'
import { SectionCard } from '@/components/ui/section-card'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Modal } from '@/components/ui/modal'
import {
  Settings, User, Users, Pencil, Eye, UserPlus, Save, Plus, Copy, Lock,
  Check, X, Key, AlertCircle, CheckCircle, Star, Loader2, Trash2, Zap, Globe,
} from '../../../components/ui/icons'
import { cn } from '@/lib/utils'

const TABS = [
  { label: 'Perfil',    Icon: User },
  { label: 'Equipo',    Icon: Users },
  { label: 'API Keys',  Icon: Key },
  { label: 'Agente IA', Icon: Zap },
  { label: 'Proxies',   Icon: Globe },
]
const INPUT_CLASS = 'h-[52px] rounded-xl border-transparent bg-muted/60 text-base shadow-none transition-colors focus-visible:border-ring focus-visible:bg-background focus-visible:ring-0'

const ROLES = [
  { value: 'asesor', label: 'Asesor', Icon: User, color: 'bg-jungle-green-100 text-jungle-green-700',
    description: 'Accede al Inbox y sus conversaciones WA/SMS asignadas.',
    permisos: ['Inbox y conversaciones', 'Su número WA/SMS asignado', 'Enviar mensajes individuales'],
    noPermisos: ['Campañas masivas', 'Configuración del sistema', 'Dominios e integraciones'] },
  { value: 'editor', label: 'Editor', Icon: Pencil, color: 'bg-blue-100 text-blue-700',
    description: 'Gestiona campañas, contactos e integraciones.',
    permisos: ['Todo lo del Asesor', 'Crear y gestionar campañas', 'Importar contactos', 'Ver reportes'],
    noPermisos: ['Configuración de WhatsApp/SMS', 'Gestión del equipo', 'API Keys'] },
  { value: 'viewer', label: 'Visor', Icon: Eye, color: 'bg-muted text-muted-foreground',
    description: 'Solo lectura: ve campañas y reportes, sin cambios.',
    permisos: ['Ver campañas y reportes', 'Ver contactos'],
    noPermisos: ['Crear o editar nada', 'Enviar mensajes', 'Configuración'] },
]
const ROLE_MAP   = Object.fromEntries(ROLES.map(r => [r.value, r]))
const ROLE_LABEL = { owner: 'Dueño', ...Object.fromEntries(ROLES.map(r => [r.value, r.label])) }
const ROLE_COLOR = { owner: 'bg-violet-100 text-violet-700', ...Object.fromEntries(ROLES.map(r => [r.value, r.color])) }
const ROLE_ICON   = { owner: Star, asesor: User, editor: Pencil, viewer: Eye }
const ROLE_TILE   = { owner: 'bg-violet-50 text-violet-600', asesor: 'bg-jungle-green-50 text-jungle-green-600', editor: 'bg-blue-50 text-blue-600', viewer: 'bg-muted text-muted-foreground' }
const ROLE_AVATAR = { owner: 'bg-violet-100 text-violet-700', asesor: 'bg-jungle-green-100 text-jungle-green-700', editor: 'bg-blue-100 text-blue-700', viewer: 'bg-muted text-muted-foreground' }
const ROLE_CARDS = [
  { value: 'owner',  label: 'Dueño',  description: 'Acceso total a la cuenta. Es la cuenta principal y no se puede eliminar.', caps: ['Acceso a todo'] },
  { value: 'asesor', label: 'Asesor', description: ROLE_MAP.asesor.description, caps: ROLE_MAP.asesor.permisos.slice(0, 3) },
  { value: 'editor', label: 'Editor', description: ROLE_MAP.editor.description, caps: ROLE_MAP.editor.permisos.slice(0, 3) },
  { value: 'viewer', label: 'Visor',  description: ROLE_MAP.viewer.description, caps: ROLE_MAP.viewer.permisos.slice(0, 2) },
]

function RoleChip({ role }) {
  const Icon = ROLE_ICON[role] ?? User
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', ROLE_COLOR[role] ?? 'bg-muted text-muted-foreground')}>
      <Icon size={11} strokeWidth={2} /> {ROLE_LABEL[role] ?? role}
    </span>
  )
}

function Field({ label, children }) {
  return <div className="space-y-1.5"><Label className="text-muted-foreground">{label}</Label>{children}</div>
}
function Notice({ type, msg }) {
  if (!msg) return null
  const ok = type === 'ok'
  return (
    <p className={cn('flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium', ok ? 'bg-jungle-green-100 text-jungle-green-700' : 'bg-red-100 text-red-700')}>
      {ok ? <CheckCircle size={16} strokeWidth={1.75} /> : <AlertCircle size={16} strokeWidth={1.75} />}{msg}
    </p>
  )
}
function Avatar({ name, className }) {
  return <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-jungle-green-100 text-sm font-semibold text-jungle-green-700', className)}>{(name ?? '?').charAt(0).toUpperCase()}</span>
}

// ── Perfil ────────────────────────────────────────────────────────────────────
function ProfileTab({ user, onUpdated }) {
  const [form, setForm] = useState({ name: user?.name ?? '', email: user?.email ?? '' })
  const [pass, setPass] = useState({ current: '', new_pass: '', confirm: '' })
  const [loading, setLoading] = useState(false)
  const [passLoading, setPassLoading] = useState(false)
  const [msg, setMsg] = useState(null)
  const [passMsg, setPassMsg] = useState(null)
  useEffect(() => { if (user) setForm({ name: user.name, email: user.email }) }, [user])

  async function saveProfile(e) {
    e.preventDefault(); setLoading(true); setMsg(null)
    try { await api.patch('/settings/profile', form); setMsg({ type: 'ok', text: 'Perfil actualizado' }); onUpdated() }
    catch (err) { setMsg({ type: 'err', text: err.response?.data?.error ?? 'Error al guardar' }) } finally { setLoading(false) }
  }
  async function changePassword(e) {
    e.preventDefault()
    if (pass.new_pass !== pass.confirm) return setPassMsg({ type: 'err', text: 'Las contraseñas no coinciden' })
    setPassLoading(true); setPassMsg(null)
    try { await api.patch('/settings/password', { current_password: pass.current, new_password: pass.new_pass }); setPassMsg({ type: 'ok', text: 'Contraseña actualizada' }); setPass({ current: '', new_pass: '', confirm: '' }) }
    catch (err) { setPassMsg({ type: 'err', text: err.response?.data?.error ?? 'Error al cambiar contraseña' }) } finally { setPassLoading(false) }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-jungle-green-100 bg-jungle-green-50 p-4">
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-jungle-green-600 text-lg font-semibold text-white">{(user?.name ?? '?').charAt(0).toUpperCase()}</span>
          <div>
            <p className="text-sm font-semibold text-foreground">{user?.name}</p>
            <p className="text-xs text-muted-foreground">{user?.email}</p>
          </div>
        </div>
        <span className="inline-flex shrink-0 rounded-full bg-jungle-green-600 px-2.5 py-1 text-xs font-medium capitalize text-white">
          {['asesor', 'editor', 'viewer'].includes(user?.role) ? ROLE_LABEL[user.role] : `Plan ${user?.plan ?? 'basic'}`}
        </span>
      </div>

      <SectionCard title="Datos personales" description="Actualiza tu nombre y correo de acceso.">
        <form onSubmit={saveProfile} className="space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Nombre"><Input className={INPUT_CLASS} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required /></Field>
            <Field label="Email"><Input className={INPUT_CLASS} type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} required /></Field>
          </div>
          <Notice type={msg?.type} msg={msg?.text} />
          <Button type="submit" disabled={loading}>{loading ? <><Loader2 size={16} className="animate-spin" /> Guardando...</> : <><Save size={16} /> Guardar cambios</>}</Button>
        </form>
      </SectionCard>

      <SectionCard title="Cambiar contraseña" description="Usa una clave de al menos 8 caracteres.">
        <form onSubmit={changePassword} className="space-y-5">
          <Field label="Contraseña actual"><Input className={INPUT_CLASS} type="password" value={pass.current} onChange={e => setPass(f => ({ ...f, current: e.target.value }))} required /></Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Nueva contraseña (mín. 8 caracteres)"><Input className={INPUT_CLASS} type="password" value={pass.new_pass} onChange={e => setPass(f => ({ ...f, new_pass: e.target.value }))} required minLength={8} /></Field>
            <Field label="Confirmar nueva contraseña"><Input className={INPUT_CLASS} type="password" value={pass.confirm} onChange={e => setPass(f => ({ ...f, confirm: e.target.value }))} required /></Field>
          </div>
          <Notice type={passMsg?.type} msg={passMsg?.text} />
          <Button type="submit" disabled={passLoading}>{passLoading ? <><Loader2 size={16} className="animate-spin" /> Guardando...</> : <><Lock size={16} /> Cambiar contraseña</>}</Button>
        </form>
      </SectionCard>
    </div>
  )
}

// ── Modal: agregar miembro ────────────────────────────────────────────────────
function AddMemberModal({ onClose, onSaved }) {
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'asesor' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  async function submit(e) {
    e.preventDefault(); setLoading(true); setError(null)
    try { await api.post('/settings/team', form); onSaved(form.name) }
    catch (err) { setError(err.response?.data?.error ?? 'Error al agregar el miembro') } finally { setLoading(false) }
  }
  const role = ROLE_MAP[form.role]

  return (
    <Modal open onClose={onClose} size="2xl" icon={UserPlus} title="Agregar miembro"
      description="Creas su cuenta con una contraseña temporal; podrá cambiarla al iniciar sesión.">
      <form onSubmit={submit} className="space-y-5 p-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Nombre completo"><Input className={INPUT_CLASS} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required placeholder="María López" /></Field>
          <Field label="Email"><Input className={INPUT_CLASS} type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} required placeholder="maria@empresa.com" /></Field>
        </div>
        <Field label="Contraseña temporal (mín. 8 caracteres)">
          <Input className={INPUT_CLASS} type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} required minLength={8} placeholder="El miembro podrá cambiarla luego" />
        </Field>

        <div className="space-y-2">
          <Label className="text-muted-foreground">Rol</Label>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {ROLES.map(r => (
              <button key={r.value} type="button" onClick={() => setForm(f => ({ ...f, role: r.value }))}
                className={cn('rounded-xl border-2 p-3 text-left transition-all',
                  form.role === r.value ? 'border-jungle-green-500 bg-jungle-green-50' : 'border-border bg-card hover:border-jungle-green-200 hover:bg-muted/40')}>
                <r.Icon size={18} strokeWidth={1.75} className={cn('mb-1', form.role === r.value ? 'text-jungle-green-600' : 'text-muted-foreground')} />
                <p className="text-sm font-semibold text-foreground">{r.label}</p>
                <p className="mt-0.5 text-xs leading-tight text-muted-foreground">{r.description}</p>
              </button>
            ))}
          </div>
          {role && (
            <div className="mt-3 grid grid-cols-1 gap-4 rounded-xl border bg-muted/30 p-4 sm:grid-cols-2">
              <div>
                <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-jungle-green-700"><Check size={14} strokeWidth={2} /> Puede hacer</p>
                {role.permisos.map(p => <p key={p} className="mb-1 flex gap-1.5 text-xs text-foreground"><Check size={14} strokeWidth={2} className="mt-0.5 shrink-0 text-jungle-green-600" />{p}</p>)}
              </div>
              <div>
                <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-red-600"><X size={14} strokeWidth={2} /> No puede</p>
                {role.noPermisos.map(p => <p key={p} className="mb-1 flex gap-1.5 text-xs text-muted-foreground"><X size={14} strokeWidth={2} className="mt-0.5 shrink-0 text-red-400" />{p}</p>)}
              </div>
            </div>
          )}
        </div>

        {error && <Notice type="err" msg={error} />}
        <div className="flex gap-3 pt-1">
          <Button type="submit" disabled={loading} className="flex-1">{loading ? <><Loader2 size={16} className="animate-spin" /> Creando...</> : <><Save size={16} /> Crear miembro</>}</Button>
          <Button type="button" variant="outline" onClick={onClose} className="flex-1">Cancelar</Button>
        </div>
      </form>
    </Modal>
  )
}

// ── Equipo ────────────────────────────────────────────────────────────────────
function TeamTab() {
  const [members, setMembers] = useState([])
  const [msg, setMsg] = useState(null)
  const [showForm, setShowForm] = useState(false)

  async function load() { const { data } = await api.get('/settings/team'); setMembers(data) }
  useEffect(() => { load() }, [])

  async function toggleMember(id, is_active) { await api.patch(`/settings/team/${id}`, { is_active }); load() }
  async function removeMember(id, name) { if (!confirm(`¿Eliminar a ${name} del equipo?`)) return; await api.delete(`/settings/team/${id}`); load() }

  return (
    <div className="space-y-4">
      <SectionCard noPadding title={`Miembros del equipo (${members.length})`}
        action={<Button size="sm" onClick={() => setShowForm(true)}><UserPlus size={16} strokeWidth={1.75} /> Agregar miembro</Button>}>
        {msg && <div className="px-5 pt-4"><Notice type={msg.type} msg={msg.text} /></div>}
        <div className="divide-y">
          {members.map(m => (
            <div key={m.id} className={cn('group flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-muted/40', !m.is_active && 'opacity-60')}>
              <div className="relative shrink-0">
                <Avatar name={m.name} className={ROLE_AVATAR[m.role] ?? ''} />
                {!m.is_owner && <span className={cn('absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card', m.is_active ? 'bg-jungle-green-500' : 'bg-muted-foreground/40')} />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium text-foreground">{m.name}</p>
                  {m.is_owner && <span className="shrink-0 rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">Tú</span>}
                  {!m.is_active && <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">Suspendido</span>}
                </div>
                <p className="truncate text-xs text-muted-foreground">{m.email}</p>
              </div>
              <RoleChip role={m.role} />
              {m.is_owner ? (
                <span className="hidden whitespace-nowrap text-xs text-muted-foreground sm:inline">Cuenta principal</span>
              ) : (
                <div className="flex shrink-0 items-center gap-1">
                  {m.is_active
                    ? <Button variant="ghost" size="sm" className="h-7 px-2 text-amber-600 hover:bg-amber-50 hover:text-amber-700" onClick={() => toggleMember(m.id, false)}>Suspender</Button>
                    : <Button variant="ghost" size="sm" className="h-7 px-2 text-jungle-green-700 hover:bg-jungle-green-50 hover:text-jungle-green-800" onClick={() => toggleMember(m.id, true)}>Activar</Button>}
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500 hover:bg-red-50 hover:text-red-600" onClick={() => removeMember(m.id, m.name)}><Trash2 size={14} /></Button>
                </div>
              )}
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Roles y permisos" description="Qué puede hacer cada tipo de miembro.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {ROLE_CARDS.map(r => {
            const count = members.filter(m => (r.value === 'owner' ? m.is_owner : m.role === r.value && !m.is_owner)).length
            const Icon = ROLE_ICON[r.value]
            return (
              <div key={r.value} className="rounded-2xl border bg-card p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className={cn('flex h-9 w-9 items-center justify-center rounded-xl', ROLE_TILE[r.value])}><Icon size={17} strokeWidth={1.75} /></span>
                    <p className="text-sm font-semibold text-foreground">{r.label}</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">{count} {count === 1 ? 'miembro' : 'miembros'}</span>
                </div>
                <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">{r.description}</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {r.caps.map(c => (
                    <span key={c} className="inline-flex items-center gap-1 rounded-full bg-jungle-green-50 px-2 py-0.5 text-[11px] font-medium text-jungle-green-700">
                      <Check size={10} strokeWidth={2.5} /> {c}
                    </span>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </SectionCard>

      {showForm && <AddMemberModal onClose={() => setShowForm(false)} onSaved={(name) => { setShowForm(false); setMsg({ type: 'ok', text: `${name} agregado al equipo` }); load() }} />}
    </div>
  )
}

// ── API Keys ──────────────────────────────────────────────────────────────────
function ApiKeysTab() {
  const [keys, setKeys] = useState([])
  const [newKey, setNewKey] = useState(null)
  const [form, setForm] = useState({ name: '' })
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [msg, setMsg] = useState(null)

  async function load() { const { data } = await api.get('/settings/api-keys'); setKeys(data) }
  useEffect(() => { load() }, [])

  async function createKey(e) {
    e.preventDefault(); setLoading(true); setMsg(null)
    try { const { data } = await api.post('/settings/api-keys', { name: form.name }); setNewKey(data); setForm({ name: '' }); load() }
    catch (err) { setMsg({ type: 'err', text: err.response?.data?.error ?? 'Error al crear API Key' }) } finally { setLoading(false) }
  }
  async function revokeKey(id, name) { if (!confirm(`¿Revocar la API Key "${name}"? Los sistemas que la usen perderán acceso.`)) return; await api.delete(`/settings/api-keys/${id}`); load() }
  function copyKey(text) { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000) }

  return (
    <div className="space-y-4">
      {newKey && (
        <div className="space-y-3 rounded-2xl border border-jungle-green-300 bg-jungle-green-50 p-5">
          <p className="flex items-center gap-2 font-semibold text-jungle-green-800"><CheckCircle size={18} strokeWidth={1.75} /> API Key creada. Guárdala ahora, no se mostrará de nuevo.</p>
          <div className="flex items-center justify-between gap-3 break-all rounded-lg border border-jungle-green-300 bg-card px-4 py-3 font-mono text-sm text-foreground">
            <span>{newKey.raw_key}</span>
            <Button size="sm" className="shrink-0" onClick={() => copyKey(newKey.raw_key)}>{copied ? <><Check size={14} /> Copiado</> : <><Copy size={14} /> Copiar</>}</Button>
          </div>
          <Button variant="ghost" size="sm" className="text-jungle-green-700 hover:text-jungle-green-800" onClick={() => setNewKey(null)}>Ya la guardé, cerrar</Button>
        </div>
      )}

      <SectionCard title="Generar nueva API Key" description="Para acceso programático a la API de Kubo.">
        <form onSubmit={createKey} className="space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row">
            <Input className={`${INPUT_CLASS} flex-1`} value={form.name} onChange={e => setForm({ name: e.target.value })} required placeholder="Ej: Mi CRM, App interna..." />
            <Button type="submit" disabled={loading} className="h-[52px] shrink-0 rounded-xl">{loading ? <><Loader2 size={16} className="animate-spin" /> Generando...</> : <><Plus size={16} /> Crear</>}</Button>
          </div>
          <Notice type={msg?.type} msg={msg?.text} />
          <p className="text-xs text-muted-foreground">Úsala en el header: <code className="rounded bg-muted px-1.5 py-0.5 font-mono">Authorization: Bearer kubo_...</code></p>
        </form>
      </SectionCard>

      <SectionCard noPadding title={`API Keys activas (${keys.length})`}>
        {keys.length === 0 ? (
          <EmptyState icon={Key} title="Sin API Keys" description="Genera una para acceso programático a la API de Kubo." />
        ) : (
          <div className="divide-y">
            {keys.map(k => (
              <div key={k.id} className="flex items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-muted/40">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground"><Key size={16} /></span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{k.name}</p>
                    <p className="font-mono text-xs text-muted-foreground">{k.key_prefix}••••••••</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">Creada: {new Date(k.created_at).toLocaleDateString('es')}{k.last_used_at && ` · Último uso: ${new Date(k.last_used_at).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' })}`}</p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', k.is_active ? 'bg-jungle-green-100 text-jungle-green-700' : 'bg-muted text-muted-foreground')}>{k.is_active ? 'Activa' : 'Revocada'}</span>
                  {k.is_active && <Button variant="ghost" size="sm" className="h-7 px-2 text-red-500 hover:bg-red-50 hover:text-red-600" onClick={() => revokeKey(k.id, k.name)}><Lock size={14} /> Revocar</Button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard title="Ejemplo de uso con curl">
        <code className="block whitespace-pre rounded-lg bg-foreground px-4 py-3 font-mono text-xs text-jungle-green-300">{`curl http://localhost:3001/api/v1/campaigns \\
  -H "Authorization: Bearer kubo_TU_API_KEY"`}</code>
      </SectionCard>
    </div>
  )
}

// ── Agente IA ─────────────────────────────────────────────────────────────────
function AiAgentTab() {
  const [ai, setAi]     = useState(null)
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg]   = useState(null)

  async function load() {
    try { const { data } = await api.get('/whatsapp/warmup/ai'); setAi(data) }
    catch { setMsg({ type: 'err', text: 'No se pudo cargar la configuración de IA' }) }
  }
  useEffect(() => { load() }, [])

  function setField(k, v) { setAi(p => ({ ...p, [k]: v })) }
  function flash(type, text) { setMsg({ type, text }); setTimeout(() => setMsg(null), 3500) }

  async function save(e) {
    e.preventDefault(); setBusy(true); setMsg(null)
    try {
      // Para proveedores conocidos, solo se acepta un modelo de la lista; si no,
      // se envía null y el backend usa el modelo por defecto válido.
      const known = ai.model_hints?.[ai.ai_provider] ?? []
      const model = ai.ai_provider === 'custom'
        ? (ai.ai_model || null)
        : (known.includes(ai.ai_model) ? ai.ai_model : null)
      const payload = { ai_provider: ai.ai_provider, ai_model: model, ai_base_url: ai.ai_base_url || null, ai_auto_weekly: !!ai.ai_auto_weekly }
      if (apiKey.trim()) payload.api_key = apiKey.trim()
      const { data } = await api.put('/whatsapp/warmup/ai', payload)
      setAi(a => ({ ...a, ...data })); setApiKey('')
      flash('ok', 'Agente IA guardado')
    } catch (err) { flash('err', err.response?.data?.error ?? 'Error al guardar') }
    finally { setBusy(false) }
  }

  async function test() {
    setBusy(true); setMsg(null)
    try { const { data } = await api.post('/whatsapp/warmup/ai/test'); flash('ok', `Conexión OK (${data.model})`) }
    catch (err) { flash('err', err.response?.data?.error ?? 'Falló la prueba de conexión') }
    finally { setBusy(false) }
  }

  if (!ai) return <div className="text-sm text-muted-foreground">Cargando…</div>
  const providerModel = ai.presets?.[ai.ai_provider]?.model ?? 'auto'
  const knownModels   = ai.model_hints?.[ai.ai_provider] ?? []
  // Valor mostrado en el select: '' = usar el modelo por defecto del proveedor.
  const modelValue = ai.ai_provider === 'custom'
    ? (ai.ai_model ?? '')
    : (knownModels.includes(ai.ai_model) ? ai.ai_model : '')

  return (
    <div className="space-y-4">
      <SectionCard title="Agente IA" description="Proveedor para generar automáticamente los diálogos del calentamiento de WhatsApp. ChatGPT y DeepSeek son compatibles.">
        <form onSubmit={save} className="space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Proveedor">
              <select className={`${INPUT_CLASS} w-full px-3`} value={ai.ai_provider ?? 'openai'} onChange={e => setField('ai_provider', e.target.value)}>
                <option value="openai">ChatGPT (OpenAI)</option>
                <option value="deepseek">DeepSeek</option>
                <option value="custom">Personalizado (compatible OpenAI)</option>
              </select>
            </Field>
            <Field label="Modelo">
              {ai.ai_provider === 'custom' ? (
                <Input className={INPUT_CLASS} value={ai.ai_model ?? ''} placeholder="nombre-del-modelo" onChange={e => setField('ai_model', e.target.value)} />
              ) : (
                <select className={`${INPUT_CLASS} w-full px-3`} value={modelValue} onChange={e => setField('ai_model', e.target.value)}>
                  <option value="">Por defecto ({providerModel})</option>
                  {knownModels.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              )}
            </Field>
          </div>

          {ai.ai_provider === 'custom' && (
            <Field label="URL base (endpoint compatible con OpenAI)">
              <Input className={INPUT_CLASS} value={ai.ai_base_url ?? ''} placeholder="https://api.tuproveedor.com/v1" onChange={e => setField('ai_base_url', e.target.value)} />
            </Field>
          )}

          <Field label={<span>API key {ai.has_ai_key && <span className="font-normal text-muted-foreground">— guardada; deja vacío para conservarla</span>}</span>}>
            <Input className={INPUT_CLASS} type="password" value={apiKey} placeholder={ai.has_ai_key ? '••••••••••••' : 'sk-...'} onChange={e => setApiKey(e.target.value)} />
          </Field>

          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-jungle-green-600"
              checked={!!ai.ai_auto_weekly} onChange={e => setField('ai_auto_weekly', e.target.checked)} />
            Regenerar diálogos con IA cada semana (domingos)
          </label>

          <Notice type={msg?.type} msg={msg?.text} />

          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={busy}>{busy ? <><Loader2 size={16} className="animate-spin" /> Guardando...</> : <><Save size={16} /> Guardar</>}</Button>
            <Button type="button" variant="outline" onClick={test} disabled={busy || !ai.has_ai_key}><Zap size={16} /> Probar conexión</Button>
          </div>
        </form>
      </SectionCard>

      <SectionCard title="¿Cómo funciona?" description="La IA genera una vez un catálogo de conversaciones que el calentamiento reproduce y remezcla — sin costo por mensaje.">
        <ul className="space-y-2 text-sm text-muted-foreground">
          <li className="flex gap-2"><Check size={16} className="mt-0.5 shrink-0 text-jungle-green-600" /> Configura aquí tu proveedor y API key (OpenAI o DeepSeek).</li>
          <li className="flex gap-2"><Check size={16} className="mt-0.5 shrink-0 text-jungle-green-600" /> Ve a <b className="text-foreground">Calentamiento</b> y usa <b className="text-foreground">“Generar diálogos”</b> para crear las conversaciones.</li>
          <li className="flex gap-2"><Check size={16} className="mt-0.5 shrink-0 text-jungle-green-600" /> Sin API key igual funciona con el catálogo base incluido.</li>
        </ul>
      </SectionCard>
    </div>
  )
}

// ── Proxies (anti-baneo) ──────────────────────────────────────────────────────
function ProxiesTab() {
  const [data, setData]   = useState(null)   // { iproxy_enabled, proxidize_enabled, accounts }
  const [rows, setRows]   = useState({})     // edición local: { [id]: { provider, url } }
  const [savingFlags, setSavingFlags] = useState(false)
  const [savingId, setSavingId] = useState(null)
  const [msg, setMsg]     = useState(null)

  async function load() {
    const { data } = await api.get('/settings/proxies')
    setData(data)
    setRows(Object.fromEntries((data.accounts ?? []).map(a => [a.id, {
      provider: a.proxy_provider ?? 'none',
      url:      a.proxy_url ?? '',
    }])))
  }
  useEffect(() => { load() }, [])

  function flash(type, text) { setMsg({ type, text }); setTimeout(() => setMsg(null), 4000) }
  function setRow(id, patch) { setRows(r => ({ ...r, [id]: { ...r[id], ...patch } })) }

  async function toggle(key, value) {
    setSavingFlags(true)
    try {
      const { data: res } = await api.put('/settings/proxies', { [key]: value })
      setData(d => ({ ...d, ...res }))
    } catch { flash('err', 'No se pudo guardar la configuración') }
    finally { setSavingFlags(false) }
  }

  async function saveRow(acc) {
    const row = rows[acc.id] ?? { provider: 'none', url: '' }
    if (row.provider !== 'none' && !row.url.trim()) { flash('err', 'Ingresa la URL del proxy o elige "Sin proxy"'); return }
    setSavingId(acc.id)
    try {
      await api.patch(`/whatsapp/accounts/${acc.id}`, {
        proxy_provider: row.provider,
        proxy_url:      row.provider === 'none' ? '' : row.url.trim(),
      })
      flash('ok', `Proxy de "${acc.name}" guardado — el número se está reconectando…`)
      load()
    } catch (err) { flash('err', err.response?.data?.error ?? 'Error al guardar') }
    finally { setSavingId(null) }
  }

  if (!data) return <div className="text-sm text-muted-foreground">Cargando…</div>
  const anyEnabled = data.iproxy_enabled || data.proxidize_enabled

  return (
    <div className="space-y-4">
      <SectionCard title="Proveedores de proxy"
        description="Por defecto todos los números salen por la IP del servidor. Asignar un proxy por celular (IP propia, idealmente móvil de Perú) reduce el riesgo de baneo en cadena cuando tienes varios números.">
        <div className="space-y-3">
          {[
            { key: 'iproxy_enabled',    name: 'iProxy.online', desc: 'Convierte un Android en proxy móvil: IP peruana real por celular.' },
            { key: 'proxidize_enabled', name: 'Proxidize',     desc: 'Proxies móviles 4G/5G auto-hospedados con SIMs propias.' },
          ].map(p => (
            <label key={p.key} className="flex cursor-pointer items-start gap-3 rounded-xl border bg-card p-4 transition-colors hover:bg-muted/30">
              <input type="checkbox" className="mt-0.5 h-5 w-5 accent-jungle-green-600"
                checked={!!data[p.key]} disabled={savingFlags}
                onChange={e => toggle(p.key, e.target.checked)} />
              <div>
                <p className="text-sm font-semibold text-foreground">{p.name}</p>
                <p className="text-xs text-muted-foreground">{p.desc}</p>
              </div>
            </label>
          ))}
        </div>
      </SectionCard>

      {!anyEnabled ? (
        <SectionCard>
          <p className="text-sm text-muted-foreground">Activa al menos un proveedor arriba para poder asignar un proxy a cada celular.</p>
        </SectionCard>
      ) : (data.accounts?.length ?? 0) === 0 ? (
        <SectionCard>
          <EmptyState icon={Globe} title="Sin números WhatsApp" description="Agrega números en Cuentas WhatsApp para asignarles un proxy." />
        </SectionCard>
      ) : (
        <SectionCard noPadding title="Proxy por celular"
          description="Elige qué proxy usa cada número. Al guardar, el número se reconecta a través de ese proxy.">
          <div className="divide-y">
            {data.accounts.map(acc => {
              const row = rows[acc.id] ?? { provider: 'none', url: '' }
              const opts = [
                { value: 'none', label: 'Sin proxy (directo)' },
                ...(data.iproxy_enabled    ? [{ value: 'iproxy',    label: 'iProxy.online' }] : []),
                ...(data.proxidize_enabled ? [{ value: 'proxidize', label: 'Proxidize' }] : []),
              ]
              if (row.provider !== 'none' && !opts.some(o => o.value === row.provider)) {
                opts.push({ value: row.provider, label: `${row.provider} (deshabilitado)` })
              }
              return (
                <div key={acc.id} className="space-y-3 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{acc.name}</p>
                      <p className="truncate font-mono text-xs text-muted-foreground">{acc.phone_number ?? 'Sin número'}</p>
                    </div>
                    <span className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium', acc.is_connected ? 'bg-jungle-green-100 text-jungle-green-700' : 'bg-muted text-muted-foreground')}>
                      <span className={cn('h-1.5 w-1.5 rounded-full', acc.is_connected ? 'bg-jungle-green-500' : 'bg-muted-foreground/40')} />
                      {acc.is_connected ? 'Conectado' : 'Sin conectar'}
                    </span>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-[180px_1fr_auto]">
                    <select className={cn(INPUT_CLASS, 'px-3')} value={row.provider}
                      onChange={e => setRow(acc.id, { provider: e.target.value })}>
                      {opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    <Input className={INPUT_CLASS} value={row.url}
                      disabled={row.provider === 'none'}
                      placeholder="socks5://usuario:clave@host:puerto"
                      onChange={e => setRow(acc.id, { url: e.target.value })} />
                    <Button onClick={() => saveRow(acc)} disabled={savingId === acc.id} className="h-[52px] shrink-0 rounded-xl">
                      {savingId === acc.id ? <><Loader2 size={16} className="animate-spin" /> Guardando…</> : <><Save size={16} /> Guardar</>}
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        </SectionCard>
      )}

      <Notice type={msg?.type} msg={msg?.text} />
    </div>
  )
}

const TAB_DESC = ['Tu cuenta y contraseña', 'Miembros y roles', 'Acceso programático', 'Generación de diálogos con IA', 'Proxy por celular (anti-baneo)']

export default function SettingsPage() {
  const [tab, setTab] = useState(0)
  const [user, setUser] = useState(null)
  async function loadUser() { const { data } = await api.get('/auth/me'); setUser(data) }
  useEffect(() => { loadUser() }, [])

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader icon={Settings} title="Configuración" description="Gestiona tu perfil, equipo y acceso programático." />

      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        {/* Navegación de secciones */}
        <nav className="flex gap-1 overflow-x-auto lg:sticky lg:top-6 lg:flex-col lg:self-start lg:overflow-visible">
          {TABS.map((t, i) => {
            const active = tab === i
            return (
              <button key={t.label} onClick={() => setTab(i)}
                className={cn('flex shrink-0 items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors',
                  active ? 'bg-jungle-green-50 text-jungle-green-700' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground')}>
                <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', active ? 'bg-jungle-green-100 text-jungle-green-700' : 'bg-muted text-muted-foreground')}>
                  <t.Icon size={17} strokeWidth={1.75} />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium leading-tight">{t.label}</span>
                  <span className="hidden text-xs text-muted-foreground lg:block">{TAB_DESC[i]}</span>
                </span>
              </button>
            )
          })}
        </nav>

        {/* Contenido */}
        <div className="min-w-0">
          {tab === 0 && <ProfileTab user={user} onUpdated={loadUser} />}
          {tab === 1 && <TeamTab />}
          {tab === 2 && <ApiKeysTab />}
          {tab === 3 && <AiAgentTab />}
          {tab === 4 && <ProxiesTab />}
        </div>
      </div>
    </div>
  )
}
