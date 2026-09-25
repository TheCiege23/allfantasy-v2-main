/** Applies only a named, reviewed Decision OS migration, then records it through Prisma.
 * Target identity is verified; environment values and connection errors never print credentials.
 * Usage: node scripts/decision-os-migration-runner.mjs --target test|production --apply
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import dotenv from 'dotenv'
import pg from 'pg'
import identity from './db-target-identity.cjs'

const selection = process.argv.find(a => a.startsWith('--migration='))?.slice(12) ?? 'market'
const approved = { market: '20260909130000_decision_os_market_observations', strategy: '20260909140000_decision_os_strategy_state' }
if (!Object.hasOwn(approved, selection)) throw new Error('Unknown migration; only reviewed Decision OS changes are allowed')
const migration = approved[selection]
const target = process.argv.find(a => a.startsWith('--target='))?.slice(9)
const apply = process.argv.includes('--apply')
if (!['test', 'production'].includes(target)) throw new Error('Explicit --target=test|production required')
const envFile = target === 'test' ? '.env.test' : '.env.prod-deploy'
const env = dotenv.parse(fs.readFileSync(envFile))
const url = env.DIRECT_URL || env.DATABASE_URL
const identified = identity.identifyTarget(url)
if (target === 'production' ? identified.kind !== 'production' : identified.label !== 'test') throw new Error('Database target identity mismatch')
console.log(`Target: ${identity.describeTarget(url)}. Migration: ${migration}`)
const sqlFile = path.join('prisma/migrations', migration, 'migration.sql')
const sql = fs.readFileSync(sqlFile, 'utf8')
const checksum = crypto.createHash('sha256').update(sql).digest('hex')
const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 10000, statement_timeout: 30000 })
const columnsQuery = `SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'PlayerValueSnapshot'
  AND column_name IN ('marketNumTeams', 'marketPpr', 'observedAt') ORDER BY column_name`
function verifyColumns(rows) {
  const expected = { marketNumTeams: 'integer', marketPpr: 'double precision', observedAt: 'timestamp with time zone' }
  if (rows.length !== 3 || rows.some(r => expected[r.column_name] !== r.data_type || r.is_nullable !== 'YES' || r.column_default !== null)) {
    throw new Error('Market observation columns differ from the reviewed schema')
  }
}
async function verifySchema() {
  if (selection === 'market') return verifyColumns((await client.query(columnsQuery)).rows)
  const rows = (await client.query(`SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public'
    AND tablename IN ('decision_strategy_states', 'decision_strategy_events')`)).rows
  if (rows.length !== 2 || rows.some(r => !r.rowsecurity)) throw new Error('Strategy tables or row-level security missing')
  const columns = (await client.query(`SELECT table_name, column_name, data_type FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name IN ('decision_strategy_states', 'decision_strategy_events')`)).rows
  for (const [table, required] of Object.entries({
    decision_strategy_states: { id: 'text', userId: 'text', leagueId: 'text', season: 'integer', active: 'character varying', revision: 'integer', pending: 'jsonb', lastObservedWeek: 'integer', createdAt: 'timestamp with time zone', updatedAt: 'timestamp with time zone' },
    decision_strategy_events: { id: 'text', stateId: 'text', userId: 'text', leagueId: 'text', season: 'integer', revision: 'integer', action: 'character varying', evidenceId: 'text', before: 'jsonb', after: 'jsonb', createdAt: 'timestamp with time zone' },
  })) for (const [name, type] of Object.entries(required)) {
    if (!columns.some(c => c.table_name === table && c.column_name === name && c.data_type === type)) throw new Error('Strategy column definition mismatch')
  }
  const indexes = (await client.query(`SELECT indexname FROM pg_indexes WHERE schemaname = 'public'
    AND indexname IN ('decision_strategy_states_userId_leagueId_season_key', 'decision_strategy_events_stateId_revision_key')`)).rows
  if (indexes.length !== 2) throw new Error('Strategy uniqueness indexes missing')
}
try {
  await client.connect()
  const failed = await client.query('SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL')
  if (failed.rows.length) throw new Error('An unresolved failed migration requires review before proceeding')
  const recorded = await client.query('SELECT checksum FROM "_prisma_migrations" WHERE migration_name = $1 AND finished_at IS NOT NULL AND rolled_back_at IS NULL', [migration])
  if (recorded.rows.some(r => r.checksum !== checksum)) throw new Error('Applied migration checksum differs from the reviewed file')
  console.log(JSON.stringify({ recorded: recorded.rows.length > 0 }))
  if (apply && !recorded.rows.length) {
    await client.query('BEGIN')
    try {
      await client.query("SET LOCAL lock_timeout = '5s'")
      await client.query(sql)
      await verifySchema()
      await client.query('COMMIT')
    } catch (error) { await client.query('ROLLBACK'); throw error }

    // Isolated datasource variable prevents .env overrides from redirecting the migration record.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'af-decision-migration-'))
    fs.mkdirSync(path.join(dir, 'migrations', migration), { recursive: true })
    fs.writeFileSync(path.join(dir, 'schema.prisma'), 'datasource db {\n provider = "postgresql"\n url = env("DECISION_OS_MIGRATION_URL")\n}\n')
    fs.copyFileSync(sqlFile, path.join(dir, 'migrations', migration, 'migration.sql'))
    fs.writeFileSync(path.join(dir, 'migrations', 'migration_lock.toml'), 'provider = "postgresql"\n')
    const resolved = spawnSync(process.execPath, [path.resolve('node_modules/prisma/build/index.js'),
      'migrate', 'resolve', '--applied', migration, '--schema', path.join(dir, 'schema.prisma')], {
      env: { ...process.env, DECISION_OS_MIGRATION_URL: url }, encoding: 'utf8', timeout: 60000,
    })
    if (resolved.status !== 0) throw new Error('DDL committed, but Prisma migration recording failed. The additive SQL can safely be rerun.')
    console.log('Migration applied and recorded through Prisma.')
  }
  if (apply || recorded.rows.length) {
    await verifySchema()
    const ledger = await client.query('SELECT checksum, finished_at IS NOT NULL AS finished FROM "_prisma_migrations" WHERE migration_name = $1 AND rolled_back_at IS NULL', [migration])
    if (ledger.rows.length !== 1 || !ledger.rows[0].finished || ledger.rows[0].checksum !== checksum) throw new Error('Migration ledger verification failed')
    if (target === 'test' && selection === 'market') {
      await client.query('BEGIN')
      try {
        const id = `decision-os-proof-${crypto.randomUUID()}`
        await client.query(`INSERT INTO "PlayerValueSnapshot" (id, "sleeperId", name, source, format, "qbFormat", value, "capturedAt", "marketNumTeams", "marketPpr", "observedAt")
          VALUES ($1, 'decision-os-proof', 'Migration proof', 'INTERNAL', 'DYNASTY', 'SUPERFLEX', 100, NOW(), 14, 0.75, NOW())`, [id])
        const proof = await client.query('SELECT "marketNumTeams", "marketPpr", "observedAt" FROM "PlayerValueSnapshot" WHERE id = $1', [id])
        if (proof.rows[0]?.marketNumTeams !== 14 || proof.rows[0]?.marketPpr !== 0.75 || !proof.rows[0]?.observedAt) throw new Error('Observation round-trip verification failed')
      } finally { await client.query('ROLLBACK') }
      console.log('Test database write/read round trip passed and was rolled back.')
    }
    console.log('Verified: expected schema, checksum and completed migration record.')
  }
} catch (error) {
  const message = String(error.message ?? 'unknown error').replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted]')
  // pg errors can include endpoint/user fragments; only our own bounded messages are printed in full.
  console.error(error.code ? `Database operation failed (${error.code}).` : message)
  process.exitCode = 1
} finally { await client.end().catch(() => {}) }
