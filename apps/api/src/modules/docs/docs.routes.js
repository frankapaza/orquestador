import crypto from 'node:crypto'

function makeUrl(raw) {
  // Convierte string de URL a objeto Postman v2.1 correcto
  const url = raw.replace('{{base_url}}', '')
  const parts = url.split('?')
  const pathParts = parts[0].split('/').filter(Boolean)
  const query = parts[1] ? parts[1].split('&').map(q => {
    const [key, value] = q.split('=')
    return { key, value: value ?? '' }
  }) : []

  return {
    raw,
    host: ['{{base_url}}'],
    path: pathParts,
    ...(query.length ? { query } : {}),
  }
}

function makeRequest({ method, url, body, description, headers = [] }) {
  const req = {
    method,
    header: [
      { key: 'Content-Type', value: 'application/json', type: 'text' },
      ...headers,
    ],
    url: makeUrl(url),
  }

  if (description) req.description = description

  if (body) {
    req.body = {
      mode: 'raw',
      raw: JSON.stringify(body, null, 2),
      options: { raw: { language: 'json' } },
    }
  }

  return req
}

function folder(name, description, endpoints) {
  return {
    name,
    description,
    item: endpoints.map(ep => ({
      name: ep.name,
      event: ep.tests ?? [],
      request: makeRequest(ep),
      response: [],
    })),
  }
}

