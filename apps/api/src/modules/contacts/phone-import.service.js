import { sql } from '../../lib/db.js'
import { splitPhone } from '../../lib/phone.js'

// Upsert de contactos deduplicando por TELÉFONO dentro de la lista. Fusiona metadata
// (las columnas nuevas se agregan/actualizan sin borrar las previas). Crea contact_phones.
export async function upsertContactsByPhone(clientId, listId, rows) {
  const map = new Map()
  for (const r of rows) {
    const sp = splitPhone(r.phone, { country: r.phone_country, dial: r.phone_dial })
    if (!sp.national) continue
    const full = `${sp.dial ?? ''}${sp.national}`
    map.set(full, { ...r, sp, full }) // la última fila del mismo teléfono gana
  }
  const deduped = [...map.values()]
  if (!deduped.length) return 0

  const fulls = deduped.map(r => r.full)
  const existing = await sql`
    SELECT (COALESCE(cp.phone_dial,'') || cp.phone) AS full, cp.contact_id
    FROM contact_phones cp
    JOIN contacts c ON c.id = cp.contact_id
    WHERE c.list_id = ${listId} AND (COALESCE(cp.phone_dial,'') || cp.phone) IN ${sql(fulls)}
  `
  const byFull = new Map(existing.map(e => [e.full, e.contact_id]))

  for (const r of deduped) {
    if (byFull.has(r.full)) {
      await sql`
        UPDATE contacts
        SET first_name = COALESCE(${r.first_name ?? null}, first_name),
            last_name  = COALESCE(${r.last_name ?? null}, last_name),
            metadata   = COALESCE(metadata, '{}'::jsonb) || ${sql.json(r.metadata ?? {})}
        WHERE id = ${byFull.get(r.full)}
      `
    } else {
      const [contact] = await sql`
        INSERT INTO contacts (client_id, list_id, first_name, last_name, metadata)
        VALUES (${clientId}, ${listId}, ${r.first_name ?? null}, ${r.last_name ?? null}, ${sql.json(r.metadata ?? {})})
        RETURNING id
      `
      await sql`
        INSERT INTO contact_phones (contact_id, client_id, phone, phone_dial, phone_country, label, is_primary)
        VALUES (${contact.id}, ${clientId}, ${r.sp.national}, ${r.sp.dial || null}, ${r.sp.country || null}, 'Móvil', true)
        ON CONFLICT (contact_id, phone) DO NOTHING
      `
      if (r.email) {
        await sql`
          INSERT INTO contact_emails (contact_id, client_id, email, label, is_primary)
          VALUES (${contact.id}, ${clientId}, ${r.email}, 'Principal', true)
          ON CONFLICT (contact_id, email) DO NOTHING
        `
      }
    }
  }
  return deduped.length
}
