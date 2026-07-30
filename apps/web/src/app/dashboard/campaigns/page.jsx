'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import api from '../../../lib/api'
import {
  Plus, Send, Pause, Play, RotateCcw, Megaphone, Loader2, Mail, MessageCircle,
  Smartphone, BarChart3, FileText, Bot,
} from '../../../components/ui/icons'
import { PageHeader } from '@/components/ui/PageHeader'
import { StatCard } from '@/components/ui/stat-card'
import { SectionCard } from '@/components/ui/section-card'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// Logo oficial de WhatsApp (hereda el color con currentColor).
function WhatsappGlyph({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  )
}

// Badge de canal. WhatsApp IA (channel whatsapp + assistant_id) se distingue con
// el robot y color teal; WhatsApp normal en verde.
function ChannelBadge({ campaign }) {
  const isAI = campaign.channel === 'whatsapp' && !!campaign.assistant_id
  if (campaign.channel === 'whatsapp') {
    return (
      <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        isAI ? 'bg-teal-100 text-teal-700' : 'bg-green-100 text-green-700')}>
        <WhatsappGlyph className="h-3 w-3" />
        {isAI && <Bot size={12} strokeWidth={2} className="-ml-0.5" />}
        {isAI ? 'WhatsApp IA' : 'WhatsApp'}
      </span>
    )
  }
  const ch = CHANNEL_META[campaign.channel] ?? CHANNEL_META.email
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', ch.cls)}>
      <ch.Icon size={12} strokeWidth={1.75} /> {ch.label}
    </span>
  )
}

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
  whatsapp: { label: 'WhatsApp', Icon: MessageCircle, cls: 'bg-green-100 text-green-700' },
  sms:      { label: 'SMS',      Icon: Smartphone,    cls: 'bg-violet-100 text-violet-700' },
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

  // Progreso en tiempo real por SSE (el servidor EMPUJA el avance; sin polling).
  // Mismo stream /events del Inbox. El worker emite 'campaign:progress' en cada
  // envío/fallo y al completar; aquí solo actualizamos la fila afectada.
  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('kubo_token') : null
    if (!token) return
    const base = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1').replace(/\/$/, '')
    const es = new EventSource(`${base}/events?token=${encodeURIComponent(token)}`)
    es.addEventListener('campaign:progress', (e) => {
      try {
        const d = JSON.parse(e.data)
        setCampaigns(prev => prev.map(c => c.id === d.campaign_id ? {
          ...c,
          sent_count:       d.sent_count,
          failed_count:     d.failed_count,
          total_recipients: d.total_recipients || c.total_recipients,
          status:           d.status ?? c.status,
          total_contacts:   d.total_contacts ?? c.total_contacts,
          done_contacts:    d.done_contacts ?? c.done_contacts,
        } : c))
      } catch { /* no-op */ }
    })
    return () => es.close()
  }, [])

  const live = campaigns.some(c => c.status === 'sending')

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
          <div className="flex items-center gap-3">
            {live && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-500 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-500" />
                </span>
                En vivo
              </span>
            )}
            <Button asChild>
              <Link href="/dashboard/campaigns/new"><Plus size={16} strokeWidth={2} /> Nueva campaña</Link>
            </Button>
          </div>
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
                  const sent = Number(c.sent_count), failed = Number(c.failed_count || 0), total = Number(c.total_recipients)
                  const done = sent + failed
                  const destPct = total > 0 ? Math.min(100, (done / total) * 100) : 0
                  const tc = Number(c.total_contacts || 0), dc = Number(c.done_contacts || 0)
                  const contactPct = tc > 0 ? Math.min(100, (dc / tc) * 100) : 0
                  const sending = c.status === 'sending'
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
                        <ChannelBadge campaign={c} />
                      </td>
                      <td className="px-5 py-3">
                        <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', STATUS_COLOR[c.status] ?? 'bg-muted text-muted-foreground')}>
                          {STATUS_LABEL[c.status] ?? c.status}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <div className="min-w-[160px] space-y-1.5">
                          {/* Contactos: el cliente cuenta solo cuando TODOS sus destinos se enviaron */}
                          <div className="flex items-center gap-2">
                            <span className="w-16 shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Contactos</span>
                            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                              <div className="h-full rounded-full bg-jungle-green-500 transition-all duration-700 ease-out" style={{ width: `${contactPct}%` }} />
                            </div>
                            <span className="w-9 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{dc}/{tc}</span>
                          </div>
                          {/* Destinos: teléfonos o correos */}
                          <div className="flex items-center gap-2">
                            <span className="w-16 shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{c.channel === 'email' ? 'Correos' : 'Teléfonos'}</span>
                            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                              <div className={cn('h-full rounded-full transition-all duration-700 ease-out', c.status === 'failed' ? 'bg-red-400' : sending ? 'bg-blue-500' : 'bg-jungle-green-500')} style={{ width: `${destPct}%` }} />
                            </div>
                            <span className="flex w-9 shrink-0 items-center justify-end gap-1 text-right text-xs tabular-nums text-muted-foreground">
                              {sending && (
                                <span className="relative flex h-1.5 w-1.5">
                                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-500 opacity-75" />
                                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-blue-500" />
                                </span>
                              )}
                              {done}/{total}
                            </span>
                          </div>
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
