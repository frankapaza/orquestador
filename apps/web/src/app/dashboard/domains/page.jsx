'use client'
import { useEffect, useState } from 'react'
import api from '../../../lib/api'
import DeliverabilityGuide from '../../../components/domains/DeliverabilityGuide'
import {
  RefreshCw, Pencil, Save, ChevronUp, ChevronDown, Plus, User, Globe, Mail,
  Loader2, Check, X, Trash2,
} from '../../../components/ui/icons'
import { PageHeader } from '@/components/ui/PageHeader'
import { StatCard } from '@/components/ui/stat-card'
import { SectionCard } from '@/components/ui/section-card'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Modal } from '@/components/ui/modal'
import { SelectMenu } from '@/components/ui/select-menu'
import { cn } from '@/lib/utils'

const inputClass = 'h-[52px] rounded-xl border-transparent bg-muted/60 text-base shadow-none transition-colors focus-visible:border-ring focus-visible:bg-background focus-visible:ring-0'
const PORT_PRESETS = [
  { label: '587 — STARTTLS (recomendado)', port: 587, tls: true },
  { label: '465 — SSL/TLS', port: 465, tls: true },
  { label: '25 — Sin cifrado', port: 25, tls: false },
]
const EMPTY_ACCOUNT = { email: '', smtp_host: '', smtp_port: 587, smtp_user: '', smtp_pass: '', use_tls: true, daily_limit: 300 }

function DnsBadge({ ok, label }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
      ok ? 'bg-jungle-green-100 text-jungle-green-700' : 'bg-muted text-muted-foreground')}>
      {ok ? <Check size={11} strokeWidth={2.5} /> : <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />}{label}
    </span>
  )
}

