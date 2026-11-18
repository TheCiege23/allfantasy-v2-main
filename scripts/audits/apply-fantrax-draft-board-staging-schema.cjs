/**
 * Apply only the additive Fantrax draft-board migration, and only to staging.
 *
 *   node --env-file=.env.staging scripts/audits/apply-fantrax-draft-board-staging-schema.cjs
 *
 * Refuses any target `db-target-identity` does not label "staging". Idempotent:
 * the SQL is `ADD COLUMN IF NOT EXISTS`, and a migration already recorded as
 * applied is skipped.
 */
const fs = require('node:fs')
const { createHash, randomUUID } = require('node:crypto')
const { Client } = require('pg')
const { identifyTarget } = require('../db-target-identity.cjs')

const url = process.env.DIRECT_URL || process.env.DATABASE_URL
if (identifyTarget(url).label !== 'staging') throw new Error('STAGING_DATABASE_REQUIRED')

const name = '20261118160000_fantrax_league_draft_board'
const sql = fs.readFileSync(`prisma/migrations/${name}/migration.sql`, 'utf8')
const checksum = createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex')

const COLUMNS_QUERY = `
  SELECT column_name, data_type FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'FantraxLeague'
    AND column_name IN ('draftBoard', 'draftPicks')
  ORDER BY column_name`

async function main() {
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 15000 })
  await client.connect()
  try {
    await client.query('BEGIN')
    await client.query("SET LOCAL lock_timeout = '5s'")
    await client.query("SET LOCAL statement_timeout = '120s'")
    await client.query("SELECT pg_advisory_xact_lock(hashtext('fantrax-draft-board-staging-schema'))")

    const before = (await client.query(COLUMNS_QUERY)).rows
    const state = await client.query(
      'SELECT finished_at, rolled_back_at FROM _prisma_migrations WHERE migration_name = $1',
      [name],
    )
    if (state.rows.some((row) => !row.finished_at && !row.rolled_back_at)) {
      throw new Error('UNRESOLVED_MIGRATION')
    }
    const alreadyApplied = state.rows.some((row) => row.finished_at && !row.rolled_back_at)

    if (!alreadyApplied) {
      await client.query(sql)
      await client.query(
        `INSERT INTO _prisma_migrations
           (id, checksum, finished_at, migration_name, started_at, applied_steps_count)
         VALUES ($1, $2, now(), $3, now(), 1)`,
        [randomUUID(), checksum, name],
      )
    }

    const after = (await client.query(COLUMNS_QUERY)).rows
    if (after.length !== 2) throw new Error('COLUMNS_NOT_PRESENT_AFTER_APPLY')
    await client.query('COMMIT')
    console.log(JSON.stringify({ target: 'staging', migration: name, alreadyApplied, before, after }))
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
