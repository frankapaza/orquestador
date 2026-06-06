'use client'
import { useState } from 'react'
import { PageHeader } from '../../../components/ui/PageHeader'

const BASE = 'http://localhost:3002/api/v1'

const SECTIONS = [
  {
    id: 'auth', icon: '🔐', title: 'Autenticación',
    description: 'Todos los endpoints requieren autenticación Bearer JWT. Obtén el token con el endpoint de login.',
    endpoints: [
      {
        method: 'POST', path: '/auth/login',
        title: 'Login — obtener token',
        description: 'Devuelve el JWT. Guárdalo y úsalo en el header Authorization: Bearer {token}',
        body: { email: 'admin@kubo.com', password: 'Admin123!' },
        response: { token: 'eyJhbGci...', client: { id: '...', name: 'Admin', email: 'admin@kubo.com', role: 'owner' } },
        note: 'El token expira en 7 días. Renueva llamando a este endpoint nuevamente.',
      },
      {
        method: 'GET', path: '/auth/me',
        title: 'Perfil del usuario autenticado',
        description: 'Devuelve nombre, email, rol y si es asesor (member_id).',
        response: { id: '...', name: 'Admin', email: 'admin@kubo.com', role: 'owner', member_id: null, is_admin: true },
      },
    ],
  },
  {
    id: 'contacts', icon: '👥', title: 'Contactos',
    description: 'Gestiona listas y contactos. Cada contacto puede tener múltiples teléfonos y emails con etiquetas.',
    endpoints: [
      {
        method: 'GET', path: '/lists',
        title: 'Listar listas de contactos',
        response: [{ id: '...', name: 'Clientes CRM', total_count: 150 }],
      },
      {
        method: 'POST', path: '/lists',
        title: 'Crear lista',
        body: { name: 'Clientes CRM', description: 'Importados desde mi sistema' },
        response: { id: '...', name: 'Clientes CRM', created_at: '2026-06-06...' },
      },
      {
        method: 'GET', path: '/lists/:listId/contacts?page=1&limit=50',
        title: 'Listar contactos de una lista',
        params: [{ name: 'listId', desc: 'ID de la lista' }],
        query: [{ name: 'page', desc: 'Página (default: 1)' }, { name: 'limit', desc: 'Registros por página (default: 50)' }],
        response: { contacts: [{ id: '...', email: 'juan@empresa.com', phone: '+51910462070', first_name: 'Juan' }], total: 150, page: 1 },
      },
      {
        method: 'POST', path: '/lists/:listId/contacts',
        title: 'Agregar contacto',
        params: [{ name: 'listId', desc: 'ID de la lista' }],
        body: { email: 'juan@empresa.com', phone: '+51910462070', first_name: 'Juan', last_name: 'Pérez' },
        note: 'Al menos email o phone es obligatorio. Los teléfonos y emails adicionales se agregan con los endpoints /contacts/:id/phones y /contacts/:id/emails.',
        response: { id: '...', email: 'juan@empresa.com', phone: '+51910462070' },
      },
      {
        method: 'GET', path: '/contacts/search?q=juan&limit=10',
        title: 'Buscar contacto',
        query: [{ name: 'q', desc: 'Texto a buscar (nombre, email o teléfono — busca en todos los teléfonos y emails del contacto)' }],
        response: [{ id: '...', first_name: 'Juan', phone: '+51910462070', list_name: 'Clientes CRM' }],
      },
      {
        method: 'GET', path: '/contacts/:id/360',
        title: 'Vista 360° — historial completo',
        params: [{ name: 'id', desc: 'ID del contacto' }],
        description: 'Devuelve datos del contacto incluyendo todos sus teléfonos y emails, estadísticas por canal y línea de tiempo cronológica.',
        response: { contact: { id: '...', first_name: 'Juan', phones: [{ phone: '+51999...', label: 'Principal', is_primary: true }], emails: [{ email: 'juan@...', label: 'Trabajo', is_primary: false }] }, stats: { email: { total_sent: 3, opens: 1 }, messages: { whatsapp: 5, sms: 2 } }, timeline: ['...'] },
      },
      {
        method: 'POST', path: '/contacts/:id/phones',
        title: 'Agregar teléfono al contacto',
        params: [{ name: 'id', desc: 'ID del contacto' }],
        body: { phone: '+51999123456', label: 'Trabajo' },
        note: 'label puede ser: Principal, Trabajo, Casa, Celular, Otro. El primer teléfono queda automáticamente como primario.',
        response: { id: '...', phone: '+51999123456', label: 'Trabajo', is_primary: false },
      },
      {
        method: 'PATCH', path: '/contacts/:id/phones/:phoneId/primary',
        title: 'Marcar teléfono como principal',
        params: [{ name: 'id', desc: 'ID del contacto' }, { name: 'phoneId', desc: 'ID del teléfono' }],
        response: { ok: true },
      },
      {
        method: 'DELETE', path: '/contacts/:id/phones/:phoneId',
        title: 'Eliminar teléfono',
        params: [{ name: 'id', desc: 'ID del contacto' }, { name: 'phoneId', desc: 'ID del teléfono' }],
        note: 'Si era el primario, el siguiente teléfono disponible queda como primario automáticamente.',
        response: { deleted: true },
      },
      {
        method: 'POST', path: '/contacts/:id/emails',
        title: 'Agregar email al contacto',
        params: [{ name: 'id', desc: 'ID del contacto' }],
        body: { email: 'juan.trabajo@empresa.com', label: 'Trabajo' },
        note: 'Mismos labels que teléfonos. El primero queda como primario automáticamente.',
        response: { id: '...', email: 'juan.trabajo@empresa.com', label: 'Trabajo', is_primary: false },
      },
      {
        method: 'PATCH', path: '/contacts/:id/emails/:emailId/primary',
        title: 'Marcar email como principal',
        params: [{ name: 'id', desc: 'ID del contacto' }, { name: 'emailId', desc: 'ID del email' }],
        response: { ok: true },
      },
      {
        method: 'DELETE', path: '/contacts/:id/emails/:emailId',
        title: 'Eliminar email',
        params: [{ name: 'id', desc: 'ID del contacto' }, { name: 'emailId', desc: 'ID del email' }],
        response: { deleted: true },
      },
    ],
  },
  {
    id: 'messaging', icon: '📤', title: 'Enviar mensajes',
    description: 'Envía mensajes individuales por WhatsApp, SMS o Email a cualquier contacto.',
    endpoints: [
      {
        method: 'POST', path: '/messages/send',
        title: 'Enviar WhatsApp o SMS',
        body: { channel: 'whatsapp', account_id: 'ID_CUENTA_WA', to: '+51910462070', message: 'Hola desde el CRM!', media_url: 'https://...opcional', media_type: 'image' },
        note: 'channel puede ser "whatsapp" o "sms". media_type puede ser: "image", "video", "audio", "document". Si envías media, sube el archivo primero con POST /media/upload para obtener la URL.',
        response: { message: { id: '...', status: 'sent', channel: 'whatsapp' }, conversation: { id: '...', contact_phone: '+51910462070' } },
      },
      {
        method: 'POST', path: '/contacts/:id/send-email',
        title: 'Enviar email individual',
        params: [{ name: 'id', desc: 'ID del contacto' }],
        body: { subject: 'Hola {{first_name}}', from_name: 'Equipo de ventas', html_content: '<p>Tu mensaje aquí</p>' },
        note: 'Soporta variables: {{first_name}}, {{last_name}}, {{email}}. Usa la cuenta SMTP asignada al asesor o la primera disponible.',
        response: { ok: true, message_id: '<id@whaxia.com>', to: 'juan@empresa.com' },
      },
    ],
  },
  {
    id: 'inbox', icon: '💬', title: 'Inbox — Conversaciones',
    description: 'Integra el inbox de Kubo en tu CRM. Lee, responde y gestiona conversaciones en tiempo real.',
    endpoints: [
      {
        method: 'GET', path: '/conversations?status=open&channel=whatsapp',
        title: 'Listar conversaciones (inbox)',
        query: [
          { name: 'status', desc: 'open | closed | pending (default: open)' },
          { name: 'channel', desc: 'whatsapp | sms (opcional, devuelve todos si se omite)' },
          { name: 'page / limit', desc: 'Paginación' },
        ],
        note: 'Para asesores, filtra automáticamente a sus canales asignados.',
        response: [{ id: '...', channel: 'whatsapp', contact_phone: '+51986095857', contact_name: 'Juan', last_body: 'Hola', unread_count: 2, last_message_at: '...' }],
      },
      {
        method: 'GET', path: '/conversations/:id',
        title: 'Detalle de conversación + mensajes',
        params: [{ name: 'id', desc: 'ID de la conversación' }],
        description: 'Devuelve la conversación con todos sus mensajes. Los mensajes multimedia incluyen media_url y media_type.',
        response: { id: '...', channel: 'whatsapp', contact_phone: '+51986095857', messages: [{ direction: 'inbound', body: null, media_url: 'http://localhost:3002/uploads/uuid.jpg', media_type: 'image', created_at: '...' }, { direction: 'outbound', body: 'En qué ayudo?', status: 'sent' }] },
      },
      {
        method: 'POST', path: '/media/upload',
        title: 'Subir archivo multimedia',
        description: 'Sube un archivo y obtén su URL para usarla en el reply. Acepta: imágenes (jpg, png, gif, webp), video (mp4), audio (mp3, ogg, opus), documentos (pdf, doc, docx, txt). Límite: 16 MB.',
        note: 'Usa multipart/form-data con el campo "file". Paso obligatorio antes de enviar media en una conversación.',
        response: { url: 'http://localhost:3002/uploads/uuid.jpg', type: 'image', filename: 'foto.jpg' },
      },
      {
        method: 'POST', path: '/conversations/:id/reply',
        title: 'Responder en una conversación',
        params: [{ name: 'id', desc: 'ID de la conversación' }],
        body: { body: 'Texto opcional si no hay media', media_url: 'http://localhost:3002/uploads/uuid.pdf', media_type: 'document', media_caption: 'propuesta.pdf' },
        note: 'media_type: "image" | "video" | "audio" | "document". Para enviar solo texto omite los campos media_*. Para enviar solo media omite body. Primero sube el archivo con POST /media/upload para obtener la URL.',
        response: { id: '...', direction: 'outbound', status: 'sent', body: null, media_url: 'http://...', media_type: 'document' },
      },
      {
        method: 'PATCH', path: '/conversations/:id/status',
        title: 'Cerrar / cambiar estado',
        params: [{ name: 'id', desc: 'ID de la conversación' }],
        body: { status: 'closed' },
        note: 'Estados: "open", "closed", "pending"',
        response: { id: '...', status: 'closed' },
      },
    ],
  },
  {
    id: 'whatsapp', icon: '💚', title: 'WhatsApp — Vincular número',
    description: 'Escanea QR o usa código de emparejamiento para vincular números de WhatsApp en tu CRM.',
    endpoints: [
      {
        method: 'GET', path: '/whatsapp/accounts',
        title: 'Listar cuentas WhatsApp',
        response: [{ id: '...', name: 'Asesor Kubo', phone_number: '+51910462070', is_connected: true, baileys_status: 'connected' }],
      },
      {
        method: 'GET', path: '/whatsapp/accounts/:id/qr',
        title: 'Obtener QR para vincular',
        params: [{ name: 'id', desc: 'ID de la cuenta WA' }],
        description: 'Llama este endpoint cada 3 segundos hasta que status=connected. Muestra qrBase64 como imagen <img src={qrBase64}>.',
        response: { status: 'qr', is_connected: false, qrBase64: 'data:image/png;base64,...' },
        note: 'Estados posibles: "starting", "connecting", "qr", "awaiting_code", "connected", "disconnected"',
      },
      {
        method: 'POST', path: '/whatsapp/accounts/:id/pairing-code',
        title: 'Código de emparejamiento (alternativa al QR)',
        params: [{ name: 'id', desc: 'ID de la cuenta WA' }],
        body: { phone_number: '+51910462070' },
        description: 'Devuelve un código de 8 caracteres. El usuario lo ingresa en WhatsApp → Dispositivos vinculados → Vincular con número de teléfono.',
        response: { pairing_code: 'ABCD-EFGH' },
      },
      {
        method: 'POST', path: '/whatsapp/accounts/:id/reconnect',
        title: 'Reconectar sesión',
        params: [{ name: 'id', desc: 'ID de la cuenta WA' }],
        description: 'Reinicia la sesión Baileys sin borrar credenciales. Usa esto cuando el número muestre "Sin conectar" después de reiniciar el servidor.',
        response: { ok: true, message: 'Reconectando...' },
      },
    ],
  },
  {
    id: 'sms', icon: '📱', title: 'SMS — Android Gateway',
    description: 'Kubo envía SMS usando Android SMS Gateway. Puedes conectar un teléfono Android en modo cloud (api.sms-gate.app) o en modo local (IP de red).',
    endpoints: [
      {
        method: 'GET', path: '/sms/accounts',
        title: 'Listar cuentas SMS',
        description: 'Devuelve las cuentas configuradas con su ID, estado online y cuota diaria. El ID es el que usas en POST /messages/send con channel: "sms".',
        response: [{ id: '...', name: 'Celular Frank', phone_number: '+51910462070', is_online: true, sent_today: 5, daily_limit: 100 }],
      },
      {
        method: 'POST', path: '/sms/accounts',
        title: 'Crear cuenta SMS (modo cloud)',
        body: { name: 'Mi celular', phone_number: '+51910462070', gateway_url: 'https://api.sms-gate.app', api_key: 'usuario:contraseña', daily_limit: 100, delay_min: 5, delay_max: 15, active_hours_start: '08:00', active_hours_end: '20:00' },
        note: 'MODO CLOUD: Instala Android SMS Gateway app → crea cuenta en sms-gate.app → usa tus credenciales como api_key en formato "usuario:contraseña". MODO LOCAL: usa la IP del teléfono como gateway_url (ej: http://192.168.1.5:8080) y el Bearer token de la app como api_key.',
        response: { id: '...', name: 'Mi celular', is_online: true },
      },
      {
        method: 'GET', path: '/sms/accounts/:id/ping',
        title: 'Verificar estado del gateway',
        params: [{ name: 'id', desc: 'ID de la cuenta SMS' }],
        description: 'Comprueba si el teléfono Android está online y puede enviar mensajes.',
        response: { online: true },
      },
      {
        method: 'POST', path: '/messages/send',
        title: 'Enviar SMS',
        body: { channel: 'sms', account_id: 'ID_CUENTA_SMS', to: '+51910462070', message: 'Hola desde Kubo!' },
        note: 'Usa el ID obtenido de GET /sms/accounts. El mensaje se envía desde el teléfono Android configurado.',
        response: { message: { id: '...', status: 'sent', channel: 'sms' }, conversation: { id: '...', contact_phone: '+51910462070' } },
      },
    ],
  },
  {
    id: 'webhooks', icon: '🔗', title: 'Webhooks — Recibir eventos',
    description: 'Configura una URL en tu CRM para recibir notificaciones en tiempo real cuando llegan mensajes.',
    endpoints: [
      {
        method: 'POST', path: '/webhook-subscriptions',
        title: 'Suscribirse a eventos',
        body: { name: 'Mi CRM', url: 'https://mi-crm.com/api/kubo-webhook', events: ['message.received', 'message.sent', 'message.read'], secret: 'clave-secreta-opcional' },
        note: 'Eventos disponibles: message.received, message.sent, message.delivered, message.read, conversation.created',
        response: { id: '...', url: 'https://mi-crm.com/...', events: ['message.received'], is_active: true },
      },
      {
        method: 'POST', path: '/webhook-subscriptions/:id/test',
        title: 'Probar webhook',
        params: [{ name: 'id', desc: 'ID de la suscripción' }],
        description: 'Envía un evento de prueba a tu URL para verificar que la integración funciona.',
        response: { ok: true, status: 200 },
      },
    ],
  },
]