// ── Modal de cuenta SMTP (alta y edición) ────────────────────────────────────
function AccountModal({ domainId, account, onClose, onSaved }) {
  const editing = !!account
  const [form, setForm] = useState(editing
    ? { email: account.email, smtp_host: account.smtp_host, smtp_port: account.smtp_port, smtp_user: account.smtp_user ?? account.email, smtp_pass: '', use_tls: account.use_tls, daily_limit: account.daily_limit }
    : { ...EMPTY_ACCOUNT })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function submit(e) {
    e.preventDefault()
    setLoading(true); setError('')
    try {
      if (editing) {
        await api.patch(`/domains/${domainId}/accounts/${account.id}`, {
          email: form.email, smtp_host: form.smtp_host, smtp_port: parseInt(form.smtp_port), smtp_user: form.smtp_user,
          use_tls: form.use_tls, daily_limit: parseInt(form.daily_limit), ...(form.smtp_pass ? { smtp_pass: form.smtp_pass } : {}),
        })
      } else {
        await api.post(`/domains/${domainId}/accounts`, { ...form, smtp_port: parseInt(form.smtp_port), daily_limit: parseInt(form.daily_limit) })
      }
      onSaved()
    } catch (err) { setError(err.response?.data?.error ?? 'Error al guardar la cuenta') }
    finally { setLoading(false) }
  }

  return (
    <Modal open onClose={onClose} size="xl" icon={Mail} title={editing ? 'Editar cuenta SMTP' : 'Nueva cuenta SMTP'}>
      <form onSubmit={submit} className="space-y-4 p-6">
        {error && <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2 space-y-1.5">
            <Label>Email de envío *</Label>
            <Input required value={form.email} onChange={e => set('email', e.target.value)} placeholder="ventas@tudominio.com" className={inputClass} />
          </div>
          <div className="space-y-1.5">
            <Label>Servidor SMTP *</Label>
            <Input required value={form.smtp_host} onChange={e => set('smtp_host', e.target.value)} placeholder="mail.tudominio.com" className={inputClass} />
          </div>
          <div className="space-y-1.5">
            <Label>Puerto</Label>
            <div className="flex gap-2">
              <Input type="number" value={form.smtp_port} onChange={e => set('smtp_port', e.target.value)} className={`${inputClass} w-24`} />
              <div className="flex-1">
                <SelectMenu value="" placeholder="Preset..." className="h-[52px]"
                  onChange={i => { const p = PORT_PRESETS[i]; set('smtp_port', p.port); set('use_tls', p.tls) }}
                  options={PORT_PRESETS.map((p, i) => ({ value: String(i), label: p.label }))} />
              </div>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Usuario SMTP *</Label>
            <Input required value={form.smtp_user} onChange={e => set('smtp_user', e.target.value)} placeholder="ventas@tudominio.com" className={inputClass} />
          </div>
          <div className="space-y-1.5">
            <Label>Contraseña SMTP {editing && <span className="font-normal text-muted-foreground">(vacío = no cambiar)</span>}{!editing && ' *'}</Label>
            <Input required={!editing} type="password" value={form.smtp_pass} onChange={e => set('smtp_pass', e.target.value)} placeholder="••••••••" className={inputClass} />
          </div>
          <div className="space-y-1.5">
            <Label>Límite diario (correos)</Label>
            <Input type="number" value={form.daily_limit} onChange={e => set('daily_limit', e.target.value)} min={1} max={2000} className={inputClass} />
          </div>
          <label className="col-span-2 flex w-fit cursor-pointer items-center gap-2 rounded-xl border bg-muted/40 px-4 py-2.5">
            <Checkbox checked={form.use_tls} onCheckedChange={v => set('use_tls', !!v)} />
            <span className="text-sm text-foreground">Usar TLS</span>
          </label>
        </div>
        <div className="flex gap-3 pt-1">
          <Button type="submit" disabled={loading} className="flex-1">
            {loading ? <><Loader2 size={16} className="animate-spin" /> Guardando...</> : <><Save size={16} /> {editing ? 'Guardar cambios' : 'Guardar cuenta'}</>}
          </Button>
          <Button type="button" variant="outline" onClick={onClose} className="flex-1">Cancelar</Button>
        </div>
      </form>
    </Modal>
  )
}

// ── Fila de cuenta SMTP ───────────────────────────────────────────────────────
function AccountRow({ account, domainId, members, onChanged }) {
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [editing, setEditing] = useState(false)
  const [assigning, setAssigning] = useState(false)

  async function assign(memberId) {
    setAssigning(true)
    try { await api.patch(`/domains/${domainId}/accounts/${account.id}/assign`, { member_id: memberId || null }); onChanged() } catch {}
    setAssigning(false)
  }
  async function testConnection() {
    setTesting(true); setTestResult(null)
    try { const { data } = await api.post(`/domains/${domainId}/accounts/${account.id}/test`); setTestResult(data) }
    catch (err) { setTestResult({ ok: false, message: err.response?.data?.message ?? 'Error de conexión' }) }
    finally { setTesting(false) }
  }
  async function remove() {
    if (!confirm(`¿Eliminar la cuenta ${account.email}?`)) return
    await api.delete(`/domains/${domainId}/accounts/${account.id}`); onChanged()
  }

  const usePct = account.daily_limit > 0 ? Math.round((account.sent_today / account.daily_limit) * 100) : 0
  const memberOpts = [{ value: '', label: '— Sin asignar —', icon: <User size={14} className="text-muted-foreground" /> },
    ...(members ?? []).filter(m => !m.is_owner).map(m => ({ value: m.id, label: `${m.name}`, icon: <User size={14} className="text-jungle-green-600" /> }))]

  return (
    <div className="space-y-3 rounded-xl border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className={cn('mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full', account.is_active ? 'bg-jungle-green-500' : 'bg-muted-foreground/40')} />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">{account.email}</p>
            <p className="text-xs text-muted-foreground">{account.smtp_host}:{account.smtp_port} · {account.use_tls ? 'TLS' : 'Sin TLS'}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button size="sm" variant="outline" onClick={testConnection} disabled={testing}>
            {testing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Probar
          </Button>
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}><Pencil size={12} /> Editar</Button>
          <Button size="sm" variant="ghost" onClick={remove} className="h-8 w-8 p-0 text-red-600 hover:bg-red-50 hover:text-red-700"><Trash2 size={14} /></Button>
        </div>
      </div>

      <div>
        <div className="mb-1 flex justify-between text-xs text-muted-foreground">
          <span>Uso hoy</span>
          <span className="tabular-nums">{account.sent_today} / {account.daily_limit} ({usePct}%)</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div className={cn('h-full rounded-full', usePct > 90 ? 'bg-red-500' : usePct > 70 ? 'bg-amber-400' : 'bg-jungle-green-500')} style={{ width: `${Math.min(usePct, 100)}%` }} />
        </div>
      </div>

      {members && members.length > 0 && (
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Asignado a asesor</Label>
          <SelectMenu value={account.assigned_member_id ?? ''} onChange={assign} options={memberOpts} disabled={assigning} loading={assigning} className="h-10" />
        </div>
      )}

      {testResult && (
        <div className={cn('flex items-center gap-1.5 rounded-lg p-2 text-xs', testResult.ok ? 'bg-jungle-green-100 text-jungle-green-700' : 'bg-red-100 text-red-700')}>
          {testResult.ok ? <Check size={14} /> : <X size={14} />}<span>{testResult.message}</span>
        </div>
      )}

      {editing && <AccountModal domainId={domainId} account={account} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); onChanged() }} />}
    </div>
  )
}

