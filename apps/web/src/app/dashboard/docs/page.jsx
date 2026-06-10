'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  ChevronDown, ChevronUp, Download, Info, Key, Users, Send, MessageCircle,
  Smartphone, Webhook, Megaphone, Copy, Check,
} from '@/components/ui/icons'

const BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1'

const SECTIONS = [
  {
    id: 'auth', Icon: Key, title: 'Autenticación',
    description: 'Todos los endpoints requieren un JWT en el header Authorization: Bearer {token}. Obtén el token con el login.',
    endpoints: [
      { method: 'POST', path: '/auth/login', title: 'Login — obtener token',
        description: 'Devuelve el JWT. Guárdalo y úsalo en el header de cada petición.',
        body: { email: 'admin@kubo.com', password: 'Admin123!' },
        response: { token: 'eyJhbGci...', client: { id: '...', name: 'Admin', email: 'admin@kubo.com', role: 'owner' } },
        note: 'El token expira en 7 días. Renueva llamando a este endpoint nuevamente.' },
      { method: 'GET', path: '/auth/me', title: 'Perfil del usuario autenticado',
        description: 'Devuelve nombre, email, rol y, si es asesor, su member_id.',
        response: { id: '...', name: 'Admin', email: 'admin@kubo.com', role: 'owner', member_id: null, is_admin: true } },
    ],
  },
  {
    id: 'contacts', Icon: Users, title: 'Contactos',
    description: 'Un contacto puede tener VARIOS teléfonos y VARIOS correos, cada uno con etiqueta. El teléfono se guarda SEPARADO en columnas y el E.164 se compone en el envío.',
    endpoints: [
      { method: 'GET', path: '/lists', title: 'Listar listas de contactos',
        response: [{ id: '...', name: 'Clientes CRM', total_count: 150 }] },
      { method: 'POST', path: '/lists', title: 'Crear lista',
        body: { name: 'Clientes CRM', description: 'Importados desde mi sistema' },
        response: { id: '...', name: 'Clientes CRM', created_at: '2026-06-06T...' } },
      { method: 'GET', path: '/lists/:listId/contacts?page=1&limit=50', title: 'Listar contactos de una lista',
        params: [{ name: 'listId', desc: 'ID de la lista' }],
        query: [{ name: 'page', desc: 'Página (default: 1)' }, { name: 'limit', desc: 'Registros por página (default: 50)' }],
        description: 'Cada contacto incluye su teléfono y correo PRINCIPAL ya separados (phone = nacional, phone_dial = código, phone_country = ISO).',
        response: { contacts: [{ id: '...', first_name: 'Juan', last_name: 'Pérez', email: 'juan@empresa.com', phone: '910462070', phone_dial: '+51', phone_country: 'PE' }], total: 150, page: 1 } },
      { method: 'POST', path: '/lists/:listId/contacts', title: 'Agregar contacto',
        params: [{ name: 'listId', desc: 'ID de la lista' }],
        body: { first_name: 'Juan', last_name: 'Pérez', email: 'juan@empresa.com', phone: '910462070', phone_dial: '+51', phone_country: 'PE' },
        note: 'Debe incluir al menos email o phone. El teléfono/correo se registran como PRINCIPAL en contact_phones / contact_emails. phone es el número NACIONAL (sin el código); phone_dial es el código (+51) y phone_country el ISO (PE). Si envías phone con el código incluido (ej. +51910462070) el sistema lo separa solo.',
        response: { id: '...', first_name: 'Juan', email: 'juan@empresa.com', phone: '910462070', phone_dial: '+51', phone_country: 'PE' } },
      { method: 'GET', path: '/contacts/search?q=juan&limit=10', title: 'Buscar contacto',
        query: [{ name: 'q', desc: 'Busca por nombre completo, correo o número (ignora espacios/formato del número y busca en TODOS los teléfonos/correos del contacto).' }],
        description: 'Cada resultado trae el arreglo phones[] con todos los teléfonos del contacto.',
        response: [{ id: '...', first_name: 'Juan', last_name: 'Pérez', email: 'juan@empresa.com', phone: '910462070', phone_dial: '+51', phones: [{ phone: '910462070', phone_dial: '+51', phone_country: 'PE', label: 'Móvil', is_primary: true }], list_name: 'Clientes CRM' }] },
      { method: 'GET', path: '/contacts/:id/360', title: 'Vista 360° — historial completo',
        params: [{ name: 'id', desc: 'ID del contacto' }],
        description: 'Datos del contacto con TODOS sus teléfonos y correos, estadísticas por canal y línea de tiempo cronológica (mensajes WA/SMS de todos sus números + actividad de email de todos sus correos).',
        response: { contact: { id: '...', first_name: 'Juan', phones: [{ id: '...', phone: '999123456', phone_dial: '+51', phone_country: 'PE', label: 'Móvil', is_primary: true }], emails: [{ id: '...', email: 'juan@empresa.com', label: 'Trabajo', is_primary: true }] }, stats: { email: { total_sent: 3, opens: 1 }, messages: { whatsapp: 5, sms: 2, received: 2 } }, timeline: ['...'] } },
      { method: 'POST', path: '/contacts/:id/phones', title: 'Agregar teléfono al contacto',
        params: [{ name: 'id', desc: 'ID del contacto' }],
        body: { phone: '999123456', phone_dial: '+51', phone_country: 'PE', label: 'Trabajo' },
        note: 'label: Móvil, Trabajo, Casa u Otro. "Principal" es EXCLUSIVO: si envías label "Principal" (o es el primer teléfono) pasa a ser el principal y REEMPLAZA al anterior. phone es el número nacional; phone_dial el código (+51).',
        response: { id: '...', phone: '999123456', phone_dial: '+51', phone_country: 'PE', label: 'Trabajo', is_primary: false } },
      { method: 'PATCH', path: '/contacts/:id/phones/:phoneId/primary', title: 'Marcar teléfono como principal',
        params: [{ name: 'id', desc: 'ID del contacto' }, { name: 'phoneId', desc: 'ID del teléfono' }],
        note: 'Desmarca al principal anterior (solo uno puede ser principal).',
        response: { ok: true } },
      { method: 'DELETE', path: '/contacts/:id/phones/:phoneId', title: 'Eliminar teléfono',
        params: [{ name: 'id', desc: 'ID del contacto' }, { name: 'phoneId', desc: 'ID del teléfono' }],
        note: 'Si era el principal, el más antiguo restante toma el relevo automáticamente.',
        response: { deleted: true } },
      { method: 'POST', path: '/contacts/:id/emails', title: 'Agregar correo al contacto',
        params: [{ name: 'id', desc: 'ID del contacto' }],
        body: { email: 'juan.trabajo@empresa.com', label: 'Trabajo' },
        note: 'Igual que teléfonos: "Principal" es EXCLUSIVO y reemplaza al principal actual. label: Trabajo, Casa u Otro.',
        response: { id: '...', email: 'juan.trabajo@empresa.com', label: 'Trabajo', is_primary: false } },
      { method: 'PATCH', path: '/contacts/:id/emails/:emailId/primary', title: 'Marcar correo como principal',
        params: [{ name: 'id', desc: 'ID del contacto' }, { name: 'emailId', desc: 'ID del correo' }],
        response: { ok: true } },
      { method: 'DELETE', path: '/contacts/:id/emails/:emailId', title: 'Eliminar correo',
        params: [{ name: 'id', desc: 'ID del contacto' }, { name: 'emailId', desc: 'ID del correo' }],
        response: { deleted: true } },
    ],
  },
  {
    id: 'campaigns', Icon: Megaphone, title: 'Campañas',
    description: 'Campañas masivas por Email, WhatsApp o SMS a una lista de contactos. Puedes enviar al PRINCIPAL de cada contacto o a TODOS sus teléfonos/correos.',
    endpoints: [
      { method: 'GET', path: '/campaigns', title: 'Listar campañas',
        response: [{ id: '...', name: 'Promo Mayo', channel: 'whatsapp', status: 'completed', list_name: 'Clientes CRM', total_recipients: 150, sent_count: 148, open_count: 0 }] },
      { method: 'POST', path: '/campaigns', title: 'Crear campaña (Email)',
        body: { name: 'Promo Mayo', channel: 'email', subject: 'Hola {{first_name}}', from_name: 'Ventas', html_content: '<h1>Oferta</h1>', strategy: 'smtp_own', list_id: 'ID_LISTA', settings: { send_to_all: false, track_opens: true } },
        note: 'channel: "email". Requiere subject, from_name y html_content. strategy: smtp_own | sendgrid | brevo | mailchimp (las externas requieren settings.integration_id). settings.send_to_all = true envía a TODOS los correos del contacto; false solo al principal.',
        response: { id: '...', name: 'Promo Mayo', channel: 'email', status: 'draft' } },
      { method: 'POST', path: '/campaigns', title: 'Crear campaña (WhatsApp / SMS)',
        body: { name: 'Aviso WA', channel: 'whatsapp', content_text: 'Hola! Tenemos una promo para ti.', list_id: 'ID_LISTA', media_url: 'https://...opcional', settings: { send_to_all: true } },
        note: 'channel: "whatsapp" o "sms". Requiere content_text (el mensaje). El envío rota automáticamente entre tus cuentas WA/SMS conectadas. settings.send_to_all = true envía a TODOS los teléfonos del contacto; false solo al principal. En WhatsApp puedes adjuntar media_url (+ media_caption).',
        response: { id: '...', name: 'Aviso WA', channel: 'whatsapp', status: 'draft' } },
      { method: 'POST', path: '/campaigns/:id/send', title: 'Enviar / encolar campaña',
        params: [{ name: 'id', desc: 'ID de la campaña' }],
        description: 'Encola la campaña para envío. Genera un trabajo por cada DESTINO (un contacto con 3 teléfonos = 3 envíos si send_to_all está activo).',
        response: { message: 'Campaña encolada para envío', campaign_id: '...' } },
    ],
  },
  {
    id: 'messaging', Icon: Send, title: 'Enviar mensajes',
    description: 'Mensajes individuales por WhatsApp, SMS o Email a cualquier número/correo.',
    endpoints: [
      { method: 'POST', path: '/messages/send', title: 'Enviar WhatsApp o SMS',
        body: { channel: 'whatsapp', account_id: 'ID_CUENTA_WA', to: '+51910462070', message: 'Hola desde el CRM!', media_url: 'https://...opcional', media_type: 'image' },
        note: 'channel: "whatsapp" o "sms". to debe ser el número COMPLETO en E.164 (+código+nacional). media_type: image | video | audio | document. Para media, súbela primero con POST /media/upload.',
        response: { message: { id: '...', status: 'sent', channel: 'whatsapp' }, conversation: { id: '...', contact_phone: '+51910462070' } } },
      { method: 'POST', path: '/contacts/:id/send-email', title: 'Enviar correo individual',
        params: [{ name: 'id', desc: 'ID del contacto' }],
        body: { subject: 'Hola {{first_name}}', from_name: 'Equipo de ventas', html_content: '<p>Tu mensaje aquí</p>', to: 'juan.trabajo@empresa.com' },
        note: 'Variables: {{first_name}}, {{last_name}}, {{email}}. "to" es opcional: si se omite usa el correo PRINCIPAL; si lo envías debe ser uno de los correos del contacto.',
        response: { ok: true, message_id: '<id@whaxia.com>', to: 'juan.trabajo@empresa.com' } },
    ],
  },
  {
    id: 'inbox', Icon: MessageCircle, title: 'Inbox — Conversaciones',
    description: 'Lee, responde y gestiona conversaciones de WhatsApp/SMS en tiempo real.',
    endpoints: [
      { method: 'GET', path: '/conversations?status=open&channel=whatsapp&account=ID', title: 'Listar conversaciones',
        query: [
          { name: 'status', desc: 'open | closed | pending | all (default: open)' },
          { name: 'channel', desc: 'whatsapp | sms (opcional)' },
          { name: 'account', desc: 'ID de cuenta WA/SMS para filtrar por la "vía" (opcional)' },
          { name: 'page / limit', desc: 'Paginación' },
        ],
        note: 'Cada conversación incluye account_name y account_phone (la cuenta/número con que se atiende). Para asesores, filtra automáticamente a sus canales asignados.',
        response: [{ id: '...', channel: 'whatsapp', contact_phone: '+51986095857', contact_name: 'Juan', account_name: 'Asesor Kubo', account_phone: '+51910462070', last_body: 'Hola', unread_count: 2, last_message_at: '...' }] },
      { method: 'GET', path: '/conversations/:id', title: 'Detalle + mensajes',
        params: [{ name: 'id', desc: 'ID de la conversación' }],
        description: 'La conversación con todos sus mensajes. Los multimedia incluyen media_url y media_type.',
        response: { id: '...', channel: 'whatsapp', contact_phone: '+51986095857', messages: [{ direction: 'inbound', body: 'Hola', media_url: null, created_at: '...' }, { direction: 'outbound', body: 'En qué ayudo?', status: 'sent' }] } },
      { method: 'POST', path: '/media/upload', title: 'Subir archivo multimedia',
        description: 'Sube un archivo y obtén su URL. Acepta imágenes (jpg, png, gif, webp), video (mp4), audio (mp3, ogg, opus), documentos (pdf, doc, docx, txt). Límite: 16 MB.',
        note: 'multipart/form-data con el campo "file". Paso previo obligatorio para enviar media.',
        response: { url: 'http://localhost:3002/uploads/uuid.jpg', type: 'image', filename: 'foto.jpg' } },
      { method: 'POST', path: '/conversations/:id/reply', title: 'Responder en una conversación',
        params: [{ name: 'id', desc: 'ID de la conversación' }],
        body: { body: 'Texto opcional si no hay media', media_url: 'http://localhost:3002/uploads/uuid.pdf', media_type: 'document', media_caption: 'propuesta.pdf' },
        note: 'Para solo texto omite los media_*. Para solo media omite body.',
        response: { id: '...', direction: 'outbound', status: 'sent', media_url: 'http://...', media_type: 'document' } },
      { method: 'PATCH', path: '/conversations/:id/status', title: 'Cerrar / cambiar estado',
        params: [{ name: 'id', desc: 'ID de la conversación' }],
        body: { status: 'closed' }, note: 'Estados: open, closed, pending.',
        response: { id: '...', status: 'closed' } },
    ],
  },
  {
    id: 'whatsapp', Icon: MessageCircle, title: 'WhatsApp — Vincular número',
    description: 'Escanea QR o usa código de emparejamiento para vincular números de WhatsApp.',
    endpoints: [
      { method: 'GET', path: '/whatsapp/accounts', title: 'Listar cuentas WhatsApp',
        response: [{ id: '...', name: 'Asesor Kubo', phone_number: '+51910462070', is_connected: true }] },
      { method: 'GET', path: '/whatsapp/accounts/:id/qr', title: 'Obtener QR para vincular',
        params: [{ name: 'id', desc: 'ID de la cuenta WA' }],
        description: 'Llama cada 3 segundos hasta status=connected. Muestra qrBase64 como <img src={qrBase64}>.',
        note: 'Estados: starting, connecting, qr, awaiting_code, connected, disconnected.',
        response: { status: 'qr', is_connected: false, qrBase64: 'data:image/png;base64,...' } },
      { method: 'POST', path: '/whatsapp/accounts/:id/pairing-code', title: 'Código de emparejamiento',
        params: [{ name: 'id', desc: 'ID de la cuenta WA' }],
        body: { phone_number: '+51910462070' },
        description: 'Código de 8 caracteres para WhatsApp → Dispositivos vinculados → Vincular con número.',
        response: { pairing_code: 'ABCD-EFGH' } },
      { method: 'POST', path: '/whatsapp/accounts/:id/reconnect', title: 'Reconectar sesión',
        params: [{ name: 'id', desc: 'ID de la cuenta WA' }],
        description: 'Reinicia la sesión sin borrar credenciales (úsalo si quedó "Sin conectar" tras reiniciar).',
        response: { ok: true, message: 'Reconectando...' } },
    ],
  },
  {
    id: 'sms', Icon: Smartphone, title: 'SMS — Android Gateway',
    description: 'Envía SMS con Android SMS Gateway, en modo cloud (api.sms-gate.app) o local (IP de red).',
    endpoints: [
      { method: 'GET', path: '/sms/accounts', title: 'Listar cuentas SMS',
        description: 'Devuelve las cuentas con su ID, estado online y cuota. El ID se usa en POST /messages/send con channel "sms".',
        response: [{ id: '...', name: 'Celular Frank', phone_number: '+51910462070', is_online: true, sent_today: 5, daily_limit: 100 }] },
      { method: 'POST', path: '/sms/accounts', title: 'Crear cuenta SMS (modo cloud)',
        body: { name: 'Mi celular', phone_number: '+51910462070', gateway_url: 'https://api.sms-gate.app', api_key: 'usuario:contraseña', daily_limit: 100, delay_min: 5, delay_max: 15, active_hours_start: '08:00', active_hours_end: '20:00' },
        note: 'CLOUD: app Android SMS Gateway → cuenta en sms-gate.app → api_key "usuario:contraseña". LOCAL: gateway_url = IP del teléfono (http://192.168.1.5:8080) y api_key = Bearer token de la app.',
        response: { id: '...', name: 'Mi celular', is_online: true } },
      { method: 'GET', path: '/sms/accounts/:id/ping', title: 'Verificar estado del gateway',
        params: [{ name: 'id', desc: 'ID de la cuenta SMS' }],
        response: { online: true } },
      { method: 'POST', path: '/messages/send', title: 'Enviar SMS',
        body: { channel: 'sms', account_id: 'ID_CUENTA_SMS', to: '+51910462070', message: 'Hola desde Kubo!' },
        note: 'Usa el ID de GET /sms/accounts. to en E.164.',
        response: { message: { id: '...', status: 'sent', channel: 'sms' }, conversation: { id: '...', contact_phone: '+51910462070' } } },
    ],
  },
  {
    id: 'webhooks', Icon: Webhook, title: 'Webhooks — Recibir eventos',
    description: 'Recibe notificaciones en tiempo real en tu CRM cuando llegan o cambian mensajes.',
    endpoints: [
      { method: 'POST', path: '/webhook-subscriptions', title: 'Suscribirse a eventos',
        body: { name: 'Mi CRM', url: 'https://mi-crm.com/api/kubo-webhook', events: ['message.received', 'message.sent', 'message.read'], secret: 'clave-secreta-opcional' },
        note: 'Eventos: message.received, message.sent, message.delivered, message.read, conversation.created.',
        response: { id: '...', url: 'https://mi-crm.com/...', events: ['message.received'], is_active: true } },
      { method: 'POST', path: '/webhook-subscriptions/:id/test', title: 'Probar webhook',
        params: [{ name: 'id', desc: 'ID de la suscripción' }],
        description: 'Envía un evento de prueba a tu URL para verificar la integración.',
        response: { ok: true, status: 200 } },
    ],
  },
]

