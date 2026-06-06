'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import api from '../../../lib/api'
import { Plus, Send, Pause, Play, RotateCcw } from '../../../components/ui/icons'

const STATUS_LABEL = {
  draft: 'Borrador', sending: 'Enviando', completed: 'Completada',
  failed: 'Fallida', paused: 'Pausada', scheduled: 'Programada',
}
const STATUS_COLOR = {
  draft:     'bg-gray-100 text-gray-700',
  sending:   'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
  failed:    'bg-red-100 text-red-700',
  paused:    'bg-yellow-100 text-yellow-700',
  scheduled: 'bg-purple-100 text-purple-700',
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
    // Verificar que el usuario no sea asesor
    api.get('/auth/me').then(r => {
      if (r.data.role === 'asesor') router.replace('/dashboard')
      else load().finally(() => setLoading(false))
    }).catch(() => load().finally(() => setLoading(false)))
  }, [])

  async function sendCampaign(id) {
    if (!confirm('Enviar esta campana ahora?')) return
    await api.post(`/campaigns/${id}/send`)
    load()
  }

  async function pauseCampaign(id) {
    await api.post(`/campaigns/${id}/pause`)
    load()
  }

  async function resumeCampaign(id) {
    await api.post(`/campaigns/${id}/resume`)
    load()
  }

  if (loading) return <div className="text-gray-500">Cargando...</div>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Campanas</h1>
        <Link href="/dashboard/campaigns/new"
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 flex items-center gap-1.5">
          <Plus size={14} /> Nueva campaña
        </Link>
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Nombre</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Estado</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Lista</th>
              <th className="px-4 py-3 text-right font-medium text-gray-600">Enviados</th>
              <th className="px-4 py-3 text-right font-medium text-gray-600">% Apertura</th>
              <th className="px-4 py-3 text-right font-medium text-gray-600">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {campaigns.map(c => {
              const openRate = Number(c.sent_count) > 0
                ? ((Number(c.open_count) / Number(c.sent_count)) * 100).toFixed(1)
                : '0.0'
              return (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">
                    <Link href={`/dashboard/campaigns/${c.id}`} className="hover:text-blue-600">
                      {c.name}
                    </Link>
                    {c.scheduled_at && c.status === 'scheduled' && (
                      <p className="text-xs text-purple-500 mt-0.5">
                        Programada: {new Date(c.scheduled_at).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' })}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLOR[c.status] ?? ''}`}>
                      {STATUS_LABEL[c.status] ?? c.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{c.list_name}</td>
                  <td className="px-4 py-3 text-right">
                    {Number(c.sent_count).toLocaleString()} / {Number(c.total_recipients).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right">{openRate}%</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {['draft', 'scheduled'].includes(c.status) && (
                        <button onClick={() => sendCampaign(c.id)}
                          className="text-blue-600 hover:underline text-xs font-medium flex items-center gap-1">
                          <Send size={11} /> Enviar
                        </button>
                      )}
                      {c.status === 'sending' && (
                        <button onClick={() => pauseCampaign(c.id)}
                          className="text-yellow-600 hover:underline text-xs font-medium flex items-center gap-1">
                          <Pause size={11} /> Pausar
                        </button>
                      )}
                      {c.status === 'paused' && (
                        <button onClick={() => resumeCampaign(c.id)}
                          className="text-green-600 hover:underline text-xs font-medium flex items-center gap-1">
                          <Play size={11} /> Reanudar
                        </button>
                      )}
                      <Link href={`/dashboard/campaigns/${c.id}`}
                        className="text-gray-500 hover:underline text-xs">
                        Detalle
                      </Link>
                      <Link href={`/dashboard/reports/${c.id}`}
                        className="text-gray-500 hover:underline text-xs">
                        Reporte
                      </Link>
                      <Link href={`/dashboard/campaigns/new?from=${c.id}`}
                        className="text-purple-600 hover:underline text-xs font-medium flex items-center gap-1">
                        <RotateCcw size={11} /> Reenviar
                      </Link>
                    </div>
                  </td>
                </tr>
              )
            })}
            {!campaigns.length && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-gray-400">
                  <p className="text-3xl mb-2">📭</p>
                  <p>Sin campanas. Crea una nueva.</p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
