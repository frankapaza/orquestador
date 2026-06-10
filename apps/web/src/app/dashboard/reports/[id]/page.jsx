'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import api from '../../../../lib/api'
import { PageHeader } from '@/components/ui/PageHeader'
import { StatCard } from '@/components/ui/stat-card'
import { SectionCard } from '@/components/ui/section-card'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import {
  BarChart3, Send, Eye, MousePointerClick, AlertTriangle,
  ArrowLeft, Loader2, Link2, ExternalLink,
} from 'lucide-react'

const STATUS_LABEL = { draft: 'Borrador', sending: 'Enviando', completed: 'Completada', failed: 'Fallida', paused: 'Pausada' }

function StatusBadge({ status }) {
  const map = {
    completed: 'bg-jungle-green-100 text-jungle-green-700',
    sending: 'bg-blue-100 text-blue-700',
    failed: 'bg-red-100 text-red-700',
    paused: 'bg-amber-100 text-amber-700',
    draft: 'bg-muted text-muted-foreground',
  }
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${map[status] ?? 'bg-muted text-muted-foreground'}`}>
      {STATUS_LABEL[status] ?? status}
    </span>
  )
}

// Punto de color semántico segun el estado de entrega.
function DeliveryDot({ status }) {
  const s = String(status ?? '').toLowerCase()
  const tone =
    s.includes('deliver') || s.includes('entreg') ? 'bg-jungle-green-500' :
    s.includes('open') || s.includes('abier') ? 'bg-blue-500' :
    s.includes('click') ? 'bg-violet-500' :
    s.includes('bounce') || s.includes('rebot') || s.includes('fail') || s.includes('fall') ? 'bg-red-500' :
    s.includes('send') || s.includes('envi') || s.includes('queue') || s.includes('cola') ? 'bg-amber-500' :
    'bg-muted-foreground/40'
  return <span className={`h-2 w-2 shrink-0 rounded-full ${tone}`} />
}

export default function CampaignReportPage() {
  const { id } = useParams()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get(`/reports/campaigns/${id}`).then(r => setData(r.data)).finally(() => setLoading(false))
  }, [id])

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin text-jungle-green-600" />
        Cargando reporte...
      </div>
    )
  }
  if (!data) {
    return (
      <div className="mx-auto max-w-7xl py-24">
        <EmptyState
          icon={AlertTriangle}
          title="Campaña no encontrada"
          description="No pudimos cargar el reporte de esta campaña."
          action={
            <Button asChild variant="outline">
              <Link href="/dashboard/campaigns">Volver a campañas</Link>
            </Button>
          }
        />
      </div>
    )
  }

  const { campaign, rates, delivery_breakdown, top_links } = data
  const sent = Number(campaign.sent_count)
  const opens = Number(campaign.open_count)
  const clicks = Number(campaign.click_count)
  const bounces = Number(campaign.bounce_count)

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        icon={BarChart3}
        title={campaign.name}
        description={<StatusBadge status={campaign.status} />}
        action={
          <Button asChild variant="outline" size="sm">
            <Link href="/dashboard/campaigns">
              <ArrowLeft size={16} strokeWidth={2} className="mr-1.5" />
              Campañas
            </Link>
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={Send}
          label="Enviados"
          value={sent.toLocaleString()}
          sub={`de ${Number(campaign.total_recipients).toLocaleString()}`}
          tone="green"
        />
        <StatCard
          icon={Eye}
          label="Aperturas"
          value={opens.toLocaleString()}
          sub={rates.open_rate}
          tone="blue"
        />
        <StatCard
          icon={MousePointerClick}
          label="Clicks"
          value={clicks.toLocaleString()}
          sub={`CTOR: ${rates.click_to_open_rate}`}
          tone="violet"
        />
        <StatCard
          icon={AlertTriangle}
          label="Rebotes"
          value={bounces.toLocaleString()}
          tone="amber"
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <SectionCard title="Estado de entregas" description="Distribución por estado de envío" noPadding>
          {delivery_breakdown.length ? (
            <div className="divide-y">
              {delivery_breakdown.map(d => (
                <div key={d.status} className="flex items-center justify-between gap-3 px-5 py-3 text-sm transition-colors hover:bg-muted/40">
                  <span className="flex min-w-0 items-center gap-2.5">
                    <DeliveryDot status={d.status} />
                    <span className="truncate capitalize text-muted-foreground">{d.status}</span>
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums text-foreground">{Number(d.count).toLocaleString()}</span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={Send}
              title="Sin entregas registradas"
              description="Aún no hay datos de entrega para esta campaña."
            />
          )}
        </SectionCard>

        <SectionCard title="Links más clickeados" description="Ordenados por número de clicks" noPadding>
          {top_links.length ? (
            <div className="divide-y">
              {top_links.map((l, i) => (
                <div key={i} className="flex items-center justify-between gap-3 px-5 py-3 text-sm transition-colors hover:bg-muted/40">
                  <span className="flex min-w-0 items-center gap-2.5">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-jungle-green-50 text-xs font-semibold tabular-nums text-jungle-green-700">
                      {i + 1}
                    </span>
                    <a
                      href={l.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={l.url}
                      className="group flex min-w-0 items-center gap-1.5 text-jungle-green-700 hover:underline"
                    >
                      <Link2 size={16} strokeWidth={2} className="shrink-0 text-muted-foreground" />
                      <span className="truncate">{l.url}</span>
                      <ExternalLink size={14} strokeWidth={2} className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                    </a>
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums text-foreground">{l.clicks}</span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={MousePointerClick}
              title="Sin clicks registrados"
              description="Todavía no se han registrado clicks en esta campaña."
            />
          )}
        </SectionCard>
      </div>
    </div>
  )
}
