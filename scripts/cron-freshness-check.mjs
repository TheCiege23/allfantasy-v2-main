/**
 * Cron freshness monitor -- alerts when a scheduled job stops WRITING ROWS.
 *
 * WHY THIS EXISTS
 * All 41 crons died on the Vercel -> Railway migration and nothing surfaced it for six days. The
 * bug was never "crons died"; it was "crons died and nothing told us". This is the thing that
 * tells us.
 *
 * THREE RULES IT IS BUILT AROUND, each of which is a way the previous checks lied:
 *
 *   1. CHECK THE DATA, NOT THE ROUTE. A manual curl returning 200 proves the handler is alive and
 *      reachable. It proves nothing about whether anything SCHEDULED it. Every job is judged by a
 *      timestamp in the database, never by a response code.
 *
 *   2. NEVER TRUST SyncJobRun.status. A row stuck in `running` makes computeJobHealth report amber
 *      forever -- it checks runningTooLong BEFORE freshness, so it can never escalate to red. A
 *      maxDuration kill runs no user code, so withSyncJobRun never closes the row. This script
 *      never reads `status`. Heartbeat probes read max(started_at) from the same table, which is
 *      not the same mistake: a timestamp cannot be stuck, only old.
 *
 *   3. USE `pg`, NOT PRISMA. Prisma reports a Neon bad password as P1001 "can't reach database",
 *      which reads as an outage. `pg` surfaces the real 28P01. A monitor that misreports its own
 *      auth failure as a production incident is worse than no monitor.
 *
 * TWO KINDS OF PROBE, because two kinds of job:
 *   OUTPUT    max(<freshness column>) on the table the job writes. Proves it did its work. Correct
 *             for unconditional jobs -- the data imports, which write on every successful run.
 *   HEARTBEAT max(started_at) in sync_job_runs for that job_name. Proves only that it RAN. Correct
 *             for CONDITIONAL jobs, which legitimately write nothing most of the year: no waivers
 *             to process in August, no autopick outside a live draft. An output probe on those is
 *             red for two-thirds of the season and teaches everyone to ignore the alarm.
 *
 * A cron that is neither probed nor listed in NO_PROBE is reported as an unclassified gap, and
 * __tests__/cron-tier-and-freshness.test.ts fails until someone classifies it. Silence about
 * coverage is what let the last outage run for six days.
 *
 * STALENESS is judged per job against its OWN declared cadence in vercel.json -- specifically the
 * largest gap between consecutive fires, not the average. `0 16-19 * * *` fires hourly inside a
 * four-hour window and then not again for 21 hours; an average-based threshold would page every
 * night. The allowance is MAX_GAP * TOLERANCE, so a job needs to miss roughly three runs before
 * it trips.
 *
 *   node scripts/cron-freshness-check.mjs              # fail (exit 1) on any stale probe
 *   node scripts/cron-freshness-check.mjs --report     # print only, always exit 0
 *   node scripts/cron-freshness-check.mjs --json       # machine-readable
 *
 * ENV: DATABASE_URL or DIRECT_URL. Read-only -- issues only SELECT max(...) and information_schema.
 */

import process from 'node:process'
import { pathToFileURL } from 'node:url'
import pg from 'pg'
import { readVercelCrons, classifyCrons } from './cron-tier.mjs'

/** A job must miss this many consecutive runs before it counts as stale. */
const TOLERANCE = 3

/** Nothing is allowed to page on a gap shorter than this -- absorbs Actions queue drift. */
const MIN_ALLOWANCE_MS = 20 * 60_000

/**
 * cron path (exactly as declared in vercel.json) -> the table it must advance.
 *
 * `column` is optional: when omitted the script introspects information_schema and picks the first
 * available freshness column, reporting which one it used. A probe naming a table or column that
 * does not exist is reported as a CONFIG ERROR and fails the run -- it must never look like "fresh".
 *
 * Jobs absent from this map are reported as UNMONITORED rather than skipped silently. A monitor
 * that quietly covers two-thirds of the fleet while printing "all healthy" is how the last outage
 * stayed invisible.
 */
