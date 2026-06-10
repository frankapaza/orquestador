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
import { Plug, Loader2, CheckCircle, XCircle, Info, Plus, RefreshCw, Trash2, Check, Send, Mail, Megaphone, Server } from '@/components/ui/icons'
import { cn } from '@/lib/utils'

const PROVIDER_META = {
  sendgrid:  { Icon: Send,      tile: 'bg-blue-50',  color: 'text-blue-600',  badge: 'bg-blue-100 text-blue-700',  free: 'Hasta 100 correos/día gratis' },
  brevo:     { Icon: Mail,      tile: 'bg-teal-50',  color: 'text-teal-600',  badge: 'bg-teal-100 text-teal-700',  free: 'Hasta 300 correos/día gratis' },
  mailchimp: { Icon: Megaphone, tile: 'bg-amber-50', color: 'text-amber-600', badge: 'bg-amber-100 text-amber-700', free: 'Requiere plan Mailchimp de pago' },
}
function ProviderIcon({ provider, size = 20, className }) {
  const meta = PROVIDER_META[provider]
  const Icon = meta?.Icon ?? Plug
  return <Icon size={size} strokeWidth={1.75} className={cn(meta?.color ?? 'text-muted-foreground', className)} />
}
const GUIDE = {
  sendgrid: ['Entra a app.sendgrid.com → Settings → API Keys', 'Click en "Create API Key" (Full Access)', 'Copia la clave (solo se muestra una vez)', 'El email de envío debe estar verificado (Sender Identity)'],
  brevo: ['Entra a app.brevo.com → Mi cuenta → SMTP y API', 'Pestaña "API Keys" → Generar nueva clave', 'El email de envío debe estar verificado (Senders)'],
  mailchimp: ['Entra a mandrillapp.com (requiere cuenta Mailchimp de pago)', 'Settings → SMTP & API Info → Add API Key', 'El email de envío debe estar en un dominio verificado'],
}
const inputClass = 'h-[52px] rounded-xl border-transparent bg-muted/60 text-base shadow-none transition-colors focus-visible:border-ring focus-visible:bg-background focus-visible:ring-0'

