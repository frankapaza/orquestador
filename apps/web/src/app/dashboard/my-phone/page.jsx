'use client'
import { useEffect, useState } from 'react'
import api from '../../../lib/api'
import { PageHeader } from '../../../components/ui/PageHeader'
import { SectionCard } from '../../../components/ui/section-card'
import { EmptyState } from '../../../components/ui/empty-state'
import { Button } from '../../../components/ui/button'
import { Smartphone, QrCode, RotateCcw, RefreshCw, AlertTriangle, MessageCircle, Mail, Loader2, CheckCircle, Inbox } from '../../../components/ui/icons'

const QR_STEPS = [
  { n: '1', t: 'Abre WhatsApp en tu teléfono' },
  { n: '2', t: 'Toca los tres puntos (⋮) y luego Configuración' },
  { n: '3', t: 'Selecciona "Dispositivos vinculados"' },
  { n: '4', t: 'Toca "Vincular un dispositivo"' },
  { n: '5', t: 'Escanea el QR que aparece en pantalla' },
]

function StatusBadge({ ok, label }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
        ok ? 'bg-jungle-green-100 text-jungle-green-700' : 'bg-muted text-muted-foreground'
      }`}
    >
      <span className={`h-2 w-2 rounded-full ${ok ? 'bg-jungle-green-600 animate-pulse' : 'bg-muted-foreground/40'}`} />
      {label}
    </span>
  )
}

function ChannelCard({ icon, iconTone, title, status, statusLabel, children, actions }) {
  return (
    <SectionCard
      title={
        <span className="flex items-center gap-3">
          <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${iconTone}`}>{icon}</span>
          <span>{title}</span>
        </span>
      }
      action={<StatusBadge ok={status} label={statusLabel} />}
    >
      {children}
      {actions && <div className="mt-4 space-y-2">{actions}</div>}
    </SectionCard>
  )
}

function MetricBox({ label, value, title }) {
  return (
    <div className="rounded-xl bg-muted/60 p-3 text-center">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate text-sm font-semibold text-foreground" title={title}>
        {value}
      </p>
    </div>
  )
}

