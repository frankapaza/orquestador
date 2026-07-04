import { sql } from '../../../lib/db.js'

// Crea una alerta in-app evitando duplicados: si ya hay una NO reconocida del
// mismo chip y nivel, no crea otra.
export async function createAlert(clientId, accountId, level, reason) {
  const [existing] = await sql`
    SELECT id FROM warmup_alerts
    WHERE account_id = ${accountId} AND level = ${level} AND acknowledged = false
    LIMIT 1
  `
  if (existing) return
  await sql`
    INSERT INTO warmup_alerts (client_id, account_id, level, reason)
    VALUES (${clientId}, ${accountId}, ${level}, ${reason ?? null})
  `
}
