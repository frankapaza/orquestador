-- Campañas: soporte multi-canal
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS channel      VARCHAR(20) DEFAULT 'email';
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS content_text TEXT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS media_url    VARCHAR(1000);
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS media_caption TEXT;

-- Jobs de campaña: soporte multi-canal
ALTER TABLE campaign_jobs ADD COLUMN IF NOT EXISTS channel     VARCHAR(20) DEFAULT 'email';
ALTER TABLE campaign_jobs ADD COLUMN IF NOT EXISTS phone_number VARCHAR(20);
ALTER TABLE campaign_jobs ADD COLUMN IF NOT EXISTS account_id  UUID;
ALTER TABLE campaign_jobs ADD COLUMN IF NOT EXISTS message_id  UUID REFERENCES messages(id);

CREATE INDEX IF NOT EXISTS idx_campaigns_channel      ON campaigns(channel);
CREATE INDEX IF NOT EXISTS idx_campaign_jobs_channel  ON campaign_jobs(channel);
