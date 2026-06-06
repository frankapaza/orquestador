import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  isJidBroadcast,
  makeCacheableSignalKeyStore,
  downloadMediaMessage,
} from '@whiskeysockets/baileys'
import QRCode from 'qrcode'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { mkdirSync, existsSync, rmSync, readFileSync, writeFileSync } from 'fs'
import crypto from 'crypto'
import pino from 'pino'
import { sql } from '../../lib/db.js'
import { processIncoming, updateMessageStatus } from '../channels/message.service.js'

const __dirname  = dirname(fileURLToPath(import.meta.url))
const SESSIONS_DIR = join(__dirname, '..', '..', '..', 'sessions')
if (!existsSync(SESSIONS_DIR)) mkdirSync(SESSIONS_DIR, { recursive: true })

const UPLOADS_DIR = join(__dirname, '..', '..', '..', 'uploads')
if (!existsSync(UPLOADS_DIR)) mkdirSync(UPLOADS_DIR, { recursive: true })

const MIME_TO_EXT = {
  'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png',
  'image/gif': '.gif',  'image/webp': '.webp',
  'video/mp4': '.mp4',  'video/quicktime': '.mov',
  'audio/ogg': '.ogg',  'audio/mp4': '.m4a', 'audio/mpeg': '.mp3',
  'application/pdf': '.pdf',
}

async function saveIncomingMedia(m, sock, silentLog) {
  let mediaType = null
  let mimetype  = null

  if      (m.message?.imageMessage)    { mediaType = 'image';    mimetype = m.message.imageMessage.mimetype }
  else if (m.message?.stickerMessage)  { mediaType = 'image';    mimetype = m.message.stickerMessage.mimetype }
  else if (m.message?.videoMessage)    { mediaType = 'video';    mimetype = m.message.videoMessage.mimetype }
  else if (m.message?.audioMessage)    { mediaType = 'audio';    mimetype = m.message.audioMessage.mimetype }
  else if (m.message?.documentMessage) { mediaType = 'document'; mimetype = m.message.documentMessage.mimetype }

  if (!mediaType) return { mediaUrl: null, mediaType: null }

  try {
    const buffer   = await downloadMediaMessage(m, 'buffer', {}, { logger: silentLog, reuploadRequest: sock.updateMediaMessage })
    const ext      = MIME_TO_EXT[mimetype?.split(';')[0]?.trim()] ?? '.bin'
    const fileName = `${crypto.randomUUID()}${ext}`
    writeFileSync(join(UPLOADS_DIR, fileName), buffer)
    const baseUrl  = process.env.TRACKING_BASE_URL ?? 'http://localhost:3002'
    return { mediaUrl: `${baseUrl}/uploads/${fileName}`, mediaType }
  } catch (err) {
    console.error('[Baileys] Error descargando media:', err.message)
    return { mediaUrl: null, mediaType }
  }
}

const silentLogger = pino({ level: 'silent' })

// Navegadores conocidos que WhatsApp acepta bien
const WA_BROWSER = ['Ubuntu', 'Chrome', '22.0.0.75']

class BaileysManager {
  constructor() {
    this.sessions = new Map()
    // instanceName → pairingCode string temporal
    this.pairingCodes = new Map()
  }

  sessionDir(name) {
    const dir = join(SESSIONS_DIR, name)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    return dir
  }

  toJid(phone) {
    return phone.replace(/\D/g, '') + '@s.whatsapp.net'
  }

  // Resuelve un JID a número de teléfono normalizado (+código)
  // Maneja: 51986095857@s.whatsapp.net, 67993744715995@lid
  resolvePhone(jid, instanceName) {
    if (!jid) return null

    // JID normal: número@s.whatsapp.net
    if (jid.includes('@s.whatsapp.net')) {
      const num = jid.replace('@s.whatsapp.net', '')
      return '+' + num
    }

    // LID: número@lid — buscar en archivo reverse mapping
    if (jid.includes('@lid')) {
      const lid = jid.replace('@lid', '')
      try {
        const file = join(this.sessionDir(instanceName), `lid-mapping-${lid}_reverse.json`)
        if (existsSync(file)) {
          const phone = JSON.parse(readFileSync(file, 'utf8'))
          return '+' + phone
        }
      } catch {}
      // Si no hay mapping, usar el LID como fallback
      return '+' + jid.replace('@lid', '')
    }

    return '+' + jid.replace(/[^0-9]/g, '')
  }

