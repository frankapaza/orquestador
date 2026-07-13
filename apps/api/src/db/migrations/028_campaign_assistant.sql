-- Campaña IA: vincula la campaña a un asistente. NULL = campaña manual (WhatsApp/SMS/email).
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS assistant_id UUID;
CREATE INDEX IF NOT EXISTS idx_campaigns_assistant ON campaigns(assistant_id);

-- Origen de la lista: 'campaign' marca listas creadas al subir un Excel dentro de una campaña.
ALTER TABLE contact_lists ADD COLUMN IF NOT EXISTS source VARCHAR(30) DEFAULT 'manual';
