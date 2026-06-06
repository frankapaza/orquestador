-- Tabla de teléfonos adicionales por contacto
CREATE TABLE IF NOT EXISTS contact_phones (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  client_id  UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  phone      VARCHAR(20) NOT NULL,
  label      VARCHAR(50) DEFAULT 'Principal',
  is_primary BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(contact_id, phone)
);

-- Tabla de emails adicionales por contacto
CREATE TABLE IF NOT EXISTS contact_emails (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  client_id  UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  email      VARCHAR(255) NOT NULL,
  label      VARCHAR(50) DEFAULT 'Principal',
  is_primary BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(contact_id, email)
);

-- Migrar teléfonos existentes (el único existente queda como primario)
INSERT INTO contact_phones (contact_id, client_id, phone, label, is_primary)
SELECT id, client_id, phone, 'Principal', true
FROM contacts
WHERE phone IS NOT NULL AND phone <> ''
ON CONFLICT (contact_id, phone) DO NOTHING;

-- Migrar emails existentes
INSERT INTO contact_emails (contact_id, client_id, email, label, is_primary)
SELECT id, client_id, email, 'Principal', true
FROM contacts
WHERE email IS NOT NULL AND email <> ''
ON CONFLICT (contact_id, email) DO NOTHING;

-- Índices
CREATE INDEX IF NOT EXISTS idx_contact_phones_contact ON contact_phones(contact_id);
CREATE INDEX IF NOT EXISTS idx_contact_phones_phone   ON contact_phones(phone);
CREATE INDEX IF NOT EXISTS idx_contact_phones_client  ON contact_phones(client_id);
CREATE INDEX IF NOT EXISTS idx_contact_emails_contact ON contact_emails(contact_id);
CREATE INDEX IF NOT EXISTS idx_contact_emails_email   ON contact_emails(email);
CREATE INDEX IF NOT EXISTS idx_contact_emails_client  ON contact_emails(client_id);
