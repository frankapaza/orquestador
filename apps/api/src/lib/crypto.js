import crypto from 'node:crypto'
import { env } from '../config/env.js'

const ALGO = 'aes-256-gcm'
const ENC_PREFIX = 'enc:'

function getKey() {
  const hex = env.CREDENTIALS_ENCRYPTION_KEY
  if (hex && hex.length === 64) return Buffer.from(hex, 'hex')
  // Dev fallback — NOT safe for production
  return Buffer.alloc(32, 'kubo-dev-key-not-for-production!')
}

export function encrypt(text) {
  const iv     = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv)
  const enc    = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  const tag    = cipher.getAuthTag()
  return `${ENC_PREFIX}${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`
}

export function decrypt(stored) {
  if (typeof stored !== 'string' || !stored.startsWith(ENC_PREFIX)) return stored
  const [ivHex, tagHex, encHex] = stored.slice(ENC_PREFIX.length).split(':')
  const decipher = crypto.createDecipheriv(ALGO, getKey(), Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
  return Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()]).toString('utf8')
}

export function encryptCredentials(creds) {
  return Object.fromEntries(Object.entries(creds).map(([k, v]) => [k, typeof v === 'string' ? encrypt(v) : v]))
}

export function decryptCredentials(creds) {
  return Object.fromEntries(Object.entries(creds).map(([k, v]) => [k, typeof v === 'string' ? decrypt(v) : v]))
}
