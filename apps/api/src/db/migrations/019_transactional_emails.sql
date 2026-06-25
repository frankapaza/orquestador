-- 019_transactional_emails.sql
-- Registro de correos individuales/transaccionales (envío 1:1 fuera de campaña).
-- Los usan: POST /contacts/:id/send-email (dashboard) y POST /email/send (MCOB).
-- Alimentan la vista 360° del contacto (sección Email), que antes solo leía
-- campaign_jobs y por eso no mostraba los envíos individuales.

CREATE TABLE IF NOT EXISTS transactional_emails (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  contact_id       UUID REFERENCES contacts(id) ON DELETE SET NULL,
  email_account_id UUID REFERENCES email_accounts(id),
  from_email       VARCHAR(255),
  recipient_email  VARCHAR(255) NOT NULL,
  subject          VARCHAR(500),
  body             TEXT,
  status           VARCHAR(50) DEFAULT 'sent',   -- sent | failed
  message_id       VARCHAR(500),
  error_message    TEXT,
  sent_at          TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tx_emails_client    ON transactional_emails(client_id);
CREATE INDEX IF NOT EXISTS idx_tx_emails_contact   ON transactional_emails(contact_id);
CREATE INDEX IF NOT EXISTS idx_tx_emails_recipient ON transactional_emails(recipient_email);
