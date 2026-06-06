ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS assigned_member_id UUID REFERENCES client_members(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_email_accounts_member ON email_accounts(assigned_member_id);
