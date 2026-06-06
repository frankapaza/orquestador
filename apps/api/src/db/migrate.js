import { readFileSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { sql } from '../lib/db.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dir = join(__dirname, 'migrations')

async function migrate() {
  console.log('[migrate] Running migrations...')

  const files = readdirSync(dir)
    .filter(f => f.endsWith('.sql'))
    .sort()

  for (const file of files) {
    console.log(`[migrate] ${file}`)
    await sql.unsafe(readFileSync(join(dir, file), 'utf-8'))
  }

  console.log('[migrate] Done.')
  await sql.end()
}

migrate().catch((err) => {
  console.error('[migrate] Error:', err)
  process.exit(1)
})
