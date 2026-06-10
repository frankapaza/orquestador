-- Permitir varios envíos por contacto: a cada teléfono (WA/SMS) o correo (email)
-- del contacto, no solo el principal. El destino se distingue por recipient_email
-- o phone_number, así que la unicidad pasa a ser por (campaña, contacto, destino).

ALTER TABLE campaign_jobs DROP CONSTRAINT IF EXISTS campaign_jobs_campaign_contact_unique;

CREATE UNIQUE INDEX IF NOT EXISTS campaign_jobs_campaign_contact_dest_unique
  ON campaign_jobs (campaign_id, contact_id, COALESCE(recipient_email, ''), COALESCE(phone_number, ''));
