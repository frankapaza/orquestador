-- contact_emails se vuelve la ÚNICA fuente de verdad de los correos del contacto.
-- Se elimina el "espejo" contacts.email.

-- 1) Asegurar que el correo principal de cada contacto exista en contact_emails.
INSERT INTO contact_emails (contact_id, client_id, email, label, is_primary)
SELECT c.id, c.client_id, c.email, 'Principal', true
FROM contacts c
WHERE c.email IS NOT NULL AND c.email <> ''
  AND NOT EXISTS (
    SELECT 1 FROM contact_emails ce
    WHERE ce.contact_id = c.id AND ce.email = c.email
  )
ON CONFLICT (contact_id, email) DO NOTHING;

-- 2) Si un contacto quedó sin ningún principal, marcar el más antiguo.
UPDATE contact_emails ce SET is_primary = true
WHERE ce.id = (
  SELECT ce2.id FROM contact_emails ce2
  WHERE ce2.contact_id = ce.contact_id
  ORDER BY ce2.created_at LIMIT 1
)
AND NOT EXISTS (
  SELECT 1 FROM contact_emails p WHERE p.contact_id = ce.contact_id AND p.is_primary = true
);

-- 3) Eliminar el espejo en contacts (contact_emails es la fuente). Esto borra
--    también los índices idx_contacts_email e idx_contacts_list_email.
ALTER TABLE contacts DROP COLUMN IF EXISTS email;
