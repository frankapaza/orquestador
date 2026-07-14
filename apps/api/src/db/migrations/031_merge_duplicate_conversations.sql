-- Homologa los teléfonos de conversaciones a +E.164 y FUSIONA las conversaciones
-- duplicadas por formato ("+51..." vs "51..."). Los grupos (is_group) se dejan
-- intactos (su identificador no es un teléfono). Atómico: un DO block = una
-- transacción; si algo falla, no deja nada a medias. Idempotente: al re-correrlo
-- ya no hay duplicados y las normalizaciones son no-op.
DO $mig$
DECLARE
  grp      RECORD;
  survivor UUID;
BEGIN
  -- 1) Fusionar grupos de conversaciones que normalizan al mismo teléfono canónico.
  FOR grp IN
    SELECT client_id, channel, account_id,
           '+' || regexp_replace(contact_phone, '[^0-9]', '', 'g') AS canon,
           array_agg(id ORDER BY created_at) AS ids
    FROM conversations
    WHERE COALESCE(is_group, false) = false
      AND length(regexp_replace(contact_phone, '[^0-9]', '', 'g')) >= 8
    GROUP BY client_id, channel, account_id,
             '+' || regexp_replace(contact_phone, '[^0-9]', '', 'g')
    HAVING count(*) > 1
  LOOP
    -- Superviviente: la que ya está en formato canónico; si ninguna, la más antigua.
    SELECT id INTO survivor
      FROM conversations
      WHERE id = ANY(grp.ids) AND contact_phone = grp.canon
      LIMIT 1;
    IF survivor IS NULL THEN
      survivor := grp.ids[1];
    END IF;

    -- Mover los mensajes de los duplicados a la superviviente.
    UPDATE messages SET conversation_id = survivor
      WHERE conversation_id = ANY(grp.ids) AND conversation_id <> survivor;

    -- Borrar los duplicados (ya sin mensajes propios).
    DELETE FROM conversations WHERE id = ANY(grp.ids) AND id <> survivor;

    -- Fijar el teléfono canónico en la superviviente.
    UPDATE conversations SET contact_phone = grp.canon WHERE id = survivor;
  END LOOP;

  -- 2) Normalizar el resto (sin duplicado) que aún no esté en formato canónico.
  UPDATE conversations
    SET contact_phone = '+' || regexp_replace(contact_phone, '[^0-9]', '', 'g')
    WHERE COALESCE(is_group, false) = false
      AND length(regexp_replace(contact_phone, '[^0-9]', '', 'g')) >= 8
      AND contact_phone <> '+' || regexp_replace(contact_phone, '[^0-9]', '', 'g');
END $mig$;
