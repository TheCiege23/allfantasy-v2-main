/**
 * Apply `prisma/migrations/20260826120000_platform_chat_reply_parent` directly.
 *
 * See `_prod-sql-target.cjs` for why this does not shell out to psql, and the repo notes on
 * why `prisma migrate deploy` is not used here. Idempotent: the SQL is IF NOT EXISTS on both
 * statements, and the migration bookkeeping row is ON CONFLICT DO NOTHING.
 *
 * ⚠ THE TARGET IS NAMED, NEVER INFERRED. `--env=test` reads `.env.test` (ep-muddy-leaf);
 * the default reads `.env`/`.env.local`, which in this repo IS PRODUCTION. Both print the
 * credential-free identity before doing anything, and `--apply` on production additionally
 * requires `--i-mean-production` so a rehearsal command cannot become a production write by
 * losing one flag.
 *
 * Usage:
 *   node scripts/apply-platform-chat-reply-parent.cjs --env=test            # report only
 *   node scripts/apply-platform-chat-reply-parent.cjs --env=test --apply    # apply to test
 *   node scripts/apply-platform-chat-reply-parent.cjs                        # report on prod
 *   node scripts/apply-platform-chat-reply-parent.cjs --apply --i-mean-production
 */

const fs = require('fs')
const path = require('path')
const { resolveTarget, recordMigration } = require('./_prod-sql-target.cjs')

const APPLY = process.argv.includes('--apply')
const CONFIRMED_PROD = process.argv.includes('--i-mean-production')
const USE_TEST = process.argv.some((a) => a === '--env=test')

const MIGRATION_NAME = '20260826120000_platform_chat_reply_parent'
const TABLE = 'platform_chat_messages'
const COLUMN = 'parentMessageId'
const INDEX = 'platform_chat_messages_parentMessageId_idx'

const MIGRATION_SQL = path.join(
  path.resolve(__dirname, '..'),
  'prisma', 'migrations', MIGRATION_NAME, 'migration.sql',
)

const target = resolveTarget(__dirname, USE_TEST ? { envFiles: ['.env.test'] } : {})

console.log(`target   : ${target.description}`)
console.log(`production: ${target.isProduction ? 'YES' : 'no'}`)
console.log(`migration: ${MIGRATION_NAME}`)
console.log(APPLY ? 'MODE     : APPLY (writes)' : 'MODE     : report only (no writes)')

if (APPLY && target.isProduction && !CONFIRMED_PROD) {
  console.error('\nRefusing: this is production and --i-mean-production was not passed.')
  process.exit(1)
}
if (USE_TEST && target.isProduction) {
  /* Fails closed: --env=test resolving to production means the env file is wrong. */
  console.error('\nRefusing: --env=test resolved to a PRODUCTION target. Check .env.test.')
  process.exit(1)
}

async function main() {
  const client = target.newClient()
  await client.connect()

  const state = async () => {
    const { rows } = await client.query(
      `SELECT
         current_database() AS db,
         (SELECT COUNT(*)::int FROM information_schema.columns
           WHERE table_name = $1 AND column_name = $2) AS column_present,
         (SELECT COUNT(*)::int FROM pg_indexes
           WHERE tablename = $1 AND indexname = $3) AS index_present,
         (SELECT COUNT(*)::int FROM ${TABLE}) AS rows_total,
         (SELECT COUNT(*)::int FROM "_prisma_migrations" WHERE migration_name = $4) AS recorded`,
      [TABLE, COLUMN, INDEX, MIGRATION_NAME],
    )
    return rows[0]
  }

  try {
    const before = await state()
    console.log('\nbefore:', JSON.stringify(before))

    if (!APPLY) {
      console.log('\nReport only — nothing was written. Re-run with --apply to change that.')
      return
    }

    const sql = fs.readFileSync(MIGRATION_SQL, 'utf8')

    /*
     * One transaction. Both statements are IF NOT EXISTS, so a partial earlier run is
     * absorbed rather than fought, and a failure leaves nothing half-applied.
     */
    await client.query('BEGIN')
    try {
      await client.query(sql)
      await recordMigration(client, MIGRATION_SQL, MIGRATION_NAME)
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    }

    const after = await state()
    console.log('after :', JSON.stringify(after))

    const ok =
      after.column_present === 1 && after.index_present === 1 && after.recorded === 1 &&
      after.rows_total === before.rows_total
    console.log(ok ? '\n✓ applied and recorded; row count unchanged' : '\n✗ post-state unexpected')
    if (!ok) process.exitCode = 1
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  /* Never let a connection string reach the log. */
  console.error('failed:', err && err.message ? err.message.replace(/postgres(ql)?:\/\/\S+/gi, '<redacted>') : err)
  process.exitCode = 1
})
