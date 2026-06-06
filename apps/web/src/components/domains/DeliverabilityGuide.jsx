'use client'
import { useState } from 'react'

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button onClick={copy}
      className="shrink-0 text-xs px-2 py-1 rounded border border-gray-300 text-gray-500 hover:border-blue-400 hover:text-blue-600 transition-colors">
      {copied ? '✓ Copiado' : 'Copiar'}
    </button>
  )
}

function CodeBlock({ value }) {
  return (
    <div className="flex items-start gap-2 mt-1.5">
      <code className="flex-1 block bg-gray-900 text-green-400 text-xs p-3 rounded-lg font-mono leading-relaxed break-all">
        {value}
      </code>
      <CopyButton text={value} />
    </div>
  )
}

function Step({ number, title, status, children }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={`rounded-xl border-2 transition-colors ${status === 'done' ? 'border-green-200 bg-green-50' : status === 'warn' ? 'border-yellow-200 bg-yellow-50' : 'border-red-200 bg-red-50'}`}>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 p-4 text-left">
        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold shrink-0
          ${status === 'done' ? 'bg-green-500 text-white' : status === 'warn' ? 'bg-yellow-400 text-white' : 'bg-red-400 text-white'}`}>
          {status === 'done' ? '✓' : number}
        </div>
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-semibold ${status === 'done' ? 'text-green-800' : status === 'warn' ? 'text-yellow-800' : 'text-red-800'}`}>
            {title}
          </p>
          <p className={`text-xs mt-0.5 ${status === 'done' ? 'text-green-600' : status === 'warn' ? 'text-yellow-600' : 'text-red-500'}`}>
            {status === 'done' ? 'Configurado correctamente' : status === 'warn' ? 'Configurado pero mejorable' : 'Pendiente — afecta entregabilidad'}
          </p>
        </div>
        {status !== 'done' && (
          <span className="text-gray-400 text-sm">{open ? '▲' : '▼'}</span>
        )}
      </button>
      {open && status !== 'done' && (
        <div className="px-4 pb-4 space-y-3 border-t border-current/10 pt-3">
          {children}
        </div>
      )}
    </div>
  )
}