function ProviderModal({ provider, onClose, onSaved }) {
  const [form, setForm]       = useState({ name: '', credentials: {} })
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  const setCred = (k, v) => setForm(f => ({ ...f, credentials: { ...f.credentials, [k]: v } }))
  const meta = PROVIDER_META[provider?.provider] ?? {}

  async function submit(e) {
    e.preventDefault()
    setLoading(true); setError('')
    try {
      await api.post('/integrations', { provider: provider.provider, name: form.name, credentials: form.credentials })
      onSaved()
    } catch (err) { setError(err.response?.data?.error ?? 'Error al guardar') }
    finally { setLoading(false) }
  }

  return (
    <Modal open={!!provider} onClose={onClose} size="lg"
      title={`Configurar ${provider?.label ?? ''}`} description="Verificamos las credenciales antes de guardar"
      icon={meta.Icon ?? Plug}>
      <form onSubmit={submit} className="space-y-5 p-6">
        <div className="space-y-1.5">
          <Label htmlFor="int-name">Nombre de esta conexión *</Label>
          <Input id="int-name" required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder={`Ej: ${provider?.label} Principal`} className={inputClass} />
          <p className="text-xs text-muted-foreground">Para identificarla al crear campañas.</p>
        </div>

        {provider?.fields?.map(field => (
          <div key={field.key} className="space-y-1.5">
            <Label htmlFor={`int-${field.key}`}>{field.label} {field.required && '*'}</Label>
            <Input id={`int-${field.key}`} required={field.required}
              type={field.type === 'password' ? 'password' : field.type === 'email' ? 'email' : 'text'}
              value={form.credentials[field.key] ?? ''} onChange={e => setCred(field.key, e.target.value)}
              className={`${inputClass} font-mono`} placeholder={field.type === 'password' ? '••••••••••••••••' : ''} />
          </div>
        ))}

        <div className="flex gap-3 rounded-xl border border-jungle-green-100 bg-jungle-green-50/60 p-4 text-xs text-muted-foreground">
          <Info size={18} strokeWidth={1.75} className="mt-0.5 shrink-0 text-jungle-green-600" />
          <div className="space-y-1">
            <p className="font-medium text-foreground">¿Dónde obtengo la API Key?</p>
            <ol className="list-inside list-decimal space-y-0.5">
              {(GUIDE[provider?.provider] ?? []).map((s, i) => <li key={i}>{s}</li>)}
            </ol>
          </div>
        </div>

        {error && <p className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"><XCircle size={16} strokeWidth={2} className="shrink-0" /> {error}</p>}

        <div className="flex gap-3">
          <Button type="submit" disabled={loading} className="flex-1">
            {loading ? <><Loader2 size={16} className="animate-spin" /> Verificando y guardando...</> : <><Check size={16} strokeWidth={2} /> Guardar integración</>}
          </Button>
          <Button type="button" variant="outline" onClick={onClose} className="flex-1">Cancelar</Button>
        </div>
      </form>
    </Modal>
  )
}

function IntegrationCard({ integration, onChanged }) {
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const meta = PROVIDER_META[integration.provider] ?? {}

  async function test() {
    setTesting(true); setTestResult(null)
    try { const { data } = await api.post(`/integrations/${integration.id}/test`); setTestResult(data) }
    catch (err) { setTestResult({ ok: false, message: err.response?.data?.message ?? 'Error de conexión' }) }
    finally { setTesting(false) }
  }
  async function remove() { if (!confirm(`¿Eliminar la integración "${integration.name}"?`)) return; await api.delete(`/integrations/${integration.id}`); onChanged() }
  async function toggle() { await api.patch(`/integrations/${integration.id}`, { is_active: !integration.is_active }); onChanged() }

  return (
    <div className={cn('rounded-2xl border bg-card p-5 shadow-sm transition-opacity', !integration.is_active && 'opacity-70')}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', meta.tile ?? 'bg-muted')}><ProviderIcon provider={integration.provider} /></span>
          <div>
            <p className="font-semibold text-foreground">{integration.name}</p>
            <span className={cn('mt-1 inline-flex rounded-full px-2 py-0.5 text-xs font-medium', meta.badge)}>{integration.provider}</span>
          </div>
        </div>
        <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
          integration.is_active ? 'bg-jungle-green-100 text-jungle-green-700' : 'bg-muted text-muted-foreground')}>
          <span className={cn('h-1.5 w-1.5 rounded-full', integration.is_active ? 'bg-jungle-green-500' : 'bg-muted-foreground/40')} />
          {integration.is_active ? 'Activa' : 'Inactiva'}
        </span>
      </div>

      <div className="mt-3 flex items-center gap-2 rounded-lg bg-muted/60 p-2.5 font-mono text-xs text-muted-foreground">
        <span className="font-sans">API Key</span>
        <span className="flex-1 truncate text-right">{integration.credentials?.api_key ?? '••••••••'}</span>
      </div>

      {testResult && (
        <div className={cn('mt-3 flex items-start gap-2 rounded-lg p-2.5 text-xs', testResult.ok ? 'bg-jungle-green-50 text-jungle-green-700' : 'bg-red-50 text-red-700')}>
          {testResult.ok ? <CheckCircle size={16} strokeWidth={2} className="mt-0.5 shrink-0" /> : <XCircle size={16} strokeWidth={2} className="mt-0.5 shrink-0" />}
          <div>
            <span>{testResult.message}</span>
            {testResult.info && (
              <span className="ml-1 text-muted-foreground">
                {testResult.info.email && `· ${testResult.info.email}`}
                {testResult.info.reputation != null && ` · Reputación: ${testResult.info.reputation}`}
                {testResult.info.plan && ` · Plan: ${testResult.info.plan}`}
              </span>
            )}
          </div>
        </div>
      )}

      <div className="mt-4 flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={test} disabled={testing}>
          {testing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} {testing ? 'Probando...' : 'Probar'}
        </Button>
        <Button variant="ghost" size="sm" onClick={toggle}>{integration.is_active ? 'Desactivar' : 'Activar'}</Button>
        <Button variant="ghost" size="icon" onClick={remove} className="ml-auto h-8 w-8 text-muted-foreground hover:bg-red-50 hover:text-red-600"><Trash2 size={15} /></Button>
      </div>
    </div>
  )
}

