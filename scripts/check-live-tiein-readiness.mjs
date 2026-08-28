#!/usr/bin/env node
/**
 * Is `/live` → "My games" going to work? One command, read-only.
 *
 * WHY THIS EXISTS. `/live` and `/core/live` default to `scope: 'my'`, which
 * filters the slate to games where you roster a player. That join reads
 * `league_player_weekly_scores`. Through preseason the table is legitimately
 * EMPTY — Sleeper reports no fantasy points for preseason games — so "My games"
 * shows nothing and that is CORRECT. The first real test is week 1.
 *
 * ⚠ THE DANGEROUS PART IS THAT EMPTY AND BROKEN LOOK IDENTICAL HERE. An empty
 * table renders the same screen whether the sync never ran, the sync ran and
 * found nothing, or the season simply has not started. This distinguishes them,
 * because on the Sunday that matters nobody wants to be reading source.
 *
 *   node scripts/check-live-tiein-readiness.mjs --env=local
 *   node scripts/check-live-tiein-readiness.mjs --env=test
 *
 * ⚠ `--env=local` reads `.env.local`, which IS PRODUCTION in this repo. That is
 * usually what you want here — production is where the rows are — and this
 * script only ever SELECTs, inside a read-only transaction that is rolled back.
 */

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import pg from 'pg'

const ENV_FILES = { local: '.env.local', test: '.env.test' }

function fail(m) {
  console.error(m)
  process.exit(1)
}

const args = process.argv.slice(2)
const envArg = args.find((a) => a.startsWith('--env='))?.slice('--env='.length) ?? 'test'
if (!ENV_FILES[envArg]) fail(`--env must be one of: ${Object.keys(ENV_FILES).join(', ')}`)

const envPath = path.resolve(process.cwd(), ENV_FILES[envArg])
if (!fs.existsSync(envPath)) fail(`${ENV_FILES[envArg]} not found in ${process.cwd()}`)
const line = fs
  .readFileSync(envPath, 'utf8')
  .split(/\r?\n/)
  .find((l) => l.startsWith('DATABASE_URL'))
if (!line) fail(`DATABASE_URL not found in ${ENV_FILES[envArg]}`)
let url = line.slice(line.indexOf('=') + 1).trim()
if ((url.startsWith('"') && url.endsWith('"')) || (url.startsWith("'") && url.endsWith("'"))) {
  url = url.slice(1, -1)
}

// The connection string is never printed, and errors are scrubbed of it.
const scrub = (s) => String(s).replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '<redacted>')

const client = new pg.Client({ connectionString: url })

try {
  await client.connect()
  await client.query('BEGIN TRANSACTION READ ONLY')

  const q = async (sql) => (await client.query(sql)).rows

  const [tie] = await q(`
    select count(*)::int                       as rows,
           count(distinct "leagueId")::int     as leagues,
           coalesce(max(week), 0)::int         as newest_week,
           coalesce(max("seasonYear"), 0)::int as season
      from league_player_weekly_scores`)

  /*
   * Has any week of the CURRENT season been played? A scheduled-but-unplayed
   * season sums to zero everywhere, which is what makes an empty tie-in table
   * correct.
   *
   * ⚠ SCOPED TO THE NEWEST SEASON, AND THAT IS NOT A DETAIL. Aggregating across
   * all seasons made this script report "🛑 BROKEN" on its first run: 204 rows
   * carried points, so it concluded weeks had been played — but every one was
   * 2025 historical backfill, while 2026 had 13,460 rows and ZERO points. It
   * would have raised a false alarm on exactly the morning it exists to inform.
   */
  const [played] = await q(`
    with newest as (select max("seasonYear") as s from "WeeklyMatchup")
    select (select s from newest)::int                           as season,
           count(*)::int                                         as matchup_rows,
           coalesce(sum(case when "pointsFor" > 0 then 1 else 0 end), 0)::int as rows_with_points
      from "WeeklyMatchup"
     where "seasonYear" = (select s from newest)`)

  // Prior seasons, reported separately so a historical backfill is never
  // mistaken for the current season having started.
  const [historical] = await q(`
    with newest as (select max("seasonYear") as s from "WeeklyMatchup")
    select coalesce(sum(case when "pointsFor" > 0 then 1 else 0 end), 0)::int as rows_with_points
      from "WeeklyMatchup"
     where "seasonYear" <> (select s from newest)`)

  // Is the writer alive at all? Heartbeat, not output — the sync legitimately
  // writes nothing out of season, so an output probe would read as broken.
  const [sync] = await q(`
    select coalesce(max(started_at)::text, 'never')            as last_run,
           count(*)::int                                       as runs_24h
      from sync_job_runs
     where job_name = 'fantasy-os-sleeper-sync'
       and started_at > now() - interval '24 hours'`)

  await client.query('ROLLBACK')

  console.log('league_player_weekly_scores')
  console.log(`  rows            ${tie.rows}`)
  console.log(`  leagues         ${tie.leagues}`)
  console.log(`  newest week     ${tie.newest_week} (season ${tie.season})`)
  console.log(`WeeklyMatchup — season ${played.season} (current)`)
  console.log(`  rows            ${played.matchup_rows}`)
  console.log(`  with points > 0 ${played.rows_with_points}`)
  console.log(`  prior seasons   ${historical.rows_with_points} scored rows (historical, ignored)`)
  console.log('fantasy-os-sleeper-sync')
  console.log(`  runs (24h)      ${sync.runs_24h}`)
  console.log(`  last run        ${sync.last_run}`)
  console.log('')

  /*
   * The verdict, which is the whole point of the script. Order matters: a dead
   * sync is worth saying even when the empty table is otherwise explainable,
   * because it is the thing that will still be broken in week 1.
   */
  if (tie.rows > 0) {
    console.log('✅ READY — tie-ins exist. "My games" will populate for leagues with rostered players.')
  } else if (played.rows_with_points === 0) {
    console.log('⏳ EXPECTED EMPTY — no week has been played yet (every WeeklyMatchup sums to 0).')
    console.log('   "My games" showing nothing is CORRECT. Use "All games" for the slate.')
    if (sync.runs_24h === 0) {
      console.log('')
      console.log('🛑 BUT THE SYNC HAS NOT RUN IN 24h. That will not fix itself in week 1 —')
      console.log('   check /api/cron/fantasy-os-exec-sync and FANTASY_OS_EXEC_SYNC_LIVE.')
    }
  } else {
    console.log('🛑 BROKEN — weeks HAVE been played but no tie-in rows exist.')
    console.log('   The writer is ingestSleeperPlayerScoresForWeek, reached from')
    console.log('   syncConnectedSleeperLeague. Check that table exists and the sync is running.')
  }
} catch (err) {
  try {
    await client.query('ROLLBACK')
  } catch {}
  console.error('probe failed:', scrub(err?.message ?? err))
  process.exit(1)
} finally {
  await client.end().catch(() => {})
}
