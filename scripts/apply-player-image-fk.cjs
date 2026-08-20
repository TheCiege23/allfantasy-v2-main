/**
 * Apply `prisma/migrations/20260817120000_player_image_player_fk` directly.
 *
 * Already applied to production on 2026-08-17 (443 -> 228 rows, FK + index present, zero
 * orphans). Kept because it is idempotent and other environments still need it: it exits early
 * when the constraint exists. See `_prod-sql-target.cjs` for why this does not shell out to
 * psql, and `apply-player-identity-fk.cjs` for the companion constraint.
 *
 * Usage (from anywhere):
 *   node scripts/apply-player-image-fk.cjs            # report only, applies nothing
 *   node scripts/apply-player-image-fk.cjs --apply    # run the migration in one transaction
 */

const fs = require('fs')
const path = require('path')
const { resolveTarget, recordMigration } = require('./_prod-sql-target.cjs')

const APPLY = process.argv.includes('--apply')
const MIGRATION_NAME = '20260817120000_player_image_player_fk'
const CONSTRAINT = 'sports_core_player_images_player_id_fkey'
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
         (SELECT COUNT(*)::int FROM sports_core_player_images) AS rows_total,
         (SELECT COUNT(*)::int FROM sports_core_player_images i
          WHERE i.player_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM "Player" p WHERE p.id = i.player_id)) AS orphans,
         EXISTS (SELECT 1 FROM pg_constraint WHERE conname = $1) AS fk_present,
         EXISTS (SELECT 1 FROM pg_indexes
                 WHERE indexname = 'sports_core_player_images_player_id_idx') AS index_present`,
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
   * ⚠ SAY WHAT THE DELETE WILL REMOVE BEFORE REMOVING IT. Unlike the identity migration, here
   * a non-zero count is EXPECTED on an environment that has not been cleaned yet — the orphans
   * are the whole reason this migration exists. Prefer running
   * `scripts/cleanup-orphan-player-images.ts --apply` first, since that one snapshots them.
   */
  if (before.orphans > 0) {
    console.log(`\n⚠ ${before.orphans} orphaned image rows will be DELETED (no snapshot taken here).`)
    console.log('  For a snapshotted delete, run scripts/cleanup-orphan-player-images.ts --apply first.')
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

  // ⚠ POST-CONDITION, NOT A HOPE.
  const ok = after.fk_present && after.index_present && after.orphans === 0
  console.log(
    ok
      ? '\nOK — FK and index present, zero orphans.'
      : '\nPOST-CONDITION FAILED — inspect before trusting this.',
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