export default function IntegrationsPage() {
  const [integrations, setIntegrations] = useState([])
  const [providers, setProviders]       = useState([])
  const [loading, setLoading]           = useState(true)
  const [adding, setAdding]             = useState(null)

  async function load() {
    const [intRes, provRes] = await Promise.all([api.get('/integrations'), api.get('/integrations/providers')])
    setIntegrations(intRes.data); setProviders(provRes.data)
  }
  useEffect(() => { load().finally(() => setLoading(false)) }, [])

  if (loading) return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
      <Loader2 className="animate-spin text-jungle-green-600" /> Cargando...
    </div>
  )

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader icon={Plug} title="Integraciones externas"
        description="Conecta proveedores de email para usarlos como canal de envío en tus campañas." />

      {/* Proveedores disponibles */}
      <SectionCard title="Agregar proveedor" description="Elige un proveedor para conectarlo.">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {providers.map(p => {
            const meta = PROVIDER_META[p.provider] ?? {}
            const configured = integrations.filter(i => i.provider === p.provider).length
            return (
              <button key={p.provider} onClick={() => setAdding(p)}
                className="group flex items-start gap-3 rounded-2xl border bg-card p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-jungle-green-200 hover:shadow-md">
                <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', meta.tile ?? 'bg-muted')}><ProviderIcon provider={p.provider} /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-foreground">{p.label}</p>
                    {configured > 0 && <span className="shrink-0 rounded-full bg-jungle-green-100 px-2 py-0.5 text-[11px] font-medium text-jungle-green-700">{configured} activa{configured > 1 ? 's' : ''}</span>}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{meta.free}</p>
                  <p className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-jungle-green-700"><Plus size={13} strokeWidth={2} /> Conectar</p>
                </div>
              </button>
            )
          })}
        </div>
      </SectionCard>

      {/* Configuradas */}
      <SectionCard title={`Integraciones configuradas (${integrations.length})`} noPadding>
        {integrations.length === 0 ? (
          <EmptyState icon={Plug} title="Sin integraciones configuradas"
            description="Agrega SendGrid, Brevo o Mailchimp para diversificar el envío." />
        ) : (
          <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
            {integrations.map(i => <IntegrationCard key={i.id} integration={i} onChanged={load} />)}
          </div>
        )}
      </SectionCard>

      {/* Comparativa */}
      <SectionCard title="Comparativa de proveedores" noPadding>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-5 py-3 font-medium">Proveedor</th>
                <th className="px-5 py-3 font-medium">Plan gratuito</th>
                <th className="px-5 py-3 font-medium">Entregabilidad</th>
                <th className="px-5 py-3 font-medium">Mejor para</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {[
                { name: 'SMTP Propio', Icon: Server,    color: 'text-slate-500', free: 'Sin límite',       score: 3, best: 'Control total, volumen alto' },
                { name: 'SendGrid',    Icon: Send,      color: 'text-blue-600',  free: '100/día',           score: 5, best: 'Alta entregabilidad, inbox garantizado' },
                { name: 'Brevo',       Icon: Mail,      color: 'text-teal-600',  free: '300/día',           score: 4, best: 'Relación precio/volumen en LATAM' },
                { name: 'Mailchimp',   Icon: Megaphone, color: 'text-amber-600', free: 'No (solo de pago)', score: 5, best: 'Empresas con ecosistema Mailchimp' },
              ].map(r => (
                <tr key={r.name} className="transition-colors hover:bg-muted/40">
                  <td className="px-5 py-3 font-medium text-foreground">
                    <span className="inline-flex items-center gap-2"><r.Icon size={16} strokeWidth={1.75} className={r.color} /> {r.name}</span>
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">{r.free}</td>
                  <td className="px-5 py-3 text-amber-500">{'★'.repeat(r.score)}<span className="text-muted-foreground/30">{'★'.repeat(5 - r.score)}</span></td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">{r.best}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {adding && <ProviderModal provider={adding} onClose={() => setAdding(null)} onSaved={() => { setAdding(null); load() }} />}
    </div>
  )
}
