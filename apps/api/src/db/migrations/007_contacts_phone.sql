-- Agregar teléfono a contactos (necesario para campañas SMS/WhatsApp)
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS phone VARCHAR(20);

-- Email ya no es obligatorio (un contacto puede ser solo SMS/WA)
ALTER TABLE contacts ALTER COLUMN email DROP NOT NULL;

-- Quitar unique constraint de solo email y agregar uno flexible
ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_list_id_email_key;

-- Nuevo índice único: no pueden repetirse email+lista (cuando hay email)
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_list_email
  ON contacts(list_id, email)
  WHERE email IS NOT NULL AND email <> '';

-- Nuevo índice único: no pueden repetirse teléfono+lista (cuando hay teléfono)
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_list_phone
  ON contacts(list_id, phone)
  WHERE phone IS NOT NULL AND phone <> '';

CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(phone);
