import { sql } from '../lib/db.js'

// Ejecutar a medianoche via cron del servidor
// Comando: node src/workers/daily-reset.js
// Cron: 0 0 * * * node /app/src/workers/daily-reset.js

async function resetDailyCounters() {
  const result = await sql`UPDATE email_accounts SET sent_today = 0`
  console.log(`[daily-reset] Contadores reseteados: ${result.count} cuentas`)
  await sql.end()
}

resetDailyCounters().catch(err => {
  console.error('[daily-reset] Error:', err)
  process.exit(1)
})