export const PROBES = {
  // ── slow tier (GitHub Actions) ──
  '/api/cron/import-injuries': { table: 'SportsInjury', column: 'fetchedAt' },
  '/api/cron/import-players': { table: 'sports_players', column: 'last_updated' },
  '/api/cron/import-projections': { table: 'fantasy_projections', column: 'fetched_at' },
  '/api/cron/import-schedules?sport=all': {
    table: 'SportsGame',
    column: 'fetchedAt',
    // syncNFLScheduleToDb upserts prisma.sportsGame -- NOT game_schedules, which has never held a
    // row. import-scores writes the same table every 2 minutes and dominates this timestamp, so
    // this probe can only catch a TOTAL stop of both jobs, not this job alone. Kept anyway: a
    // weak probe that says so beats an empty row in the coverage list.
    caveat: 'shared with import-scores, which dominates freshness',
  },
  '/api/cron/import-season-stats': { table: 'player_season_stats', column: 'fetchedAt' },
  // fetched_at / expires_at / source_updated_at are NULL on all 252,768 rows; updatedAt is the
  // only column this table actually advances.
  '/api/cron/import-player-game-stats': { table: 'player_game_stats', column: 'updatedAt' },
  '/api/cron/import-stat-lines': { table: 'fantasy_stat_lines', column: 'fetched_at' },
  '/api/cron/import-depth-charts': { table: 'depth_charts', column: 'fetchedAt' },
  '/api/cron/sync-player-images?sport=all': { table: 'sports_core_player_images', column: 'fetched_at' },
  '/api/cron/compute-projections': { table: 'AFProjectionSnapshot', column: 'computedAt' },
  '/api/cron/recompute-allfantasy-adp': { table: 'allfantasy_adp_snapshots', column: 'createdAt' },
  // runAdpImporter writes prisma.adpDataRecord -> adp_data (82k rows). adp_refresh_runs holds 2
  // rows, newest 118 days old, and is not the job's output.
  '/api/cron/adp-refresh': { table: 'adp_data', column: 'created_at' },
  '/api/weather/refresh-cron': { table: 'WeatherCache', column: 'fetchedAt' },
  '/api/cron/decision-os-activity-ingest?discover=1': { table: 'decision_os_imported_activity', column: 'updatedAt' },
  '/api/cron/decision-os-snapshot-capture?discover=1': { table: 'intelligence_league_snapshot', column: 'updatedAt' },

  // Produces decision_parity_record rows; the `*/10` job whose 37-hour gap is how the whole
  // scheduler outage was found in the first place.
  '/api/cron/decision-os-intelligence-maintenance': { table: 'decision_parity_record', column: 'recordedAt' },

  // ── fast tier (stays on the host) ──
  // Monitored here on purpose. The whole reason the tiers are split is so that a host outage
  // cannot silence its own alarm; these probes are what make a fast-tier stop visible.
  '/api/cron/import-scores': { table: 'SportsGame', column: 'fetchedAt' },
  '/api/cron/import-news': { table: 'player_news', column: 'created_at' },

  // ── heartbeat probes ──
  // `heartbeat` reads max(started_at) from sync_job_runs for that job_name instead of looking at
  // an output table. It answers "did this job RUN", which is a strictly weaker claim than "did it
  // do its work" -- a run that started and then failed still refreshes the heartbeat.
  //
  // Weaker is the right trade for CONDITIONAL jobs. Most of these correctly write nothing most of
  // the time: there are no waivers to process in August, no live scores between games, no drafts
  // outside draft season. An output probe on those is red for two-thirds of the year and trains
  // everyone to ignore the alarm, which is the failure this monitor exists to prevent.
  //
  // Reading sync_job_runs at all is NOT a contradiction of rule 2 above. Rule 2 forbids trusting
  // `status`, where a row stuck in `running` makes computeJobHealth report amber forever. A
  // timestamp is not a status: max(started_at) cannot be stuck, only old.
  '/api/cron/live-score-tick': { heartbeat: 'cron-live-score-tick' },
  '/api/cron/trade-grade-notify': { heartbeat: 'cron-trade-grade-notify' },
  '/api/cron/fantasy-os-exec-sync': { heartbeat: 'fantasy-os-sleeper-sync' },
  '/api/cron/morning-briefing': { heartbeat: 'cron-morning-briefing' },
  '/api/cron/import-nfl-team-defense': { heartbeat: 'cron-nfl-team-defense-import' },
  '/api/cron/weekly-awards': { heartbeat: 'cron-weekly-awards' },

  // The eight conditional jobs that used to sit in NO_PROBE as "Needs withSyncJobRun". Each
  // handler now records a run row on every SCHEDULED fire, the no-work ones included -- which is
  // the whole point, because no-work IS the normal outcome for all eight. Manual and dry-run
  // paths on these routes deliberately record nothing: the probe matches on job_name alone, so a
  // row written by hand would be indistinguishable from a scheduled fire and could hide a dead
  // scheduler.
  //
  // Until each job next fires these read CONFIG ("no sync_job_runs rows for job_name ..."), not
  // STALE -- a heartbeat cannot backfill, and a job_name with zero rows is deliberately reported
  // as a registry problem rather than a dead scheduler. For a newly instrumented job that state
  // is expected and clears itself on the first fire; for the four FAST-tier entries here
  // (waivers, score-sync, draft-tick, legacy-import-drain) it will persist until the fast tier
  // has a scheduler again, exactly like the fast-tier output probes above.
  '/api/cron/waivers': { heartbeat: 'cron-waivers' },
  '/api/redraft/score-sync': { heartbeat: 'cron-redraft-score-sync' },
  '/api/redraft/waiver-process': { heartbeat: 'cron-redraft-waiver-process' },
  '/api/guillotine/eliminate': { heartbeat: 'cron-guillotine-eliminate' },
  '/api/tournament/automation': { heartbeat: 'cron-tournament-automation' },
  // draft-tick WAS instrumented, but only below its DRAFT_TICK_CRON_ENABLED early-return -- so
  // the default path (flag off) recorded nothing and the job looked identical whether it ran
  // every minute or had not run since March. The wrap now spans the whole tick.
  '/api/cron/draft-tick': { heartbeat: 'cron-draft-tick' },
  '/api/cron/legacy-import-drain': { heartbeat: 'cron-legacy-import-drain' },
  '/api/brackets/playoffs/cron/refresh-schedule?sport=all&provider=espn': {
    heartbeat: 'cron-playoff-schedule-refresh',
  },
}

