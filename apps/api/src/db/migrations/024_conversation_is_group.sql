-- Marca de conversación de GRUPO de WhatsApp (para mostrar el nombre del grupo
-- y un badge en vez del número/JID largo).
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS is_group BOOLEAN DEFAULT false;
