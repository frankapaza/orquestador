'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import api from '../../../lib/api'

const STATUS_LABEL = { draft: 'Borrador', sending: 'Enviando', completed: 'Completada', failed: 'Fallida', paused: 'Pausada', scheduled: 'Programada' }
const STATUS_COLOR = { draft: 'bg-gray-100 text-gray-700', sending: 'bg-blue-100 text-blue-700', completed: 'bg-green-100 text-green-700', failed: 'bg-red-100 text-red-700', paused: 'bg-yellow-100 text-yellow-700' }

export default function ReportsPage() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get('/reports/summary').then(r => setData(r.data)).finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="text-gray-500">Cargando...</div>

  const t = data?.totals ?? {}

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Reportes</h1>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total enviados', value: Number(t.total_sent ?? 0).toLocaleString() },
          { label: 'Aperturas', value: Number(t.total_opens ?? 0).toLocaleString() },
          { label: 'Clicks', value: Number(t.total_clicks ?? 0).toLocaleString() },
          { label: 'Campanas completadas', value: t.completed_campaigns ?? 0 },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl p-5 shadow-sm">
            <p className="text-xs text-gray-500 uppercase tracking-wide">{s.label}</p>
            <p className="text-3xl font-bold mt-1">{s.value}</p>
          </div>
        ))}
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-3">Todas las campanas</h2>
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Campana</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Estado</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">Enviados</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">Aperturas</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">Clicks</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">Detalle</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {(data?.recent_campaigns ?? []).map(c => {
                const openRate = c.sent_count > 0 ? ((c.open_count / c.sent_count) * 100).toFixed(1) : '0.0'
                return (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium">{c.name}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLOR[c.status] ?? ''}`}>
                        {STATUS_LABEL[c.status] ?? c.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">{Number(c.sent_count).toLocaleString()}</td>
                    <td className="px-4 py-3 text-right">{Number(c.open_count).toLocaleString()} <span className="text-gray-400 text-xs">({openRate}%)</span></td>
                    <td className="px-4 py-3 text-right">{Number(c.click_count).toLocaleString()}</td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`/dashboard/reports/${c.id}`} className="text-blue-600 hover:underline text-xs">Ver →</Link>
                    </td>
                  </tr>
                )
              })}
              {!data?.recent_campaigns?.length && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Sin campanas enviadas todavia</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