/** Where heartbeats are read from. One row per run, whether or not the run found work to do. */
const HEARTBEAT_TABLE = 'sync_job_runs'
const HEARTBEAT_NAME_COLUMN = 'job_name'
const HEARTBEAT_TIME_COLUMN = 'started_at'

/**
 * Crons with a KNOWN reason for having no probe, so they are reported as a deliberate gap rather
 * than an oversight -- and, critically, are not pointed at a table that would alert forever.
 *
 * A probe on a table that nothing writes is worse than no probe: it goes red on day one, stays
 * red, and trains everyone to ignore the alarm. Both entries here were exactly that trap.
 */
export const NO_PROBE = {
  '/api/cron/import-standings': 'the `standings` table has never held a row -- find where this job actually writes before probing it',
  '/api/cron/import-schedules?source=tsdb-only': '`fantasy_schedule_games` has never held a row; the tsdb path may be dead',

  // The eight CONDITIONAL jobs that used to live here -- waivers, redraft score-sync and
  // waiver-process, guillotine eliminate, tournament automation, draft-tick, legacy-import-drain
  // and the playoff schedule refresh -- are now instrumented with withSyncJobRun and have moved
  // up into PROBES as heartbeats. They are the reason heartbeat probes exist: every one of them
  // correctly writes nothing for most of the year, so an output probe on them is red for
  // two-thirds of the season and trains everyone to ignore the alarm.

  // ── NO DURABLE OUTPUT AT ALL ──
  '/api/cron/alert-sweep': 'WRITES NOTHING -- reads webPushSubscription and sends push notifications. There is no table to probe; only a heartbeat could ever cover it, and the handler does not record one yet.',
  '/api/cron/draft-pool-prewarm': 'WRITES NOTHING DURABLE -- warms a cache. The `draft_pool_cache_warm` job_name exists in sync_job_runs but has 0 cron-triggered runs, so the cron path does not record one.',

  // ── HAS NEVER PRODUCED ANYTHING ──
  '/api/cron/trade-weekly-recalibration': 'TradeLearningStats holds ZERO rows -- this job has never produced output on any scheduler. Investigate before probing.',
}

const FRESHNESS_COLUMN_PREFERENCE = [
  'fetchedAt', 'fetched_at', 'capturedAt', 'captured_at', 'computedAt', 'computed_at',
  'lastUpdated', 'last_updated', 'updatedAt', 'updated_at', 'createdAt', 'created_at',
]

// ───────────────────────────── cron cadence ──────────────────────────────

