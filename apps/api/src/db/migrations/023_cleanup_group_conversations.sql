-- Limpieza: elimina conversaciones/mensajes creados por error a partir de JID de
-- GRUPOS o newsletters de WhatsApp (su "número" tiene más de 15 dígitos; un
-- teléfono real en formato E.164 tiene como máximo 15). Ej: +120363216648351735.
-- El fix en baileys.manager.js evita que se vuelvan a crear.

DELETE FROM messages
WHERE conversation_id IN (
  SELECT id FROM conversations
  WHERE length(regexp_replace(COALESCE(contact_phone, ''), '\D', '', 'g')) > 15
);

DELETE FROM conversations
WHERE length(regexp_replace(COALESCE(contact_phone, ''), '\D', '', 'g')) > 15;
