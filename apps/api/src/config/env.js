import 'dotenv/config'

export const env = {
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  PORT: parseInt(process.env.PORT ?? '3001'),

  DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://kubo:kubo123@localhost:5432/kubo_orquestador',

  REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',

  JWT_SECRET: process.env.JWT_SECRET ?? 'change-me-in-production',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN ?? '7d',

  TRACKING_BASE_URL: process.env.TRACKING_BASE_URL ?? 'http://localhost:3001',

  SMTP_DEFAULT_HOST: process.env.SMTP_DEFAULT_HOST ?? '',
  SMTP_DEFAULT_PORT: parseInt(process.env.SMTP_DEFAULT_PORT ?? '587'),
  SMTP_DEFAULT_USER: process.env.SMTP_DEFAULT_USER ?? '',
  SMTP_DEFAULT_PASS: process.env.SMTP_DEFAULT_PASS ?? '',

  MAILCHIMP_API_KEY: process.env.MAILCHIMP_API_KEY ?? '',
  SENDGRID_API_KEY: process.env.SENDGRID_API_KEY ?? '',

  // Cifrado de credenciales en DB (64 hex chars = 32 bytes AES-256)
  // Generar con: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  CREDENTIALS_ENCRYPTION_KEY: process.env.CREDENTIALS_ENCRYPTION_KEY ?? '',

  // Secrets para validar webhooks entrantes
  SENDGRID_WEBHOOK_SECRET: process.env.SENDGRID_WEBHOOK_SECRET ?? '',
  BREVO_WEBHOOK_SECRET:    process.env.BREVO_WEBHOOK_SECRET    ?? '',
}
