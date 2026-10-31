/** Apply only the two additive import tables required by the Fantrax staging flow. */
const fs = require('node:fs')
const { createHash, randomUUID } = require('node:crypto')
const { Client } = require('pg')
const { identifyTarget } = require('../db-target-identity.cjs')

const url = process.env.DIRECT_URL || process.env.DATABASE_URL
if (identifyTarget(url).label !== 'staging') throw new Error('STAGING_DATABASE_REQUIRED')

const names = [
  '20260904040000_deleted_league_tombstones',
  '20260912020000_import_run_attempt',
]
const migrations = names.map((name) => {
  const sql = fs.readFileSync(`prisma/migrations-pending/${name}/migration.sql`, 'utf8')
  return { name, sql, checksum: createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex') }
})

async function main() {
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 15000 })
  await client.connect()
  try {
    await client.query('BEGIN')
    await client.query("SET LOCAL lock_timeout = '5s'")
    await client.query("SET LOCAL statement_timeout = '120s'")
    await client.query("SELECT pg_advisory_xact_lock(hashtext('fantrax-import-staging-schema'))")
    const state = await client.query(`
      SELECT migration_name, finished_at, rolled_back_at
      FROM _prisma_migrations WHERE migration_name = ANY($1)`, [names])
    if (state.rows.some((row) => !row.finished_at && !row.rolled_back_at)) {
      throw new Error('UNRESOLVED_IMPORT_MIGRATION')
    }
    const applied = new Set(state.rows
      .filter((row) => row.finished_at && !row.rolled_back_at)
      .map((row) => row.migration_name))
    const tables = await client.query(`
      SELECT to_regclass('public.deleted_league_tombstones') IS NOT NULL AS tombstones,
             to_regclass('public.import_run_attempts') IS NOT NULL AS attempts`)
    const present = [tables.rows[0].tombstones, tables.rows[0].attempts]
    for (let index = 0; index < migrations.length; index++) {
      const migration = migrations[index]
      if (applied.has(migration.name) !== present[index]) {
        throw new Error(`MIGRATION_TABLE_STATE_MISMATCH_${migration.name}`)
      }
      if (applied.has(migration.name)) continue
      await client.query(migration.sql)
      await client.query(`
        INSERT INTO _prisma_migrations
          (id, checksum, finished_at, migration_name, started_at, applied_steps_count)
        VALUES ($1, $2, now(), $3, now(), 1)`,
        [randomUUID(), migration.checksum, migration.name])
    }
    await client.query('COMMIT')
    console.log(JSON.stringify({ target: 'staging', applied: names.filter((name) => !applied.has(name)),
      alreadyApplied: names.filter((name) => applied.has(name)) }))
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    await client.end()
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ failed: true, code: error.code || error.message }))
  process.exitCode = 1
})
