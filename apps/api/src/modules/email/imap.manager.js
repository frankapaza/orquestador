// Gestor de recepción de correo en TIEMPO REAL vía IMAP IDLE.
//
// Espejo conceptual de baileys.manager: mantiene una conexión IMAP persistente
// por cuenta (con imap_enabled = true) y, cuando llega un correo, lo parsea,
// lo empareja con el envío original (In-Reply-To/References → message_id),
// lo guarda en email_inbound y lo empuja por el EventBus (SSE) en vivo.
//
// IMAP IDLE: imapflow entra en IDLE automáticamente al abrir el buzón sin otras
// operaciones; emite 'exists' cuando el servidor avisa de correo nuevo (push,
// no polling). Reconexión automática ante caídas.
import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { sql } from '../../lib/db.js'
import { bus } from '../../lib/eventBus.js'
import { dispatchWebhook } from '../webhook-subscriptions/dispatcher.js'

function log(msg)  { console.log('[IMAP] ' + msg) }
function logErr(m) { console.error('[IMAP] ' + m) }

function stripHtml(html) {
  return String(html || '').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

// Deriva el host IMAP del SMTP cuando la cuenta no lo tiene seteado.
function deriveImapHost(smtpHost) {
  if (!smtpHost) return null
  const h = String(smtpHost).toLowerCase().trim()
  if (h.includes('gmail'))                              return 'imap.gmail.com'
  if (h.includes('office365') || h.includes('outlook')) return 'outlook.office365.com'
  if (h.startsWith('smtp.'))                            return 'imap.' + h.slice(5)
  return h
}

class ImapManager {
  constructor() {
    /** @type {Map<string, { client: ImapFlow, account: any, stopped: boolean }>} */
    this.conns = new Map()
  }

  // Arranca todas las cuentas con IMAP habilitado (llamado en el boot del API).
  async initAll() {
    try {
      const accounts = await sql`
        SELECT ea.*, d.client_id
        FROM email_accounts ea
        JOIN domains d ON d.id = ea.domain_id
        WHERE ea.imap_enabled = true AND ea.is_active = true
      `
      log(`Inicializando ${accounts.length} cuenta(s) IMAP...`)
      for (const acc of accounts) this.connect(acc).catch(e => logErr(`init ${acc.email}: ${e.message}`))
    } catch (e) {
      logErr('initAll: ' + e.message)
    }
  }

  // Reconcilia una cuenta puntual tras crear/editar (conecta o desconecta según estado).
  async reconcile(accountId) {
    try {
      const [acc] = await sql`
        SELECT ea.*, d.client_id
        FROM email_accounts ea
        JOIN domains d ON d.id = ea.domain_id
        WHERE ea.id = ${accountId}
      `
      if (!acc) { await this.disconnect(accountId); return }
      const debeEstar = acc.imap_enabled && acc.is_active
      if (debeEstar) {
        await this.disconnect(accountId)   // reinicia con credenciales frescas
        await this.connect(acc)
      } else {
        await this.disconnect(accountId)
      }
    } catch (e) { logErr('reconcile: ' + e.message) }
  }

  async connect(acc) {
    if (this.conns.has(acc.id)) return

    // Credenciales IMAP: usa las propias o las deriva del SMTP (mismo buzón).
    const imapHost = acc.imap_host || deriveImapHost(acc.smtp_host)
    const imapUser = acc.imap_user || acc.smtp_user
    const imapPass = acc.imap_pass || acc.smtp_pass
    if (!imapHost || !imapUser || !imapPass) {
      logErr(`${acc.email} sin credenciales IMAP derivables; se omite`)
      return
    }

    const client = new ImapFlow({
      host: imapHost,
      port: acc.imap_port || 993,
      secure: acc.imap_tls !== false,
      auth: { user: imapUser, pass: imapPass },
      logger: false,
      emitLogs: false,
    })
    const state = { client, account: acc, stopped: false }
    this.conns.set(acc.id, state)

    client.on('error', err => logErr(`${acc.email} error: ${err?.message || err}`))
    client.on('close', () => {
      if (state.stopped) return
      this.conns.delete(acc.id)
      log(`${acc.email} conexión cerrada; reintentando en 10s`)
      setTimeout(() => this.connect(acc).catch(() => {}), 10000)
    })
    // Push del servidor: hay correo nuevo en el buzón.
    client.on('exists', () => { this.fetchNuevos(state).catch(e => logErr(`fetch ${acc.email}: ${e.message}`)) })

    try {
      await client.connect()
      await client.mailboxOpen('INBOX')

      // Primera vez: marca el punto actual y NO procesa el histórico (solo lo nuevo de aquí en más).
      if (acc.imap_last_uid == null) {
        const status = await client.status('INBOX', { uidNext: true })
        const baseUid = Math.max(0, (status.uidNext || 1) - 1)
        acc.imap_last_uid = baseUid
        await sql`UPDATE email_accounts SET imap_last_uid = ${baseUid} WHERE id = ${acc.id}`
        log(`${acc.email} conectado (IDLE). Base UID=${baseUid}`)
      } else {
        log(`${acc.email} conectado (IDLE). last_uid=${acc.imap_last_uid}`)
        await this.fetchNuevos(state)   // procesa lo que haya entrado mientras estuvo caído
      }
    } catch (e) {
      logErr(`${acc.email} no conectó: ${e.message}`)
      this.conns.delete(acc.id)
      if (!state.stopped) setTimeout(() => this.connect(acc).catch(() => {}), 30000)
    }
  }

  async disconnect(accountId) {
    const s = this.conns.get(accountId)
    if (!s) return
    s.stopped = true
    this.conns.delete(accountId)
    try { await s.client.logout() } catch { try { s.client.close() } catch {} }
  }

  // Trae los correos con UID mayor al último procesado y los maneja.
  async fetchNuevos(state) {
    const { client, account } = state
    const lock = await client.getMailboxLock('INBOX')
    try {
      const since = account.imap_last_uid || 0
      let maxUid = since
      for await (const msg of client.fetch({ uid: `${since + 1}:*` }, { uid: true, source: true, envelope: true })) {
        if (msg.uid <= since) continue
        try { await this.handleMessage(account, msg) }
        catch (e) { logErr(`handle ${account.email} uid ${msg.uid}: ${e.message}`) }
        if (msg.uid > maxUid) maxUid = msg.uid
      }
      if (maxUid > since) {
        account.imap_last_uid = maxUid
        await sql`UPDATE email_accounts SET imap_last_uid = ${maxUid} WHERE id = ${account.id}`
      }
    } finally {
      lock.release()
    }
  }

  async handleMessage(account, msg) {
    const parsed     = await simpleParser(msg.source)
    const fromAddr   = parsed.from?.value?.[0]?.address || ''
    const fromName   = parsed.from?.value?.[0]?.name || ''
    const toAddr     = parsed.to?.value?.[0]?.address || account.email
    const subject    = parsed.subject || ''
    const text       = parsed.text || ''
    const html       = parsed.html || ''
    const messageId  = parsed.messageId || null
    const inReplyTo  = parsed.inReplyTo || null
    const refs       = parsed.references
      ? (Array.isArray(parsed.references) ? parsed.references : [parsed.references])
      : []
    const received   = parsed.date || new Date()

    // Empareja la respuesta con el envío original por Message-ID.
    const candidatos = [inReplyTo, ...refs].filter(Boolean)
    let tx = null
    if (candidatos.length) {
      const rows = await sql`
        SELECT id, contact_id FROM transactional_emails
        WHERE client_id = ${account.client_id} AND message_id IN ${sql(candidatos)}
        ORDER BY sent_at DESC LIMIT 1
      `
      tx = rows[0] ?? null
    }

    // Resuelve el contacto: por el envío original, o por el correo remitente.
    let contactId = tx?.contact_id ?? null
    if (!contactId && fromAddr) {
      const [ct] = await sql`
        SELECT ce.contact_id FROM contact_emails ce
        JOIN contacts c ON c.id = ce.contact_id
        WHERE lower(ce.email) = lower(${fromAddr}) AND c.client_id = ${account.client_id}
        LIMIT 1
      `
      contactId = ct?.contact_id ?? null
    }

    const [row] = await sql`
      INSERT INTO email_inbound
        (client_id, email_account_id, contact_id, transactional_email_id,
         from_email, from_name, to_email, subject, body_text, body_html,
         message_id, in_reply_to, imap_uid, received_at)
      VALUES
        (${account.client_id}, ${account.id}, ${contactId}, ${tx?.id ?? null},
         ${fromAddr}, ${fromName}, ${toAddr}, ${subject}, ${text}, ${html},
         ${messageId}, ${inReplyTo}, ${msg.uid}, ${received})
      ON CONFLICT (email_account_id, message_id) WHERE message_id IS NOT NULL DO NOTHING
      RETURNING id
    `
    if (!row) return   // duplicado (re-lectura)

    log(`${account.email} ← respuesta de ${fromAddr} (contacto ${contactId ?? 'desconocido'})`)

    const payloadEvento = {
      channel: 'email',
      id: row.id,
      contact_id: contactId,
      account_email: account.email,
      from_email: fromAddr,
      from_name: fromName,
      to_email: toAddr,
      subject,
      body: text || stripHtml(html),
      message_id: messageId,
      transactional_email_id: tx?.id ?? null,
      received_at: received,
    }

    // Empuja en vivo al dashboard del Orquestador (SSE).
    bus.emit(account.client_id, { type: 'email:inbound', ...payloadEvento })

    // Notifica a sistemas externos (MCOB) en tiempo real vía webhook.
    dispatchWebhook(account.client_id, 'email.received', payloadEvento).catch(() => {})
  }
}

export const imapManager = new ImapManager()
