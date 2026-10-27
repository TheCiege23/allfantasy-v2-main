/** Apply only Pirate migrations to the separately configured staging database. */
const fs = require('node:fs')
const { createHash, randomUUID } = require('node:crypto')
const dotenv = require('dotenv')
const { Client } = require('pg')

const read = (name) => fs.existsSync(name) ? dotenv.parse(fs.readFileSync(name)) : {}
const staging = read(process.env.PIRATE_STAGING_ENV || '.env.staging')
const production = read(process.env.PIRATE_PRODUCTION_ENV || '.env')
const local = read(process.env.PIRATE_LOCAL_ENV || '.env.local')
if (!staging.DATABASE_URL || !production.DATABASE_URL && !local.DATABASE_URL) throw Error('A verified staging and production URL are required.')
const target = new URL(staging.DATABASE_URL)
const productionHosts = [production.DATABASE_URL, production.DIRECT_URL, local.DATABASE_URL, local.DIRECT_URL]
  .filter(Boolean).map((value) => new URL(value).hostname.replace('-pooler', ''))
if (!target.hostname.includes('winter-salad') || productionHosts.includes(target.hostname.replace('-pooler', ''))) {
  throw Error('Refusing an unverified or production database target.')
}
const names = ['20261027000000_pirate_league', '20261027010000_pirate_claim_governance', '20261027020000_pirate_claim_cycles', '20261027030000_pirate_playoff_claims']
const migrations = names.map((name) => {
  const sql = fs.readFileSync(`prisma/migrations/${name}/migration.sql`, 'utf8')
  return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') }
})

async function main() {
  const db = new Client({ connectionString: staging.DATABASE_URL, connectionTimeoutMillis: 15000 })
  await db.connect()
  try {
    await db.query('BEGIN')
    await db.query("SET LOCAL lock_timeout = '5s'")
    await db.query("SET LOCAL statement_timeout = '120s'")
    await db.query("SELECT pg_advisory_xact_lock(hashtext('pirate-staging-migrations'))")
    const state = await db.query('SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations WHERE migration_name = ANY($1)', [names])
    if (state.rows.some((row) => !row.finished_at && !row.rolled_back_at)) throw Error('An unresolved Pirate migration already exists.')
    const applied = new Set(state.rows.filter((row) => row.finished_at && !row.rolled_back_at).map((row) => row.migration_name))
    const pending = migrations.filter((migration) => !applied.has(migration.name))
    for (const migration of pending) {
      await db.query(migration.sql)
      await db.query(`INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, started_at, applied_steps_count)
        VALUES ($1, $2, now(), $3, now(), 1)`, [randomUUID(), migration.checksum, migration.name])
    }
    await db.query('COMMIT')
    console.log(JSON.stringify({ databaseHost: target.hostname, applied: pending.map((migration) => migration.name), alreadyApplied: names.filter((name) => applied.has(name)) }))
  } catch (error) {
    await db.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    await db.end()
  }
}
main().catch((error) => { console.error('Pirate staging migration failed:', error.code || error.message); process.exitCode = 1 })