// ── Panel de dominio (expandible) ─────────────────────────────────────────────
function DomainPanel({ domain, onRefresh }) {
  const [open, setOpen] = useState(false)
  const [accounts, setAccounts] = useState([])
  const [members, setMembers] = useState([])
  const [loadingAcc, setLoadingAcc] = useState(false)
  const [addOpen, setAddOpen] = useState(false)

  async function loadAccounts() {
    setLoadingAcc(true)
    try {
      const [accRes, memRes] = await Promise.all([
        api.get(`/domains/${domain.id}/accounts`),
        api.get('/settings/team').catch(() => ({ data: [] })),
      ])
      setAccounts(accRes.data); setMembers(memRes.data ?? [])
    } finally { setLoadingAcc(false) }
  }
  function toggle() { if (!open) loadAccounts(); setOpen(v => !v) }
  async function toggleDNS(field) { await api.patch(`/domains/${domain.id}`, { [field]: !domain[field] }); onRefresh() }
  async function remove() { if (!confirm(`¿Eliminar el dominio ${domain.domain} y todas sus cuentas?`)) return; await api.delete(`/domains/${domain.id}`); onRefresh() }

  return (
    <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <div className="flex cursor-pointer items-center gap-4 p-5 transition-colors hover:bg-muted/40" onClick={toggle}>
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-jungle-green-50 text-jungle-green-600"><Globe size={20} strokeWidth={1.75} /></div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <p className="font-semibold text-foreground">{domain.domain}</p>
            <div className="flex gap-1.5">
              <DnsBadge ok={domain.spf_configured} label="SPF" />
              <DnsBadge ok={domain.dkim_configured} label="DKIM" />
              <DnsBadge ok={domain.dmarc_configured} label="DMARC" />
            </div>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {domain.account_count} {domain.account_count === 1 ? 'cuenta' : 'cuentas'} · {Number(domain.sent_today_total ?? 0).toLocaleString()} / {Number(domain.daily_limit).toLocaleString()} enviados hoy
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button size="sm" variant="ghost" onClick={e => { e.stopPropagation(); remove() }} className="h-8 w-8 p-0 text-red-600 hover:bg-red-50 hover:text-red-700"><Trash2 size={15} /></Button>
          <span className="text-muted-foreground">{open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</span>
        </div>
      </div>

      {open && (
        <div className="space-y-5 border-t bg-muted/30 p-5">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Estado DNS</p>
            <div className="flex flex-wrap gap-3">
              {[{ key: 'spf_configured', label: 'SPF configurado' }, { key: 'dkim_configured', label: 'DKIM configurado' }, { key: 'dmarc_configured', label: 'DMARC configurado' }].map(item => (
                <label key={item.key} className="flex cursor-pointer items-center gap-2 rounded-xl border bg-card px-3 py-2 text-sm text-foreground" onClick={e => e.stopPropagation()}>
                  <Checkbox checked={!!domain[item.key]} onCheckedChange={() => toggleDNS(item.key)} /> {item.label}
                </label>
              ))}
            </div>
          </div>

          <DeliverabilityGuide domain={domain} />

          <div>
            <div className="mb-3 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Cuentas SMTP ({accounts.length})</p>
              <Button size="sm" onClick={() => setAddOpen(true)}><Plus size={12} /> Agregar cuenta</Button>
            </div>
            {loadingAcc && <p className="flex items-center gap-2 py-2 text-sm text-muted-foreground"><Loader2 size={16} className="animate-spin text-jungle-green-600" /> Cargando...</p>}
            <div className="space-y-2">
              {accounts.map(acc => <AccountRow key={acc.id} account={acc} domainId={domain.id} members={members} onChanged={loadAccounts} />)}
              {!loadingAcc && accounts.length === 0 && (
                <div className="rounded-xl border border-dashed bg-card p-6 text-center">
                  <Mail size={22} className="mx-auto mb-2 text-muted-foreground" />
                  <p className="text-sm font-medium text-foreground">Sin cuentas SMTP</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">Agrega al menos una para enviar campañas.</p>
                </div>
              )}
            </div>
          </div>

          {addOpen && <AccountModal domainId={domain.id} onClose={() => setAddOpen(false)} onSaved={() => { setAddOpen(false); loadAccounts(); onRefresh() }} />}
        </div>
      )}
    </div>
  )
}

// ── Modal nuevo dominio ───────────────────────────────────────────────────────
function DomainModal({ onClose, onSaved }) {
  const [form, setForm] = useState({ domain: '', daily_limit: 1000 })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function submit(e) {
    e.preventDefault()
    setSaving(true); setError('')
    try { await api.post('/domains', { ...form, daily_limit: parseInt(form.daily_limit) }); onSaved() }
    catch (err) { setError(err.response?.data?.error ?? 'Error al guardar el dominio') }
    finally { setSaving(false) }
  }

  return (
    <Modal open onClose={onClose} size="lg" icon={Globe} title="Nuevo dominio">
      <form onSubmit={submit} className="space-y-4 p-6">
        {error && <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Dominio *</Label>
            <Input required value={form.domain} onChange={e => setForm(d => ({ ...d, domain: e.target.value }))} placeholder="miempresa.com" className={inputClass} />
            <p className="text-xs text-muted-foreground">Solo el dominio, sin http://</p>
          </div>
          <div className="space-y-1.5">
            <Label>Límite diario total</Label>
            <Input type="number" min={1} max={50000} value={form.daily_limit} onChange={e => setForm(d => ({ ...d, daily_limit: e.target.value }))} className={inputClass} />
          </div>
        </div>
        <div className="rounded-xl border border-amber-100 bg-amber-50 p-4 text-xs text-amber-700">
          <p className="mb-1 font-medium">Asegúrate de tener configurado en tu DNS:</p>
          <ul className="list-inside list-disc space-y-0.5">
            <li><strong>SPF</strong>: autoriza tu servidor a enviar correos del dominio</li>
            <li><strong>DKIM</strong>: firma digital para autenticar los correos</li>
            <li><strong>DMARC</strong>: política de manejo de correos no autenticados</li>
          </ul>
        </div>
        <div className="flex gap-3 pt-1">
          <Button type="submit" disabled={saving} className="flex-1">{saving ? <><Loader2 size={16} className="animate-spin" /> Guardando...</> : <><Save size={16} /> Guardar dominio</>}</Button>
          <Button type="button" variant="outline" onClick={onClose} className="flex-1">Cancelar</Button>
        </div>
      </form>
    </Modal>
  )
}

export default function DomainsPage() {
  const [domains, setDomains] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)

  async function load() { const { data } = await api.get('/domains'); setDomains(data) }
  useEffect(() => { load().finally(() => setLoading(false)) }, [])

  if (loading) return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
      <Loader2 size={18} className="animate-spin text-jungle-green-600" /> Cargando...
    </div>
  )

  const totalAccounts = domains.reduce((a, d) => a + Number(d.account_count ?? 0), 0)
  const sentToday     = domains.reduce((a, d) => a + Number(d.sent_today_total ?? 0), 0)

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader icon={Globe} title="Dominios de envío"
        description="Configura dominios y sus cuentas SMTP para enviar campañas."
        action={<Button onClick={() => setShowForm(true)}><Plus size={14} /> Agregar dominio</Button>} />

      {domains.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          <StatCard icon={Globe} label="Dominios" value={domains.length} />
          <StatCard icon={Mail} label="Cuentas SMTP" value={totalAccounts} tone="blue" />
          <StatCard icon={RefreshCw} label="Enviados hoy" value={sentToday.toLocaleString()} tone="green" />
        </div>
      )}

      <div className="space-y-3">
        {domains.map(d => <DomainPanel key={d.id} domain={d} onRefresh={load} />)}
        {!domains.length && (
          <SectionCard>
            <EmptyState icon={Globe} title="Sin dominios configurados"
              description="Agrega un dominio y luego sus cuentas SMTP para empezar a enviar."
              action={<Button onClick={() => setShowForm(true)}><Plus size={14} /> Agregar dominio</Button>} />
          </SectionCard>
        )}
      </div>

      {showForm && <DomainModal onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); load() }} />}
    </div>
  )
}
