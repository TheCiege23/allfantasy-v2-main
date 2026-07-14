/**
 * Schema drift detector.
 *
 * Compares the live database (datasource) against prisma/schema.prisma
 * (datamodel) via `prisma migrate diff` and reports any drift — tables the
 * schema declares but the DB lacks (additive), and DROP operations the diff
 * would perform (destructive: the DB has something the schema removed).
 *
 * This is the guard that would have caught the `league_championships` drift:
 * `prisma migrate status` only compares migration history vs `_prisma_migrations`
 * and reports "up to date" even when the schema has models no migration created.
 *
 *   npx tsx scripts/check-schema-drift.ts          # human report
 *   npx tsx scripts/check-schema-drift.ts --ci     # exit 1 on any drift
 *
 * Requires DATABASE_URL (loaded from .env/.env.local).
 */
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'

function loadDotEnv() {
  for (const f of ['.env', '.env.local']) {
    try {
      for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
        if (m && !process.env[m[1]]) {
          let v = m[2].trim()
          if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
          process.env[m[1]] = v
        }
      }
    } catch {
      /* file may not exist */
    }
  }
}

loadDotEnv()
const CI = process.argv.includes('--ci')

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set.')
  process.exit(2)
}

let sql = ''
try {
  sql = execFileSync(
    'npx',
    [
      'prisma',
      'migrate',
      'diff',
      '--from-schema-datasource',
      'prisma/schema.prisma',
      '--to-schema-datamodel',
      'prisma/schema.prisma',
      '--script',
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' },
  )
} catch (e) {
  console.error('prisma migrate diff failed:', e instanceof Error ? e.message : String(e))
  process.exit(2)
}

const lines = sql.split('\n')
const missingTables = lines.filter((l) => /^CREATE TABLE /i.test(l.trim())).map((l) => (l.match(/CREATE TABLE "([^"]+)"/i) || [])[1] ?? l.trim())
const dropOps = lines.filter((l) => /\bDROP (TABLE|COLUMN|CONSTRAINT)\b/i.test(l)).map((l) => l.trim())
const alterTables = lines.filter((l) => /^ALTER TABLE /i.test(l.trim())).length

const hasDrift = missingTables.length > 0 || dropOps.length > 0 || alterTables > 0

console.log('──── SCHEMA DRIFT REPORT (live DB vs prisma/schema.prisma) ────')
if (!hasDrift) {
  console.log('✅ No drift — database matches the schema.')
  process.exit(0)
}

console.log(`Missing tables (schema declares, DB lacks): ${missingTables.length}`)
missingTables.forEach((t) => console.log(`  + ${t}`))
console.log(`ALTER TABLE statements (column/constraint drift): ${alterTables}`)
console.log(`DESTRUCTIVE drops the full diff would perform (DB has, schema removed): ${dropOps.length}`)
dropOps.slice(0, 20).forEach((d) => console.log(`  ! ${d}`))
console.log('\nNOTE: A scoped, additive migration should be authored for required missing')
console.log('tables. NEVER apply the full diff — the DROP operations above destroy live data.')

if (CI && hasDrift) process.exit(1)
process.exit(0)
