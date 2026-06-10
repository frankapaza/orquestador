'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  AreaChart, Area, ResponsiveContainer, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts'
import api from '@/lib/api'
import {
  Mail, MessageCircle, Smartphone, CheckCircle, Loader2, ChevronRight,
  LayoutDashboard, ArrowUpRight, MessageSquare, Inbox, FolderOpen,
  TrendingDown, Send,
} from '@/components/ui/icons'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/components/ui/PageHeader'
import { SectionCard } from '@/components/ui/section-card'
import { EmptyState } from '@/components/ui/empty-state'

const STATUS_LABEL = { draft: 'Borrador', sending: 'Enviando', completed: 'Completada', failed: 'Fallida', paused: 'Pausada', scheduled: 'Programada' }
const STATUS_COLOR = {
  draft: 'bg-muted text-muted-foreground',
  sending: 'bg-blue-100 text-blue-700',
  completed: 'bg-jungle-green-100 text-jungle-green-700',
  failed: 'bg-red-100 text-red-700',
  paused: 'bg-amber-100 text-amber-700',
  scheduled: 'bg-violet-100 text-violet-700',
}
const CHANNEL_ICON = {
  whatsapp: <MessageCircle size={13} className="mr-1 inline-block" />,
  sms: <Smartphone size={13} className="mr-1 inline-block" />,
  email: <Mail size={13} className="mr-1 inline-block" />,
}

const num = v => Number(v ?? 0).toLocaleString('es')

function StatusPill({ ok, label }) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
      ok ? 'bg-jungle-green-50 text-jungle-green-700' : 'bg-muted text-muted-foreground',
    )}>
      <span className={cn('h-1.5 w-1.5 rounded-full', ok ? 'bg-jungle-green-500' : 'bg-muted-foreground/40')} />
      {label}
    </span>
  )
}

const TILE_TONES = {
  green: 'bg-jungle-green-50 text-jungle-green-600',
  blue: 'bg-blue-50 text-blue-600',
  violet: 'bg-violet-50 text-violet-600',
  amber: 'bg-amber-50 text-amber-600',
  rose: 'bg-rose-50 text-rose-600',
  slate: 'bg-muted text-muted-foreground',
}

function GroupStat({ icon: Icon, label, value, tone = 'green' }) {
  return (
    <div className="px-5 py-4">
      <span className={cn('flex h-8 w-8 items-center justify-center rounded-lg', TILE_TONES[tone] ?? TILE_TONES.green)}>
        <Icon size={16} strokeWidth={2} />
      </span>
      <p className="mt-2.5 text-2xl font-bold tabular-nums text-foreground">{value}</p>
      <p className="mt-0.5 text-xs leading-tight text-muted-foreground">{label}</p>
    </div>
  )
}

function Sparkline({ data, id }) {
  const hasData = data.some(d => d.v > 0)
  if (!hasData) return <div className="h-10 w-24" />
  return (
    <AreaChart width={96} height={40} data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1f7c62" stopOpacity={0.35} />
          <stop offset="100%" stopColor="#1f7c62" stopOpacity={0} />
        </linearGradient>
      </defs>
      <Area type="monotone" dataKey="v" stroke="#1f7c62" strokeWidth={2} fill={`url(#${id})`} dot={false} isAnimationActive={false} />
    </AreaChart>
  )
}

function ChannelCard({ icon: Icon, name, value, subLabel, status, spark, sparkId, href }) {
  return (
    <Link
      href={href}
      className="group rounded-2xl border bg-card p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-jungle-green-50 text-jungle-green-600">
            <Icon size={18} strokeWidth={2} />
          </span>
          <span className="text-sm font-semibold text-foreground">{name}</span>
        </div>
        <StatusPill ok={status.ok} label={status.label} />
      </div>
      <div className="mt-5 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-3xl font-bold tracking-tight tabular-nums text-foreground">{value}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{subLabel}</p>
        </div>
        <Sparkline data={spark} id={sparkId} />
      </div>
    </Link>
  )
}

const cap = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

// Tick del eje X: día de la semana (arriba) + fecha corta (abajo), en español
function DateTick({ x, y, payload, data }) {
  const item = data?.[payload?.index]
  if (!item) return null
  const last = (data?.length ?? 1) - 1
  const anchor = payload?.index === 0 ? 'start' : payload?.index === last ? 'end' : 'middle'
  return (
    <g transform={`translate(${x},${y})`}>
      <text x={0} dy={14} textAnchor={anchor} fontSize={12} fontWeight={600} fill="#3f3f46">{item.weekday}</text>
      <text x={0} dy={29} textAnchor={anchor} fontSize={10} fill="#a1a1aa">{item.short}</text>
    </g>
  )
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const d = new Date(label)
  const title = isNaN(d.getTime()) ? label : cap(d.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }))
  return (
    <div className="rounded-lg border bg-card px-3 py-2 text-xs shadow-md">
      <p className="mb-1.5 font-medium text-foreground">{title}</p>
      {payload.map(p => (
        <p key={p.dataKey} className="flex items-center gap-1.5 text-muted-foreground">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
          {p.name}: <span className="font-medium text-foreground">{p.value}</span>
        </p>
      ))}
    </div>
  )
}

