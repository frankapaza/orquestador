-- Teléfono guardado SEPARADO en la BD. `phone` pasa a contener SOLO el número
-- nacional (sin el código de país). El código va en columnas aparte.
--   phone_country  = ISO del país      (ej. 'PE')   [ya existía en contacts]
--   phone_dial     = código de país    (ej. '+51')  [NUEVO]
--   phone          = número nacional   (ej. '986095857')  ← se le quita el +51
-- El número completo NO se guarda; el backend concatena phone_dial+phone cuando
-- lo necesita (enviar / emparejar mensajes). Cambio aditivo + reescritura de phone.

-- ── contacts ────────────────────────────────────────────────────────────────
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS phone_dial VARCHAR(8);

UPDATE contacts
SET phone_country = COALESCE(phone_country, 'PE'),
    phone_dial    = '+51',
    phone         = substring(phone FROM 4)        -- quita '+51'
WHERE phone LIKE '+51%' AND phone_dial IS NULL;

-- ── contact_phones (múltiples teléfonos por contacto) ───────────────────────
ALTER TABLE contact_phones ADD COLUMN IF NOT EXISTS phone_dial VARCHAR(8);

UPDATE contact_phones
SET phone_dial = '+51',
    phone      = substring(phone FROM 4)
WHERE phone LIKE '+51%' AND phone_dial IS NULL;
