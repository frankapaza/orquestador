'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import api from '../../../../lib/api'

function Stat({ label, value, sub }) {
  return (
    <div className="bg-white rounded-xl p-4 shadow-sm">
      <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  )
}

const STATUS_LABEL = { draft: 'Borrador', sending: 'Enviando', completed: 'Completada', failed: 'Fallida', paused: 'Pausada' }

export default function CampaignReportPage() {
  const { id } = useParams()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get(`/reports/campaigns/${id}`).then(r => setData(r.data)).finally(() => setLoading(false))
  }, [id])

  if (loading) return <div className="text-gray-500">Cargando reporte...</div>
  if (!data) return <div className="text-red-500">Campana no encontrada</div>

  const { campaign, rates, delivery_breakdown, top_links } = data
  const sent = Number(campaign.sent_count)
  const opens = Number(campaign.open_count)
  const clicks = Number(campaign.click_count)
  const bounces = Number(campaign.bounce_count)

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/dashboard/campaigns" className="text-gray-400 hover:text-gray-600 text-sm">← Campanas</Link>
        <h1 className="text-2xl font-bold">{campaign.name}</h1>
        <span className="text-sm text-gray-500">{STATUS_LABEL[campaign.status]}</span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="Enviados" value={sent.toLocaleString()} sub={`de ${Number(campaign.total_recipients).toLocaleString()}`} />
        <Stat label="Aperturas" value={opens.toLocaleString()} sub={rates.open_rate} />
        <Stat label="Clicks" value={clicks.toLocaleString()} sub={`CTOR: ${rates.click_to_open_rate}`} />
        <Stat label="Rebotes" value={bounces.toLocaleString()} />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl shadow-sm p-5">
          <h2 className="font-semibold mb-3">Estado de entregas</h2>
          <div className="space-y-2">
            {delivery_breakdown.map(d => (
              <div key={d.status} className="flex justify-between text-sm">
                <span className="text-gray-600 capitalize">{d.status}</span>
                <span className="font-medium">{Number(d.count).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-5">
          <h2 className="font-semibold mb-3">Links mas clickeados</h2>
          <div className="space-y-2">
            {top_links.map((l, i) => (
              <div key={i} className="flex justify-between text-sm">
                <span className="text-blue-600 truncate max-w-[200px]" title={l.url}>{l.url}</span>
                <span className="font-medium ml-2">{l.clicks}</span>
              </div>
            ))}
            {!top_links.length && <p className="text-gray-400 text-sm">Sin clicks registrados</p>}
          </div>
        </div>
      </div>
    </div>
  )
}