export default function DeliverabilityGuide({ domain }) {
  const [open, setOpen] = useState(false)

  const spfOk    = domain.spf_configured
  const dkimOk   = domain.dkim_configured
  const dmarcOk  = domain.dmarc_configured
  const allOk    = spfOk && dkimOk && dmarcOk

  const score = [spfOk, dkimOk, dmarcOk].filter(Boolean).length
  const scoreColor = score === 3 ? 'text-green-600' : score >= 1 ? 'text-yellow-600' : 'text-red-500'
  const scoreBg    = score === 3 ? 'bg-green-50 border-green-200' : score >= 1 ? 'bg-yellow-50 border-yellow-200' : 'bg-red-50 border-red-200'

  return (
    <div className="mt-4">
      <button
        onClick={() => setOpen(v => !v)}
        className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border-2 transition-colors ${scoreBg}`}>
        <div className="flex items-center gap-3">
          <span className="text-xl">{score === 3 ? '🟢' : score >= 1 ? '🟡' : '🔴'}</span>
          <div className="text-left">
            <p className={`text-sm font-semibold ${scoreColor}`}>
              Entregabilidad: {score === 3 ? 'Excelente' : score === 2 ? 'Buena' : score === 1 ? 'Regular' : 'Critica'}
            </p>
            <p className="text-xs text-gray-500">
              {score}/3 configuraciones DNS activas ·
              {allOk ? ' Los correos llegan al inbox' : ' Los correos pueden ir a spam'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            {[spfOk, dkimOk, dmarcOk].map((ok, i) => (
              <div key={i} className={`w-2.5 h-2.5 rounded-full ${ok ? 'bg-green-500' : 'bg-gray-300'}`} />
            ))}
          </div>
          <span className="text-gray-400 text-sm ml-1">{open ? '▲' : '▼'}</span>
        </div>
      </button>

      {open && (
        <div className="mt-3 space-y-3">

          {/* SPF */}
          <Step number={1} title="SPF — Autorizar servidor de envio" status={spfOk ? 'done' : 'pending'}>
            <p className="text-sm text-gray-700">
              SPF le dice al mundo qué servidores están autorizados a enviar correos de tu dominio.
              Sin SPF, Gmail y otros proveedores desconfían del correo.
            </p>
            <div className="bg-white rounded-lg p-3 space-y-2">
              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Pasos en cPanel:</p>
              <ol className="text-sm text-gray-700 space-y-1 list-decimal list-inside">
                <li>Entra a <strong>cPanel → Zone Editor</strong> (o DNS Zone Editor)</li>
                <li>Selecciona el dominio <strong>{domain.domain}</strong></li>
                <li>Busca si ya existe un registro TXT con <code className="bg-gray-100 px-1 rounded">v=spf1</code></li>
                <li>Si no existe, agrega un nuevo registro TXT:</li>
              </ol>
              <p className="text-xs font-semibold text-gray-500 mt-2">Tipo: TXT · Nombre: {domain.domain} · Valor:</p>
              <CodeBlock value={`v=spf1 mx a include:_spf.${domain.domain} -all`} />
              <p className="text-xs text-gray-400">
                Si tu hosting es cPanel/a1center, el valor correcto suele ser:
              </p>
              <CodeBlock value={`v=spf1 mx a include:_spf.h6.a1center.net include:_spfgeneral.a1center.net -all`} />
              <div className="bg-yellow-50 rounded p-2 text-xs text-yellow-700">
                <strong>Importante:</strong> el <code>-all</code> al final es hardfail (recomendado). Si tu hosting ya tiene un SPF con <code>~all</code>, solo cámbialo a <code>-all</code>.
              </div>
            </div>
          </Step>

          {/* DKIM */}
          <Step number={2} title="DKIM — Firma criptografica del correo" status={dkimOk ? 'done' : 'pending'}>
            <p className="text-sm text-gray-700">
              DKIM agrega una firma digital a cada correo. Gmail la verifica para confirmar que el correo
              no fue alterado y realmente viene de tu servidor. <strong>Es el factor más importante para evitar spam.</strong>
            </p>
            <div className="bg-white rounded-lg p-3 space-y-2">
              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Activar DKIM en cPanel (5 minutos):</p>
              <ol className="text-sm text-gray-700 space-y-2 list-decimal list-inside">
                <li>Entra a <strong>cPanel → Email → Email Deliverability</strong></li>
                <li>Busca tu dominio <strong>{domain.domain}</strong> en la lista</li>
                <li>Si aparece <span className="text-red-500 font-medium">"Invalid"</span> o <span className="text-yellow-600 font-medium">"Not configured"</span> junto a DKIM, haz click en <strong>"Manage"</strong></li>
                <li>Haz click en <strong>"Install the suggested record"</strong> — cPanel instala todo automáticamente</li>
                <li>Espera 5-10 minutos para que propague el DNS</li>
              </ol>
              <div className="bg-blue-50 rounded p-2 text-xs text-blue-700 mt-2">
                <strong>Alternativa (WHM):</strong> WHM → Email → Manage DKIM Keys → Enable para {domain.domain}
              </div>
              <div className="bg-amber-50 rounded p-2 text-xs text-amber-700">
                <strong>¿No ves la opción?</strong> Contacta al soporte de tu hosting y pide:
                <em> "Por favor habiliten DKIM para el dominio {domain.domain}"</em>
              </div>
            </div>
          </Step>

          {/* PTR */}
          <Step number={3} title="PTR — Identidad reversa del servidor (Reverse DNS)" status={dkimOk && spfOk ? 'warn' : 'pending'}>
            <p className="text-sm text-gray-700">
              El registro PTR verifica que la IP de tu servidor corresponde a tu dominio. Gmail lo usa para
              confirmar que el servidor es legítimo. Este registro <strong>solo lo puede configurar tu proveedor de hosting</strong>, no tú desde el DNS.
            </p>
            <div className="bg-white rounded-lg p-3 space-y-2">
              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Qué pedirle a tu proveedor:</p>
              <p className="text-sm text-gray-600">Escribe a soporte de <strong>a1center.net</strong> (o tu proveedor VPS) con este mensaje:</p>
              <CodeBlock value={`Hola, necesito configurar el registro PTR (reverse DNS) para la IP de mi servidor de correo. Por favor configuren: IP [tu-ip] → mail.${domain.domain}. Gracias.`} />
              <div className="bg-gray-50 rounded p-2 text-xs text-gray-600">
                <strong>Tip:</strong> Si tienes un VPS propio, el PTR generalmente se configura desde el panel del proveedor (Hetzner, DigitalOcean, Vultr, etc.) en la sección de Networking de tu servidor.
              </div>
            </div>
          </Step>

          {/* DMARC */}
          <Step number={4} title="DMARC — Politica de autenticacion" status={dmarcOk ? 'done' : 'pending'}>
            <p className="text-sm text-gray-700">
              DMARC indica a los servidores receptores qué hacer si un correo falla SPF o DKIM.
              También te manda reportes de entregabilidad.
            </p>
            <div className="bg-white rounded-lg p-3 space-y-2">
              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Agregar en tu DNS:</p>
              <p className="text-xs text-gray-500">Tipo: TXT · Nombre:</p>
              <CodeBlock value={`_dmarc.${domain.domain}`} />
              <p className="text-xs text-gray-500">Valor (empieza en modo monitoreo, sin rechazar):</p>
              <CodeBlock value={`v=DMARC1; p=none; rua=mailto:dmarc@${domain.domain}; ruf=mailto:dmarc@${domain.domain}; fo=1`} />
              <div className="bg-blue-50 rounded p-2 text-xs text-blue-700">
                <strong>p=none</strong> significa que solo monitorea sin rechazar correos. Una vez que tengas SPF y DKIM funcionando, puedes cambiarlo a <strong>p=quarantine</strong> o <strong>p=reject</strong> para mayor seguridad.
              </div>
            </div>
          </Step>

          {/* Resumen final si todo OK */}
          {allOk && (
            <div className="bg-green-50 border-2 border-green-200 rounded-xl p-4 text-center">
              <p className="text-2xl mb-1">🎉</p>
              <p className="font-semibold text-green-800">Dominio completamente configurado</p>
              <p className="text-sm text-green-600 mt-1">
                SPF, DKIM y DMARC activos. Los correos enviados desde este dominio deberían llegar directamente al inbox.
              </p>
            </div>
          )}

          {/* Herramienta de verificacion externa */}
          {!allOk && (
            <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
              <p className="text-sm font-semibold text-gray-700 mb-2">Verificar configuracion DNS online</p>
              <p className="text-sm text-gray-500 mb-3">
                Después de hacer los cambios, espera 10-30 minutos y verifica con estas herramientas gratuitas:
              </p>
              <div className="space-y-2">
                {[
                  { name: 'MXToolbox — SPF, DKIM, DMARC', url: `https://mxtoolbox.com/SuperTool.aspx?action=spf%3a${domain.domain}` },
                  { name: 'Mail-Tester — Score de entregabilidad completo', url: 'https://www.mail-tester.com' },
                  { name: 'DKIM Validator', url: `https://dkimvalidator.com` },
                ].map(tool => (
                  <a key={tool.name} href={tool.url} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-800 hover:underline">
                    <span>→</span> {tool.name}
                  </a>
                ))}
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  )
}
