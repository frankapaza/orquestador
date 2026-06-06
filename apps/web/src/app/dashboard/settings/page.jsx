'use client'
import { useEffect, useState } from 'react'
import api from '../../../lib/api'
import { User, Pencil, Eye, UserPlus, Save, Plus, Copy, Lock } from '../../../components/ui/icons'

const TABS = ['Perfil', 'Equipo', 'API Keys']

const ROLES = [
  {
    value: 'asesor',
    label: 'Asesor',
    Icon: User,
    color: 'bg-green-100 text-green-700',
    description: 'Accede al Inbox, sus conversaciones WA/SMS asignadas y puede enviar mensajes a contactos.',
    permisos: ['Inbox y conversaciones', 'Su número WA/SMS asignado', 'Enviar mensajes individuales'],
    noPermisos: ['Campañas masivas', 'Configuración del sistema', 'Dominios e integraciones'],
  },
  {
    value: 'editor',
    label: 'Editor',
    Icon: Pencil,
    color: 'bg-blue-100 text-blue-700',
    description: 'Gestiona campañas, contactos e integraciones. Ideal para el equipo de marketing.',
    permisos: ['Todo lo del Asesor', 'Crear y gestionar campañas', 'Importar contactos', 'Ver reportes'],
    noPermisos: ['Configuración de WhatsApp/SMS', 'Gestión del equipo', 'API Keys'],
  },
  {
    value: 'viewer',
    label: 'Visor',
    Icon: Eye,
    color: 'bg-gray-100 text-gray-600',
    description: 'Solo lectura. Puede ver campañas y reportes pero no realizar cambios.',
    permisos: ['Ver campañas y reportes', 'Ver contactos'],
    noPermisos: ['Crear o editar nada', 'Enviar mensajes', 'Configuración'],
  },
]

const ROLE_MAP   = Object.fromEntries(ROLES.map(r => [r.value, r]))
const ROLE_LABEL = { owner: 'Dueño', ...Object.fromEntries(ROLES.map(r => [r.value, r.label])) }
const ROLE_COLOR = { owner: 'bg-purple-100 text-purple-700', ...Object.fromEntries(ROLES.map(r => [r.value, r.color])) }

// ── Helpers ──────────────────────────────────────────────────────────────────

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-700 mb-1">{label}</label>
      {children}
    </div>
  )
}

function Input({ ...props }) {
  return <input {...props} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
}

function SaveBtn({ loading, label = 'Guardar cambios' }) {
  return (
    <button type="submit" disabled={loading}
      className="px-5 py-2 text-sm bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50">
      {loading ? 'Guardando...' : label}
    </button>
  )
}

