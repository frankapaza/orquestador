-- País del teléfono del contacto (ISO 3166-1 alpha-2, ej: PE, MX, CO) para poder
-- mostrar la bandera y el código de país separados del número.
-- Cambio ADITIVO y seguro: columna nueva, nullable, no toca datos existentes.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS phone_country CHAR(2);
