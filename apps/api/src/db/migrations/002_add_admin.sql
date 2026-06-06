-- Columna is_admin en clients
ALTER TABLE clients ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false;
