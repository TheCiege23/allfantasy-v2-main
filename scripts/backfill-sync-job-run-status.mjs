/**
 * One-off: normalise `sync_job_runs.status` from `completed` to `success`.
 *
 * WHY. The column carries two words for "fine". `syncJobRunTelemetry` types it
 * `success | partial | failed` and is the only writer that does; three others write directly and
 * emit `completed` — measured 2026-09-06: fantasy-os-sleeper-sync 27,020, import-players 159,
 * import-player-game-stats 53. Every reader therefore needs a translation table, and
 * `normalizeRunStatus` exists precisely to supply one.
 *
 * 🛑 RUN THIS ONLY AFTER THE EXPAND STEP IS DEPLOYED. `lib/fantasy-data/fantasyDataEvidence.ts`
 * queried `status IN ('completed','failed')` and matches `import-players` rows through
 * `jobScope contains <sport>`. Running this against a deployment whose reader still asks only for
 * `completed` empties that query — and it feeds `leagueSportsGroundingPacket`, so the symptom is
 * the AI quietly losing its evidence for when data last imported, with nothing failing anywhere.
 * The reader now accepts both spellings; that change must be LIVE first.
 *
 * ORDER, and it is expand / migrate / contract:
 *   1. reader accepts `completed` and `success`      <- landed, must be DEPLOYED before step 2
 *   2. this backfill, then writers switch to `success`
 *   3. optionally narrow the reader again, much later
 *
 * USAGE
 *   node scripts/backfill-sync-job-run-status.mjs             # dry run: counts only, writes nothing
 *   node scripts/backfill-sync-job-run-status.mjs --apply --yes
 *
 * ⚠ BOTH FLAGS ARE REQUIRED. `--apply` alone is refused. A single flag is too easy to reach for on
 * a script whose default target is production.
 *
 * ENV: DATABASE_URL or DIRECT_URL. The endpoint is PRINTED before anything happens, because two
 * Neon branches are schema-identical and no query can tell you which one you reached.
 */

import process from 'node:process'
import pg from 'pg'

const ARGV = process.argv.slice(2)
const APPLY = ARGV.includes('--apply')
const YES = ARGV.includes('--yes')

/** Only these three emit `completed`. Naming them keeps the update off any writer discovered later. */
const JOB_NAMES = ['fantasy-os-sleeper-sync', 'import-players', 'import-player-game-stats']