const METHOD_COLOR = {
  GET:    'bg-green-100 text-green-700',
  POST:   'bg-blue-100 text-blue-700',
  PATCH:  'bg-yellow-100 text-yellow-700',
  DELETE: 'bg-red-100 text-red-700',
}

function EndpointCard({ ep }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-5 py-3.5 bg-white hover:bg-gray-50 text-left transition-colors">
        <span className={`text-xs font-bold px-2.5 py-1 rounded-lg flex-shrink-0 font-mono ${METHOD_COLOR[ep.method]}`}>
          {ep.method}
        </span>
        <code className="text-sm text-gray-700 font-mono flex-1">{ep.path}</code>
        <span className="text-sm font-medium text-gray-600 hidden md:block">{ep.title}</span>
        <span className="text-gray-400 flex-shrink-0">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="border-t border-gray-100 bg-gray-50 p-5 space-y-4">
          <div>
            <p className="font-semibold text-gray-800">{ep.title}</p>
            {ep.description && <p className="text-sm text-gray-600 mt-1">{ep.description}</p>}
          </div>

          {ep.note && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 text-sm text-amber-700">
              💡 {ep.note}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {ep.params && (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Parámetros de ruta</p>
                <div className="space-y-1">
                  {ep.params.map(p => (
                    <div key={p.name} className="flex items-start gap-2 text-sm">
                      <code className="bg-gray-200 px-1.5 py-0.5 rounded text-xs font-mono text-gray-700 flex-shrink-0">:{p.name}</code>
                      <span className="text-gray-600">{p.desc}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {ep.query && (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Query params</p>
                <div className="space-y-1">
                  {ep.query.map(q => (
                    <div key={q.name} className="flex items-start gap-2 text-sm">
                      <code className="bg-gray-200 px-1.5 py-0.5 rounded text-xs font-mono text-gray-700 flex-shrink-0">{q.name}</code>
                      <span className="text-gray-600">{q.desc}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {ep.body && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Body (JSON)</p>
              <pre className="bg-gray-900 text-green-300 rounded-xl px-4 py-3 text-xs overflow-x-auto">
                {JSON.stringify(ep.body, null, 2)}
              </pre>
            </div>
          )}

          {ep.response && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Respuesta ejemplo</p>
              <pre className="bg-gray-900 text-blue-300 rounded-xl px-4 py-3 text-xs overflow-x-auto">
                {JSON.stringify(ep.response, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function DocsPage() {
  const [active, setActive] = useState('auth')

  const section = SECTIONS.find(s => s.id === active)

  return (
    <div className="flex gap-6 -m-6 h-[calc(100vh-49px)]">
      {/* Sidebar navegación */}
      <div className="w-56 flex-shrink-0 bg-white border-r border-gray-200 overflow-y-auto">
        <div className="p-4 border-b border-gray-100">
          <h2 className="font-bold text-gray-900">API Docs</h2>
          <p className="text-xs text-gray-500 mt-0.5">v1.0 · REST JSON</p>
        </div>

        {/* Descargar Postman */}
        <div className="p-3 border-b border-gray-100">
          <a href="http://localhost:3002/api/v1/docs/postman" download="Kubo-API.postman_collection.json"
            className="flex items-center gap-2 w-full bg-orange-500 hover:bg-orange-600 text-white text-xs py-2 px-3 rounded-lg font-medium transition-colors">
            <span>⬇</span> Descargar para Postman
          </a>
          <p className="text-xs text-gray-400 mt-1.5 text-center">Importa en Postman para probar</p>
        </div>

        <nav className="p-3 space-y-1">
          {SECTIONS.map(s => (
            <button key={s.id} onClick={() => setActive(s.id)}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left transition-colors ${
                active === s.id ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'
              }`}>
              <span>{s.icon}</span>
              <span>{s.title}</span>
            </button>
          ))}
        </nav>

        {/* Auth header */}
        <div className="p-3 border-t border-gray-100 mt-2">
          <p className="text-xs font-semibold text-gray-500 mb-1">Header requerido</p>
          <code className="text-xs bg-gray-100 px-2 py-1 rounded block text-gray-700 break-all">
            Authorization: Bearer {'{token}'}
          </code>
        </div>
      </div>

      {/* Contenido */}
      <div className="flex-1 overflow-y-auto p-6">
        {section && (
          <div>
            <div className="mb-6">
              <div className="flex items-center gap-3 mb-2">
                <span className="text-3xl">{section.icon}</span>
                <h1 className="text-2xl font-bold text-gray-900">{section.title}</h1>
              </div>
              {section.description && (
                <p className="text-gray-600">{section.description}</p>
              )}
              <div className="mt-3 bg-gray-900 rounded-xl px-4 py-2.5 inline-block">
                <code className="text-xs text-gray-300">Base URL: </code>
                <code className="text-xs text-green-400">{BASE}</code>
              </div>
            </div>

            <div className="space-y-3">
              {section.endpoints.map((ep, i) => (
                <EndpointCard key={i} ep={ep} />
              ))}
            </div>

            {/* Ejemplo de integración para Webhook */}
            {section.id === 'webhooks' && (
              <div className="mt-6 bg-gray-900 rounded-2xl p-5">
                <p className="text-sm font-semibold text-gray-300 mb-3">Ejemplo: recibir webhook en C# (.NET)</p>
                <pre className="text-xs text-green-300 overflow-x-auto">{`[HttpPost("/api/kubo-webhook")]
public async Task<IActionResult> KuboWebhook([FromBody] JsonElement body)
{
    var evt     = body.GetProperty("event").GetString();
    var payload = body.GetProperty("payload");

    if (evt == "message.received")
    {
        var phone   = payload.GetProperty("contact_phone").GetString();
        var message = payload.GetProperty("body").GetString();
        var channel = payload.GetProperty("channel").GetString();

        // Actualizar CRM con el mensaje recibido
        await _crmService.UpdateContactMessage(phone, message, channel);
    }
    return Ok();
}`}</pre>
              </div>
            )}

            {/* Ejemplo QR para inbox */}
            {section.id === 'whatsapp' && (
              <div className="mt-6 bg-gray-900 rounded-2xl p-5">
                <p className="text-sm font-semibold text-gray-300 mb-3">Ejemplo: mostrar QR en tu CRM (JavaScript)</p>
                <pre className="text-xs text-green-300 overflow-x-auto">{`// Polling hasta conectar
async function showQR(accountId, token) {
  const interval = setInterval(async () => {
    const res = await fetch(\`\${BASE_URL}/whatsapp/accounts/\${accountId}/qr\`, {
      headers: { Authorization: \`Bearer \${token}\` }
    });
    const data = await res.json();

    if (data.status === 'connected') {
      clearInterval(interval);
      document.getElementById('qr-status').textContent = '✅ Conectado';
      return;
    }
    if (data.qrBase64) {
      document.getElementById('qr-img').src = data.qrBase64;
    }
  }, 3000); // cada 3 segundos
}`}</pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
