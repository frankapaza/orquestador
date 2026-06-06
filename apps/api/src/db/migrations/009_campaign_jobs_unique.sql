-- Evitar duplicados de jobs por campaña+contacto
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'campaign_jobs_campaign_contact_unique'
  ) THEN
    ALTER TABLE campaign_jobs ADD CONSTRAINT campaign_jobs_campaign_contact_unique
      UNIQUE (campaign_id, contact_id);
  END IF;
END$$;
