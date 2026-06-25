-- 020_email_inbound_imap.sql
-- Recepción de correo en tiempo real (IMAP IDLE) + almacenamiento de respuestas.
--
--  - Credenciales IMAP por cuenta (lado lectura del mismo buzón SMTP).
--  - Tabla email_inbound: correos entrantes (respuestas) que el imap.manager
--    captura por IDLE y empareja con el envío original por Message-ID.

-- Credenciales/flags IMAP por cuenta de correo.
ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS imap_host    VARCHAR(255);
ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS imap_port    INTEGER DEFAULT 993;
ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS imap_user    VARCHAR(255);
ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS imap_pass    VARCHAR(500);
ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS imap_tls     BOOLEAN DEFAULT true;
ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS imap_enabled BOOLEAN DEFAULT false;
-- Marca de la última posición leída en el buzón (UID) para resync incremental.
ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS imap_last_uid BIGINT;

-- Correos entrantes (respuestas de los clientes).
CREATE TABLE IF NOT EXISTS email_inbound (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id              UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  email_account_id       UUID REFERENCES email_accounts(id) ON DELETE SET NULL,
  contact_id             UUID REFERENCES contacts(id) ON DELETE SET NULL,
  -- Envío original con el que se enlaza la respuesta (por In-Reply-To/References).
  transactional_email_id UUID REFERENCES transactional_emails(id) ON DELETE SET NULL,
  from_email             VARCHAR(255),
  from_name              VARCHAR(255),
  to_email               VARCHAR(255),
  subject                VARCHAR(500),
  body_text              TEXT,
  body_html              TEXT,
  message_id             VARCHAR(500),
  in_reply_to            VARCHAR(500),
  imap_uid               BIGINT,
  received_at            TIMESTAMPTZ,
  created_at             TIMESTAMPTZ DEFAULT now()
);

-- Evita duplicar el mismo correo si el buzón se re-lee.
CREATE UNIQUE INDEX IF NOT EXISTS uq_email_inbound_msg
  ON email_inbound(email_account_id, message_id)
  WHERE message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_email_inbound_contact   ON email_inbound(contact_id);
CREATE INDEX IF NOT EXISTS idx_email_inbound_from      ON email_inbound(from_email);
CREATE INDEX IF NOT EXISTS idx_email_inbound_tx        ON email_inbound(transactional_email_id);
