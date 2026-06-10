'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import api from '../../../lib/api'
import {
  Plus, Send, Pause, Play, RotateCcw, Megaphone, Loader2, Mail, MessageCircle,
  Smartphone, BarChart3, FileText,
} from '../../../components/ui/icons'
import { PageHeader } from '@/components/ui/PageHeader'
import { StatCard } from '@/components/ui/stat-card'
import { SectionCard } from '@/components/ui/section-card'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const STATUS_LABEL = {
  draft: 'Borrador', sending: 'Enviando', completed: 'Completada',
  failed: 'Fallida', paused: 'Pausada', scheduled: 'Programada',
}
const STATUS_COLOR = {
  draft:     'bg-muted text-muted-foreground',
  sending:   'bg-blue-100 text-blue-700',
  completed: 'bg-jungle-green-100 text-jungle-green-700',
  failed:    'bg-red-100 text-red-700',
  paused:    'bg-amber-100 text-amber-700',
  scheduled: 'bg-violet-100 text-violet-700',
}
const CHANNEL_META = {
  email:    { label: 'Email',    Icon: Mail,          cls: 'bg-amber-100 text-amber-700' },
  whatsapp: { label: 'WhatsApp', Icon: MessageCircle, cls: 'bg-jungle-green-100 text-jungle-green-700' },
  sms:      { label: 'SMS',      Icon: Smartphone,    cls: 'bg-blue-100 text-blue-700' },
}

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState([])
  const [loading, setLoading]     = useState(true)
  const router = useRouter()

  async function load() {
    const { data } = await api.get('/campaigns')
    setCampaigns(data)
  }
  useEffect(() => {
    api.get('/auth/me').then(r => {
      if (r.data.role === 'asesor') router.replace('/dashboard')
      else load().finally(() => setLoading(false))
    }).catch(() => load().finally(() => setLoading(false)))
  }, [])

  async function sendCampaign(id)   { if (!confirm('¿Enviar esta campaña ahora?')) return; await api.post(`/campaigns/${id}/send`); load() }
  async function pauseCampaign(id)  { await api.post(`/campaigns/${id}/pause`); load() }
  async function resumeCampaign(id) { await api.post(`/campaigns/${id}/resume`); load() }

  if (loading) return (
    <div className="flex items-center justify-center gap-2 py-20 text-sm text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin text-jungle-green-600" /> Cargando...
    </div>
  )

  const stats = {
    total:     campaigns.length,
    sending:   campaigns.filter(c => c.status === 'sending').length,
    completed: campaigns.filter(c => c.status === 'completed').length,
    draft:     campaigns.filter(c => ['draft', 'scheduled'].includes(c.status)).length,
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        icon={Megaphone}
        title="Campañas"
        description="Gestiona, envía y monitorea tus campañas de comunicación."
        action={
          <Button asChild>
            <Link href="/dashboard/campaigns/new"><Plus size={16} strokeWidth={2} /> Nueva campaña</Link>
          </Button>
        }
      />

      {campaigns.length > 0 && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard icon={Megaphone}    label="Total"       value={stats.total} />
          <StatCard icon={Send}         label="Enviando"    value={stats.sending}   tone="blue" />
          <StatCard icon={BarChart3}    label="Completadas" value={stats.completed} tone="green" />
          <StatCard icon={FileText}     label="Borradores"  value={stats.draft}     tone="slate" />
        </div>
      )}

      <SectionCard noPadding>
        {campaigns.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-5 py-3 font-medium">Campaña</th>
                  <th className="px-5 py-3 font-medium">Canal</th>
                  <th className="px-5 py-3 font-medium">Estado</th>
                  <th className="px-5 py-3 font-medium">Progreso</th>
                  <th className="px-5 py-3 text-right font-medium">Apertura</th>
                  <th className="px-5 py-3 text-right font-medium">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {campaigns.map(c => {
                  const ch = CHANNEL_META[c.channel] ?? CHANNEL_META.email
                  const sent = Number(c.sent_count), total = Number(c.total_recipients)
                  const pct = total > 0 ? Math.min(100, (sent / total) * 100) : 0
                  const openRate = sent > 0 ? ((Number(c.open_count) / sent) * 100).toFixed(1) : '0.0'
                  return (
                    <tr key={c.id} className="transition-colors hover:bg-muted/40">
                      <td className="px-5 py-3">
                        <Link href={`/dashboard/campaigns/${c.id}`} className="font-medium text-foreground hover:text-jungle-green-700">{c.name}</Link>
                        <p className="mt-0.5 text-xs text-muted-foreground">{c.list_name}</p>
                        {c.scheduled_at && c.status === 'scheduled' && (
                          <p className="mt-0.5 text-xs text-violet-600">Programada: {new Date(c.scheduled_at).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' })}</p>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', ch.cls)}>
                          <ch.Icon size={12} strokeWidth={1.75} /> {ch.label}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', STATUS_COLOR[c.status] ?? 'bg-muted text-muted-foreground')}>
                          {STATUS_LABEL[c.status] ?? c.status}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                            <div className={cn('h-full rounded-full', c.status === 'failed' ? 'bg-red-400' : 'bg-jungle-green-500')} style={{ width: `${pct}%` }} />
                          </div>
                          <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">{sent.toLocaleString()}/{total.toLocaleString()}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums">
                        {c.channel && c.channel !== 'email' ? <span className="text-muted-foreground">—</span> : `${openRate}%`}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {['draft', 'scheduled'].includes(c.status) && (
                            <Button variant="ghost" size="sm" className="h-7 px-2 text-jungle-green-700 hover:text-jungle-green-800" onClick={() => sendCampaign(c.id)}>
                              <Send size={14} strokeWidth={2} /> Enviar
                            </Button>
                          )}
                          {c.status === 'sending' && (
                            <Button variant="ghost" size="sm" className="h-7 px-2 text-amber-600 hover:text-amber-700" onClick={() => pauseCampaign(c.id)}>
                              <Pause size={14} strokeWidth={2} /> Pausar
                            </Button>
                          )}
                          {c.status === 'paused' && (
                            <Button variant="ghost" size="sm" className="h-7 px-2 text-jungle-green-700 hover:text-jungle-green-800" onClick={() => resumeCampaign(c.id)}>
                              <Play size={14} strokeWidth={2} /> Reanudar
                            </Button>
                          )}
                          <Button asChild variant="ghost" size="sm" className="h-7 px-2 text-muted-foreground hover:text-foreground">
                            <Link href={`/dashboard/campaigns/${c.id}`}>Detalle</Link>
                          </Button>
                          <Button asChild variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-violet-700" title="Reenviar">
                            <Link href={`/dashboard/campaigns/new?from=${c.id}`}><RotateCcw size={14} strokeWidth={2} /></Link>
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon={Megaphone}
            title="Sin campañas"
            description="Aún no tienes campañas. Crea una para empezar a comunicarte por email, WhatsApp o SMS."
            action={<Button asChild><Link href="/dashboard/campaigns/new"><Plus size={16} strokeWidth={2} /> Nueva campaña</Link></Button>}
          />
        )}
      </SectionCard>
    </div>
  )
}
