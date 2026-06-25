'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import api from '../../../lib/api'
import { PageHeader } from '@/components/ui/PageHeader'
import { StatCard } from '@/components/ui/stat-card'
import { SectionCard } from '@/components/ui/section-card'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { BarChart3, Send, Eye, CheckCircle, ArrowRight, Loader2, Megaphone, Mail, MessageCircle, Smartphone } from '@/components/ui/icons'
import { MousePointerClick } from 'lucide-react'
import { cn } from '@/lib/utils'

const STATUS_LABEL = { draft: 'Borrador', sending: 'Enviando', completed: 'Completada', failed: 'Fallida', paused: 'Pausada', scheduled: 'Programada' }
const STATUS_COLOR = {
  draft: 'bg-muted text-muted-foreground',
  sending: 'bg-blue-100 text-blue-700',
  completed: 'bg-jungle-green-100 text-jungle-green-700',
  failed: 'bg-red-100 text-red-700',
  paused: 'bg-amber-100 text-amber-700',
  scheduled: 'bg-violet-100 text-violet-700',
}
const CHANNEL_META = {
  email:    { label: 'Email',    Icon: Mail,          cls: 'bg-amber-100 text-amber-700' },
  whatsapp: { label: 'WhatsApp', Icon: MessageCircle, cls: 'bg-green-100 text-green-700' },
  sms:      { label: 'SMS',      Icon: Smartphone,    cls: 'bg-violet-100 text-violet-700' },
}

export default function ReportsPage() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get('/reports/summary').then(r => setData(r.data)).finally(() => setLoading(false))
  }, [])

  if (loading) return (
    <div className="flex items-center justify-center gap-2 py-20 text-sm text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin text-jungle-green-600" />
      Cargando...
    </div>
  )

  const t = data?.totals ?? {}

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        icon={BarChart3}
        title="Reportes"
        description="Resumen de envíos y rendimiento de tus campañas."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Send} label="Total enviados" value={Number(t.total_sent ?? 0).toLocaleString()} tone="green" />
        <StatCard icon={Eye} label="Aperturas" value={Number(t.total_opens ?? 0).toLocaleString()} tone="blue" />
        <StatCard icon={MousePointerClick} label="Clicks" value={Number(t.total_clicks ?? 0).toLocaleString()} tone="violet" />
        <StatCard icon={CheckCircle} label="Campañas completadas" value={t.completed_campaigns ?? 0} tone="green" />
      </div>

      <SectionCard title="Todas las campañas" description="Rendimiento detallado de cada envío." noPadding>
        {!data?.recent_campaigns?.length ? (
          <EmptyState
            icon={Megaphone}
            title="Sin campañas enviadas todavía"
            description="Cuando envíes campañas, aquí verás su rendimiento detallado."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-5 py-3 font-medium">Campaña</th>
                  <th className="px-5 py-3 font-medium">Canal</th>
                  <th className="px-5 py-3 font-medium">Estado</th>
                  <th className="px-5 py-3 font-medium">Progreso</th>
                  <th className="px-5 py-3 text-right font-medium">Aperturas</th>
                  <th className="px-5 py-3 text-right font-medium">Clicks</th>
                  <th className="px-5 py-3 text-right font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {(data?.recent_campaigns ?? []).map(c => {
                  const ch = CHANNEL_META[c.channel] ?? CHANNEL_META.email
                  const isEmail = !c.channel || c.channel === 'email'
                  const sent = Number(c.sent_count), total = Number(c.total_recipients ?? c.sent_count)
                  const pct = total > 0 ? Math.min(100, (sent / total) * 100) : 0
                  const openRate = sent > 0 ? ((Number(c.open_count) / sent) * 100).toFixed(1) : '0.0'
                  return (
                    <tr key={c.id} className="transition-colors hover:bg-muted/40">
                      <td className="px-5 py-3">
                        <Link href={`/dashboard/reports/${c.id}`} className="font-medium text-foreground hover:text-jungle-green-700">{c.name}</Link>
                        {c.list_name && <p className="mt-0.5 text-xs text-muted-foreground">{c.list_name}</p>}
                      </td>
                      <td className="px-5 py-3">
                        <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', ch.cls)}><ch.Icon size={12} strokeWidth={1.75} /> {ch.label}</span>
                      </td>
                      <td className="px-5 py-3">
                        <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', STATUS_COLOR[c.status] ?? 'bg-muted text-muted-foreground')}>{STATUS_LABEL[c.status] ?? c.status}</span>
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
                        {isEmail ? <>{Number(c.open_count).toLocaleString()} <span className="text-xs text-muted-foreground">({openRate}%)</span></> : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums">{isEmail ? Number(c.click_count).toLocaleString() : <span className="text-muted-foreground">—</span>}</td>
                      <td className="px-5 py-3 text-right">
                        <Button asChild variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
                          <Link href={`/dashboard/reports/${c.id}`}>Ver <ArrowRight className="h-4 w-4" /></Link>
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  )
}