/** Expands one cron field into the set of values it matches. Handles `*`, `a-b`, `a,b`, and `*​/n`. */
function expandField(field, min, max) {
  const out = new Set()
  for (const part of String(field).split(',')) {
    const [rangePart, stepPart] = part.split('/')
    const step = stepPart ? Number(stepPart) : 1
    let lo = min
    let hi = max
    if (rangePart !== '*') {
      const bounds = rangePart.split('-')
      lo = Number(bounds[0])
      hi = bounds.length > 1 ? Number(bounds[1]) : (stepPart ? max : lo)
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || step <= 0) continue
    for (let v = lo; v <= hi; v += step) out.add(v)
  }
  return out
}

/**
 * Largest gap in ms between consecutive fires, found by walking a real two-week window minute by
 * minute rather than estimating from the expression's shape.
 *
 * Two weeks because the longest cadence here is weekly, and a one-week window can produce a gap of
 * zero for a weekly job (only one fire observed). Exact beats clever: ranges, steps, lists and
 * day-of-week all fall out of the same walk, and there is no dependency to add.
 */
export function maxGapMs(schedule) {
  const f = String(schedule).trim().split(/\s+/)
  if (f.length < 5) return null
  const minutes = expandField(f[0], 0, 59)
  const hours = expandField(f[1], 0, 23)
  const doms = expandField(f[2], 1, 31)
  const months = expandField(f[3], 1, 12)
  const dows = expandField(f[4], 0, 6)

  // Standard cron: when BOTH day-of-month and day-of-week are restricted they are OR'd, not AND'd.
  const domRestricted = f[2] !== '*'
  const dowRestricted = f[4] !== '*'

  const start = Date.UTC(2027, 0, 4) // a Monday, so weekday-restricted schedules start cleanly
  let prev = null
  let maxGap = 0
  for (let m = 0; m < 14 * 24 * 60; m += 1) {
    const t = start + m * 60_000
    const d = new Date(t)
    if (!minutes.has(d.getUTCMinutes())) continue
    if (!hours.has(d.getUTCHours())) continue
    if (!months.has(d.getUTCMonth() + 1)) continue
    const dayOk =
      domRestricted && dowRestricted
        ? doms.has(d.getUTCDate()) || dows.has(d.getUTCDay())
        : (!domRestricted || doms.has(d.getUTCDate())) && (!dowRestricted || dows.has(d.getUTCDay()))
    if (!dayOk) continue
    if (prev !== null) maxGap = Math.max(maxGap, t - prev)
    prev = t
  }
  return maxGap > 0 ? maxGap : null
}

// ───────────────────────────── formatting ────────────────────────────────

function fmtAge(ms) {
  if (ms == null) return 'never'
  const h = ms / 3_600_000
  if (h < 1) return `${Math.round(ms / 60_000)}m`
  if (h < 48) return `${h.toFixed(1)}h`
  return `${(h / 24).toFixed(1)}d`
}

// ───────────────────────────────── main ──────────────────────────────────

