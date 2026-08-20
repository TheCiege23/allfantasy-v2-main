/**
 * Apply `prisma/migrations/20260817130000_player_identity_player_fk` directly.
 *
 * Companion to `apply-player-image-fk.cjs`. See `_prod-sql-target.cjs` for why this does not
 * shell out to psql. Idempotent: exits early if the constraint is already present.
 *
 * Usage (from anywhere):
 *   node scripts/apply-player-identity-fk.cjs            # report only, applies nothing
 *   node scripts/apply-player-identity-fk.cjs --apply    # run the migration in one transaction
 */

const fs = require('fs')
const path = require('path')
const { resolveTarget, recordMigration } = require('./_prod-sql-target.cjs')

const APPLY = process.argv.includes('--apply')
const MIGRATION_NAME = '20260817130000_player_identity_player_fk'
const CONSTRAINT = 'sports_core_player_provider_identities_player_id_fkey'
const MIGRATION_SQL = path.join(
  path.resolve(__dirname, '..'),
  'prisma', 'migrations', MIGRATION_NAME, 'migration.sql',
)

const target = resolveTarget(__dirname)
console.log(`target   : ${target.description}`)
console.log(`migration: ${MIGRATION_NAME}`)
console.log(APPLY ? 'MODE     : APPLY (writes)' : 'MODE     : report only (no writes)')

async function main() {
  const client = target.newClient()
  await client.connect()

  const state = async () => {
    const { rows } = await client.query(
      `SELECT
         (SELECT COUNT(*)::int FROM sports_core_player_provider_identities) AS rows_total,
         (SELECT COUNT(*)::int FROM sports_core_player_provider_identities i
          WHERE i.player_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM "Player" p WHERE p.id = i.player_id)) AS orphans,
         EXISTS (SELECT 1 FROM pg_constraint WHERE conname = $1) AS fk_present,
         EXISTS (SELECT 1 FROM pg_indexes
                 WHERE tablename = 'sports_core_player_provider_identities'
                   AND indexdef LIKE '%(player_id)%') AS index_present`,
      [CONSTRAINT],
    )
    return rows[0]
  }

  const before = await state()
  console.log('\nbefore:')
  console.table(before)

  if (before.fk_present) {
    console.log('FK already present — nothing to do.')
    await client.end()
    return
  }

  /*
   * ⚠ REPORT THE DELETE BEFORE DOING IT. The migration contains a defensive DELETE. It should
   * remove nothing, and if it would remove anything that is news worth seeing rather than a
   * silent side effect of "adding a constraint".
   */
  if (before.orphans > 0) {
    console.log(`\n⚠ ${before.orphans} orphaned identity rows would be DELETED by this migration.`)
    if (!APPLY) console.log('  Inspect them before applying — this was 0 when the migration was written.')
  }

  if (!APPLY) {
    console.log('\nreport only — nothing written. Re-run with --apply to execute.')
    await client.end()
    return
  }

  // ⚠ ONE TRANSACTION. Postgres runs DDL transactionally, so a failure leaves the table as-is.
  try {
    await client.query('BEGIN')
    await client.query(fs.readFileSync(MIGRATION_SQL, 'utf8'))
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('\nFAILED — rolled back, nothing changed:', err.message)
    await client.end()
    process.exit(1)
  }

  const after = await state()
  console.log('\nafter:')
  console.table(after)

  // ⚠ POST-CONDITION, NOT A HOPE. Row count must be unchanged: there were no orphans, so this
  // migration must not have deleted anything.
  const ok =
    after.fk_present &&
    after.index_present &&
    after.orphans === 0 &&
    after.rows_total === before.rows_total
  console.log(
    ok
      ? `\nOK — FK present, ${after.rows_total} rows intact, zero orphans.`
      : `\nPOST-CONDITION FAILED — rows ${before.rows_total} -> ${after.rows_total}. Inspect before trusting this.`,
  )
  if (!ok) process.exitCode = 1

  const checksum = await recordMigration(client, MIGRATION_SQL, MIGRATION_NAME)
  console.log(`recorded in _prisma_migrations (checksum ${checksum.slice(0, 12)}…)`)

  await client.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
