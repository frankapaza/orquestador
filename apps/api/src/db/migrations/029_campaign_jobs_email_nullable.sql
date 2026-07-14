-- Los envíos de WhatsApp/SMS no tienen email: recipient_email debe poder ser NULL.
-- Antes era NOT NULL (001_initial), lo que hacía fallar el INSERT de campaign_jobs
-- para campañas de WhatsApp/SMS (recipient_email = NULL) y dejaba la campaña colgada
-- en 'sending' sin jobs. La app ya trata la columna como opcional
-- (ver COALESCE(recipient_email,'') en 017_campaign_jobs_per_destination).
ALTER TABLE campaign_jobs ALTER COLUMN recipient_email DROP NOT NULL;
