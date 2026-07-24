-- La conversación se ata al CONTACTO exacto de la campaña que la generó, para que
-- el asistente IA siga la "línea de datos" de esa carga (su factura/monto/fecha),
-- y no tome datos de otro contacto que comparta el mismo teléfono (otra campaña /
-- otra carga con montos distintos). Se actualiza en cada saludo de campaña IA, así
-- refleja la última campaña que escribió a ese hilo.
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS contact_id UUID;
CREATE INDEX IF NOT EXISTS idx_conversations_contact ON conversations(contact_id);