const METHOD_COLOR = {
  GET:    'bg-jungle-green-100 text-jungle-green-700',
  POST:   'bg-blue-100 text-blue-700',
  PATCH:  'bg-amber-100 text-amber-700',
  DELETE: 'bg-red-100 text-red-700',
}

function CodeBlock({ data, tone = 'green' }) {
  const [copied, setCopied] = useState(false)
  const text = JSON.stringify(data, null, 2)
  function copy() { navigator.clipboard?.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1200) }
  return (
    <div className="group relative">
      <button onClick={copy} className="absolute right-2 top-2 flex items-center gap-1 rounded-md bg-zinc-800 px-2 py-1 text-[11px] font-medium text-zinc-300 opacity-0 transition-opacity hover:bg-zinc-700 group-hover:opacity-100">
        {copied ? <><Check size={12} /> Copiado</> : <><Copy size={12} /> Copiar</>}
      </button>
      <pre className={`overflow-x-auto rounded-xl bg-zinc-900 px-4 py-3 text-xs ${tone === 'blue' ? 'text-blue-300' : 'text-jungle-green-300'}`}>{text}</pre>
    </div>
  )
}

function EndpointCard({ ep }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <button onClick={() => setOpen(o => !o)} className="flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-muted/40">
        <span className={`shrink-0 rounded-lg px-2.5 py-1 font-mono text-xs font-bold ${METHOD_COLOR[ep.method]}`}>{ep.method}</span>
        <code className="flex-1 truncate font-mono text-sm text-foreground">{ep.path}</code>
        <span className="hidden text-sm font-medium text-muted-foreground lg:block">{ep.title}</span>
        {open ? <ChevronUp size={16} strokeWidth={2} className="shrink-0 text-muted-foreground" /> : <ChevronDown size={16} strokeWidth={2} className="shrink-0 text-muted-foreground" />}
      </button>

      {open && (
        <div className="space-y-4 border-t bg-muted/30 p-5">
          <div>
            <p className="font-semibold text-foreground">{ep.title}</p>
            {ep.description && <p className="mt-1 text-sm text-muted-foreground">{ep.description}</p>}
          </div>
          {ep.note && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
              <Info size={16} strokeWidth={2} className="mt-0.5 shrink-0 text-amber-600" /><span>{ep.note}</span>
            </div>
          )}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {ep.params && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Parámetros de ruta</p>
                <div className="space-y-1.5">
                  {ep.params.map(p => (
                    <div key={p.name} className="flex items-start gap-2 text-sm">
                      <code className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">:{p.name}</code>
                      <span className="text-muted-foreground">{p.desc}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {ep.query && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Query params</p>
                <div className="space-y-1.5">
                  {ep.query.map(q => (
                    <div key={q.name} className="flex items-start gap-2 text-sm">
                      <code className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">{q.name}</code>
                      <span className="text-muted-foreground">{q.desc}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          {ep.body && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Body (JSON)</p>
              <CodeBlock data={ep.body} tone="green" />
            </div>
          )}
          {ep.response && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Respuesta ejemplo</p>
              <CodeBlock data={ep.response} tone="blue" />
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
    <div className="-m-6 flex h-[calc(100vh-49px)]">
      {/* Sidebar */}
      <aside className="flex w-60 shrink-0 flex-col overflow-y-auto border-r bg-card">
        <div className="border-b px-4 py-4">
          <h2 className="text-base font-semibold text-foreground">API Docs</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">v1.0 · REST JSON</p>
        </div>
        <div className="border-b p-3">
          <Button asChild variant="outline" size="sm" className="w-full justify-center gap-2">
            <a href={`${BASE}/docs/postman`} download="Kubo-API.postman_collection.json">
              <Download size={16} strokeWidth={2} /> Descargar para Postman
            </a>
          </Button>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {SECTIONS.map(s => {
            const on = active === s.id
            return (
              <button key={s.id} onClick={() => setActive(s.id)}
                className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm transition-colors ${on ? 'bg-jungle-green-50 font-medium text-jungle-green-700' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'}`}>
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${on ? 'bg-jungle-green-100 text-jungle-green-700' : 'bg-muted text-muted-foreground'}`}><s.Icon size={15} strokeWidth={1.75} /></span>
                {s.title}
              </button>
            )
          })}
        </nav>
        <div className="border-t p-3">
          <p className="mb-1 text-xs font-semibold text-muted-foreground">Header requerido</p>
          <code className="block break-all rounded-lg bg-muted px-2 py-1.5 text-xs text-foreground">Authorization: Bearer {'{token}'}</code>
        </div>
      </aside>

      {/* Contenido */}
      <div className="flex-1 overflow-y-auto p-6">
        {section && (
          <div className="mx-auto max-w-5xl">
            <div className="mb-6">
              <div className="mb-2 flex items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-jungle-green-50 text-jungle-green-600"><section.Icon size={22} strokeWidth={1.75} /></div>
                <h1 className="text-2xl font-bold tracking-tight text-foreground">{section.title}</h1>
              </div>
              {section.description && <p className="text-sm text-muted-foreground">{section.description}</p>}
              <div className="mt-3 inline-flex items-center gap-2 rounded-xl bg-zinc-900 px-4 py-2.5">
                <code className="text-xs text-zinc-400">Base URL</code>
                <code className="text-xs text-jungle-green-400">{BASE}</code>
              </div>
            </div>

            <div className="space-y-3">
              {section.endpoints.map((ep, i) => <EndpointCard key={i} ep={ep} />)}
            </div>

            {section.id === 'webhooks' && (
              <div className="mt-6 rounded-2xl bg-zinc-900 p-5 shadow-sm">
                <p className="mb-3 text-sm font-semibold text-zinc-300">Ejemplo: recibir webhook en C# (.NET)</p>
                <pre className="overflow-x-auto text-xs text-jungle-green-300">{`[HttpPost("/api/kubo-webhook")]
public async Task<IActionResult> KuboWebhook([FromBody] JsonElement body)
{
    var evt     = body.GetProperty("event").GetString();
    var payload = body.GetProperty("payload");

    if (evt == "message.received")
    {
        var phone   = payload.GetProperty("contact_phone").GetString();
        var message = payload.GetProperty("body").GetString();
        var channel = payload.GetProperty("channel").GetString();
        await _crmService.UpdateContactMessage(phone, message, channel);
    }
    return Ok();
}`}</pre>
              </div>
            )}

            {section.id === 'whatsapp' && (
              <div className="mt-6 rounded-2xl bg-zinc-900 p-5 shadow-sm">
                <p className="mb-3 text-sm font-semibold text-zinc-300">Ejemplo: mostrar QR en tu CRM (JavaScript)</p>
                <pre className="overflow-x-auto text-xs text-jungle-green-300">{`async function showQR(accountId, token) {
  const interval = setInterval(async () => {
    const res = await fetch(\`\${BASE_URL}/whatsapp/accounts/\${accountId}/qr\`, {
      headers: { Authorization: \`Bearer \${token}\` }
    });
    const data = await res.json();
    if (data.status === 'connected') { clearInterval(interval); return; }
    if (data.qrBase64) document.getElementById('qr-img').src = data.qrBase64;
  }, 3000);
}`}</pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
