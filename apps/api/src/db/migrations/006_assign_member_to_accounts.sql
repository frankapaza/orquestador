-- Asignar cuentas de canal a miembros del equipo
ALTER TABLE whatsapp_accounts ADD COLUMN IF NOT EXISTS assigned_member_id UUID REFERENCES client_members(id) ON DELETE SET NULL;
ALTER TABLE sms_accounts       ADD COLUMN IF NOT EXISTS assigned_member_id UUID REFERENCES client_members(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_wa_accounts_member  ON whatsapp_accounts(assigned_member_id);
CREATE INDEX IF NOT EXISTS idx_sms_accounts_member ON sms_accounts(assigned_member_id);
