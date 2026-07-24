-- FASE 0 del rediseño de Contactos: identidad por DOCUMENTO + listas muchos-a-muchos.
-- Con backfill: la relación contacts.list_id se traslada a list_members y la columna
-- se elimina (el código ya lee/escribe por list_members). Sin columnas muertas.

-- 1) Identidad del contacto: documento (DNI/RUC). Único por cliente cuando existe.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS document VARCHAR(30);
CREATE UNIQUE INDEX IF NOT EXISTS uq_contacts_client_document
  ON contacts (client_id, document)
  WHERE document IS NOT NULL AND document <> '';

-- 2) Membresías: un contacto puede estar en muchas listas SIN duplicarse.
CREATE TABLE IF NOT EXISTS list_members (
  list_id    UUID NOT NULL REFERENCES contact_lists(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id)      ON DELETE CASCADE,
  added_at   TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (list_id, contact_id)
);
CREATE INDEX IF NOT EXISTS idx_list_members_contact ON list_members(contact_id);
CREATE INDEX IF NOT EXISTS idx_list_members_list    ON list_members(list_id);

-- 3) Backfill: la relación actual (contacts.list_id) se traslada a membresías,
--    y luego se ELIMINA la columna (ya nada la lee → sin cruft en la BD).
INSERT INTO list_members (list_id, contact_id)
SELECT list_id, id FROM contacts WHERE list_id IS NOT NULL
ON CONFLICT DO NOTHING;

ALTER TABLE contacts DROP COLUMN IF EXISTS list_id;

-- 4) Snapshot de datos por conversación: cuando una campaña IA envía el saludo,
--    congela aquí los datos de ESA campaña (monto/factura/etc.). El asistente lee
--    de aquí, así cada hilo mantiene su propia "línea de datos" aunque el contacto
--    (único por documento) tenga otros montos en otras campañas/días.
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS vars JSONB;
