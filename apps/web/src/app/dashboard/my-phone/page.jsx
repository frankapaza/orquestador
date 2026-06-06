'use client'
import { useEffect, useState } from 'react'
import api from '../../../lib/api'
import { PageHeader } from '../../../components/ui/PageHeader'
import { Smartphone, QrCode, RotateCcw, RefreshCw, AlertTriangle, MessageCircle, Mail } from '../../../components/ui/icons'

const QR_STEPS = [
  { n: '1', t: 'Abre WhatsApp en tu teléfono' },
  { n: '2', t: 'Toca los tres puntos (⋮) → Configuración' },
  { n: '3', t: 'Selecciona "Dispositivos vinculados"' },
  { n: '4', t: 'Toca "Vincular un dispositivo"' },
  { n: '5', t: 'Escanea el QR que aparece en pantalla' },
]

function StatusDot({ ok, pulse }) {
  return <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${ok ? 'bg-green-500' : 'bg-gray-300'} ${ok && pulse ? 'animate-pulse' : ''}`} />
}

function ChannelCard({ icon, title, status, statusLabel, children, actions }) {
  return (
    <div className={`bg-white rounded-2xl border-2 p-6 ${status ? 'border-green-200' : 'border-gray-200'}`}>
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <span>{icon}</span>
          <div>
            <h2 className="text-lg font-bold text-gray-900">{title}</h2>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusDot ok={status} pulse={status} />
          <span className={`text-sm font-medium ${status ? 'text-green-700' : 'text-gray-400'}`}>
            {statusLabel}
          </span>
        </div>
      </div>
      {children}
      {actions && <div className="mt-4 space-y-2">{actions}</div>}
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

  // ── WhatsApp QR ────────────────────────────────────────────────────────────
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
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  const wa    = channels?.whatsapp
  const sms   = channels?.sms
  const email = channels?.email
  const hasAny = wa || sms || email

  return (
    <div className="max-w-2xl">
      <PageHeader
        icon={Smartphone}
        title="Mis canales"
        description="Canales de comunicación asignados por el administrador"
      />

      {!hasAny && (
        <div className="bg-white rounded-2xl border-2 border-dashed border-gray-200 p-12 text-center">
          <p className="text-4xl mb-4">⏳</p>
          <p className="text-lg font-semibold text-gray-700">Sin canales asignados</p>
          <p className="text-sm text-gray-400 mt-2">
            El administrador aún no te ha asignado ningún canal.<br />
            Contacta a tu administrador.
          </p>
        </div>
      )}

      <div className="space-y-4">

        {/* ── WhatsApp ── */}
        {wa && (
          <ChannelCard
            icon={<MessageCircle size={24} className="text-green-600" />} title="WhatsApp"
            status={wa.is_connected}
            statusLabel={wa.is_connected ? 'Conectado' : 'Sin conectar'}
            actions={
              <>
                {!wa.is_connected && (
                  <>
                    <button onClick={connectQr}
                      className="w-full bg-green-600 text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-green-700 flex items-center justify-center gap-2">
                      <QrCode size={14} /> Vincular WhatsApp (escanear QR)
                    </button>
                    <p className="text-xs text-center text-gray-400">
                      o usa el <strong>código de 8 dígitos</strong> desde el admin
                    </p>
                  </>
                )}
                {wa.is_connected && (
                  <button onClick={reconnectWa}
                    className="w-full border border-blue-200 text-blue-600 text-xs py-2 rounded-xl hover:bg-blue-50 font-medium flex items-center justify-center gap-1.5">
                    <RotateCcw size={14} /> Reconectar
                  </button>
                )}
              </>
            }
          >
            <div className="grid grid-cols-3 gap-3 mb-2">
              <div className="bg-gray-50 rounded-xl p-3 text-center">
                <p className="text-xs text-gray-400">Mensajes hoy</p>
                <p className="text-lg font-bold text-gray-900">{wa.sent_today}/{wa.daily_limit}</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3 text-center">
                <p className="text-xs text-gray-400">Horario</p>
                <p className="text-sm font-bold text-gray-900">{wa.active_hours_start?.slice(0,5)}–{wa.active_hours_end?.slice(0,5)}</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3 text-center">
                <p className="text-xs text-gray-400">Número</p>
                <p className="text-sm font-bold text-gray-900 truncate">{wa.phone_number ?? '—'}</p>
              </div>
            </div>

            {/* QR Modal inline */}
            {qrData && qrData.status !== 'connected' && (
              <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                <p className="text-xs font-semibold text-gray-600 mb-3">Cómo vincular:</p>
                <div className="space-y-1.5 mb-4">
                  {QR_STEPS.map(s => (
                    <div key={s.n} className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-green-600 text-white text-xs flex items-center justify-center font-bold flex-shrink-0">{s.n}</span>
                      <span className="text-xs text-gray-600">{s.t}</span>
                    </div>
                  ))}
                </div>
                {!qrData.qrBase64 ? (
                  <div className="flex flex-col items-center py-6 gap-2">
                    <div className="w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
                    <p className="text-xs text-gray-500">Generando QR...</p>
                  </div>
                ) : (
                  <img src={qrData.qrBase64} alt="QR" className="w-full rounded-xl border-2 border-gray-200" />
                )}
                <p className="text-xs text-center text-gray-400 mt-2">El QR se actualiza automáticamente</p>
              </div>
            )}
            {qrData?.status === 'connected' && (
              <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-center">
                <p className="text-green-700 font-semibold text-sm">✅ ¡WhatsApp vinculado correctamente!</p>
              </div>
            )}
          </ChannelCard>
        )}

        {/* ── SMS ── */}
        {sms && (
          <ChannelCard
            icon={<Smartphone size={24} className="text-blue-600" />} title="SMS"
            status={sms.is_online}
            statusLabel={sms.is_online ? 'Gateway online' : 'Offline'}
            actions={
              <button onClick={verifySms} disabled={pinging}
                className="w-full border border-gray-200 text-gray-600 text-xs py-2 rounded-xl hover:bg-gray-50 disabled:opacity-50 font-medium flex items-center justify-center">
                {pinging ? 'Verificando...' : <><RefreshCw size={14} className="mr-1.5" />Verificar conexión</>}
              </button>
            }
          >
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-gray-50 rounded-xl p-3 text-center">
                <p className="text-xs text-gray-400">SMS hoy</p>
                <p className="text-lg font-bold text-gray-900">{sms.sent_today}/{sms.daily_limit}</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3 text-center">
                <p className="text-xs text-gray-400">Número</p>
                <p className="text-sm font-bold text-gray-900">{sms.phone_number}</p>
              </div>
            </div>
            {!sms.is_online && (
              <div className="mt-3 bg-amber-50 border border-amber-100 rounded-xl p-3 text-xs text-amber-700 flex items-start gap-2">
                <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                <span>El teléfono SMS no responde. Asegúrate de que <strong>Android SMS Gateway</strong> esté abierto y conectado a internet.</span>
              </div>
            )}
          </ChannelCard>
        )}

        {/* ── Email ── */}
        {email && (
          <ChannelCard
            icon={<Mail size={24} className="text-orange-500" />} title="Email"
            status={email.is_active}
            statusLabel={email.is_active ? 'Cuenta activa' : 'Inactiva'}
          >
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-gray-50 rounded-xl p-3 text-center">
                <p className="text-xs text-gray-400">Emails hoy</p>
                <p className="text-lg font-bold text-gray-900">{email.sent_today}/{email.daily_limit}</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3 text-center">
                <p className="text-xs text-gray-400">Dirección</p>
                <p className="text-xs font-bold text-gray-900 truncate" title={email.email}>{email.email}</p>
              </div>
            </div>
            <div className="mt-3 bg-blue-50 border border-blue-100 rounded-xl p-3">
              <p className="text-xs text-blue-700 flex items-center gap-1.5">
                <Mail size={12} /> Tus campañas de email saldrán desde <strong>{email.email}</strong> ({email.domain})
              </p>
            </div>
          </ChannelCard>
        )}

      </div>
    </div>
  )
}
