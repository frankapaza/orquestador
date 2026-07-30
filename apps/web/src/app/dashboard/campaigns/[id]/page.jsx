'use client'
import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import api from '../../../../lib/api'
import { ArrowLeft, Send, Pause, Play, Download, Megaphone, Users, CheckCircle, XCircle, Clock, Eye, Inbox, Loader2 } from '../../../../components/ui/icons'
import { PageHeader } from '@/components/ui/PageHeader'
import { StatCard } from '@/components/ui/stat-card'
import { SectionCard } from '@/components/ui/section-card'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'

const STATUS_LABEL = { draft: 'Borrador', sending: 'Enviando', completed: 'Completada', failed: 'Fallida', paused: 'Pausada', scheduled: 'Programada' }
const STATUS_COLOR = {
  draft:     'bg-muted text-muted-foreground',
  sending:   'bg-blue-100 text-blue-700',
  completed: 'bg-jungle-green-100 text-jungle-green-700',
  failed:    'bg-red-100 text-red-700',
  paused:    'bg-amber-100 text-amber-700',
  scheduled: 'bg-violet-100 text-violet-700',
}
const JOB_COLOR = {
  pending: 'bg-muted text-muted-foreground',
  sent:    'bg-jungle-green-100 text-jungle-green-700',
  failed:  'bg-red-100 text-red-700',
  bounced: 'bg-amber-100 text-amber-700',
  invalid: 'bg-orange-100 text-orange-700',
}