export async function docsRoutes(fastify) {

  fastify.get('/docs/postman', async (req, reply) => {
    const base = process.env.TRACKING_BASE_URL ?? 'http://localhost:3002'
    const apiBase = `${base}/api/v1`

    const collection = {
      info: {
        _postman_id: crypto.randomUUID(),
        name: 'Kubo Orquestador API',
        description: 'API REST para integrar el inbox omnicanal de Kubo (WhatsApp, SMS, Email) con CRMs externos. Incluye envío de mensajes, gestión de contactos, conversaciones en tiempo real y webhooks.',
        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      },

      variable: [
        { key: 'base_url',      value: apiBase,            type: 'default', description: 'URL base de la API' },
        { key: 'token',         value: 'PEGAR_TOKEN_AQUI', type: 'default', description: 'JWT del admin/owner' },
        { key: 'token_asesor',  value: 'PEGAR_TOKEN_ASESOR', type: 'default', description: 'JWT del asesor (se llena con Login Asesor)' },
      ],

      auth: {
        type: 'bearer',
        bearer: [{ key: 'token', value: '{{token}}', type: 'string' }],
      },

      item: [

        // ── 1. AUTENTICACIÓN ───────────────────────────────────────────────
        folder('1. Autenticación', 'Obtén el JWT para usar en el resto de las peticiones. Cada rol tiene su propio token.', [
          {
            name: 'Login Admin — obtener token',
            method: 'POST',
            url: '{{base_url}}/auth/login',
            body: { email: 'admin@kubo.com', password: 'Admin123!' },
            description: 'Login del administrador. Guarda el token en {{token}} automáticamente via script.',
            tests: [{
              listen: 'test',
              script: {
                type: 'text/javascript',
                exec: [
                  'const r = pm.response.json();',
                  'if (r.token) {',
                  '  pm.collectionVariables.set("token", r.token);',
                  '  pm.test("Login Admin OK - token guardado en {{token}}", () => pm.response.to.have.status(200));',
                  '}',
                ],
              },
            }],
          },
          {
            name: 'Login Asesor — obtener token',
            method: 'POST',
            url: '{{base_url}}/auth/login',
            body: { email: 'johe@kubo.com', password: 'Kubo2026!' },
            description: 'Login del asesor. Guarda el token en {{token_asesor}}. Úsalo en los endpoints "Como Asesor" para ver solo sus conversaciones y canales asignados.',
            tests: [{
              listen: 'test',
              script: {
                type: 'text/javascript',
                exec: [
                  'const r = pm.response.json();',
                  'if (r.token) {',
                  '  pm.collectionVariables.set("token_asesor", r.token);',
                  '  pm.test("Login Asesor OK - token guardado en {{token_asesor}}", () => pm.response.to.have.status(200));',
                  '  console.log("Asesor:", r.client.name, "| Rol:", r.client.role, "| member_id:", r.client.member_id);',
                  '}',
                ],
              },
            }],
          },
          {
            name: 'Mi perfil (/auth/me)',
            method: 'GET',
            url: '{{base_url}}/auth/me',
            description: 'Devuelve nombre, email, rol y member_id. Cambia el Bearer token para ver el perfil de admin o asesor.',
          },
        ]),

        // ── 2. CONTACTOS ───────────────────────────────────────────────────
        folder('2. Contactos', 'Gestiona listas y contactos. Cada contacto puede tener múltiples teléfonos y emails con etiquetas.', [
          {
            name: 'Listar listas',
            method: 'GET',
            url: '{{base_url}}/lists',
          },
          {
            name: 'Crear lista',
            method: 'POST',
            url: '{{base_url}}/lists',
            body: { name: 'Clientes CRM', description: 'Importados desde mi sistema' },
          },
          {
            name: 'Listar contactos de una lista',
            method: 'GET',
            url: '{{base_url}}/lists/ID_DE_LA_LISTA/contacts?page=1&limit=50',
            description: 'Reemplaza ID_DE_LA_LISTA con el ID real.',
          },
          {
            name: 'Agregar contacto individual',
            method: 'POST',
            url: '{{base_url}}/lists/ID_DE_LA_LISTA/contacts',
            body: { email: 'juan@empresa.com', phone: '+51910462070', first_name: 'Juan', last_name: 'Pérez' },
            description: 'Al menos email o phone es obligatorio. Los teléfonos y emails adicionales se agregan después con los endpoints de phones/emails.',
          },
          {
            name: 'Buscar contacto',
            method: 'GET',
            url: '{{base_url}}/contacts/search?q=juan&limit=10',
            description: 'Busca por nombre, email o teléfono. Ahora también busca en todos los teléfonos y emails adicionales del contacto.',
          },
          {
            name: 'Vista 360° del contacto',
            method: 'GET',
            url: '{{base_url}}/contacts/ID_DEL_CONTACTO/360',
            description: 'Devuelve historial completo. Incluye phones[] y emails[] con todos los teléfonos/emails del contacto y su etiqueta (Principal, Trabajo, Casa, etc.).',
          },
          {
            name: 'Agregar teléfono al contacto',
            method: 'POST',
            url: '{{base_url}}/contacts/ID_DEL_CONTACTO/phones',
            body: { phone: '+51999123456', label: 'Trabajo' },
            description: 'label puede ser: Trabajo, Casa, Móvil, Otro. Si se envía label "Principal" (o es el primer teléfono) queda como principal y reemplaza al anterior. Los teléfonos viven solo en contact_phones.',
          },
          {
            name: 'Marcar teléfono como principal',
            method: 'PATCH',
            url: '{{base_url}}/contacts/ID_DEL_CONTACTO/phones/ID_DEL_TELEFONO/primary',
            description: 'El teléfono marcado como primario es el que aparece en el inbox y se usa al enviar mensajes.',
          },
          {
            name: 'Eliminar teléfono',
            method: 'DELETE',
            url: '{{base_url}}/contacts/ID_DEL_CONTACTO/phones/ID_DEL_TELEFONO',
            description: 'Si era el primario, el siguiente teléfono disponible queda como primario automáticamente.',
          },
          {
            name: 'Agregar email al contacto',
            method: 'POST',
            url: '{{base_url}}/contacts/ID_DEL_CONTACTO/emails',
            body: { email: 'juan.trabajo@empresa.com', label: 'Trabajo' },
            description: 'Mismos labels que teléfonos. El primero queda como primario automáticamente.',
          },
          {
            name: 'Marcar email como principal',
            method: 'PATCH',
            url: '{{base_url}}/contacts/ID_DEL_CONTACTO/emails/ID_DEL_EMAIL/primary',
            description: 'El email marcado como primario es el que se usa para envíos y campañas.',
          },
          {
            name: 'Eliminar email',
            method: 'DELETE',
            url: '{{base_url}}/contacts/ID_DEL_CONTACTO/emails/ID_DEL_EMAIL',
            description: 'Si era el primario, el siguiente email disponible queda como primario automáticamente.',
          },
        ]),

        // ── 3. ENVIAR MENSAJES ─────────────────────────────────────────────
        folder('3. Enviar mensajes', 'Envía mensajes individuales por WhatsApp, SMS o Email.', [
          {
            name: 'Enviar WhatsApp o SMS (texto)',
            method: 'POST',
            url: '{{base_url}}/messages/send',
            body: { channel: 'whatsapp', account_id: 'ID_CUENTA_WA', to: '+51910462070', message: 'Hola desde el CRM!' },
            description: 'channel puede ser "whatsapp" o "sms". Crea la conversación automáticamente.',
          },
          {
            name: 'Enviar WhatsApp con imagen/archivo',
            method: 'POST',
            url: '{{base_url}}/messages/send',
            body: { channel: 'whatsapp', account_id: 'ID_CUENTA_WA', to: '+51910462070', message: '', media_url: 'https://mi-servidor.com/archivo.jpg', media_type: 'image' },
            description: 'media_type puede ser: "image", "video", "audio", "document". Sube el archivo primero con POST /media/upload para obtener la URL.',
          },
          {
            name: 'Enviar email individual a contacto',
            method: 'POST',
            url: '{{base_url}}/contacts/ID_DEL_CONTACTO/send-email',
            body: {
              subject:      'Hola {{first_name}}, tienes un mensaje',
              from_name:    'Equipo de ventas',
              html_content: '<p>Hola <strong>{{first_name}}</strong>,</p><p>Tu mensaje aquí.</p>',
              account_id:   'ID_CUENTA_EMAIL',
              reply_to:     'respuestas@tuempresa.com',
              cc:           ['supervisor@empresa.com'],
              bcc:          ['registro@empresa.com'],
            },
            description: 'Variables: {{first_name}}, {{last_name}}, {{email}}. account_id (opcional): cuenta SMTP emisora; si se omite se auto-selecciona. CC = Copia, BCC = Copia oculta (arrays). El envío se registra en la vista 360 del contacto.',
          },
          {
            name: 'Listar cuentas de correo (account_id)',
            method: 'GET',
            url: '{{base_url}}/email/accounts',
            description: 'Devuelve las cuentas SMTP activas del cliente (id, email, dominio). El "id" es el account_id que usas en /email/send y en send-email para elegir DESDE qué correo enviar.',
          },
          {
            name: 'Enviar email desde cuenta específica (CRM)',
            method: 'POST',
            url: '{{base_url}}/email/send',
            body: {
              account_id:   'ID_CUENTA_EMAIL',
              to:           'cliente@correo.com',
              subject:      'Asunto del correo',
              html_content: '<p>Contenido del correo.</p>',
              from_name:    'Cobranzas',
              cc:           ['copia@empresa.com'],
              bcc:          ['oculto@empresa.com'],
            },
            description: 'Envío transaccional 1:1 DESDE la cuenta SMTP indicada (account_id, de GET /email/accounts) hacia cualquier destino (no necesita ser un contacto). Pensado para integrar desde CRMs externos (ej. MCOB). Valida que la cuenta pertenezca al cliente del token. Si el destino coincide con un contacto, queda registrado en su vista 360.',
          },
        ]),

        // ── 4. INBOX / CONVERSACIONES ──────────────────────────────────────
        folder('4. Inbox — Conversaciones', 'Lee, responde y gestiona conversaciones en tiempo real desde tu CRM.', [
          {
            name: 'Listar conversaciones (inbox)',
            method: 'GET',
            url: '{{base_url}}/conversations?status=open&channel=whatsapp',
            description: 'Filtra por status (open/closed/pending) y channel (whatsapp/sms). Para asesores, filtra automáticamente a sus canales asignados.',
          },
          {
            name: 'Detalle de conversación + mensajes',
            method: 'GET',
            url: '{{base_url}}/conversations/ID_DE_CONVERSACION',
            description: 'Devuelve la conversación con todos sus mensajes en orden cronológico. Los mensajes multimedia incluyen media_url y media_type (image/video/audio/document).',
          },
          {
            name: 'Subir archivo multimedia',
            method: 'POST',
            url: '{{base_url}}/media/upload',
            description: 'PASO 1 antes de enviar media. Sube el archivo con multipart/form-data (campo: "file"). Formatos: jpg/png/gif/webp, mp4, mp3/ogg/opus, pdf/doc/docx/txt. Máximo 16 MB. Devuelve la URL para usar en el reply.',
            headers: [{ key: 'Content-Type', value: 'multipart/form-data', type: 'text' }],
          },
          {
            name: 'Responder en conversación (texto)',
            method: 'POST',
            url: '{{base_url}}/conversations/ID_DE_CONVERSACION/reply',
            body: { body: 'Claro, en qué puedo ayudarte?' },
            description: 'Envía respuesta de texto por el mismo canal (WA o SMS).',
          },
          {
            name: 'Responder en conversación (con archivo)',
            method: 'POST',
            url: '{{base_url}}/conversations/ID_DE_CONVERSACION/reply',
            body: { media_url: 'http://localhost:3002/uploads/uuid.pdf', media_type: 'document', media_caption: 'propuesta.pdf' },
            description: 'PASO 2: usa la URL obtenida de /media/upload. media_type: "image" | "video" | "audio" | "document". body es opcional si envías media.',
          },
          {
            name: 'Cambiar estado de conversación',
            method: 'PATCH',
            url: '{{base_url}}/conversations/ID_DE_CONVERSACION/status',
            body: { status: 'closed' },
            description: 'Estados: "open", "closed", "pending".',
          },
        ]),

        // ── 5. WHATSAPP ────────────────────────────────────────────────────
        folder('5. WhatsApp — Vincular número', 'Conecta y gestiona números de WhatsApp con Baileys.', [
          {
            name: 'Listar cuentas WhatsApp',
            method: 'GET',
            url: '{{base_url}}/whatsapp/accounts',
            description: 'Para asesores, devuelve solo las cuentas asignadas a ellos.',
          },
          {
            name: 'Obtener QR para vincular (polling)',
            method: 'GET',
            url: '{{base_url}}/whatsapp/accounts/ID_CUENTA_WA/qr',
            description: 'Llama cada 3 segundos. Devuelve { status, qrBase64 }. Muestra qrBase64 como <img src={qrBase64}>. status puede ser: starting, connecting, qr, connected, disconnected.',
          },
          {
            name: 'Código de emparejamiento (8 dígitos)',
            method: 'POST',
            url: '{{base_url}}/whatsapp/accounts/ID_CUENTA_WA/pairing-code',
            body: { phone_number: '+51910462070' },
            description: 'Alternativa al QR. Devuelve { pairing_code: "ABCD-EFGH" }. El usuario lo ingresa en WhatsApp → Dispositivos vinculados → Vincular con número.',
          },
          {
            name: 'Verificar estado de conexión',
            method: 'GET',
            url: '{{base_url}}/whatsapp/accounts/ID_CUENTA_WA/status',
          },
          {
            name: 'Reconectar sesión',
            method: 'POST',
            url: '{{base_url}}/whatsapp/accounts/ID_CUENTA_WA/reconnect',
            description: 'Reinicia la sesión sin borrar credenciales. Útil cuando aparece "Sin conectar" tras reiniciar el servidor.',
          },
        ]),

        // ── 6. SMS ────────────────────────────────────────────────────────
        folder('6. SMS — Android Gateway', 'Envía SMS usando un celular Android como gateway. Obtén el account_id de GET /sms/accounts y úsalo en POST /messages/send con channel:"sms".', [
          {
            name: 'Listar cuentas SMS (obtener account_id)',
            method: 'GET',
            url: '{{base_url}}/sms/accounts',
            description: 'Devuelve todas las cuentas SMS configuradas. El campo "id" de cada cuenta es el account_id que debes usar en POST /messages/send con channel:"sms". Igual que WhatsApp pero para SMS.',
          },
          {
            name: 'Crear cuenta SMS (modo cloud)',
            method: 'POST',
            url: '{{base_url}}/sms/accounts',
            body: {
              name:               'Mi celular',
              phone_number:       '+51910462070',
              gateway_url:        'https://api.sms-gate.app',
              api_key:            'usuario:contraseña',
              daily_limit:        100,
              delay_min:          5,
              delay_max:          15,
              active_hours_start: '08:00',
              active_hours_end:   '20:00',
            },
            description: 'MODO CLOUD: Instala "Android SMS Gateway" en tu celular → crea cuenta en sms-gate.app → pon tus credenciales en api_key como "usuario:contraseña". MODO LOCAL: cambia gateway_url por la IP del celular (ej: http://192.168.1.5:8080) y pon el Bearer token de la app en api_key.',
          },
          {
            name: 'Verificar gateway online',
            method: 'GET',
            url: '{{base_url}}/sms/accounts/ID_CUENTA_SMS/ping',
            description: 'Verifica si el celular Android está online. Devuelve { online: true/false }.',
          },
          {
            name: 'Enviar SMS',
            method: 'POST',
            url: '{{base_url}}/messages/send',
            body: { channel: 'sms', account_id: 'ID_CUENTA_SMS', to: '+51910462070', message: 'Hola desde Kubo!' },
            description: 'Usa el "id" obtenido de GET /sms/accounts como account_id. El mensaje se envía desde el celular Android configurado.',
          },
        ]),

        // ── 7. VISTA DEL ASESOR ────────────────────────────────────────────
        {
          name: '6. Vista del Asesor (usar {{token_asesor}})',
          description: 'Estos endpoints usan el token del asesor. El filtrado es automático: solo devuelve conversaciones y canales asignados a ese asesor. Primero ejecuta "Login Asesor" para obtener {{token_asesor}}.',
          item: [
            {
              name: 'Mis conversaciones (filtradas)',
              event: [],
              request: {
                ...makeRequest({
                  method: 'GET',
                  url: '{{base_url}}/conversations?status=open',
                  description: 'Devuelve SOLO las conversaciones de los canales asignados al asesor. Si el asesor tiene WhatsApp +51910462070 y SMS asignados, solo verá esas conversaciones.',
                }),
                auth: {
                  type: 'bearer',
                  bearer: [{ key: 'token', value: '{{token_asesor}}', type: 'string' }],
                },
              },
              response: [],
            },
            {
              name: 'Mis canales asignados',
              event: [],
              request: {
                ...makeRequest({
                  method: 'GET',
                  url: '{{base_url}}/settings/my-channels',
                  description: 'Devuelve los canales asignados al asesor: cuenta WhatsApp, cuenta SMS y cuenta de email. Útil para saber qué cuentas usar al enviar mensajes.',
                }),
                auth: {
                  type: 'bearer',
                  bearer: [{ key: 'token', value: '{{token_asesor}}', type: 'string' }],
                },
              },
              response: [],
            },
            {
              name: 'Enviar mensaje como asesor',
              event: [],
              request: {
                ...makeRequest({
                  method: 'POST',
                  url: '{{base_url}}/messages/send',
                  body: { channel: 'whatsapp', account_id: 'ID_CUENTA_WA_DEL_ASESOR', to: '+51910462070', message: 'Hola, soy tu asesor asignado' },
                  description: 'Envía un mensaje usando el token del asesor. El account_id debe ser de un canal asignado al asesor (obtenlo de "Mis canales asignados").',
                }),
                auth: {
                  type: 'bearer',
                  bearer: [{ key: 'token', value: '{{token_asesor}}', type: 'string' }],
                },
              },
              response: [],
            },
            {
              name: 'Mis conversaciones WA solo',
              event: [],
              request: {
                ...makeRequest({
                  method: 'GET',
                  url: '{{base_url}}/conversations?status=open&channel=whatsapp',
                  description: 'Filtra además por canal WhatsApp.',
                }),
                auth: {
                  type: 'bearer',
                  bearer: [{ key: 'token', value: '{{token_asesor}}', type: 'string' }],
                },
              },
              response: [],
            },
            {
              name: 'Mis conversaciones SMS solo',
              event: [],
              request: {
                ...makeRequest({
                  method: 'GET',
                  url: '{{base_url}}/conversations?status=open&channel=sms',
                  description: 'Filtra además por canal SMS.',
                }),
                auth: {
                  type: 'bearer',
                  bearer: [{ key: 'token', value: '{{token_asesor}}', type: 'string' }],
                },
              },
              response: [],
            },
            {
              name: 'Mi perfil de asesor',
              event: [],
              request: {
                ...makeRequest({
                  method: 'GET',
                  url: '{{base_url}}/auth/me',
                  description: 'Devuelve nombre, email, rol="asesor" y member_id del asesor logueado.',
                }),
                auth: {
                  type: 'bearer',
                  bearer: [{ key: 'token', value: '{{token_asesor}}', type: 'string' }],
                },
              },
              response: [],
            },
          ],
        },

        // ── 7. WEBHOOKS (antes era 6) ──────────────────────────────────────
        folder('6. Webhooks — Notificaciones al CRM', 'Recibe eventos en tiempo real cuando llegan mensajes.', [
          {
            name: 'Listar suscripciones',
            method: 'GET',
            url: '{{base_url}}/webhook-subscriptions',
          },
          {
            name: 'Crear suscripción',
            method: 'POST',
            url: '{{base_url}}/webhook-subscriptions',
            body: {
              name: 'Mi CRM C#',
              url: 'https://mi-crm.com/api/kubo-webhook',
              events: ['message.received', 'message.sent', 'message.read'],
              secret: 'mi-secret-opcional',
            },
            description: 'Eventos disponibles: message.received, message.sent, message.delivered, message.read, conversation.created. Kubo firmará con HMAC-SHA256 en X-Kubo-Signature si configuras secret.',
          },
          {
            name: 'Probar webhook',
            method: 'POST',
            url: '{{base_url}}/webhook-subscriptions/ID_SUSCRIPCION/test',
            description: 'Envía un evento de prueba a tu URL para verificar la integración.',
          },
          {
            name: 'Eliminar suscripción',
            method: 'DELETE',
            url: '{{base_url}}/webhook-subscriptions/ID_SUSCRIPCION',
          },
        ]),

      ],
    }

    reply
      .header('Content-Type', 'application/json; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="Kubo-Orquestador-API.postman_collection.json"')
    return collection
  })
}
