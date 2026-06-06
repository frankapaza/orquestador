-- Soporte multi-proveedor WhatsApp: baileys | evolution | meta
ALTER TABLE whatsapp_accounts ADD COLUMN IF NOT EXISTS provider VARCHAR(20) DEFAULT 'evolution';

-- Para Baileys no se necesitan estos campos, los hacemos opcionales
ALTER TABLE whatsapp_accounts ALTER COLUMN evolution_url     DROP NOT NULL;
ALTER TABLE whatsapp_accounts ALTER COLUMN evolution_api_key DROP NOT NULL;

-- Directorio de sesión para Baileys (nombre relativo dentro del servidor)
ALTER TABLE whatsapp_accounts ADD COLUMN IF NOT EXISTS session_dir VARCHAR(255);

UPDATE whatsapp_accounts SET provider = 'evolution' WHERE provider IS NULL;