  async startSession(account, { usePairingCode = false } = {}) {
    const name = account.instance_name

    // Si ya hay sesión activa, no duplicar
    if (this.sessions.has(name)) {
      const s = this.sessions.get(name)
      if (s.status === 'connected') return
      // Si estaba en otro estado, reiniciar
      try { s.socket?.end() } catch {}
      this.sessions.delete(name)
    }

    this.sessions.set(name, { status: 'connecting', qrBase64: null, pairingCode: null, account })

    const dir = this.sessionDir(name)
    const { state, saveCreds } = await useMultiFileAuthState(dir)
    const { version } = await fetchLatestBaileysVersion()

    const sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys:  makeCacheableSignalKeyStore(state.keys, silentLogger),
      },
      logger:                       silentLogger,
      printQRInTerminal:            false,
      browser:                      WA_BROWSER,
      generateHighQualityLinkPreview: false,
      syncFullHistory:              false,
      markOnlineOnConnect:          false,
      // Usar código de emparejamiento si se solicita
      ...(usePairingCode ? { mobile: false } : {}),
    })

    const session = this.sessions.get(name)
    session.socket = sock

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
      const s = this.sessions.get(name)
      if (!s) return

      // Momento clave: WhatsApp pide autenticación (envía QR)
      // Es aquí donde podemos elegir entre QR o código de emparejamiento
      if (qr) {
        console.log(`[Baileys][${name}] QR recibido, usePairingCode=${usePairingCode}, phone=${account.phone_number}`)

        if (usePairingCode && account.phone_number) {
          s.qrBase64 = await QRCode.toDataURL(qr) // guardar QR como fallback
          try {
            const phone = account.phone_number.replace(/\D/g, '')
            console.log(`[Baileys][${name}] Llamando requestPairingCode(${phone})`)
            const code = await sock.requestPairingCode(phone)
            console.log(`[Baileys][${name}] Resultado requestPairingCode:`, typeof code, JSON.stringify(code))
            if (code) {
              s.pairingCode = code.match(/.{1,4}/g)?.join('-') ?? code
              s.status      = 'awaiting_code'
              console.log(`[Baileys][${name}] Código formateado:`, s.pairingCode)
            } else {
              console.warn(`[Baileys][${name}] requestPairingCode retornó vacío`)
              s.status = 'qr' // mostrar QR si no hay código
            }
          } catch (err) {
            console.error(`[Baileys][${name}] Error requestPairingCode:`, err.message)
            s.error  = err.message
            s.status = 'qr' // fallback a QR
          }
        } else {
          s.qrBase64 = await QRCode.toDataURL(qr)
          s.status   = 'qr'
          await sql`UPDATE whatsapp_accounts SET is_connected = false WHERE instance_name = ${name}`
        }
      }

      if (connection === 'open') {
        s.status      = 'connected'
        s.qrBase64    = null
        s.pairingCode = null
        const phone = sock.user?.id?.split(':')[0] ?? null
        await sql`
          UPDATE whatsapp_accounts
          SET is_connected = true,
              phone_number = COALESCE(phone_number, ${phone ? '+' + phone : null})
          WHERE instance_name = ${name}
        `
      }

      if (connection === 'close') {
        const code      = lastDisconnect?.error?.output?.statusCode
        const loggedOut = code === DisconnectReason.loggedOut

        console.log(`[Baileys][${name}] Conexión cerrada. Código: ${code}, LoggedOut: ${loggedOut}`)
        console.log(`[Baileys][${name}] Error:`, lastDisconnect?.error?.message)

        s.status = 'disconnected'
        await sql`UPDATE whatsapp_accounts SET is_connected = false WHERE instance_name = ${name}`

        if (loggedOut) {
          this.sessions.delete(name)
          // Borrar credenciales: la sesión fue revocada desde el teléfono
          try { rmSync(this.sessionDir(name), { recursive: true, force: true }) } catch {}
          console.log(`[Baileys][${name}] Sesión revocada — credenciales eliminadas`)
        } else {
          // Reconectar en 5s
          this.sessions.delete(name)
          console.log(`[Baileys][${name}] Reconectando en 5s...`)
          setTimeout(() => this.startSession(account).catch(e => console.error(`[Baileys][${name}] Error reconexión:`, e.message)), 5000)
        }
      }
    })

    // Mensajes entrantes
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return
      const [acc] = await sql`SELECT * FROM whatsapp_accounts WHERE instance_name = ${name}`
      if (!acc) return

      for (const m of messages) {
        if (m.key.fromMe || isJidBroadcast(m.key.remoteJid ?? '')) continue

        // Resolver número real (maneja @s.whatsapp.net y @lid)
        const contactPhone = this.resolvePhone(m.key.remoteJid, name)
        if (!contactPhone) continue

        const body = m.message?.conversation
                  ?? m.message?.extendedTextMessage?.text
                  ?? m.message?.imageMessage?.caption
                  ?? m.message?.videoMessage?.caption
                  ?? m.message?.documentMessage?.caption
                  ?? null

        const { mediaUrl, mediaType } = await saveIncomingMedia(m, sock, silentLogger)

        await processIncoming({
          clientId: acc.client_id, channel: 'whatsapp',
          accountId: acc.id, accountType: 'whatsapp',
          contactPhone, contactName: m.pushName ?? null,
          body, mediaUrl, mediaType, externalId: m.key.id,
        })
      }
    })

    // Estado de mensajes enviados
    sock.ev.on('message-receipt.update', async (updates) => {
      const [acc] = await sql`SELECT * FROM whatsapp_accounts WHERE instance_name = ${name}`
      if (!acc) return
      for (const { key, receipt } of updates) {
        const st = (receipt.readTimestamp || receipt.receiptTimestamp) ? 'read' : 'delivered'
        await updateMessageStatus(acc.client_id, key.id, st)
      }
    })
  }

  async stopSession(name) {
    const s = this.sessions.get(name)
    if (!s) return
    // Cerrar conexión sin logout (logout blacklistea el device key en WA)
    try { s.socket?.end(undefined) } catch {}
    this.sessions.delete(name)
    await sql`UPDATE whatsapp_accounts SET is_connected = false WHERE instance_name = ${name}`
  }

  async deleteSession(name) {
    const s = this.sessions.get(name)
    if (s) {
      try { s.socket?.end(undefined) } catch {}
      this.sessions.delete(name)
    }
    // Borrar archivos de credenciales
    try { rmSync(this.sessionDir(name), { recursive: true, force: true }) } catch {}
    await sql`UPDATE whatsapp_accounts SET is_connected = false WHERE instance_name = ${name}`
  }

  getStatus(name) {
    return this.sessions.get(name)?.status ?? 'not_started'
  }

  getQr(name) {
    return this.sessions.get(name)?.qrBase64 ?? null
  }

  getPairingCode(name) {
    return this.sessions.get(name)?.pairingCode ?? null
  }

  getError(name) {
    return this.sessions.get(name)?.error ?? null
  }

  async send(name, { to, body, mediaUrl, mediaType, mediaCaption }) {
    const s = this.sessions.get(name)
    if (!s?.socket) throw new Error('Sesión no activa')
    if (s.status !== 'connected') throw new Error('WhatsApp no conectado. Vincula el número primero.')

    const jid = this.toJid(to)

    if (mediaUrl) {
      const typeMap = {
        image:    { image:    { url: mediaUrl }, caption: mediaCaption ?? '' },
        video:    { video:    { url: mediaUrl }, caption: mediaCaption ?? '' },
        audio:    { audio:    { url: mediaUrl }, mimetype: 'audio/mp4' },
        document: { document: { url: mediaUrl }, fileName: mediaCaption ?? 'archivo', mimetype: 'application/octet-stream' },
      }
      const sent = await s.socket.sendMessage(jid, typeMap[mediaType] ?? typeMap.image)
      return { id: sent?.key?.id }
    }

    const sent = await s.socket.sendMessage(jid, { text: body })
    return { id: sent?.key?.id }
  }

  async initAll() {
    const accounts = await sql`
      SELECT * FROM whatsapp_accounts WHERE provider = 'baileys' AND is_active = true
    `
    for (const acc of accounts) {
      this.startSession(acc).catch(e =>
        console.error(`[Baileys] Error iniciando ${acc.instance_name}:`, e.message)
      )
    }
    if (accounts.length) console.log(`[Baileys] ${accounts.length} sesión(es) cargadas`)
  }
}

export const baileysManager = new BaileysManager()
