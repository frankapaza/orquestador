'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import api from '../../lib/api'
import { PageHeader } from '@/components/ui/PageHeader'
import { StatCard } from '@/components/ui/stat-card'
import { SectionCard } from '@/components/ui/section-card'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import {
  Shield, Users, Megaphone, Send, User, Mail, ArrowLeft, Loader2, Lock, Info,
} from '@/components/ui/icons'

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

  if (loading) return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin text-jungle-green-600" />
        Cargando...
      </div>
    </div>
  )

  if (error) return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm rounded-xl border bg-card p-8 text-center shadow-sm">
        <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-600">
          <Lock size={22} strokeWidth={1.75} />
        </span>
        <p className="font-semibold text-foreground">{error}</p>
        <Button asChild variant="outline" size="sm" className="mt-5">
          <Link href="/dashboard">
            <ArrowLeft size={16} strokeWidth={2} />
            Volver al dashboard
          </Link>
        </Button>
      </div>
    </div>
  )

  const STATUS_COLOR = {
    draft: 'bg-muted text-muted-foreground',
    sending: 'bg-blue-100 text-blue-700',
    completed: 'bg-jungle-green-100 text-jungle-green-700',
    failed: 'bg-red-100 text-red-700',
    paused: 'bg-amber-100 text-amber-700',
    scheduled: 'bg-violet-100 text-violet-700',
  }

  const visibleClients = clients.filter(c => !c.is_admin)

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-7xl space-y-6 p-6">
        <PageHeader
          icon={Shield}
          title="Panel de administración"
          description="Gestiona clientes y supervisa la actividad global del orquestador."
          action={
            <Button asChild variant="outline" size="sm">
              <Link href="/dashboard">
                <ArrowLeft size={16} strokeWidth={2} />
                Dashboard
              </Link>
            </Button>
          }
        />

        {/* Stats globales */}
        {stats && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard icon={Users}    label="Clientes"        value={Number(stats.clients).toLocaleString()}     tone="green" />
            <StatCard icon={Megaphone} label="Campañas"        value={Number(stats.campaigns).toLocaleString()}   tone="violet" />
            <StatCard icon={Send}     label="Correos enviados" value={Number(stats.emails_sent).toLocaleString()} tone="blue" />
            <StatCard icon={User}     label="Contactos"        value={Number(stats.contacts).toLocaleString()}    tone="amber" />
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Lista de clientes */}
          <SectionCard title="Clientes" description={`${visibleClients.length} registrados`} noPadding>
            {visibleClients.length === 0 ? (
              <EmptyState
                icon={Users}
                title="Sin clientes registrados"
                description="Todavía no hay clientes en la plataforma."
              />
            ) : (
              <div className="divide-y">
                {visibleClients.map(c => (
                  <div key={c.id} className={`flex items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-muted/40 ${!c.is_active ? 'opacity-60' : ''}`}>
                    <div className="min-w-0">
                      <button
                        onClick={() => viewCampaigns(c)}
                        className="block max-w-[180px] truncate text-left text-sm font-medium text-foreground hover:text-jungle-green-700">
                        {c.name}
                      </button>
                      <p className="truncate text-xs text-muted-foreground">{c.email}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {Number(c.campaign_count)} campañas, {Number(c.total_sent).toLocaleString()} enviados, {Number(c.domain_count)} dominios
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${c.is_active ? 'bg-jungle-green-100 text-jungle-green-700' : 'bg-muted text-muted-foreground'}`}>
                        {c.is_active ? 'Activo' : 'Inactivo'}
                      </span>
                      <Button
                        variant={c.is_active ? 'outline' : 'default'}
                        size="sm"
                        onClick={() => toggleClient(c.id, !c.is_active)}>
                        {c.is_active ? 'Desactivar' : 'Activar'}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          {/* Campañas del cliente seleccionado */}
          <SectionCard
            title={selected ? `Campañas de ${selected.name}` : 'Campañas'}
            description={selected ? 'Detalle de envíos del cliente.' : undefined}
            noPadding>
            {!selected ? (
              <EmptyState
                icon={Megaphone}
                title="Selecciona un cliente"
                description="Elige un cliente de la lista para ver sus campañas."
              />
            ) : campaigns.length === 0 ? (
              <EmptyState
                icon={Mail}
                title="Sin campañas"
                description="Este cliente todavía no tiene campañas."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-5 py-3 font-medium">Nombre</th>
                      <th className="px-5 py-3 font-medium">Estado</th>
                      <th className="px-5 py-3 text-right font-medium">Enviados</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {campaigns.map(c => (
                      <tr key={c.id} className="transition-colors hover:bg-muted/40">
                        <td className="px-5 py-3 font-medium text-foreground">{c.name}</td>
                        <td className="px-5 py-3">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[c.status] ?? 'bg-muted text-muted-foreground'}`}>
                            {c.status}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">
                          {Number(c.sent_count).toLocaleString()} / {Number(c.total_recipients).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </div>

        {/* Instrucciones para hacer admin */}
        <SectionCard>
          <div className="flex gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
              <Info size={18} strokeWidth={2} />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">Para dar acceso de administrador a un usuario</p>
              <p className="mt-0.5 text-sm text-muted-foreground">Ejecuta esta consulta en la base de datos.</p>
              <code className="mt-3 block overflow-x-auto rounded-lg bg-muted px-3 py-2 font-mono text-xs text-foreground">
                UPDATE clients SET is_admin = true WHERE email = 'usuario@ejemplo.com';
              </code>
            </div>
          </div>
        </SectionCard>
      </div>
    </div>
  )
}