async function main() {
  const reportOnly = process.argv.includes('--report')
  const asJson = process.argv.includes('--json')
  const connectionString = process.env.DATABASE_URL?.trim() || process.env.DIRECT_URL?.trim()

  if (!connectionString) {
    console.log('::notice::Neither DATABASE_URL nor DIRECT_URL is set -- skipping freshness check.')
    return 0
  }

  const crons = readVercelCrons()
  const tiers = classifyCrons(crons)
  const tierOf = new Map()
  for (const c of tiers.fast) tierOf.set(c.path, 'fast')
  for (const c of tiers.slow) tierOf.set(c.path, 'slow')
  for (const c of tiers.excluded) tierOf.set(c.path, 'excluded')

  const client = new pg.Client({ connectionString })
  await client.connect()

  /**
   * Every age below is computed by POSTGRES, against its own clock, and this pins the session to
   * UTC so that stays true regardless of where the check runs.
   *
   * WHY, because the bug it fixes is invisible in CI. The freshness columns are
   * `timestamp without time zone` holding UTC, and `pg` hands those back as JS Dates interpreted
   * in the CLIENT's timezone. On a UTC runner that happens to be right; on a UTC-4 laptop a row
   * written 2 minutes ago reads as 238 minutes in the FUTURE.
   *
   * A negative age is not a harmless oddity: it makes data look NEWER than it is, so a fast-tier
   * probe with a 20-minute allowance reports healthy no matter how long its job has been dead.
   * That is a false negative in the one tool whose entire job is to stop false negatives.
   *
   * Setting the session zone also makes the naive-vs-timestamptz distinction stop mattering:
   * Postgres coerces a naive column using the session zone, which is now the UTC the data is
   * actually stored in.
   */
  await client.query("SET TIME ZONE 'UTC'")

  const results = []
  const unmonitored = []
  try {
    // One introspection query for every probe table, so a missing table or column is a config
    // error rather than a per-probe exception storm.
    // Heartbeat probes carry no `table`; filtering keeps an `undefined` out of the ANY($1) array,
    // which would otherwise make the introspection return nothing and mark every probe a CONFIG error.
    const tables = [...new Set(Object.values(PROBES).map((p) => p.table).filter(Boolean))]
    const cols = await client.query(
      `SELECT table_name, array_agg(column_name::text) AS cols
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ANY($1)
        GROUP BY table_name`,
      [tables],
    )
    const columnsByTable = new Map(cols.rows.map((r) => [r.table_name, r.cols]))

    for (const cron of crons) {
      const probe = PROBES[cron.path]
      if (!probe) {
        if (tierOf.get(cron.path) !== 'excluded') {
          unmonitored.push({ ...cron, reason: NO_PROBE[cron.path] ?? null })
        }
        continue
      }

      const gap = maxGapMs(cron.schedule)
      const allowanceMs = Math.max(MIN_ALLOWANCE_MS, (gap ?? 3_600_000) * TOLERANCE)
      const base = {
        path: cron.path,
        schedule: cron.schedule,
        tier: tierOf.get(cron.path) ?? '?',
        table: probe.heartbeat ? HEARTBEAT_TABLE : probe.table,
        kind: probe.heartbeat ? 'heartbeat' : 'output',
        allowanceMs,
      }

      if (probe.heartbeat) {
        let hb
        try {
          // age_seconds comes from Postgres, not from Date.now() — see the SET TIME ZONE note.
          hb = await client.query(
            `SELECT max("${HEARTBEAT_TIME_COLUMN}") AS newest, count(*)::bigint AS n,
                    EXTRACT(EPOCH FROM (now() - max("${HEARTBEAT_TIME_COLUMN}"))) AS age_seconds
               FROM "${HEARTBEAT_TABLE}" WHERE "${HEARTBEAT_NAME_COLUMN}" = $1`,
            [probe.heartbeat],
          )
        } catch (err) {
          results.push({ ...base, state: 'CONFIG', detail: err.message })
          continue
        }
        const newest = hb.rows[0].newest ? new Date(hb.rows[0].newest) : null
        const runCount = Number(hb.rows[0].n)
        // A job_name that has never appeared is a registry error, not a dead cron -- most likely the
        // name was renamed in code. Reporting it as STALE would send someone hunting a scheduler.
        if (runCount === 0) {
          results.push({ ...base, state: 'CONFIG', detail: `no sync_job_runs rows for job_name "${probe.heartbeat}"` })
          continue
        }
        const ageMs = hb.rows[0].age_seconds == null ? null : Number(hb.rows[0].age_seconds) * 1000
        results.push({
          ...base,
          column: probe.heartbeat,
          rowCount: runCount,
          newest: newest?.toISOString() ?? null,
          ageMs,
          state: ageMs == null ? 'EMPTY' : ageMs > allowanceMs ? 'STALE' : 'OK',
          caveat: 'heartbeat: proves the job RAN, not that it succeeded',
        })
        continue
      }

      const available = columnsByTable.get(probe.table)
      if (!available) {
        results.push({ ...base, state: 'CONFIG', detail: `table "${probe.table}" does not exist` })
        continue
      }
      const column = probe.column ?? FRESHNESS_COLUMN_PREFERENCE.find((c) => available.includes(c))
      if (!column || !available.includes(column)) {
        results.push({ ...base, state: 'CONFIG', detail: `column "${probe.column ?? '(auto)'}" not on "${probe.table}"` })
        continue
      }

      let row
      try {
        // Identifiers are interpolated because they cannot be parameterised, so they are quoted and
        // come only from the literal PROBES map above -- never from input.
        // count(col) counts NON-NULL values; count(*) counts rows. The pair is what separates
        // "this job has never written" from "this probe names the wrong column", which a bare
        // max() reports identically as `never`. player_game_stats is exactly that case: 252,768
        // rows, fetched_at NULL on every one.
        row = await client.query(
          // age_seconds comes from Postgres, not from Date.now() — see the SET TIME ZONE note.
          `SELECT max("${column}") AS newest, count(*)::bigint AS n, count("${column}")::bigint AS n_ts,
                  EXTRACT(EPOCH FROM (now() - max("${column}"))) AS age_seconds
             FROM "${probe.table}"`,
        )
      } catch (err) {
        results.push({ ...base, column, state: 'CONFIG', detail: err.message })
        continue
      }

      const newest = row.rows[0].newest ? new Date(row.rows[0].newest) : null
      const rowCount = Number(row.rows[0].n)
      const tsCount = Number(row.rows[0].n_ts)
      const ageMs = row.rows[0].age_seconds == null ? null : Number(row.rows[0].age_seconds) * 1000

      let state
      if (rowCount > 0 && tsCount === 0) {
        state = 'CONFIG'
      } else if (ageMs == null) {
        state = 'EMPTY'
      } else {
        state = ageMs > allowanceMs ? 'STALE' : 'OK'
      }
      results.push({
        ...base,
        column,
        rowCount,
        newest: newest?.toISOString() ?? null,
        ageMs,
        state,
        caveat: probe.caveat ?? null,
        detail: state === 'CONFIG' ? `"${column}" is NULL on all ${rowCount} rows -- wrong column for this table` : undefined,
      })
    }
  } finally {
    await client.end()
  }

  const bad = results.filter((r) => r.state !== 'OK')

  if (asJson) {
    console.log(JSON.stringify({ results, unmonitored, failing: bad.length }, null, 2))
  } else {
    console.log('\n=== Cron freshness ===')
    console.log('Judged on max(freshness column) per table, against each job\'s own declared cadence.\n')
    for (const r of [...results].sort((a, b) => a.state.localeCompare(b.state) || a.path.localeCompare(b.path))) {
      const mark = r.state === 'OK' ? 'ok  ' : r.state === 'STALE' ? 'STALE' : r.state === 'EMPTY' ? 'EMPTY' : 'CONFIG'
      const age = r.state === 'CONFIG' ? r.detail : `${fmtAge(r.ageMs)} old (allow ${fmtAge(r.allowanceMs)})`
      const kind = r.kind === 'heartbeat' ? 'hb ' : '   '
      console.log(`  ${mark.padEnd(6)} ${r.tier.padEnd(5)} ${kind}${r.path.padEnd(52)} ${age}`)
      if (r.caveat) console.log(`             ^ ${r.caveat}`)
    }
    if (unmonitored.length > 0) {
      const known = unmonitored.filter((c) => c.reason)
      const unknown = unmonitored.filter((c) => !c.reason)
      console.log(`\n  ${unmonitored.length} declared cron(s) have NO freshness probe -- an outage in these is invisible.`)
      if (unknown.length > 0) {
        console.log(`  ${unknown.length} not yet mapped (add to PROBES, naming the table each one writes):`)
        for (const c of unknown) console.log(`     ${c.schedule.padEnd(14)} ${c.path}`)
      }
      if (known.length > 0) {
        console.log(`  ${known.length} deliberately unprobed:`)
        for (const c of known) console.log(`     ${c.schedule.padEnd(14)} ${c.path}\n         ${c.reason}`)
      }
    }
    console.log(`\n${results.length - bad.length}/${results.length} probes healthy; ${unmonitored.length} unmonitored.`)
  }

  if (bad.length > 0 && !reportOnly) {
    console.error(`\ncron-freshness-check FAILED: ${bad.length} probe(s) not healthy.`)
    for (const r of bad) console.error(`  - ${r.state} ${r.path} (${r.table})`)
    return 1
  }
  return 0
}

// Only run when executed directly. Without this guard, importing the module to unit-test
// maxGapMs() would open a database connection and then call process.exit on the test runner.
const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href

if (invokedDirectly) {
  main()
  .then((code) => process.exit(code))
  .catch((err) => {
    // Surface the driver's real error code. 28P01 is a bad password, not an outage -- the whole
    // reason this uses pg instead of Prisma.
    console.error(`cron-freshness-check crashed: ${err?.code ? `[${err.code}] ` : ''}${err?.message ?? err}`)
    process.exit(1)
  })
}
