'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import api from '../../lib/api'
import {
  Mail, MessageCircle, Smartphone, Send, Megaphone,
  TrendingDown, FolderOpen, CheckCircle, PhoneCall,
  Loader2, ChevronRight,
} from '../../components/ui/icons'

const STATUS_LABEL = { draft:'Borrador', sending:'Enviando', completed:'Completada', failed:'Fallida', paused:'Pausada', scheduled:'Programada' }
const STATUS_COLOR = { draft:'bg-gray-100 text-gray-600', sending:'bg-blue-100 text-blue-700', completed:'bg-green-100 text-green-700', failed:'bg-red-100 text-red-700', paused:'bg-yellow-100 text-yellow-700', scheduled:'bg-purple-100 text-purple-700' }

const CHANNEL_ICON = {
  whatsapp: <MessageCircle size={13} className="inline-block mr-1" />,
  sms:      <Smartphone    size={13} className="inline-block mr-1" />,
  email:    <Mail          size={13} className="inline-block mr-1" />,
}

function MetricCard({ Icon, label, value, sub, color = 'blue', href }) {
  const colors = {
    blue:   'bg-blue-50   border-blue-200   text-blue-700',
    green:  'bg-green-50  border-green-200  text-green-700',
    purple: 'bg-purple-50 border-purple-200 text-purple-700',
    orange: 'bg-orange-50 border-orange-200 text-orange-700',
    gray:   'bg-gray-50   border-gray-200   text-gray-600',
  }
  const Wrapper = href ? Link : 'div'
  return (
    <Wrapper href={href ?? '#'} className={`rounded-2xl border p-5 ${colors[color]} ${href ? 'metric-card-hover cursor-pointer' : ''}`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium opacity-70 mb-1">{label}</p>
          <p className="text-3xl font-bold">{value ?? '0'}</p>
          {sub && <p className="text-xs opacity-60 mt-1">{sub}</p>}
        </div>
        {Icon && <Icon size={22} strokeWidth={1.5} className="opacity-60 flex-shrink-0" />}
      </div>
    </Wrapper>
  )
}

function MiniBar({ days, channel, color }) {
  const filtered = days.filter(d => d.channel === channel)
  if (!filtered.length) return <p className="text-xs text-gray-400 py-4 text-center">Sin datos</p>
  const max = Math.max(...filtered.map(d => parseInt(d.count)), 1)
  return (
    <div className="flex items-end gap-1 h-16">
      {filtered.map((d, i) => (
        <div key={i} className="flex-1 flex flex-col items-center gap-1">
          <div className={`w-full rounded-t ${color}`}
            style={{ height: `${Math.max((parseInt(d.count) / max) * 52, 3)}px` }}
            title={`${d.day}: ${d.count}`} />
          <span className="text-gray-400 leading-none" style={{ fontSize: '9px' }}>
            {new Date(d.day).toLocaleDateString('es', { day: '2-digit', month: '2-digit' })}
          </span>
        </div>
      ))}
    </div>
  )
}

function ChannelStatus({ channels }) {
  const items = [
    { label: 'WhatsApp conectados', value: channels?.wa_connected ?? 0, Icon: PhoneCall,    ok: parseInt(channels?.wa_connected) > 0 },
    { label: 'SMS gateways online',  value: channels?.sms_online   ?? 0, Icon: Smartphone,   ok: parseInt(channels?.sms_online)   > 0 },
    { label: 'Cuentas email activas', value: channels?.email_active ?? 0, Icon: Mail,         ok: parseInt(channels?.email_active)  > 0 },
  ]
  return (
    <div className="grid grid-cols-3 gap-3">
      {items.map(c => (
        <div key={c.label} className={`rounded-xl border p-3 text-center ${c.ok ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-gray-50'}`}>
          <c.Icon size={20} strokeWidth={1.5} className={`mx-auto mb-1 ${c.ok ? 'text-green-600' : 'text-gray-400'}`} />
          <p className={`text-xl font-bold ${c.ok ? 'text-green-700' : 'text-gray-400'}`}>{c.value}</p>
          <p className="text-xs text-gray-500 mt-0.5">{c.label}</p>
        </div>
      ))}
    </div>
  )
}

export default function DashboardPage() {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get('/reports/summary').then(r => setData(r.data)).finally(() => setLoading(false))
  }, [])

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 size={32} className="animate-spin text-blue-600" />
    </div>
  )

  const isAdvisor = data?.is_advisor ?? false
  const email = data?.email         ?? {}
  const msgs  = data?.messages      ?? {}
  const convs = data?.conversations ?? {}
  const days  = data?.msg_by_day    ?? []

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          {isAdvisor ? 'Mi actividad' : 'Resumen'}
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {isAdvisor ? 'Actividad de tus canales asignados' : 'Vista general de todos los canales de comunicación'}
        </p>
      </div>

      {/* Métricas principales */}
      <div className={`grid gap-4 ${isAdvisor ? 'grid-cols-2 lg:grid-cols-3' : 'grid-cols-2 lg:grid-cols-4'}`}>
        {!isAdvisor && (
          <MetricCard Icon={Mail}          label="Emails enviados"    value={Number(email.total_sent  ?? 0).toLocaleString()} sub={`${Number(email.total_opens ?? 0).toLocaleString()} aperturas`} color="blue"   href="/dashboard/campaigns" />
        )}
        <MetricCard   Icon={MessageCircle} label="WhatsApp enviados"  value={Number(msgs.wa_sent      ?? 0).toLocaleString()} sub={`${Number(msgs.total_received ?? 0).toLocaleString()} recibidos`} color="green"  href="/dashboard/inbox" />
        <MetricCard   Icon={Smartphone}    label="SMS enviados"       value={Number(msgs.sms_sent     ?? 0).toLocaleString()} sub={`${Number(msgs.total_received ?? 0).toLocaleString()} recibidos`} color="orange" href="/dashboard/inbox" />
        <MetricCard   Icon={FolderOpen}    label="Conversaciones"     value={Number(convs.total       ?? 0).toLocaleString()} sub={`${Number(convs.unread ?? 0)} sin leer`}                          color="purple" href="/dashboard/inbox" />
      </div>

      {/* Segunda fila */}
      {!isAdvisor && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard Icon={Megaphone}      label="Campañas completadas"   value={email.completed_campaigns ?? 0} color="blue" />
          <MetricCard Icon={TrendingDown}   label="Tasa de rebote"          value={email.total_sent > 0 ? ((email.total_bounces / email.total_sent) * 100).toFixed(1) + '%' : '0%'} color="gray" />
          <MetricCard Icon={FolderOpen}     label="Conversaciones abiertas" value={convs.open ?? 0} sub={`WA ${convs.whatsapp ?? 0} · SMS ${convs.sms ?? 0}`} color="purple" href="/dashboard/inbox" />
          <MetricCard Icon={CheckCircle}    label="Mensajes totales"        value={Number((parseInt(msgs.total_sent ?? 0) + parseInt(msgs.total_received ?? 0))).toLocaleString()} color="green" />
        </div>
      )}

      {/* Estado de canales */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5">
        <h2 className="text-base font-semibold text-gray-800 mb-4">Estado de canales</h2>
        <ChannelStatus channels={data?.channels} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Gráfica mensajes */}
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <h2 className="text-base font-semibold text-gray-800 mb-4">Mensajes enviados — últimos 7 días</h2>
          <div className="space-y-4">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="w-2.5 h-2.5 rounded-full bg-green-400 flex-shrink-0" />
                <MessageCircle size={12} className="text-gray-500" />
                <span className="text-xs text-gray-600 font-medium">WhatsApp</span>
              </div>
              <MiniBar days={days} channel="whatsapp" color="bg-green-400" />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="w-2.5 h-2.5 rounded-full bg-blue-400 flex-shrink-0" />
                <Smartphone size={12} className="text-gray-500" />
                <span className="text-xs text-gray-600 font-medium">SMS</span>
              </div>
              <MiniBar days={days} channel="sms" color="bg-blue-400" />
            </div>
          </div>
        </div>

        {/* Conversaciones pendientes */}
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-800">Conversaciones pendientes</h2>
            <Link href="/dashboard/inbox" className="text-xs text-blue-600 hover:underline flex items-center gap-1">
              Ver todas <ChevronRight size={12} />
            </Link>
          </div>
          {(data?.recent_conversations ?? []).length === 0 ? (
            <div className="text-center py-8 text-gray-400">
              <CheckCircle size={32} className="mx-auto mb-2 text-gray-300" strokeWidth={1.5} />
              <p className="text-sm">Sin mensajes pendientes</p>
            </div>
          ) : (
            <div className="space-y-2">
              {(data?.recent_conversations ?? []).map(c => (
                <Link key={c.id} href="/dashboard/inbox"
                  className="flex items-center gap-3 p-3 rounded-xl hover:bg-gray-50 transition-colors border border-gray-100">
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 ${c.channel === 'whatsapp' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                    {(c.contact_name ?? c.contact_phone)?.[0]?.toUpperCase() ?? '?'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{c.contact_name ?? c.contact_phone}</p>
                    <p className="text-xs text-gray-500 flex items-center gap-1">
                      {c.channel === 'whatsapp'
                        ? <><MessageCircle size={11} /> WhatsApp</>
                        : <><Smartphone    size={11} /> SMS</>}
                    </p>
                  </div>
                  {c.unread_count > 0 && (
                    <span className="bg-blue-600 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-medium flex-shrink-0">
                      {c.unread_count}
                    </span>
                  )}
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Últimas campañas */}
      {!isAdvisor && (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <h2 className="text-base font-semibold text-gray-800">Últimas campañas</h2>
            <Link href="/dashboard/campaigns" className="text-xs text-blue-600 hover:underline flex items-center gap-1">
              Ver todas <ChevronRight size={12} />
            </Link>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-5 py-3 text-left font-medium text-gray-500 text-xs uppercase tracking-wide">Nombre</th>
                <th className="px-5 py-3 text-left font-medium text-gray-500 text-xs uppercase tracking-wide">Canal</th>
                <th className="px-5 py-3 text-left font-medium text-gray-500 text-xs uppercase tracking-wide">Estado</th>
                <th className="px-5 py-3 text-right font-medium text-gray-500 text-xs uppercase tracking-wide">Enviados</th>
                <th className="px-5 py-3 text-right font-medium text-gray-500 text-xs uppercase tracking-wide">Aperturas</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(data?.recent_campaigns ?? []).map(c => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-5 py-3 font-medium">
                    <Link href={`/dashboard/campaigns/${c.id}`} className="hover:text-blue-600">{c.name}</Link>
                  </td>
                  <td className="px-5 py-3 text-gray-500">
                    <span className="flex items-center gap-1">
                      {CHANNEL_ICON[c.channel] ?? CHANNEL_ICON.email}
                      {c.channel ?? 'email'}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLOR[c.status] ?? ''}`}>
                      {STATUS_LABEL[c.status] ?? c.status}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right">{Number(c.sent_count).toLocaleString()}</td>
                  <td className="px-5 py-3 text-right">{Number(c.open_count).toLocaleString()}</td>
                </tr>
              ))}
              {!data?.recent_campaigns?.length && (
                <tr><td colSpan={5} className="px-5 py-8 text-center text-gray-400">Sin campañas todavía</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