function Notice({ type, msg }) {
  if (!msg) return null
  return (
    <p className={`text-sm p-2.5 rounded-lg ${type === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
      {msg}
    </p>
  )
}

// ── Tab: Perfil ───────────────────────────────────────────────────────────────

function ProfileTab({ user, onUpdated }) {
  const [form, setForm]     = useState({ name: user?.name ?? '', email: user?.email ?? '' })
  const [pass, setPass]     = useState({ current: '', new_pass: '', confirm: '' })
  const [loading, setLoading] = useState(false)
  const [passLoading, setPassLoading] = useState(false)
  const [msg, setMsg]         = useState(null)
  const [passMsg, setPassMsg] = useState(null)

  useEffect(() => { if (user) setForm({ name: user.name, email: user.email }) }, [user])

  async function saveProfile(e) {
    e.preventDefault()
    setLoading(true); setMsg(null)
    try {
      await api.patch('/settings/profile', form)
      setMsg({ type: 'ok', text: 'Perfil actualizado' })
      onUpdated()
    } catch (err) {
      setMsg({ type: 'err', text: err.response?.data?.error ?? 'Error al guardar' })
    } finally { setLoading(false) }
  }

  async function changePassword(e) {
    e.preventDefault()
    if (pass.new_pass !== pass.confirm) return setPassMsg({ type: 'err', text: 'Las contrasenas no coinciden' })
    setPassLoading(true); setPassMsg(null)
    try {
      await api.patch('/settings/password', { current_password: pass.current, new_password: pass.new_pass })
      setPassMsg({ type: 'ok', text: 'Contrasena actualizada' })
      setPass({ current: '', new_pass: '', confirm: '' })
    } catch (err) {
      setPassMsg({ type: 'err', text: err.response?.data?.error ?? 'Error al cambiar contrasena' })
    } finally { setPassLoading(false) }
  }

  return (
    <div className="space-y-6 max-w-lg">
      {/* Info del plan */}
      <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-blue-800">{user?.name}</p>
          <p className="text-xs text-blue-600">{user?.email}</p>
        </div>
        <span className="text-xs bg-blue-600 text-white px-2 py-1 rounded-full capitalize font-medium">
          {user?.role === 'owner' || !user?.role ? `Plan ${user?.plan ?? 'basic'}` : ROLE_LABEL[user?.role]}
        </span>
      </div>

      {/* Datos personales */}
      <form onSubmit={saveProfile} className="bg-white rounded-xl shadow-sm p-5 space-y-4">
        <h3 className="font-semibold text-gray-800">Datos personales</h3>
        <Field label="Nombre">
          <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
        </Field>
        <Field label="Email">
          <Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} required />
        </Field>
        <Notice type={msg?.type} msg={msg?.text} />
        <SaveBtn loading={loading} />
      </form>

      {/* Cambiar contraseña */}
      <form onSubmit={changePassword} className="bg-white rounded-xl shadow-sm p-5 space-y-4">
        <h3 className="font-semibold text-gray-800">Cambiar contrasena</h3>
        <Field label="Contrasena actual">
          <Input type="password" value={pass.current} onChange={e => setPass(f => ({ ...f, current: e.target.value }))} required />
        </Field>
        <Field label="Nueva contrasena (min. 8 caracteres)">
          <Input type="password" value={pass.new_pass} onChange={e => setPass(f => ({ ...f, new_pass: e.target.value }))} required minLength={8} />
        </Field>
        <Field label="Confirmar nueva contrasena">
          <Input type="password" value={pass.confirm} onChange={e => setPass(f => ({ ...f, confirm: e.target.value }))} required />
        </Field>
        <Notice type={passMsg?.type} msg={passMsg?.text} />
        <SaveBtn loading={passLoading} label="Cambiar contrasena" />
      </form>
    </div>
  )
}

// ── Tab: Equipo ───────────────────────────────────────────────────────────────

function TeamTab() {
  const [members, setMembers] = useState([])
  const [form, setForm]       = useState({ name: '', email: '', password: '', role: 'asesor' })
  const [loading, setLoading] = useState(false)
  const [msg, setMsg]         = useState(null)
  const [showForm, setShowForm] = useState(false)

  async function load() {
    const { data } = await api.get('/settings/team')
    setMembers(data)
  }

  useEffect(() => { load() }, [])

  async function addMember(e) {
    e.preventDefault()
    setLoading(true); setMsg(null)
    try {
      await api.post('/settings/team', form)
      setMsg({ type: 'ok', text: `${form.name} agregado al equipo` })
      setForm({ name: '', email: '', password: '', role: 'editor' })
      setShowForm(false)
      load()
    } catch (err) {
      setMsg({ type: 'err', text: err.response?.data?.error ?? 'Error al agregar miembro' })
    } finally { setLoading(false) }
  }

  async function toggleMember(id, is_active) {
    await api.patch(`/settings/team/${id}`, { is_active })
    load()
  }

  async function removeMember(id, name) {
    if (!confirm(`Eliminar a ${name} del equipo?`)) return
    await api.delete(`/settings/team/${id}`)
    load()
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <p className="font-semibold text-gray-800">Miembros del equipo ({members.length})</p>
          <button onClick={() => setShowForm(s => !s)}
            className="text-sm bg-blue-600 text-white px-3 py-1.5 rounded-lg font-medium hover:bg-blue-700 flex items-center gap-1.5">
            <UserPlus size={14} /> Invitar miembro
          </button>
        </div>

        {showForm && (
          <form onSubmit={addMember} className="p-5 bg-gray-50 border-b border-gray-200 space-y-4">
            <p className="text-sm font-semibold text-gray-800">Nuevo miembro del equipo</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Nombre completo">
                <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required placeholder="Maria Lopez" />
              </Field>
              <Field label="Email">
                <Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} required placeholder="maria@empresa.com" />
              </Field>
            </div>
            <Field label="Contraseña temporal (mín. 8 caracteres)">
              <Input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} required minLength={8} placeholder="El usuario podrá cambiarla luego" />
            </Field>

            {/* Selector de rol visual */}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-2">Rol</label>
              <div className="grid grid-cols-3 gap-2">
                {ROLES.map(r => (
                  <button key={r.value} type="button"
                    onClick={() => setForm(f => ({ ...f, role: r.value }))}
                    className={`rounded-xl border-2 p-3 text-left transition-all ${
                      form.role === r.value
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 bg-white hover:border-gray-300'
                    }`}>
                    <div className="mb-1"><r.Icon size={18} /></div>
                    <p className="text-sm font-semibold text-gray-800">{r.label}</p>
                    <p className="text-xs text-gray-500 mt-0.5 leading-tight">{r.description}</p>
                  </button>
                ))}
              </div>

              {/* Detalle del rol seleccionado */}
              {ROLE_MAP[form.role] && (
                <div className="mt-3 bg-white border border-gray-200 rounded-xl p-3 grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs font-semibold text-green-700 mb-1.5">✓ Puede hacer</p>
                    {ROLE_MAP[form.role].permisos.map(p => (
                      <p key={p} className="text-xs text-gray-600 flex gap-1.5 mb-1">
                        <span className="text-green-500 flex-shrink-0">✓</span>{p}
                      </p>
                    ))}
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-red-600 mb-1.5">✕ No puede</p>
                    {ROLE_MAP[form.role].noPermisos.map(p => (
                      <p key={p} className="text-xs text-gray-500 flex gap-1.5 mb-1">
                        <span className="text-red-400 flex-shrink-0">✕</span>{p}
                      </p>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <Notice type={msg?.type} msg={msg?.text} />
            <div className="flex gap-2">
              <button type="submit" disabled={loading}
                className="px-5 py-2 text-sm bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5">
                {loading ? 'Guardando...' : <><Save size={14} /> Agregar al equipo</>}
              </button>
              <button type="button" onClick={() => setShowForm(false)}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-white">
                Cancelar
              </button>
            </div>
          </form>
        )}

        {!showForm && msg && <div className="px-5 pt-3"><Notice type={msg.type} msg={msg.text} /></div>}

        <div className="divide-y">
          {members.map(m => (
            <div key={m.id} className={`px-5 py-3 flex items-center justify-between gap-3 ${!m.is_active ? 'opacity-50' : ''}`}>
              <div>
                <p className="text-sm font-medium text-gray-800">{m.name}</p>
                <p className="text-xs text-gray-400">{m.email}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ROLE_COLOR[m.role] ?? ''}`}>
                  {ROLE_LABEL[m.role] ?? m.role}
                </span>
                {m.is_owner ? (
                  <span className="text-xs text-gray-400">Cuenta principal</span>
                ) : (
                  <>
                    {!m.is_active
                      ? <button onClick={() => toggleMember(m.id, true)} className="text-xs text-green-600 hover:underline">Activar</button>
                      : <button onClick={() => toggleMember(m.id, false)} className="text-xs text-yellow-600 hover:underline">Suspender</button>
                    }
                    <button onClick={() => removeMember(m.id, m.name)}
                      className="text-xs text-red-400 hover:text-red-600 border border-red-200 rounded px-2 py-0.5 hover:bg-red-50">
                      Eliminar
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
        <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-3">Resumen de roles</p>
        <div className="space-y-2">
          {[{ value: 'owner', label: 'Dueño', icon: '👑', desc: 'Acceso total. Cuenta principal.' }, ...ROLES].map(r => (
            <div key={r.value} className="flex items-start gap-3">
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 mt-0.5 flex items-center gap-1 ${ROLE_COLOR[r.value]}`}>
                {r.icon ? r.icon : r.Icon ? <r.Icon size={11} /> : null} {ROLE_LABEL[r.value]}
              </span>
              <p className="text-xs text-gray-600">{r.desc ?? r.description}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Tab: API Keys ─────────────────────────────────────────────────────────────

function ApiKeysTab() {
  const [keys, setKeys]       = useState([])
  const [newKey, setNewKey]   = useState(null) // key recién creada (mostrar solo una vez)
  const [form, setForm]       = useState({ name: '' })
  const [loading, setLoading] = useState(false)
  const [copied, setCopied]   = useState(false)
  const [msg, setMsg]         = useState(null)

  async function load() {
    const { data } = await api.get('/settings/api-keys')
    setKeys(data)
  }

  useEffect(() => { load() }, [])

  async function createKey(e) {
    e.preventDefault()
    setLoading(true); setMsg(null)
    try {
      const { data } = await api.post('/settings/api-keys', { name: form.name })
      setNewKey(data)
      setForm({ name: '' })
      load()
    } catch (err) {
      setMsg({ type: 'err', text: err.response?.data?.error ?? 'Error al crear API Key' })
    } finally { setLoading(false) }
  }

  async function revokeKey(id, name) {
    if (!confirm(`Revocar la API Key "${name}"? Los sistemas que la usen perderan acceso.`)) return
    await api.delete(`/settings/api-keys/${id}`)
    load()
  }

  function copyKey(text) {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-4 max-w-2xl">
      {/* Alerta key nueva */}
      {newKey && (
        <div className="bg-green-50 border-2 border-green-400 rounded-xl p-5 space-y-3">
          <p className="font-semibold text-green-800">API Key creada — guarda esto ahora, no se mostrara de nuevo</p>
          <div className="bg-white border border-green-300 rounded-lg px-4 py-3 font-mono text-sm text-gray-800 flex items-center justify-between gap-3 break-all">
            <span>{newKey.raw_key}</span>
            <button onClick={() => copyKey(newKey.raw_key)}
              className="shrink-0 text-xs bg-green-600 text-white px-3 py-1.5 rounded-lg hover:bg-green-700 flex items-center gap-1">
              {copied ? 'Copiado!' : <><Copy size={12} /> Copiar</>}
            </button>
          </div>
          <button onClick={() => setNewKey(null)} className="text-xs text-green-700 underline">Ya la guarde, cerrar</button>
        </div>
      )}

      {/* Formulario nueva key */}
      <form onSubmit={createKey} className="bg-white rounded-xl shadow-sm p-5 space-y-3">
        <h3 className="font-semibold text-gray-800">Generar nueva API Key</h3>
        <div className="flex gap-3">
          <div className="flex-1">
            <Input value={form.name} onChange={e => setForm({ name: e.target.value })}
              required placeholder="Ej: Mi CRM, App interna..." />
          </div>
          <button type="submit" disabled={loading}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 shrink-0 flex items-center gap-1">
            {loading ? 'Generando...' : <><Plus size={14} /> Crear</>}
          </button>
        </div>
        <Notice type={msg?.type} msg={msg?.text} />
        <p className="text-xs text-gray-400">
          Usa la API Key en el header: <code className="bg-gray-100 px-1.5 py-0.5 rounded">Authorization: Bearer kubo_...</code>
        </p>
      </form>

      {/* Lista de keys */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100">
          <p className="font-semibold text-gray-800">API Keys activas ({keys.length})</p>
        </div>
        {keys.length === 0 ? (
          <p className="px-5 py-8 text-center text-gray-400 text-sm">Sin API Keys. Genera una para acceso programático.</p>
        ) : (
          <div className="divide-y">
            {keys.map(k => (
              <div key={k.id} className="px-5 py-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-gray-800">{k.name}</p>
                  <p className="text-xs font-mono text-gray-400">{k.key_prefix}••••••••</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Creada: {new Date(k.created_at).toLocaleDateString('es')}
                    {k.last_used_at && ` · Último uso: ${new Date(k.last_used_at).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' })}`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${k.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {k.is_active ? 'Activa' : 'Revocada'}
                  </span>
                  {k.is_active && (
                    <button onClick={() => revokeKey(k.id, k.name)}
                      className="text-xs text-red-400 hover:text-red-600 border border-red-200 rounded px-2 py-0.5 hover:bg-red-50 flex items-center gap-1">
                      <Lock size={11} /> Revocar
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-sm text-gray-600 space-y-1">
        <p className="font-semibold text-gray-700">Ejemplo de uso con curl:</p>
        <code className="block bg-gray-800 text-green-400 rounded-lg px-4 py-3 text-xs font-mono mt-2 whitespace-pre">
{`curl http://localhost:3001/api/v1/campaigns \\
  -H "Authorization: Bearer kubo_TU_API_KEY"`}
        </code>
      </div>
    </div>
  )
}

// ── Página principal ──────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [tab, setTab]   = useState(0)
  const [user, setUser] = useState(null)

  async function loadUser() {
    const { data } = await api.get('/auth/me')
    setUser(data)
  }

  useEffect(() => { loadUser() }, [])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Configuracion</h1>
        <p className="text-sm text-gray-400 mt-0.5">Gestiona tu perfil, equipo y acceso programático</p>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 flex gap-0">
        {TABS.map((t, i) => (
          <button key={t} onClick={() => setTab(i)}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              tab === i
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            {t}
          </button>
        ))}
      </div>

      <div>
        {tab === 0 && <ProfileTab user={user} onUpdated={loadUser} />}
        {tab === 1 && <TeamTab />}
        {tab === 2 && <ApiKeysTab />}
      </div>
    </div>
  )
}
