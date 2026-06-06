'use client'
import { useEffect, useState } from 'react'
import api from '../../../lib/api'
import DeliverabilityGuide from '../../../components/domains/DeliverabilityGuide'
import { RefreshCw, Pencil, Trash2, Save, ChevronUp, ChevronDown, Plus, User } from '../../../components/ui/icons'

function Badge({ ok, label }) {
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium
      ${ok ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'}`}>
      <span>{ok ? '✓' : '○'}</span>{label}
    </span>
  )
}

function StatusDot({ active }) {
  return <span className={`inline-block w-2 h-2 rounded-full ${active ? 'bg-green-500' : 'bg-gray-300'}`} />
}

const PORT_PRESETS = [
  { label: '587 — STARTTLS (recomendado)', port: 587, tls: true },
  { label: '465 — SSL/TLS',                port: 465, tls: true },
  { label: '25  — Sin cifrado',            port: 25,  tls: false },
]

const EMPTY_ACCOUNT = { email: '', smtp_host: '', smtp_port: 587, smtp_user: '', smtp_pass: '', use_tls: true, daily_limit: 300 }

function AccountForm({ domainId, onSaved, onCancel }) {
  const [form, setForm]       = useState(EMPTY_ACCOUNT)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function submit(e) {
    e.preventDefault()
    setLoading(true); setError('')
    try {
      await api.post(`/domains/${domainId}/accounts`, {
        ...form, smtp_port: parseInt(form.smtp_port), daily_limit: parseInt(form.daily_limit),
      })
      onSaved()
    } catch (err) {
      setError(err.response?.data?.error ?? 'Error al guardar la cuenta')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={submit} className="bg-blue-50 border border-blue-200 rounded-xl p-5 mt-3 space-y-4">
      <p className="text-sm font-semibold text-blue-800">Nueva cuenta SMTP</p>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-700 mb-1">Email de envio *</label>
          <input required value={form.email} onChange={e => set('email', e.target.value)}
            placeholder="ventas@tudominio.com"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Servidor SMTP *</label>
          <input required value={form.smtp_host} onChange={e => set('smtp_host', e.target.value)}
            placeholder="mail.tudominio.com"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Puerto</label>
          <div className="flex gap-2">
            <input type="number" value={form.smtp_port} onChange={e => set('smtp_port', e.target.value)}
              className="w-20 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <select onChange={e => { const p = PORT_PRESETS[e.target.value]; set('smtp_port', p.port); set('use_tls', p.tls) }}
              defaultValue=""
              className="flex-1 border border-gray-300 rounded-lg px-2 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="" disabled>Presets...</option>
              {PORT_PRESETS.map((p, i) => <option key={i} value={i}>{p.label}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Usuario SMTP *</label>
          <input required value={form.smtp_user} onChange={e => set('smtp_user', e.target.value)}
            placeholder="ventas@tudominio.com"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Contrasena SMTP *</label>
          <input required type="password" value={form.smtp_pass} onChange={e => set('smtp_pass', e.target.value)}
            placeholder="••••••••"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Limite diario (correos)</label>
          <input type="number" value={form.daily_limit} onChange={e => set('daily_limit', e.target.value)}
            min={1} max={2000}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div className="flex items-end pb-1">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.use_tls} onChange={e => set('use_tls', e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-blue-600" />
            <span className="text-sm text-gray-700">Usar TLS</span>
          </label>
        </div>
      </div>
      {error && <p className="text-red-500 text-sm bg-red-50 p-2 rounded-lg">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={loading}
          className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50">
          {loading ? 'Guardando...' : 'Guardar cuenta'}
        </button>
        <button type="button" onClick={onCancel}
          className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">
          Cancelar
        </button>
      </div>
    </form>
  )
}

function AccountRow({ account, domainId, members, onDeleted }) {
  const [testing, setTesting]       = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [editing, setEditing]       = useState(false)
  const [assigningId, setAssigningId] = useState(null)

  async function assign(memberId) {
    setAssigningId(memberId)
    try {
      await api.patch(`/domains/${domainId}/accounts/${account.id}/assign`, { member_id: memberId || null })
      onDeleted() // recarga
    } catch {}
    setAssigningId(null)
  }
  const [form, setForm]             = useState({
    email:       account.email,
    smtp_host:   account.smtp_host,
    smtp_port:   account.smtp_port,
    smtp_user:   account.smtp_user ?? account.email,
    smtp_pass:   '',
    use_tls:     account.use_tls,
    daily_limit: account.daily_limit,
  })
  const [saving, setSaving]   = useState(false)
  const [saveErr, setSaveErr] = useState('')

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function testConnection() {
    setTesting(true); setTestResult(null)
    try {
      const { data } = await api.post(`/domains/${domainId}/accounts/${account.id}/test`)
      setTestResult(data)
    } catch (err) {
      setTestResult({ ok: false, message: err.response?.data?.message ?? 'Error de conexion' })
    } finally { setTesting(false) }
  }

  async function saveEdit(e) {
    e.preventDefault()
    setSaving(true); setSaveErr('')
    try {
      const payload = {
        email:       form.email,
        smtp_host:   form.smtp_host,
        smtp_port:   parseInt(form.smtp_port),
        smtp_user:   form.smtp_user,
        use_tls:     form.use_tls,
        daily_limit: parseInt(form.daily_limit),
        ...(form.smtp_pass ? { smtp_pass: form.smtp_pass } : {}),
      }
      await api.patch(`/domains/${domainId}/accounts/${account.id}`, payload)
      setEditing(false)
      onDeleted() // recarga lista
    } catch (err) {
      setSaveErr(err.response?.data?.error ?? 'Error al guardar')
    } finally { setSaving(false) }
  }

  async function remove() {
    if (!confirm(`Eliminar la cuenta ${account.email}?`)) return
    await api.delete(`/domains/${domainId}/accounts/${account.id}`)
    onDeleted()
  }

  const usePct = account.daily_limit > 0 ? Math.round((account.sent_today / account.daily_limit) * 100) : 0

  return (
    <div className="border border-gray-200 rounded-lg p-4 space-y-3 bg-white">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <StatusDot active={account.is_active} />
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{account.email}</p>
            <p className="text-xs text-gray-400">{account.smtp_host}:{account.smtp_port} · {account.use_tls ? 'TLS activado' : 'Sin TLS'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={testConnection} disabled={testing}
            className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50 disabled:opacity-50 font-medium flex items-center gap-1">
            {testing ? 'Probando...' : <><RefreshCw size={12} /> Probar</>}
          </button>
          <button onClick={() => setEditing(v => !v)}
            className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 hover:border-yellow-400 hover:text-yellow-600 hover:bg-yellow-50 font-medium flex items-center gap-1">
            <Pencil size={12} /> Editar
          </button>
          <button onClick={remove}
            className="text-xs px-3 py-1.5 rounded-lg border border-red-200 text-red-400 hover:bg-red-50 hover:text-red-600">
            Eliminar
          </button>
        </div>
      </div>

      {/* Formulario de edición */}
      {editing && (
        <form onSubmit={saveEdit} className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 space-y-3 mt-2">
          <p className="text-sm font-semibold text-yellow-800">Editar cuenta SMTP</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-700 mb-1">Email de envío</label>
              <input value={form.email} onChange={e => set('email', e.target.value)} required
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Servidor SMTP</label>
              <input value={form.smtp_host} onChange={e => set('smtp_host', e.target.value)} required
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Puerto</label>
              <div className="flex gap-2">
                <input type="number" value={form.smtp_port} onChange={e => set('smtp_port', e.target.value)}
                  className="w-20 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400" />
                <select onChange={e => { const p = PORT_PRESETS[e.target.value]; set('smtp_port', p.port); set('use_tls', p.tls) }}
                  defaultValue="" className="flex-1 border border-gray-300 rounded-lg px-2 py-2 text-xs">
                  <option value="" disabled>Presets...</option>
                  {PORT_PRESETS.map((p, i) => <option key={i} value={i}>{p.label}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Usuario SMTP</label>
              <input value={form.smtp_user} onChange={e => set('smtp_user', e.target.value)} required
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Contraseña <span className="text-gray-400 font-normal">(dejar vacío para no cambiar)</span>
              </label>
              <input type="password" value={form.smtp_pass} onChange={e => set('smtp_pass', e.target.value)}
                placeholder="Nueva contraseña..."
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Límite diario</label>
              <input type="number" value={form.daily_limit} onChange={e => set('daily_limit', e.target.value)} min={1}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400" />
            </div>
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.use_tls} onChange={e => set('use_tls', e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-yellow-500" />
                <span className="text-sm text-gray-700">Usar TLS</span>
              </label>
            </div>
          </div>
          {saveErr && <p className="text-red-500 text-xs bg-red-50 p-2 rounded">{saveErr}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={saving}
              className="px-4 py-2 text-sm bg-yellow-500 text-white rounded-lg font-medium hover:bg-yellow-600 disabled:opacity-50 flex items-center gap-1.5">
              {saving ? 'Guardando...' : <><Save size={14} /> Guardar cambios</>}
            </button>
            <button type="button" onClick={() => { setEditing(false); setSaveErr('') }}
              className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">
              Cancelar
            </button>
          </div>
        </form>
      )}

      <div>
        <div className="flex justify-between text-xs text-gray-400 mb-1">
          <span>Uso hoy</span>
          <span>{account.sent_today} / {account.daily_limit} ({usePct}%)</span>
        </div>
        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div className={`h-full rounded-full ${usePct > 90 ? 'bg-red-400' : usePct > 70 ? 'bg-yellow-400' : 'bg-green-400'}`}
            style={{ width: `${Math.min(usePct, 100)}%` }} />
        </div>
      </div>

      {/* Asignación a asesor */}
      {members && members.length > 0 && (
        <div className="mt-3">
          <label className="text-xs text-gray-500 flex items-center gap-1 mb-1">
            Asignado a asesor
          </label>
          <select
            value={account.assigned_member_id ?? ''}
            onChange={e => assign(e.target.value)}
            disabled={!!assigningId}
            className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none">
            <option value="">— Sin asignar —</option>
            {members.filter(m => !m.is_owner).map(m => (
              <option key={m.id} value={m.id}>{m.name} ({m.email})</option>
            ))}
          </select>
          {account.assigned_member_name && (
            <p className="text-xs text-blue-600 mt-1 flex items-center gap-1"><User size={12} /> {account.assigned_member_name}</p>
          )}
        </div>
      )}

      {testResult && (
        <div className={`text-xs p-2 rounded-lg flex items-center gap-1.5 ${testResult.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
          <span>{testResult.ok ? '✓' : '✕'}</span>
          <span>{testResult.message}</span>
        </div>
      )}
    </div>
  )
}

function DomainPanel({ domain, onRefresh }) {
  const [open, setOpen]         = useState(false)
  const [accounts, setAccounts] = useState([])
  const [members, setMembers]   = useState([])
  const [loadingAcc, setLoadingAcc] = useState(false)
  const [showForm, setShowForm] = useState(false)

  async function loadAccounts() {
    setLoadingAcc(true)
    try {
      const [accRes, memRes] = await Promise.all([
        api.get(`/domains/${domain.id}/accounts`),
        api.get('/settings/team').catch(() => ({ data: [] })),
      ])
      setAccounts(accRes.data)
      setMembers(memRes.data ?? [])
    } finally {
      setLoadingAcc(false)
    }
  }

  function toggle() {
    if (!open) loadAccounts()
    setOpen(v => !v)
  }

  async function toggleDNS(field) {
    await api.patch(`/domains/${domain.id}`, { [field]: !domain[field] })
    onRefresh()
  }

  async function remove() {
    if (!confirm(`Eliminar el dominio ${domain.domain} y todas sus cuentas?`)) return
    await api.delete(`/domains/${domain.id}`)
    onRefresh()
  }

  return (
    <div className="bg-white rounded-xl shadow-sm overflow-hidden">
      <div className="flex items-center gap-4 p-5 cursor-pointer hover:bg-gray-50 transition-colors" onClick={toggle}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <p className="font-semibold text-gray-900">{domain.domain}</p>
            <div className="flex gap-1.5">
              <Badge ok={domain.spf_configured}   label="SPF"   />
              <Badge ok={domain.dkim_configured}  label="DKIM"  />
              <Badge ok={domain.dmarc_configured} label="DMARC" />
            </div>
          </div>
          <p className="text-xs text-gray-400 mt-1">
            {domain.account_count} {domain.account_count === 1 ? 'cuenta' : 'cuentas'} · {' '}
            {Number(domain.sent_today_total ?? 0).toLocaleString()} / {Number(domain.daily_limit).toLocaleString()} enviados hoy
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button onClick={e => { e.stopPropagation(); remove() }}
            className="text-xs text-red-400 hover:text-red-600 px-2 py-1 rounded hover:bg-red-50">
            Eliminar
          </button>
          <span className="text-gray-400">{open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</span>
        </div>
      </div>

      {open && (
        <div className="border-t border-gray-100 p-5 space-y-5 bg-gray-50">
          {/* DNS */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Estado DNS</p>
            <div className="flex flex-wrap gap-4">
              {[
                { key: 'spf_configured',   label: 'SPF configurado'   },
                { key: 'dkim_configured',  label: 'DKIM configurado'  },
                { key: 'dmarc_configured', label: 'DMARC configurado' },
              ].map(item => (
                <label key={item.key} className="flex items-center gap-2 cursor-pointer text-sm text-gray-700"
                  onClick={e => e.stopPropagation()}>
                  <input type="checkbox" checked={!!domain[item.key]} onChange={() => toggleDNS(item.key)}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600" />
                  {item.label}
                </label>
              ))}
            </div>
          </div>

          {/* Guia de entregabilidad */}
          <DeliverabilityGuide domain={domain} />

          {/* Cuentas SMTP */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Cuentas SMTP ({accounts.length})
              </p>
              <button onClick={() => setShowForm(v => !v)}
                className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 flex items-center gap-1">
                <Plus size={12} /> Agregar cuenta
              </button>
            </div>

            {showForm && (
              <AccountForm
                domainId={domain.id}
                onSaved={() => { setShowForm(false); loadAccounts() }}
                onCancel={() => setShowForm(false)}
              />
            )}

            {loadingAcc && <p className="text-sm text-gray-400 py-2">Cargando...</p>}

            <div className="space-y-2 mt-2">
              {accounts.map(acc => (
                <AccountRow key={acc.id} account={acc} domainId={domain.id} members={members} onDeleted={loadAccounts} />
              ))}
              {!loadingAcc && accounts.length === 0 && !showForm && (
                <div className="text-center py-6 text-gray-400 text-sm border-2 border-dashed border-gray-200 rounded-xl">
                  Sin cuentas SMTP. Agrega al menos una para enviar campanas.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function DomainsPage() {
  const [domains, setDomains]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [newDomain, setNewDomain] = useState({ domain: '', daily_limit: 1000 })
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState('')

  async function load() {
    const { data } = await api.get('/domains')
    setDomains(data)
  }

  useEffect(() => { load().finally(() => setLoading(false)) }, [])

  async function addDomain(e) {
    e.preventDefault()
    setSaving(true); setError('')
    try {
      await api.post('/domains', { ...newDomain, daily_limit: parseInt(newDomain.daily_limit) })
      setNewDomain({ domain: '', daily_limit: 1000 })
      setShowForm(false)
      load()
    } catch (err) {
      setError(err.response?.data?.error ?? 'Error al guardar el dominio')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="text-gray-500">Cargando...</div>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dominios de envio</h1>
          <p className="text-sm text-gray-400 mt-0.5">Configura dominios y sus cuentas SMTP para enviar campanas</p>
        </div>
        <button onClick={() => setShowForm(v => !v)}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 flex items-center gap-1.5">
          <Plus size={14} /> Agregar dominio
        </button>
      </div>

      {showForm && (
        <form onSubmit={addDomain} className="bg-white rounded-xl shadow-sm p-5 space-y-4">
          <p className="font-semibold text-gray-800">Nuevo dominio</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Dominio *</label>
              <input required value={newDomain.domain}
                onChange={e => setNewDomain(d => ({ ...d, domain: e.target.value }))}
                placeholder="miempresa.com"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <p className="text-xs text-gray-400 mt-1">Solo el dominio, sin http://</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Limite diario total</label>
              <input type="number" min={1} max={50000} value={newDomain.daily_limit}
                onChange={e => setNewDomain(d => ({ ...d, daily_limit: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <div className="bg-amber-50 rounded-lg p-3 text-xs text-amber-700">
            <p className="font-medium mb-1">Asegurate de tener configurado en tu DNS:</p>
            <ul className="list-disc list-inside space-y-0.5">
              <li><strong>SPF</strong> — autoriza tu servidor a enviar correos del dominio</li>
              <li><strong>DKIM</strong> — firma digital para autenticar los correos</li>
              <li><strong>DMARC</strong> — politica de manejo de correos no autenticados</li>
            </ul>
          </div>
          {error && <p className="text-red-500 text-sm bg-red-50 p-2 rounded-lg">{error}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={saving}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'Guardando...' : 'Guardar dominio'}
            </button>
            <button type="button" onClick={() => setShowForm(false)}
              className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">
              Cancelar
            </button>
          </div>
        </form>
      )}

      <div className="space-y-3">
        {domains.map(d => <DomainPanel key={d.id} domain={d} onRefresh={load} />)}
        {!domains.length && (
          <div className="bg-white rounded-xl shadow-sm p-12 text-center text-gray-400">
            <p className="text-4xl mb-3">🌐</p>
            <p className="font-medium text-gray-500">Sin dominios configurados</p>
            <p className="text-sm mt-1">Agrega un dominio y luego sus cuentas SMTP para empezar a enviar.</p>
          </div>
        )}
      </div>
    </div>
  )
}
