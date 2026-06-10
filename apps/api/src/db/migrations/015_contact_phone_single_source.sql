-- contact_phones se vuelve la ÚNICA fuente de verdad de los teléfonos del contacto.
-- Se elimina el "espejo" en contacts (phone / phone_dial / phone_country).

-- 1) contact_phones necesita su propio país (antes solo lo tenía contacts).
ALTER TABLE contact_phones ADD COLUMN IF NOT EXISTS phone_country VARCHAR(2);

-- Backfill: tomar el país del contacto cuando exista; el resto con +51 => PE.
UPDATE contact_phones cp
   SET phone_country = c.phone_country
  FROM contacts c
 WHERE c.id = cp.contact_id
   AND cp.phone_country IS NULL
   AND c.phone_country IS NOT NULL;

UPDATE contact_phones
   SET phone_country = 'PE'
 WHERE phone_country IS NULL
   AND phone_dial = '+51';

-- 2) Eliminar el espejo en contacts. contact_phones (is_primary) es la fuente.
ALTER TABLE contacts DROP COLUMN IF EXISTS phone;
ALTER TABLE contacts DROP COLUMN IF EXISTS phone_dial;
ALTER TABLE contacts DROP COLUMN IF EXISTS phone_country;
