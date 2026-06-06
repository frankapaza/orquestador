'use client'
import { useEffect, useState } from 'react'
import api from '../../../lib/api'

const PROVIDER_META = {
  sendgrid:  { icon: '📧', color: 'bg-blue-50 border-blue-200',   badge: 'bg-blue-100 text-blue-700'   },
  brevo:     { icon: '💌', color: 'bg-teal-50 border-teal-200',   badge: 'bg-teal-100 text-teal-700'   },
  mailchimp: { icon: '🐵', color: 'bg-yellow-50 border-yellow-200', badge: 'bg-yellow-100 text-yellow-700' },
}

function ProviderForm({ provider, onSaved, onCancel }) {
  const [form, setForm]       = useState({ name: '', credentials: {} })
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')

  function setCred(key, value) {
    setForm(f => ({ ...f, credentials: { ...f.credentials, [key]: value } }))
  }

  async function submit(e) {
    e.preventDefault()
    setLoading(true); setError('')
    try {
      await api.post('/integrations', { provider: provider.provider, name: form.name, credentials: form.credentials })
      onSaved()
    } catch (err) {
      setError(err.response?.data?.error ?? 'Error al guardar')
    } finally {
      setLoading(false)
    }
  }

  const meta = PROVIDER_META[provider.provider] ?? {}

  return (
    <form onSubmit={submit} className={`border-2 rounded-xl p-5 space-y-4 mt-3 ${meta.color}`}>
      <p className="text-sm font-semibold text-gray-800">Configurar {provider.label}</p>

      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Nombre de esta conexion *</label>
        <input required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
          placeholder={`Ej: ${provider.label} Principal`}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <p className="text-xs text-gray-400 mt-1">Para identificarla al crear campanas</p>
      </div>

      {provider.fields.map(field => (
        <div key={field.key}>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            {field.label} {field.required && '*'}
          </label>
          <input
            required={field.required}
            type={field.type === 'password' ? 'password' : field.type === 'email' ? 'email' : 'text'}
            value={form.credentials[field.key] ?? ''}
            onChange={e => setCred(field.key, e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
            placeholder={field.type === 'password' ? '••••••••••••••••' : ''}
          />
        </div>
      ))}

      {/* Guia de donde obtener la API key */}
      <div className="bg-white/70 rounded-lg p-3 text-xs text-gray-600 space-y-1">
        {provider.provider === 'sendgrid' && <>
          <p className="font-medium">¿Dónde obtengo la API Key de SendGrid?</p>
          <p>1. Entra a <strong>app.sendgrid.com</strong> → Settings → API Keys</p>
          <p>2. Click en <strong>"Create API Key"</strong> → Full Access</p>
          <p>3. Copia la clave (solo se muestra una vez)</p>
          <p>4. El <strong>Email de envio</strong> debe estar verificado en SendGrid (Sender Identity)</p>
        </>}
        {provider.provider === 'brevo' && <>
          <p className="font-medium">¿Dónde obtengo la API Key de Brevo?</p>
          <p>1. Entra a <strong>app.brevo.com</strong> → Mi cuenta → SMTP y API</p>
          <p>2. Pestaña <strong>"API Keys"</strong> → Generar nueva clave</p>
          <p>3. El <strong>Email de envio</strong> debe estar verificado en Brevo (Senders)</p>
        </>}
        {provider.provider === 'mailchimp' && <>
          <p className="font-medium">¿Dónde obtengo la API Key de Mandrill (Mailchimp Transactional)?</p>
          <p>1. Entra a <strong>mandrillapp.com</strong> (requiere cuenta Mailchimp de pago)</p>
          <p>2. Settings → SMTP & API Info → Add API Key</p>
          <p>3. El <strong>Email de envio</strong> debe estar en un dominio verificado en Mandrill</p>
        </>}
      </div>

      {error && <p className="text-red-500 text-sm bg-red-50 p-2 rounded-lg">{error}</p>}

      <div className="flex gap-2">
        <button type="submit" disabled={loading}
          className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50">
          {loading ? 'Verificando y guardando...' : 'Guardar integracion'}
        </button>
        <button type="button" onClick={onCancel}
          className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">
          Cancelar
        </button>
      </div>
    </form>
  )
}

function IntegrationCard({ integration, onDeleted, onToggle }) {
  const [testing, setTesting]   = useState(false)
  const [testResult, setTestResult] = useState(null)
  const meta = PROVIDER_META[integration.provider] ?? {}

  async function test() {
    setTesting(true); setTestResult(null)
    try {
      const { data } = await api.post(`/integrations/${integration.id}/test`)
      setTestResult(data)
    } catch (err) {
      setTestResult({ ok: false, message: err.response?.data?.message ?? 'Error de conexion' })
    } finally {
      setTesting(false)
    }
  }

  async function remove() {
    if (!confirm(`Eliminar la integracion "${integration.name}"?`)) return
    await api.delete(`/integrations/${integration.id}`)
    onDeleted()
  }

  async function toggle() {
    await api.patch(`/integrations/${integration.id}`, { is_active: !integration.is_active })
    onToggle()
  }

  return (
    <div className={`border-2 rounded-xl p-5 space-y-3 ${integration.is_active ? meta.color : 'bg-gray-50 border-gray-200'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-2xl">{meta.icon}</span>
          <div>
            <p className="font-semibold text-gray-900">{integration.name}</p>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${meta.badge}`}>
              {integration.provider}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs px-2 py-1 rounded-full font-medium ${integration.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
            {integration.is_active ? 'Activa' : 'Inactiva'}
          </span>
        </div>
      </div>

      {/* API Key mascarada */}
      <div className="bg-white/60 rounded-lg p-2 text-xs font-mono text-gray-500 flex items-center gap-2">
        <span>API Key:</span>
        <span className="flex-1 truncate">{integration.credentials?.api_key ?? '••••••••'}</span>
      </div>

      {testResult && (
        <div className={`text-xs p-2 rounded-lg flex items-start gap-1.5 ${testResult.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
          <span className="mt-0.5">{testResult.ok ? '✓' : '✕'}</span>
          <div>
            <span>{testResult.message}</span>
            {testResult.info && (
              <span className="ml-2 text-gray-500">
                {testResult.info.email && `· ${testResult.info.email}`}
                {testResult.info.reputation != null && ` · Reputacion: ${testResult.info.reputation}`}
                {testResult.info.plan && ` · Plan: ${testResult.info.plan}`}
              </span>
            )}
          </div>
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <button onClick={test} disabled={testing}
          className="text-xs px-3 py-1.5 border border-gray-300 rounded-lg text-gray-600 hover:border-blue-400 hover:text-blue-600 disabled:opacity-50 font-medium">
          {testing ? 'Probando...' : 'Probar conexion'}
        </button>
        <button onClick={toggle}
          className="text-xs px-3 py-1.5 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-100">
          {integration.is_active ? 'Desactivar' : 'Activar'}
        </button>
        <button onClick={remove}
          className="text-xs px-3 py-1.5 border border-red-200 rounded-lg text-red-400 hover:bg-red-50 hover:text-red-600 ml-auto">
          Eliminar
        </button>
      </div>
    </div>
  )
}

export default function IntegrationsPage() {
  const [integrations, setIntegrations] = useState([])
  const [providers, setProviders]       = useState([])
  const [loading, setLoading]           = useState(true)
  const [adding, setAdding]             = useState(null) // provider seleccionado

  async function load() {
    const [intRes, provRes] = await Promise.all([
      api.get('/integrations'),
      api.get('/integrations/providers'),
    ])
    setIntegrations(intRes.data)
    setProviders(provRes.data)
  }

  useEffect(() => { load().finally(() => setLoading(false)) }, [])

  if (loading) return <div className="text-gray-500">Cargando...</div>

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Integraciones externas</h1>
        <p className="text-sm text-gray-400 mt-0.5">
          Conecta proveedores de email para usarlos como canal de envio en tus campanas
        </p>
      </div>

      {/* Proveedores disponibles */}
      <div>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Agregar proveedor</h2>
        <div className="grid grid-cols-3 gap-3">
          {providers.map(p => {
            const meta = PROVIDER_META[p.provider] ?? {}
            const configured = integrations.filter(i => i.provider === p.provider).length
            return (
              <button key={p.provider}
                onClick={() => setAdding(adding?.provider === p.provider ? null : p)}
                className={`border-2 rounded-xl p-4 text-left transition-all hover:shadow-md
                  ${adding?.provider === p.provider ? 'border-blue-400 bg-blue-50' : 'border-gray-200 bg-white hover:border-gray-300'}`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-2xl">{meta.icon}</span>
                  {configured > 0 && (
                    <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                      {configured} activa{configured > 1 ? 's' : ''}
                    </span>
                  )}
                </div>
                <p className="font-semibold text-sm text-gray-800">{p.label}</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {p.provider === 'sendgrid' && 'Hasta 100 correos/dia gratis'}
                  {p.provider === 'brevo' && 'Hasta 300 correos/dia gratis'}
                  {p.provider === 'mailchimp' && 'Requiere plan Mailchimp de pago'}
                </p>
              </button>
            )
          })}
        </div>

        {adding && (
          <ProviderForm
            provider={adding}
            onSaved={() => { setAdding(null); load() }}
            onCancel={() => setAdding(null)}
          />
        )}
      </div>

      {/* Integraciones configuradas */}
      <div>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
          Integraciones configuradas ({integrations.length})
        </h2>
        {integrations.length === 0 ? (
          <div className="bg-white rounded-xl border-2 border-dashed border-gray-200 p-10 text-center text-gray-400">
            <p className="text-3xl mb-2">🔌</p>
            <p className="font-medium text-gray-500">Sin integraciones configuradas</p>
            <p className="text-sm mt-1">Agrega SendGrid, Brevo o Mailchimp para diversificar el envio.</p>
          </div>
        ) : (
          <div className="grid gap-4">
            {integrations.map(i => (
              <IntegrationCard key={i.id} integration={i} onDeleted={load} onToggle={load} />
            ))}
          </div>
        )}
      </div>

      {/* Comparativa */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
          <p className="text-sm font-semibold text-gray-700">Comparativa de proveedores</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Proveedor</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Plan gratuito</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Entregabilidad</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Mejor para</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {[
                { name: 'SMTP Propio', icon: '🖥️', free: 'Sin límite',       score: '⭐⭐⭐',   best: 'Control total, volumen alto' },
                { name: 'SendGrid',   icon: '📧', free: '100/dia',           score: '⭐⭐⭐⭐⭐', best: 'Alta entregabilidad, inbox garantizado' },
                { name: 'Brevo',      icon: '💌', free: '300/dia',           score: '⭐⭐⭐⭐',  best: 'Relación precio/volumen en LATAM' },
                { name: 'Mailchimp',  icon: '🐵', free: 'No (solo de pago)', score: '⭐⭐⭐⭐⭐', best: 'Empresas con ecosistema Mailchimp' },
              ].map(r => (
                <tr key={r.name} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">{r.icon} {r.name}</td>
                  <td className="px-4 py-3 text-gray-600">{r.free}</td>
                  <td className="px-4 py-3">{r.score}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{r.best}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
