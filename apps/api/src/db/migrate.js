import { readFileSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { sql } from '../lib/db.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dir = join(__dirname, 'migrations')

async function migrate() {
  console.log('[migrate] Running migrations...')

  // Registro de migraciones aplicadas: cada archivo corre UNA sola vez.
  // (Antes se reejecutaban todas, lo que rompía cuando una migración borraba
  //  una columna que otra anterior usaba en un índice/backfill.)
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename   text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`

  const files = readdirSync(dir).filter(f => f.endsWith('.sql')).sort()
  let applied = new Set((await sql`SELECT filename FROM schema_migrations`).map(r => r.filename))

  // Adopción de una BD ya inicializada (sin registro previo): se marcan todas
  // las migraciones presentes como aplicadas, sin reejecutarlas. En una BD nueva
  // (sin tabla contacts) no se adopta y se corren todas desde cero.
  if (applied.size === 0) {
    const [{ exists }] = await sql`
      SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'contacts') AS exists
    `
    if (exists) {
      for (const f of files) await sql`INSERT INTO schema_migrations (filename) VALUES (${f}) ON CONFLICT DO NOTHING`
      console.log(`[migrate] BD existente adoptada: ${files.length} migraciones marcadas como baseline (sin reejecutar).`)
      applied = new Set(files)
    }
  }

  let ran = 0
  for (const file of files) {
    if (applied.has(file)) continue
    console.log(`[migrate] aplicando ${file}`)
    await sql.unsafe(readFileSync(join(dir, file), 'utf-8'))
    await sql`INSERT INTO schema_migrations (filename) VALUES (${file}) ON CONFLICT DO NOTHING`
    ran++
  }

  console.log(ran === 0 ? '[migrate] Sin migraciones pendientes.' : `[migrate] Done. ${ran} aplicada(s).`)
  await sql.end()
}

migrate().catch((err) => {
  console.error('[migrate] Error:', err)
  process.exit(1)
})