export default function MyPhonePage() {
  const [channels, setChannels] = useState(null)
  const [qrData, setQrData]     = useState(null)
  const [loadingQr, setLoadingQr] = useState(false)
  const [polling, setPolling]   = useState(null)
  const [pinging, setPinging]   = useState(false)
  const [loaded, setLoaded]     = useState(false)

  async function load() {
    try {
      const r = await api.get('/settings/my-channels')
      setChannels(r.data)
    } catch {}
    setLoaded(true)
  }

  useEffect(() => { load() }, [])

  // WhatsApp QR
  function stopPolling() {
    if (polling) { clearInterval(polling); setPolling(null) }
  }

  async function pollQr(id) {
    try {
      const r = await api.get(`/whatsapp/accounts/${id}/qr`)
      if (r.data.status === 'connected') {
        stopPolling()
        setQrData({ status: 'connected' })
        load()
        return
      }
      setQrData(prev => ({ ...prev, status: r.data.status, qrBase64: r.data.qrBase64 ?? prev?.qrBase64 }))
    } catch {}
  }

  async function connectQr() {
    const wa = channels?.whatsapp
    if (!wa) return
    stopPolling()
    setLoadingQr(true)
    setQrData({ status: 'starting', qrBase64: null, accountId: wa.id })
    await pollQr(wa.id)
    setLoadingQr(false)
    const t = setInterval(() => pollQr(wa.id), 3000)
    setPolling(t)
  }

  async function reconnectWa() {
    const wa = channels?.whatsapp
    if (!wa) return
    stopPolling()
    try {
      await api.post(`/whatsapp/accounts/${wa.id}/reconnect`)
      setQrData({ status: 'starting', qrBase64: null, accountId: wa.id })
      await new Promise(r => setTimeout(r, 3000))
      await pollQr(wa.id)
      const t = setInterval(() => pollQr(wa.id), 3000)
      setPolling(t)
    } catch {}
  }

  async function verifySms() {
    const sms = channels?.sms
    if (!sms) return
    setPinging(true)
    try {
      await api.get(`/sms/accounts/${sms.id}/ping`)
      load()
    } catch {}
    setPinging(false)
  }

  if (!loaded) return (
    <div className="flex h-64 items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-jungle-green-600" />
    </div>
  )

  const wa    = channels?.whatsapp
  const sms   = channels?.sms
  const email = channels?.email
  const hasAny = wa || sms || email

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        icon={Smartphone}
        title="Mis canales"
        description="Canales de comunicación asignados por el administrador"
      />

      {!hasAny && (
        <SectionCard>
          <EmptyState
            icon={Inbox}
            title="Sin canales asignados"
            description="El administrador aún no te ha asignado ningún canal. Contacta a tu administrador."
          />
        </SectionCard>
      )}

      <div className="space-y-4">

        {/* WhatsApp */}
        {wa && (
          <ChannelCard
            icon={<MessageCircle size={18} strokeWidth={1.75} className="text-jungle-green-600" />}
            iconTone="bg-jungle-green-50"
            title="WhatsApp"
            status={wa.is_connected}
            statusLabel={wa.is_connected ? 'Conectado' : 'Sin conectar'}
            actions={
              <>
                {!wa.is_connected && (
                  <>
                    <Button onClick={connectQr} className="w-full">
                      <QrCode size={16} strokeWidth={1.75} /> Vincular WhatsApp (escanear QR)
                    </Button>
                    <p className="text-center text-xs text-muted-foreground">
                      o usa el <strong className="font-medium text-foreground">código de 8 dígitos</strong> desde el admin
                    </p>
                  </>
                )}
                {wa.is_connected && (
                  <Button onClick={reconnectWa} variant="outline" size="sm" className="w-full">
                    <RotateCcw size={16} strokeWidth={1.75} /> Reconectar
                  </Button>
                )}
              </>
            }
          >
            <div className="grid grid-cols-3 gap-3">
              <MetricBox label="Mensajes hoy" value={`${wa.sent_today}/${wa.daily_limit}`} />
              <MetricBox label="Horario" value={`${wa.active_hours_start?.slice(0,5)} a ${wa.active_hours_end?.slice(0,5)}`} />
              <MetricBox label="Número" value={wa.phone_number ?? 'Sin definir'} title={wa.phone_number ?? ''} />
            </div>

            {/* QR inline */}
            {qrData && qrData.status !== 'connected' && (
              <div className="mt-4 rounded-xl border bg-muted/40 p-4">
                <p className="mb-3 text-xs font-medium text-foreground">Cómo vincular:</p>
                <div className="mb-4 space-y-1.5">
                  {QR_STEPS.map(s => (
                    <div key={s.n} className="flex items-center gap-2">
                      <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-jungle-green-600 text-xs font-bold text-white">{s.n}</span>
                      <span className="text-xs text-muted-foreground">{s.t}</span>
                    </div>
                  ))}
                </div>
                {!qrData.qrBase64 ? (
                  <div className="flex flex-col items-center gap-2 py-6">
                    <Loader2 className="h-8 w-8 animate-spin text-jungle-green-600" />
                    <p className="text-xs text-muted-foreground">Generando QR...</p>
                  </div>
                ) : (
                  <img src={qrData.qrBase64} alt="QR" className="w-full rounded-xl border" />
                )}
                <p className="mt-2 text-center text-xs text-muted-foreground">El QR se actualiza automáticamente</p>
              </div>
            )}
            {qrData?.status === 'connected' && (
              <div className="mt-4 flex items-center justify-center gap-2 rounded-xl border border-green-100 bg-green-50 p-3 text-center">
                <CheckCircle size={16} strokeWidth={1.75} className="text-green-600" />
                <p className="text-sm font-medium text-green-700">¡WhatsApp vinculado correctamente!</p>
              </div>
            )}
          </ChannelCard>
        )}

        {/* SMS */}
        {sms && (
          <ChannelCard
            icon={<Smartphone size={18} strokeWidth={1.75} className="text-blue-600" />}
            iconTone="bg-blue-50"
            title="SMS"
            status={sms.is_online}
            statusLabel={sms.is_online ? 'Gateway online' : 'Offline'}
            actions={
              <Button onClick={verifySms} disabled={pinging} variant="outline" size="sm" className="w-full">
                {pinging ? 'Verificando...' : <><RefreshCw size={16} strokeWidth={1.75} />Verificar conexión</>}
              </Button>
            }
          >
            <div className="grid grid-cols-2 gap-3">
              <MetricBox label="SMS hoy" value={`${sms.sent_today}/${sms.daily_limit}`} />
              <MetricBox label="Número" value={sms.phone_number} title={sms.phone_number} />
            </div>
            {!sms.is_online && (
              <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-100 bg-amber-50 p-3 text-xs text-amber-700">
                <AlertTriangle size={16} strokeWidth={1.75} className="mt-0.5 flex-shrink-0" />
                <span>El teléfono SMS no responde. Asegúrate de que <strong className="font-medium">Android SMS Gateway</strong> esté abierto y conectado a internet.</span>
              </div>
            )}
          </ChannelCard>
        )}

        {/* Email */}
        {email && (
          <ChannelCard
            icon={<Mail size={18} strokeWidth={1.75} className="text-violet-600" />}
            iconTone="bg-violet-50"
            title="Email"
            status={email.is_active}
            statusLabel={email.is_active ? 'Cuenta activa' : 'Inactiva'}
          >
            <div className="grid grid-cols-2 gap-3">
              <MetricBox label="Emails hoy" value={`${email.sent_today}/${email.daily_limit}`} />
              <MetricBox label="Dirección" value={email.email} title={email.email} />
            </div>
            <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50 p-3">
              <p className="flex items-center gap-1.5 text-xs text-blue-700">
                <Mail size={14} strokeWidth={1.75} className="flex-shrink-0" /> Tus campañas de email saldrán desde <strong className="font-medium">{email.email}</strong> ({email.domain})
              </p>
            </div>
          </ChannelCard>
        )}

      </div>
    </div>
  )
}
