import { sql } from '../../lib/db.js'
import { splitPhone } from '../../lib/phone.js'

// Upsert de contactos deduplicando por DOCUMENTO (identidad, a nivel cliente). Un
// contacto = una persona, con muchos teléfonos/correos, en muchas listas (membresías)
// SIN duplicarse. Fusiona datos (columnas nuevas se agregan/actualizan) y suma los
// teléfonos/correos nuevos. Fallback: si una fila no trae documento (llamadas
// internas), deduplica por teléfono a nivel cliente.
export async function upsertContactsByPhone(clientId, listId, rows) {
  // Dedup dentro del propio lote: por documento; si no, por teléfono; si no, por correo.
  const map = new Map()
  for (const r of rows) {
    const sp = splitPhone(r.phone, { country: r.phone_country, dial: r.phone_dial })
    const full = sp.national ? `${sp.dial ?? ''}${sp.national}` : null
    const email = r.email ? String(r.email).trim().toLowerCase() : null
    if (!full && !email) continue // sin teléfono ni correo no hay a quién escribir
    const key = r.document ? `doc:${r.document}` : (full ? `tel:${full}` : `email:${email}`)
    map.set(key, { ...r, sp, full, email }) // la última fila de la misma persona gana
  }
  const deduped = [...map.values()]
  if (!deduped.length) return 0

  for (const r of deduped) {
    // Buscar el contacto existente: documento → teléfono → correo.
    let contactId = null
    if (r.document) {
      const [c] = await sql`
        SELECT id FROM contacts WHERE client_id = ${clientId} AND document = ${r.document} LIMIT 1
      `
      contactId = c?.id ?? null
    }
    if (!contactId && r.full) {
      const [c] = await sql`
        SELECT cp.contact_id AS id FROM contact_phones cp
        JOIN contacts co ON co.id = cp.contact_id
        WHERE co.client_id = ${clientId}
          AND (COALESCE(cp.phone_dial,'') || cp.phone) = ${r.full}
        LIMIT 1
      `
      contactId = c?.id ?? null
    }
    if (!contactId && r.email) {
      const [c] = await sql`
        SELECT ce.contact_id AS id FROM contact_emails ce
        JOIN contacts co ON co.id = ce.contact_id
        WHERE co.client_id = ${clientId} AND ce.email = ${r.email}
        LIMIT 1
      `
      contactId = c?.id ?? null
    }

    if (contactId) {
      // Ya existe → actualiza identidad/datos, no lo duplica.
      await sql`
        UPDATE contacts
        SET first_name = COALESCE(${r.first_name ?? null}, first_name),
            last_name  = COALESCE(${r.last_name ?? null}, last_name),
            document   = COALESCE(document, ${r.document ?? null}),
            metadata   = COALESCE(metadata, '{}'::jsonb) || ${sql.json(r.metadata ?? {})}
        WHERE id = ${contactId}
      `
    } else {
      const [contact] = await sql`
        INSERT INTO contacts (client_id, document, first_name, last_name, metadata)
        VALUES (${clientId}, ${r.document ?? null}, ${r.first_name ?? null}, ${r.last_name ?? null}, ${sql.json(r.metadata ?? {})})
        RETURNING id
      `
      contactId = contact.id
    }

    // Suma el teléfono (si viene y es nuevo). El primero queda principal.
    if (r.sp.national) {
      await sql`
        INSERT INTO contact_phones (contact_id, client_id, phone, phone_dial, phone_country, label, is_primary)
        VALUES (${contactId}, ${clientId}, ${r.sp.national}, ${r.sp.dial || null}, ${r.sp.country || null}, 'Móvil',
                NOT EXISTS (SELECT 1 FROM contact_phones WHERE contact_id = ${contactId}))
        ON CONFLICT (contact_id, phone) DO NOTHING
      `
    }
    if (r.email) {
      await sql`
        INSERT INTO contact_emails (contact_id, client_id, email, label, is_primary)
        VALUES (${contactId}, ${clientId}, ${r.email}, 'Principal',
                NOT EXISTS (SELECT 1 FROM contact_emails WHERE contact_id = ${contactId}))
        ON CONFLICT (contact_id, email) DO NOTHING
      `
    }

    // Membresía a la lista (muchos-a-muchos), sin duplicar el contacto.
    await sql`
      INSERT INTO list_members (list_id, contact_id) VALUES (${listId}, ${contactId})
      ON CONFLICT DO NOTHING
    `
  }
  return deduped.length
}
