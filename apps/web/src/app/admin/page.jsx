'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import api from '../../lib/api'

function StatBadge({ label, value, color = 'bg-blue-50 text-blue-700' }) {
  return (
    <div className={`rounded-xl p-4 ${color}`}>
      <p className="text-xs font-medium uppercase tracking-wide opacity-70">{label}</p>
      <p className="text-2xl font-bold mt-1">{typeof value === 'number' ? value.toLocaleString() : value}</p>
    </div>
  )
}

export default function AdminPage() {
  const [stats, setStats]     = useState(null)
  const [clients, setClients] = useState([])
  const [selected, setSelected] = useState(null)
  const [campaigns, setCampaigns] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')

  async function load() {
    try {
      const [statsRes, clientsRes] = await Promise.all([
        api.get('/admin/stats'),
        api.get('/admin/clients'),
      ])
      setStats(statsRes.data)
      setClients(clientsRes.data)
    } catch (err) {
      setError(err.response?.data?.error ?? 'Sin acceso. Solo administradores.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function toggleClient(id, is_active) {
    await api.patch(`/admin/clients/${id}`, { is_active })
    load()
  }

  async function viewCampaigns(client) {
    setSelected(client)
    const { data } = await api.get(`/admin/clients/${client.id}/campaigns`)
    setCampaigns(data)
  }

  if (loading) return <div className="min-h-screen bg-gray-50 flex items-center justify-center text-gray-500">Cargando...</div>

  if (error) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="bg-white rounded-xl p-8 shadow text-center max-w-sm">
        <p className="text-4xl mb-3">🔒</p>
        <p className="font-semibold text-gray-800">{error}</p>
        <Link href="/dashboard" className="mt-4 inline-block text-sm text-blue-600 hover:underline">Volver al dashboard</Link>
      </div>
    </div>
  )

  const STATUS_COLOR = { draft: 'bg-gray-100 text-gray-700', sending: 'bg-blue-100 text-blue-700', completed: 'bg-green-100 text-green-700', failed: 'bg-red-100 text-red-700', paused: 'bg-yellow-100 text-yellow-700', scheduled: 'bg-purple-100 text-purple-700' }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gray-900 text-white px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <span className="text-lg font-bold">Kubo Mail</span>
          <span className="text-xs bg-red-600 px-2 py-0.5 rounded font-medium">ADMIN</span>
        </div>
        <Link href="/dashboard" className="text-sm text-gray-400 hover:text-white">← Dashboard</Link>
      </div>

      <div className="max-w-6xl mx-auto p-6 space-y-6">
        <h1 className="text-2xl font-bold">Panel de administración</h1>

        {/* Stats globales */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatBadge label="Clientes"       value={stats.clients}     color="bg-blue-50 text-blue-700" />
            <StatBadge label="Campanas"       value={stats.campaigns}   color="bg-purple-50 text-purple-700" />
            <StatBadge label="Correos enviados" value={stats.emails_sent} color="bg-green-50 text-green-700" />
            <StatBadge label="Contactos"      value={stats.contacts}    color="bg-orange-50 text-orange-700" />
          </div>
        )}

        <div className="grid md:grid-cols-2 gap-6">
          {/* Lista de clientes */}
          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
              <p className="font-semibold text-gray-700">Clientes ({clients.filter(c => !c.is_admin).length})</p>
            </div>
            <div className="divide-y">
              {clients.filter(c => !c.is_admin).map(c => (
                <div key={c.id} className={`px-5 py-3 flex items-center justify-between gap-3 ${!c.is_active ? 'opacity-50' : ''}`}>
                  <div className="min-w-0">
                    <button onClick={() => viewCampaigns(c)}
                      className="font-medium text-sm text-gray-800 hover:text-blue-600 text-left truncate block max-w-[160px]">
                      {c.name}
                    </button>
                    <p className="text-xs text-gray-400 truncate">{c.email}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {Number(c.campaign_count)} campanas · {Number(c.total_sent).toLocaleString()} enviados · {Number(c.domain_count)} dominios
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${c.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {c.is_active ? 'Activo' : 'Inactivo'}
                    </span>
                    <button
                      onClick={() => toggleClient(c.id, !c.is_active)}
                      className="text-xs text-gray-400 hover:text-gray-700 border border-gray-200 rounded px-2 py-0.5 hover:bg-gray-50">
                      {c.is_active ? 'Desactivar' : 'Activar'}
                    </button>
                  </div>
                </div>
              ))}
              {clients.filter(c => !c.is_admin).length === 0 && (
                <p className="px-5 py-8 text-center text-gray-400 text-sm">Sin clientes registrados</p>
              )}
            </div>
          </div>

          {/* Campanas del cliente seleccionado */}
          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
              <p className="font-semibold text-gray-700">
                {selected ? `Campanas de ${selected.name}` : 'Campanas'}
              </p>
            </div>
            {!selected ? (
              <p className="px-5 py-8 text-center text-gray-400 text-sm">Selecciona un cliente para ver sus campanas</p>
            ) : campaigns.length === 0 ? (
              <p className="px-5 py-8 text-center text-gray-400 text-sm">Sin campanas</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Nombre</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Estado</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">Enviados</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {campaigns.map(c => (
                      <tr key={c.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2 font-medium text-xs">{c.name}</td>
                        <td className="px-4 py-2">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLOR[c.status] ?? ''}`}>
                            {c.status}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right text-xs text-gray-500">
                          {Number(c.sent_count).toLocaleString()} / {Number(c.total_recipients).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Instrucciones para hacer admin */}
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
          <p className="font-semibold mb-1">Para dar acceso de administrador a un usuario:</p>
          <code className="block bg-amber-100 rounded px-3 py-2 text-xs font-mono mt-1">
            UPDATE clients SET is_admin = true WHERE email = 'usuario@ejemplo.com';
          </code>
        </div>
      </div>
    </div>
  )
}
