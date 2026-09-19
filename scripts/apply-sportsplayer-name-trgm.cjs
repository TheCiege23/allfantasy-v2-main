/**
 * Apply `supabase_ensure_sportsplayer_name_trgm.sql` — the trigram index behind player search.
 *
 * ⚠ THIS EXISTS BECAUSE "RUN IT BY HAND" HAS A FOOT-GUN THE SQL FILE ITSELF WARNS ABOUT.
 * `CREATE INDEX CONCURRENTLY` is REJECTED inside a transaction block, and every GUI client that
 * wraps a pasted script in BEGIN/COMMIT fails it. This runs the three statements on one plain
 * connection with no BEGIN anywhere, which is the only shape that works. It is not a new
 * decision about the schema — the SQL and its measurements are already reviewed in that file.
 *
 * ⚠ CONCURRENTLY CAN LEAVE AN INVALID INDEX BEHIND IF IT FAILS MIDWAY, and that is not an error
 * you will see later on its own. This checks for one afterwards and says so.
 *
 * Usage (from anywhere):
 *   node scripts/apply-sportsplayer-name-trgm.cjs                      # report only
 *   node scripts/apply-sportsplayer-name-trgm.cjs --staging            # report against .env.test
 *   node scripts/apply-sportsplayer-name-trgm.cjs --staging --apply
 *   node scripts/apply-sportsplayer-name-trgm.cjs --apply --production # PRODUCTION — the user's call
 *
 * ⚠ Without --staging this reads `.env` / `.env.local`, which in this repo is PRODUCTION. Report
 * mode writes nothing anywhere; --apply against production additionally requires --production.
 * `--env-root` names the checkout holding the env files (a worktree has none of its own).
 *
 * Rollback, if it is ever wanted — also outside a transaction:
 *   DROP INDEX CONCURRENTLY IF EXISTS "SportsPlayer_name_trgm_idx";
 * The extension is deliberately left in place: dropping it would break any other trigram index
 * added later, and it costs nothing idle.
 */

const { resolveTarget } = require('./_prod-sql-target.cjs')

const argv = process.argv.slice(2)
const flag = (name) => argv.includes(name)
const option = (name) => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}

const APPLY = flag('--apply')
const STAGING = flag('--staging')
const PRODUCTION_OK = flag('--production')
const ENV_ROOT = option('--env-root') ?? __dirname

const INDEX = 'SportsPlayer_name_trgm_idx'

/** The predicate `searchPlayers()` actually issues — the widest of the four catalog passes. */
const PROBE_SQL =
  'SELECT "externalId" FROM "SportsPlayer" ' +
  'WHERE ("name" ILIKE $1 OR "name" ILIKE $2) AND "team" IS NOT NULL ' +
  'ORDER BY "sleeperId" DESC NULLS LAST, "name" ASC LIMIT 200'

async function plan(client, label) {
  const r = await client.query('EXPLAIN (ANALYZE, FORMAT JSON) ' + PROBE_SQL, ['all%', '% all%'])
  const p = r.rows[0]['QUERY PLAN'][0]
  const scans = (JSON.stringify(p.Plan).match(/"Node Type":"([^"]+)"/g) || [])
    .map((s) => s.replace(/"Node Type":"|"/g, ''))
    .filter((s) => /Scan/.test(s))
    .join(' + ')
  console.log(`  ${label.padEnd(7)}${scans.padEnd(48)}  ${p['Execution Time'].toFixed(1)} ms`)
}

async function main() {
  const target = resolveTarget(ENV_ROOT, STAGING ? { envFiles: ['.env.test'] } : {})
  console.log(`target : ${target.description}${target.isProduction ? '  ⚠ PRODUCTION' : ''}`)
  console.log(`mode   : ${APPLY ? 'APPLY (creates the index)' : 'report only (creates nothing)'}`)
  if (APPLY && target.isProduction && !PRODUCTION_OK) {
    console.log('\n🛑 REFUSING: --apply against production needs --production as well. That is the user’s decision.')
    process.exitCode = 1
    return
  }

  /* No BEGIN anywhere in this function. That is the whole point — see the header. */
  const client = target.newClient()
  await client.connect()
  try {
    const { rows: ext } = await client.query(`SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'`)
    const { rows: existing } = await client.query(
      `SELECT indisvalid FROM pg_index WHERE indexrelid = to_regclass($1)`,
      [`"${INDEX}"`],
    )
    const { rows: size } = await client.query(`SELECT count(*)::int AS n FROM "SportsPlayer"`)

    console.log(`\npg_trgm            : ${ext.length > 0 ? 'installed' : 'NOT installed'}`)
    console.log(
      `${INDEX} : ${
        existing.length === 0 ? 'absent' : existing[0].indisvalid ? 'present and valid' : '⚠ PRESENT BUT INVALID — drop it and retry'
      }`,
    )
    console.log(`SportsPlayer rows  : ${size[0].n}`)

    console.log('\nplan for the widest search pass:')
    await plan(client, 'now')

    if (existing.length > 0 && existing[0].indisvalid) {
      console.log('\nAlready applied. Nothing to do.')
      return
    }
    if (!APPLY) {
      console.log('\nReport only — re-run with --apply to create it.')
      return
    }

    console.log('\nCREATE EXTENSION IF NOT EXISTS pg_trgm …')
    await client.query('CREATE EXTENSION IF NOT EXISTS pg_trgm')

    console.log('CREATE INDEX CONCURRENTLY … (the statement that cannot run in a transaction)')
    const t0 = Date.now()
    await client.query(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS "${INDEX}" ON "SportsPlayer" USING gin ("name" gin_trgm_ops)`,
    )
    console.log(`  built in ${((Date.now() - t0) / 1000).toFixed(1)}s`)

    // The planner will not choose the new index until the table has been analyzed.
    await client.query('ANALYZE "SportsPlayer"')

    console.log('\nplan after:')
    await plan(client, 'after')

    const { rows: invalid } = await client.query(
      `SELECT indexrelid::regclass::text AS name FROM pg_index WHERE NOT indisvalid`,
    )
    console.log(`\nINVALID indexes left behind: ${invalid.map((r) => r.name).join(', ') || 'none'}`)

    const { rows: built } = await client.query(
      `SELECT pg_size_pretty(pg_relation_size($1)) AS s`,
      [`"${INDEX}"`],
    )
    console.log(`index size: ${built[0].s}`)
  } finally {
    await client.end().catch(() => {})
  }
}

main().catch((err) => {
  console.error('[apply-sportsplayer-name-trgm] failed:', err instanceof Error ? err.message : err)
  process.exitCode = 1
})
