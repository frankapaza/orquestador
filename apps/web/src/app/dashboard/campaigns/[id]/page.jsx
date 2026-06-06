'use client'
import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import api from '../../../../lib/api'
import { ArrowLeft, Send, Pause, Play, Download } from '../../../../components/ui/icons'

const STATUS_LABEL = { draft: 'Borrador', sending: 'Enviando', completed: 'Completada', failed: 'Fallida', paused: 'Pausada', scheduled: 'Programada' }
const STATUS_COLOR = {
  draft:     'bg-gray-100 text-gray-700',
  sending:   'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
  failed:    'bg-red-100 text-red-700',
  paused:    'bg-yellow-100 text-yellow-700',
  scheduled: 'bg-purple-100 text-purple-700',
}
const JOB_COLOR = {
  pending: 'bg-gray-100 text-gray-600',
  sent:    'bg-green-100 text-green-700',
  failed:  'bg-red-100 text-red-600',
  bounced: 'bg-orange-100 text-orange-700',
}

function StatCard({ label, value, color = 'text-gray-900' }) {
  return (
    <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
      <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
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

  // Auto-refresh cuando está enviando
  useEffect(() => {
    if (campaign?.status !== 'sending') return
    const interval = setInterval(() => { loadCampaign(); loadJobs() }, 5000)
    return () => clearInterval(interval)
  }, [campaign?.status, loadCampaign, loadJobs])

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

  if (loading) return <div className="text-gray-500">Cargando...</div>
  if (!campaign) return <div className="text-red-500">Campana no encontrada</div>

  const sent    = Number(campaign.sent_count)
  const failed  = Number(campaign.failed_count)
  const total_r = Number(campaign.total_recipients)
  const pending = total_r - sent - failed
  const openRate = sent > 0 ? ((Number(campaign.open_count) / sent) * 100).toFixed(1) + '%' : '—'
  const progress = total_r > 0 ? Math.round(((sent + failed) / total_r) * 100) : 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link href="/dashboard/campaigns" className="text-gray-400 hover:text-gray-600 text-sm flex items-center gap-1"><ArrowLeft size={14} /> Campañas</Link>
          <h1 className="text-2xl font-bold">{campaign.name}</h1>
          <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLOR[campaign.status] ?? ''}`}>
            {STATUS_LABEL[campaign.status] ?? campaign.status}
          </span>
        </div>
        <div className="flex gap-2">
          {['draft', 'scheduled'].includes(campaign.status) && (
            <button onClick={() => handleAction('send')} disabled={actionLoading}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5">
              <Send size={14} /> Enviar ahora
            </button>
          )}
          {campaign.status === 'sending' && (
            <button onClick={() => handleAction('pause')} disabled={actionLoading}
              className="px-4 py-2 text-sm bg-yellow-500 text-white rounded-lg font-medium hover:bg-yellow-600 disabled:opacity-50 flex items-center gap-1.5">
              <Pause size={14} /> Pausar
            </button>
          )}
          {campaign.status === 'paused' && (
            <button onClick={() => handleAction('resume')} disabled={actionLoading}
              className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 flex items-center gap-1.5">
              <Play size={14} /> Reanudar
            </button>
          )}
          <button onClick={exportCSV}
            className="px-4 py-2 text-sm border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 flex items-center gap-1.5">
            <Download size={14} /> Exportar CSV
          </button>
          <Link href={`/dashboard/reports/${id}`}
            className="px-4 py-2 text-sm border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50">
            Ver reporte
          </Link>
        </div>
      </div>

      {/* Info de la campana */}
      <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-100">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-3 text-sm">
          <div><span className="text-gray-500">Asunto:</span> <span className="font-medium ml-1">{campaign.subject}</span></div>
          <div><span className="text-gray-500">Remitente:</span> <span className="font-medium ml-1">{campaign.from_name}</span></div>
          <div><span className="text-gray-500">Lista:</span> <span className="font-medium ml-1">{campaign.list_name}</span></div>
          <div><span className="text-gray-500">Estrategia:</span> <span className="font-medium ml-1 capitalize">{campaign.strategy}</span></div>
          {campaign.scheduled_at && (
            <div><span className="text-gray-500">Programada:</span> <span className="font-medium ml-1">{new Date(campaign.scheduled_at).toLocaleString('es')}</span></div>
          )}
          {campaign.started_at && (
            <div><span className="text-gray-500">Iniciada:</span> <span className="font-medium ml-1">{new Date(campaign.started_at).toLocaleString('es')}</span></div>
          )}
          {campaign.completed_at && (
            <div><span className="text-gray-500">Completada:</span> <span className="font-medium ml-1">{new Date(campaign.completed_at).toLocaleString('es')}</span></div>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <StatCard label="Total destinatarios" value={total_r.toLocaleString()} />
        <StatCard label="Enviados" value={sent.toLocaleString()} color="text-green-700" />
        <StatCard label="Fallidos" value={failed.toLocaleString()} color={failed > 0 ? 'text-red-600' : 'text-gray-900'} />
        <StatCard label="Pendientes" value={Math.max(0, pending).toLocaleString()} color={pending > 0 ? 'text-blue-600' : 'text-gray-900'} />
        <StatCard label="Tasa apertura" value={openRate} />
      </div>

      {/* Barra de progreso */}
      {total_r > 0 && (
        <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
          <div className="flex justify-between text-xs text-gray-500 mb-2">
            <span>Progreso del envio</span>
            <span>{progress}% ({(sent + failed).toLocaleString()} / {total_r.toLocaleString()})</span>
          </div>
          <div className="h-3 bg-gray-100 rounded-full overflow-hidden flex">
            <div className="bg-green-500 h-full progress-bar" style={{ width: `${total_r > 0 ? (sent / total_r) * 100 : 0}%` }} />
            <div className="bg-red-400 h-full progress-bar" style={{ width: `${total_r > 0 ? (failed / total_r) * 100 : 0}%` }} />
          </div>
          <div className="flex gap-4 mt-2 text-xs text-gray-500">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" /> Enviados</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400 inline-block" /> Fallidos</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-200 inline-block" /> Pendientes</span>
          </div>
        </div>
      )}

      {/* Tabla de jobs */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <p className="font-semibold text-gray-800">
            Destinatarios <span className="text-gray-400 font-normal text-sm">({total.toLocaleString()} total)</span>
          </p>
          <div className="flex gap-2">
            {['', 'sent', 'pending', 'failed', 'bounced'].map(s => (
              <button key={s} onClick={() => { setStatusFilter(s); setPage(1) }}
                className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                  statusFilter === s
                    ? 'bg-gray-800 text-white border-gray-800'
                    : 'border-gray-200 text-gray-600 hover:border-gray-400'
                }`}>
                {s === '' ? 'Todos' : s === 'sent' ? 'Enviados' : s === 'pending' ? 'Pendientes' : s === 'failed' ? 'Fallidos' : 'Rebotados'}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Email</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Nombre</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Estado</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Enviado</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Error</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {jobs.map(job => (
                <tr key={job.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-mono text-xs text-gray-700">{job.recipient_email}</td>
                  <td className="px-4 py-2.5 text-gray-600">{[job.first_name, job.last_name].filter(Boolean).join(' ') || '—'}</td>
                  <td className="px-4 py-2.5">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${JOB_COLOR[job.status] ?? ''}`}>
                      {job.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-gray-400">
                    {job.sent_at ? new Date(job.sent_at).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-red-500 max-w-xs truncate" title={job.error_message ?? ''}>
                    {job.error_message ?? ''}
                  </td>
                </tr>
              ))}
              {jobs.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">Sin registros</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Paginacion */}
        {pages > 1 && (
          <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between text-sm text-gray-500">
            <span>Pagina {page} de {pages}</span>
            <div className="flex gap-2">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="px-3 py-1 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40">
                Anterior
              </button>
              <button onClick={() => setPage(p => Math.min(pages, p + 1))} disabled={page === pages}
                className="px-3 py-1 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40">
                Siguiente
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