// Tarjeta de progreso. Para "teléfonos" se pasa sent/failed y la barra se segmenta
// (verde enviados + rojo fallidos); para "contactos" solo done/total (una barra).
function ProgressCard({ icon: Icon, title, subtitle, done, total, sent, failed, live }) {
  const pct       = total > 0 ? Math.round((done / total) * 100) : 0
  const sentPct   = total > 0 ? ((sent ?? done) / total) * 100 : 0
  const failedPct = total > 0 && failed ? (failed / total) * 100 : 0
  const segmented = sent != null
  return (
    <div className="rounded-2xl border bg-card p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-jungle-green-50 text-jungle-green-600"><Icon size={18} strokeWidth={1.75} /></span>
          <div>
            <div className="flex items-center gap-1.5">
              <h3 className="text-sm font-semibold text-foreground">{title}</h3>
              {live && (
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-500 opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-blue-500" />
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{subtitle}</p>
          </div>
        </div>
        <span className="shrink-0 text-3xl font-bold tabular-nums text-foreground">{pct}%</span>
      </div>
      <div className="mt-4 flex h-2.5 overflow-hidden rounded-full bg-muted">
        {segmented ? (
          <>
            <div className="h-full bg-jungle-green-500 transition-all duration-500 ease-out" style={{ width: `${sentPct}%` }} />
            <div className="h-full bg-red-400 transition-all duration-500 ease-out" style={{ width: `${failedPct}%` }} />
          </>
        ) : (
          <div className="h-full bg-jungle-green-500 transition-all duration-500 ease-out" style={{ width: `${pct}%` }} />
        )}
      </div>
      <div className="mt-2 flex items-center justify-between text-xs">
        <span className="tabular-nums font-medium text-foreground">{Number(done).toLocaleString()} / {Number(total).toLocaleString()}</span>
        {segmented && failed > 0 && <span className="font-medium text-red-600">{failed} fallidos</span>}
      </div>
    </div>
  )
}

export default function CampaignDetailPage() {
  const { id } = useParams()
  const router = useRouter()
  const [campaign, setCampaign] = useState(null)
  const [jobs, setJobs] = useState([])
  const [total, setTotal] = useState(0)
  const [pages, setPages] = useState(1)
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)

  const loadCampaign = useCallback(async () => {
    const { data } = await api.get(`/campaigns/${id}`)
    setCampaign(data)
  }, [id])

  const loadJobs = useCallback(async () => {
    const params = new URLSearchParams({ page })
    if (statusFilter) params.set('status', statusFilter)
    const { data } = await api.get(`/campaigns/${id}/jobs?${params}`)
    setJobs(data.jobs)
    setTotal(data.total)
    setPages(data.pages)
  }, [id, page, statusFilter])

  useEffect(() => {
    Promise.all([loadCampaign(), loadJobs()]).finally(() => setLoading(false))
  }, [loadCampaign, loadJobs])

  // Progreso en tiempo real por SSE (el servidor empuja; mismo stream del Inbox).
  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('kubo_token') : null
    if (!token) return
    const base = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1').replace(/\/$/, '')
    const es = new EventSource(`${base}/events?token=${encodeURIComponent(token)}`)
    es.addEventListener('campaign:progress', (e) => {
      try {
        const d = JSON.parse(e.data)
        if (d.campaign_id !== id) return
        setCampaign(prev => prev ? {
          ...prev,
          sent_count:       d.sent_count,
          failed_count:     d.failed_count,
          total_recipients: d.total_recipients || prev.total_recipients,
          status:           d.status ?? prev.status,
          total_contacts:   d.total_contacts ?? prev.total_contacts,
          done_contacts:    d.done_contacts ?? prev.done_contacts,
        } : prev)
      } catch { /* no-op */ }
    })
    return () => es.close()
  }, [id])

  // La tabla de destinatarios se refresca cada 5s mientras envía (el progreso ya
  // va en vivo por SSE arriba).
  useEffect(() => {
    if (campaign?.status !== 'sending') return
    const interval = setInterval(() => { loadJobs() }, 5000)
    return () => clearInterval(interval)
  }, [campaign?.status, loadJobs])

  async function handleAction(action) {
    setActionLoading(true)
    try {
      if (action === 'send')   await api.post(`/campaigns/${id}/send`)
      if (action === 'pause')  await api.post(`/campaigns/${id}/pause`)
      if (action === 'resume') await api.post(`/campaigns/${id}/resume`)
      await loadCampaign()
      await loadJobs()
    } finally {
      setActionLoading(false)
    }
  }

  async function exportCSV() {
    const token = localStorage.getItem('kubo_token')
    const base  = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1'
    const res   = await fetch(`${base}/campaigns/${id}/export`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const blob = await res.blob()
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `campana-${id}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (loading) return (
    <div className="flex items-center justify-center py-24 text-sm text-muted-foreground">
      <Loader2 className="mr-2 h-5 w-5 animate-spin text-jungle-green-600" /> Cargando...
    </div>
  )
  if (!campaign) return (
    <div className="mx-auto max-w-7xl">
      <EmptyState
        icon={Megaphone}
        title="Campaña no encontrada"
        description="No pudimos cargar la información de esta campaña."
        action={<Button variant="outline" asChild><Link href="/dashboard/campaigns"><ArrowLeft size={16} /> Volver a campañas</Link></Button>}
      />
    </div>
  )

  const sent    = Number(campaign.sent_count)
  const failed  = Number(campaign.failed_count)
  const total_r = Number(campaign.total_recipients)
  const pending = total_r - sent - failed
  const openRate = sent > 0 ? ((Number(campaign.open_count) / sent) * 100).toFixed(1) + '%' : '-'
  const totalContacts = Number(campaign.total_contacts ?? 0)
  const doneContacts  = Number(campaign.done_contacts ?? 0)
  const live = campaign.status === 'sending'
  const destLabel = campaign.channel === 'email' ? 'Correos' : 'Teléfonos'

  const FILTERS = [
    { value: '', label: 'Todos' },
    { value: 'sent', label: 'Enviados' },
    { value: 'pending', label: 'Pendientes' },
    { value: 'failed', label: 'Fallidos' },
    { value: 'invalid', label: 'Sin WhatsApp' },
    { value: 'bounced', label: 'Rebotados' },
    { value: 'undelivered', label: 'No entregado' },
  ]

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* Migas y encabezado */}
      <div>
        <Link href="/dashboard/campaigns" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft size={16} /> Campañas
        </Link>
        <PageHeader
          icon={Megaphone}
          title={campaign.name}
          description={
            <span className="inline-flex items-center gap-2">
              <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[campaign.status] ?? 'bg-muted text-muted-foreground'}`}>
                {STATUS_LABEL[campaign.status] ?? campaign.status}
              </span>
            </span>
          }
          action={
            <div className="flex flex-wrap gap-2">
              {['draft', 'scheduled'].includes(campaign.status) && (
                <Button onClick={() => handleAction('send')} disabled={actionLoading}>
                  <Send size={16} /> Enviar ahora
                </Button>
              )}
              {campaign.status === 'sending' && (
                <Button onClick={() => handleAction('pause')} disabled={actionLoading} className="bg-amber-500 text-white hover:bg-amber-600">
                  <Pause size={16} /> Pausar
                </Button>
              )}
              {campaign.status === 'paused' && (
                <Button onClick={() => handleAction('resume')} disabled={actionLoading}>
                  <Play size={16} /> Reanudar
                </Button>
              )}
              <Button variant="outline" onClick={exportCSV}>
                <Download size={16} /> Exportar CSV
              </Button>
              <Button variant="outline" asChild>
                <Link href={`/dashboard/reports/${id}`}>Ver reporte</Link>
              </Button>
              {campaign.channel === 'whatsapp' && campaign.assistant_id && (
                <Button variant="outline" disabled={actionLoading} onClick={async () => {
                  setActionLoading(true)
                  try {
                    const { data } = await api.post(`/campaigns/${id}/sms-followup`)
                    const { list_id, wame_number } = data
                    router.push(`/dashboard/campaigns/new?channel=sms&list_id=${list_id}&wame=${wame_number ?? ''}`)
                  } catch (e) {
                    alert(e?.response?.data?.error ?? 'No se pudo generar el seguimiento SMS')
                  } finally {
                    setActionLoading(false)
                  }
                }}>
                  Generar SMS de seguimiento
                </Button>
              )}
            </div>
          }
        />
      </div>

      {/* Info de la campaña */}
      <SectionCard title="Detalles">
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm md:grid-cols-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Asunto</p>
            <p className="mt-0.5 font-medium text-foreground">{campaign.subject}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Remitente</p>
            <p className="mt-0.5 font-medium text-foreground">{campaign.from_name}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Lista</p>
            <p className="mt-0.5 font-medium text-foreground">{campaign.list_name}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Estrategia</p>
            <p className="mt-0.5 font-medium capitalize text-foreground">{campaign.strategy}</p>
          </div>
          {campaign.scheduled_at && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Programada</p>
              <p className="mt-0.5 font-medium text-foreground">{new Date(campaign.scheduled_at).toLocaleString('es')}</p>
            </div>
          )}
          {campaign.started_at && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Iniciada</p>
              <p className="mt-0.5 font-medium text-foreground">{new Date(campaign.started_at).toLocaleString('es')}</p>
            </div>
          )}
          {campaign.completed_at && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Completada</p>
              <p className="mt-0.5 font-medium text-foreground">{new Date(campaign.completed_at).toLocaleString('es')}</p>
            </div>
          )}
        </div>
      </SectionCard>

      {/* Progreso — dos métricas: por CONTACTOS y por DESTINOS (teléfonos/correos) */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ProgressCard
          icon={Users}
          title="Contactos"
          subtitle="Un contacto se completa cuando TODOS sus destinos fueron enviados"
          done={doneContacts} total={totalContacts} live={live}
        />
        <ProgressCard
          icon={Send}
          title={`${destLabel} (destinos)`}
          subtitle={`Cada ${campaign.channel === 'email' ? 'correo' : 'teléfono'} del contacto es un envío`}
          done={sent + failed} total={total_r} sent={sent} failed={failed} live={live}
        />
      </div>

      {/* Resumen de métricas */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <StatCard icon={Users} label="Contactos" value={`${doneContacts}/${totalContacts}`} tone="slate" />
        <StatCard icon={Send} label={`${destLabel} enviados`} value={`${sent + failed}/${total_r}`} tone="blue" />
        <StatCard icon={CheckCircle} label="Enviados" value={sent.toLocaleString()} tone="green" />
        <StatCard icon={XCircle} label="Fallidos" value={failed.toLocaleString()} tone={failed > 0 ? 'rose' : 'slate'} />
        <StatCard icon={Clock} label="Pendientes" value={Math.max(0, pending).toLocaleString()} tone={pending > 0 ? 'blue' : 'slate'} />
      </div>

      {/* Tabla de destinatarios */}
      <SectionCard
        noPadding
        title="Destinatarios"
        description={`${total.toLocaleString()} en total`}
        action={
          <div className="flex flex-wrap gap-2">
            {FILTERS.map(({ value, label }) => (
              <button
                key={value}
                onClick={() => { setStatusFilter(value); setPage(1) }}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  statusFilter === value
                    ? 'border-jungle-green-600 bg-jungle-green-600 text-white'
                    : 'border-border text-muted-foreground hover:bg-muted/60'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-5 py-3 font-medium">{campaign.channel === 'email' ? 'Email' : 'Teléfono'}</th>
                <th className="px-5 py-3 font-medium">Nombre</th>
                <th className="px-5 py-3 font-medium">Estado</th>
                <th className="px-5 py-3 font-medium">Enviado</th>
                <th className="px-5 py-3 font-medium">Error</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {jobs.map(job => (
                <tr key={job.id} className="transition-colors hover:bg-muted/40">
                  <td className="px-5 py-3 font-mono text-xs text-foreground">{job.recipient_email || job.phone_number || '—'}</td>
                  <td className="px-5 py-3 text-muted-foreground">{[job.first_name, job.last_name].filter(Boolean).join(' ') || '-'}</td>
                  <td className="px-5 py-3">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${JOB_COLOR[job.status] ?? 'bg-muted text-muted-foreground'}`}>
                      {job.status === 'invalid' ? 'Sin WhatsApp' : job.status}
                    </span>
                    {job.delivery_status && (
                      <span className="ml-2 text-xs text-muted-foreground" title={`Entrega: ${job.delivery_status}`}>
                        {job.delivery_status === 'read' ? '✓✓ leído'
                          : job.delivery_status === 'delivered' ? '✓✓ entregado'
                          : '✓ enviado'}
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">
                    {job.sent_at ? new Date(job.sent_at).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' }) : '-'}
                  </td>
                  <td className="max-w-xs truncate px-5 py-3 text-xs text-red-600" title={job.error_message ?? ''}>
                    {job.error_message ?? ''}
                  </td>
                </tr>
              ))}
              {jobs.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-0">
                    <EmptyState icon={Inbox} title="Sin registros" description="No hay destinatarios que coincidan con este filtro." />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Paginación */}
        {pages > 1 && (
          <div className="flex items-center justify-between border-t px-5 py-3 text-sm text-muted-foreground">
            <span>Página {page} de {pages}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
                Anterior
              </Button>
              <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(pages, p + 1))} disabled={page === pages}>
                Siguiente
              </Button>
            </div>
          </div>
        )}
      </SectionCard>
    </div>
  )
}
