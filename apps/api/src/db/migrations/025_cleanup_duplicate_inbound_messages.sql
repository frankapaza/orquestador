-- Limpieza: elimina mensajes duplicados que quedaron guardados en la conversación
-- de varios chips cuando el MISMO mensaje de WhatsApp (mismo external_id, es decir
-- m.key.id) llegó a varias sesiones Baileys de la misma cuenta. Cada mensaje de
-- WhatsApp tiene un id GLOBAL único, por lo que solo debe existir una fila por
-- (client_id, external_id). Se conserva la copia más antigua (la primera en llegar).
-- El fix en message.service.js (dedup por external_id en processIncoming) evita que
-- se vuelvan a crear.

DELETE FROM messages m
USING (
  SELECT id,
         row_number() OVER (
           PARTITION BY client_id, external_id
           ORDER BY created_at ASC, id ASC
         ) AS rn
  FROM messages
  WHERE external_id IS NOT NULL
) d
WHERE m.id = d.id
  AND d.rn > 1;

-- Recalcular no-leídos: tras borrar los duplicados, dejar unread_count = número de
-- entrantes sin leer por conversación (los duplicados habían inflado el contador).
UPDATE conversations c
SET unread_count = COALESCE(sub.cnt, 0)
FROM (
  SELECT conversation_id, COUNT(*) AS cnt
  FROM messages
  WHERE direction = 'inbound' AND read_at IS NULL
  GROUP BY conversation_id
) sub
WHERE c.id = sub.conversation_id;

-- Conversaciones que ya no tienen entrantes sin leer → contador a 0.
UPDATE conversations c
SET unread_count = 0
WHERE unread_count <> 0
  AND NOT EXISTS (
    SELECT 1 FROM messages m
    WHERE m.conversation_id = c.id
      AND m.direction = 'inbound'
      AND m.read_at IS NULL
  );
