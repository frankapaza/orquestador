-- Corrige mensajes cuyo status quedó DEGRADADO: el acuse 'delivered'/'read' llegó
-- y fijó delivered_at/read_at, pero un SERVER_ACK 'sent' posterior pisó el status
-- hacia atrás. Avanzamos el status según las fechas ya registradas. Idempotente.
UPDATE messages SET status = 'read'
  WHERE read_at IS NOT NULL AND status <> 'read';

UPDATE messages SET status = 'delivered'
  WHERE delivered_at IS NOT NULL AND read_at IS NULL AND status IN ('sent', 'sending', 'pending');