async function main() {
  const connectionString = process.env.DATABASE_URL?.trim() || process.env.DIRECT_URL?.trim()
  if (!connectionString) {
    console.error('No DATABASE_URL or DIRECT_URL set.')
    process.exit(1)
  }

  // Host only, never the full URL — this repo is public and the password lives in that string.
  const host = connectionString.replace(/.*@/, '').replace(/[/?].*$/, '')
  console.log(`endpoint : ${host}`)
  console.log(`mode     : ${APPLY ? (YES ? 'APPLY (writes)' : 'REFUSED — --apply needs --yes') : 'dry run'}`)
  console.log('')

  const client = new pg.Client({ connectionString })
  await client.connect()
  try {
    await client.query("SET TIME ZONE 'UTC'")

    const before = await client.query(
      `SELECT job_name, count(*)::int AS n,
              to_char(min(started_at), 'YYYY-MM-DD') AS oldest,
              to_char(max(started_at), 'YYYY-MM-DD') AS newest
         FROM sync_job_runs
        WHERE status = 'completed'
        GROUP BY job_name ORDER BY 2 DESC`,
    )
    const total = before.rows.reduce((n, r) => n + r.n, 0)
    console.log('rows with status = completed:')
    for (const r of before.rows) {
      const known = JOB_NAMES.includes(r.job_name) ? '' : '   <-- NOT in JOB_NAMES, will NOT be touched'
      console.log(`  ${String(r.n).padStart(6)}  ${r.job_name.padEnd(28)} ${r.oldest} .. ${r.newest}${known}`)
    }
    console.log(`  ${String(total).padStart(6)}  TOTAL`)

    /*
     * ⚠ A JOB NAME OUTSIDE THE LIST IS A STOP, NOT A WARNING. It means a writer exists that this
     * script's author did not know about, and the safe response is to go and read it rather than
     * to migrate the rows it produced.
     */
    const unknown = before.rows.filter((r) => !JOB_NAMES.includes(r.job_name)).map((r) => r.job_name)
    if (unknown.length) {
      console.error(`\nREFUSING: unrecognised job_name(s) writing 'completed': ${unknown.join(', ')}`)
      console.error('Find the writer and decide deliberately before migrating its rows.')
      process.exit(1)
    }

    if (!APPLY) {
      console.log('\nDry run — nothing written. Re-run with --apply --yes to migrate.')
      return
    }
    if (!YES) {
      console.error('\nREFUSED: --apply requires --yes.')
      process.exit(1)
    }

    /*
     * The cutoff is captured from the DATABASE clock and printed, because it is the reversal key:
     * rows migrated by this run are exactly `status = 'success' AND job_name = ANY(...) AND
     * started_at <= cutoff`. Writers still emit `completed` until they are switched, so anything
     * appearing after the cutoff is new and not this script's doing.
     */
    const { rows: [{ now }] } = await client.query("SELECT to_char(now(), 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS now")

    await client.query('BEGIN')
    const res = await client.query(
      `UPDATE sync_job_runs SET status = 'success'
        WHERE status = 'completed' AND job_name = ANY($1)`,
      [JOB_NAMES],
    )
    await client.query('COMMIT')

    console.log(`\nreported : ${res.rowCount} row(s) updated — as claimed by the transaction`)
    console.log(`cutoff   : ${now}`)
    console.log('\nTo reverse exactly this run:')
    console.log("  UPDATE sync_job_runs SET status = 'completed'")
    console.log(`   WHERE status = 'success' AND job_name = ANY('{${JOB_NAMES.join(',')}}')`)
    console.log(`     AND started_at <= '${now}';`)
  } finally {
    await client.end()
  }

  /*
   * 🛑 THE WRITE IS VERIFIED FROM A DIFFERENT CONNECTION, AFTER THE FIRST ONE IS CLOSED.
   *
   * The original version read the row count back on the SAME client that did the UPDATE. That read
   * happened after COMMIT, so it was correct — but it could not PROVE it was correct, and that turned
   * out to matter. When the migration was later found reverted, a reviewing session reconstructed the
   * incident as "the transaction never committed and you read your own uncommitted writes", which is
   * a real failure mode and fits the observed output exactly. It was wrong — a human had run the
   * reversal — but nothing in this script's own output could rule it out, and I could not answer the
   * charge from the artifact. A verification that cannot distinguish success from the most plausible
   * failure is not a verification.
   *
   * A fresh connection cannot see an uncommitted transaction. So if these numbers are right, the
   * commit is proven rather than assumed, and the same argument cannot be had twice.
   *
   * ⚠ IT ASSERTS, IT DOES NOT JUST PRINT. Printing a number a human has to notice is how the first
   * version failed; a mismatch here exits non-zero and says which way it went.
   */
  const verifier = new pg.Client({ connectionString })
  await verifier.connect()
  try {
    await verifier.query("SET TIME ZONE 'UTC'")
    const { rows } = await verifier.query(
      `SELECT count(*) FILTER (WHERE status = 'completed')::int AS still_completed,
              count(*) FILTER (WHERE status = 'success')::int   AS now_success
         FROM sync_job_runs WHERE job_name = ANY($1)`,
      [JOB_NAMES],
    )
    const { still_completed: stillCompleted, now_success: nowSuccess } = rows[0]
    console.log('\n--- verified on a SEPARATE connection ---')
    console.log(`  still 'completed' : ${stillCompleted}`)
    console.log(`  now 'success'     : ${nowSuccess}`)

    if (stillCompleted > 0) {
      console.error(
        `\nFAILED: ${stillCompleted} row(s) are still 'completed' on a fresh connection. The ` +
          'transaction reported success but the change is not visible to anyone else — treat the ' +
          'commit as having NOT taken effect and do not report this run as done.',
      )
      process.exit(1)
    }
    console.log('\nOK — the change is visible outside the writing transaction.')
  } finally {
    await verifier.end()
  }
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