export default function DashboardPage() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get('/reports/summary').then(r => setData(r.data)).finally(() => setLoading(false))
  }, [])

  if (loading) return (
    <div className="flex h-64 items-center justify-center">
      <Loader2 size={32} className="animate-spin text-jungle-green-600" />
    </div>
  )

  const isAdvisor = data?.is_advisor ?? false
  const email = data?.email ?? {}
  const msgs = data?.messages ?? {}
  const convs = data?.conversations ?? {}
  const channels = data?.channels ?? {}
  const days = data?.msg_by_day ?? []

  // Pivot de mensajes por día → [{ label, whatsapp, sms }]
  const dayKeys = [...new Set(days.map(d => d.day))].sort()
  const chartData = dayKeys.map(day => {
    const wa = days.find(d => d.day === day && d.channel === 'whatsapp')
    const sms = days.find(d => d.day === day && d.channel === 'sms')
    const dt = new Date(day)
    return {
      day,
      weekday: cap(dt.toLocaleDateString('es', { weekday: 'short', timeZone: 'UTC' }).replace('.', '')),
      short: dt.toLocaleDateString('es', { day: 'numeric', month: 'short', timeZone: 'UTC' }).replace('.', ''),
      whatsapp: wa ? parseInt(wa.count) : 0,
      sms: sms ? parseInt(sms.count) : 0,
    }
  })
  const sparkOf = ch => chartData.map(d => ({ v: d[ch] }))

  const bounceRate = email.total_sent > 0 ? ((email.total_bounces / email.total_sent) * 100).toFixed(1) + '%' : '0%'
  const totalMsgs = parseInt(msgs.total_sent ?? 0) + parseInt(msgs.total_received ?? 0)

  const unreadTone = parseInt(convs.unread) > 0 ? 'amber' : 'slate'
  const convStats = [
    { icon: MessageSquare, label: 'Totales', value: num(convs.total), tone: 'green' },
    { icon: Inbox, label: 'Sin leer', value: num(convs.unread), tone: unreadTone },
    { icon: FolderOpen, label: 'Abiertas', value: num(convs.open), tone: 'blue' },
  ]
  const perfStats = [
    { icon: CheckCircle, label: 'Campañas completadas', value: num(email.completed_campaigns), tone: 'violet' },
    { icon: TrendingDown, label: 'Tasa de rebote (email)', value: bounceRate, tone: 'slate' },
    { icon: Send, label: 'Mensajes enviados y recibidos', value: num(totalMsgs), tone: 'green' },
  ]

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        icon={LayoutDashboard}
        title={isAdvisor ? 'Mi actividad' : 'Resumen'}
        description={isAdvisor ? 'Actividad de tus canales asignados' : 'Vista general de todos tus canales de comunicación'}
      />

      {/* Tarjetas de canal (con estado integrado) */}
      <div className={cn('grid gap-4', isAdvisor ? 'sm:grid-cols-2' : 'sm:grid-cols-2 lg:grid-cols-3')}>
        <ChannelCard
          icon={MessageCircle}
          name="WhatsApp"
          value={num(msgs.wa_sent)}
          subLabel={`enviados · ${num(msgs.total_received)} recibidos`}
          status={{ ok: parseInt(channels.wa_connected) > 0, label: parseInt(channels.wa_connected) > 0 ? `${channels.wa_connected} conectado${parseInt(channels.wa_connected) > 1 ? 's' : ''}` : 'Sin conexión' }}
          spark={sparkOf('whatsapp')}
          sparkId="spark-wa"
          href="/dashboard/inbox"
        />
        <ChannelCard
          icon={Smartphone}
          name="SMS"
          value={num(msgs.sms_sent)}
          subLabel="enviados"
          status={{ ok: parseInt(channels.sms_online) > 0, label: parseInt(channels.sms_online) > 0 ? `${channels.sms_online} online` : 'Sin gateways' }}
          spark={sparkOf('sms')}
          sparkId="spark-sms"
          href="/dashboard/sms-accounts"
        />
        {!isAdvisor && (
          <ChannelCard
            icon={Mail}
            name="Email"
            value={num(email.total_sent)}
            subLabel={`enviados · ${num(email.total_opens)} aperturas`}
            status={{ ok: parseInt(channels.email_active) > 0, label: parseInt(channels.email_active) > 0 ? `${channels.email_active} activa${parseInt(channels.email_active) > 1 ? 's' : ''}` : 'Sin cuentas' }}
            spark={[]}
            sparkId="spark-email"
            href="/dashboard/campaigns"
          />
        )}
      </div>

      {/* Métricas secundarias agrupadas por contexto */}
      <div className={cn('grid gap-6', !isAdvisor && 'lg:grid-cols-2')}>
        <SectionCard title="Conversaciones" noPadding>
          <div className="grid grid-cols-3 divide-x">
            {convStats.map(s => <GroupStat key={s.label} {...s} />)}
          </div>
        </SectionCard>
        {!isAdvisor && (
          <SectionCard title="Campañas y mensajes" noPadding>
            <div className="grid grid-cols-3 divide-x">
              {perfStats.map(s => <GroupStat key={s.label} {...s} />)}
            </div>
          </SectionCard>
        )}
      </div>

      {/* Actividad + Conversaciones pendientes */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <SectionCard title="Actividad de mensajes" description="Últimos 7 días" className="lg:col-span-2">
          <div className="mb-4 flex items-center gap-4">
            <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <span className="h-2.5 w-2.5 rounded-full bg-jungle-green-600" /> WhatsApp
            </span>
            <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <span className="h-2.5 w-2.5 rounded-full bg-jungle-green-300" /> SMS
            </span>
          </div>
          {chartData.length === 0 ? (
            <EmptyState icon={MessageCircle} title="Aún no hay actividad" description="Cuando envíes o recibas mensajes verás la tendencia aquí." />
          ) : (
            <div className="h-[240px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                  <defs>
                    <linearGradient id="area-wa" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#1f7c62" stopOpacity={0.28} />
                      <stop offset="100%" stopColor="#1f7c62" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="area-sms" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#84d1b5" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#84d1b5" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                  <XAxis dataKey="day" tickLine={false} axisLine={false} height={42} interval={0} tick={<DateTick data={chartData} />} />
                  <YAxis tickLine={false} axisLine={false} width={36} allowDecimals={false} tick={{ fontSize: 12, fill: '#71717a' }} />
                  <Tooltip content={<ChartTooltip />} cursor={{ stroke: '#84d1b5', strokeWidth: 1 }} />
                  <Area type="monotone" dataKey="whatsapp" name="WhatsApp" stroke="#1f7c62" strokeWidth={2} fill="url(#area-wa)" />
                  <Area type="monotone" dataKey="sms" name="SMS" stroke="#84d1b5" strokeWidth={2} fill="url(#area-sms)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Conversaciones pendientes"
          action={
            <Link href="/dashboard/inbox" className="flex items-center gap-1 text-xs font-medium text-jungle-green-700 hover:underline">
              Ver todas <ChevronRight size={12} />
            </Link>
          }
        >
          {(data?.recent_conversations ?? []).length === 0 ? (
            <EmptyState icon={CheckCircle} title="Todo al día" description="No hay conversaciones pendientes." />
          ) : (
            <div className="space-y-2">
              {(data?.recent_conversations ?? []).map(c => (
                <Link
                  key={c.id}
                  href="/dashboard/inbox"
                  className="flex items-center gap-3 rounded-xl border p-3 transition-colors hover:bg-muted/60"
                >
                  <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold', c.channel === 'whatsapp' ? 'bg-jungle-green-100 text-jungle-green-700' : 'bg-blue-100 text-blue-700')}>
                    {(c.contact_name ?? c.contact_phone)?.[0]?.toUpperCase() ?? '?'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{c.contact_name ?? c.contact_phone}</p>
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      {c.channel === 'whatsapp' ? <><MessageCircle size={11} /> WhatsApp</> : <><Smartphone size={11} /> SMS</>}
                    </p>
                  </div>
                  {c.unread_count > 0 && (
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-jungle-green-600 text-xs font-medium text-white">
                      {c.unread_count}
                    </span>
                  )}
                </Link>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      {/* Últimas campañas */}
      {!isAdvisor && (
        <SectionCard
          noPadding
          title="Últimas campañas"
          action={
            <Link href="/dashboard/campaigns" className="flex items-center gap-1 text-xs font-medium text-jungle-green-700 hover:underline">
              Ver todas <ChevronRight size={12} />
            </Link>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-5 py-3 font-medium">Nombre</th>
                  <th className="px-5 py-3 font-medium">Canal</th>
                  <th className="px-5 py-3 font-medium">Estado</th>
                  <th className="px-5 py-3 text-right font-medium">Enviados</th>
                  <th className="px-5 py-3 text-right font-medium">Aperturas</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {(data?.recent_campaigns ?? []).map(c => (
                  <tr key={c.id} className="transition-colors hover:bg-muted/40">
                    <td className="px-5 py-3 font-medium">
                      <Link href={`/dashboard/campaigns/${c.id}`} className="inline-flex items-center gap-1 hover:text-jungle-green-700">
                        {c.name}
                        <ArrowUpRight size={13} className="opacity-0 transition-opacity group-hover:opacity-100" />
                      </Link>
                    </td>
                    <td className="px-5 py-3 capitalize text-muted-foreground">
                      <span className="flex items-center gap-1">{CHANNEL_ICON[c.channel] ?? CHANNEL_ICON.email}{c.channel ?? 'email'}</span>
                    </td>
                    <td className="px-5 py-3">
                      <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', STATUS_COLOR[c.status] ?? '')}>
                        {STATUS_LABEL[c.status] ?? c.status}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums">{num(c.sent_count)}</td>
                    <td className="px-5 py-3 text-right tabular-nums">{num(c.open_count)}</td>
                  </tr>
                ))}
                {!data?.recent_campaigns?.length && (
                  <tr><td colSpan={5} className="px-5 py-10 text-center text-sm text-muted-foreground">Sin campañas todavía</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}
    </div>
  )
}
