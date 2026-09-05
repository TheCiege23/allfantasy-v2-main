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
import { pinSessionToUtc, maxAge } from './db-freshness.mjs'

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
 * A column that EXISTS but is NULL on every row is a separate state, UNPOPULATED: the counts cannot
 * say whether the map is wrong or nothing has written it yet, so the checker reports what it saw
 * and names both causes instead of asserting one. It fails the run just the same.
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
  /*
   * PROMOTED FROM NO_PROBE 2026-08-27, once the route gained a heartbeat.
   *
   * ⚠ IT CANNOT BE AN OUTPUT PROBE. `ingestRosters` writes prisma.sportsPlayer —
   * the same sports_players.last_updated that import-players probes, and that job
   * runs far more often, so a table probe here would report this one healthy on
   * another job's run. That is the false green that hid the dead fast tier for six
   * days.
   *
   * The heartbeat wraps the WHOLE sweep, one row per fire. A per-sport wrap would
   * record five runs a night and make a partial sweep look like a complete one.
   */
  '/api/cron/import-schedules?rosters=1': { heartbeat: 'cron-import-schedules-rosters' },
  /*
   * The four CFBD intel feeds, split onto their own tick 2026-08-28.
   *
   * ⚠ HEARTBEAT, NOT A TABLE PROBE, for the same reason as ?rosters=1 above:
   * this writes DevyPlayer columns, and the main import-players run writes
   * DevyPlayer far more often, so a table probe here would be satisfied by that
   * job and report this one healthy while it did nothing.
   *
   * It also has to be a heartbeat because of what "healthy" means here. Every
   * feed is cadence-gated (12h to 7d) and the tick caps at one phase, so a
   * correct run frequently writes NOTHING. An output probe would read that as
   * dead. The heartbeat records that the sweep FIRED, which is the only thing
   * this job can honestly promise every six hours.
   *
   * Why it exists at all: the phase was starved, never broken. It sat behind
   * runSportsDataImporter plus the pool and stats phases and required 150s of a
   * 240s budget to start, so it was skipped before running on every tick since
   * it shipped — zero `devy_intel_refresh:*` markers in production, ever, while
   * the pool and stats markers were fresh.
   */
  '/api/cron/import-players?intel=1': { heartbeat: 'cron-devy-intel-sources' },
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
  /*
   * ⚠ SEASONAL, AND ONLY THIS ONE UNTIL ANOTHER IS PROVEN. Measured 2026-08-23: 37 runs total, but
   * the last one to read anything was 2026-07-21 (a five-run backfill burst, 13,670 rows). Every
   * scheduled run since reads 0 and writes 0 in ~700ms. That is the route's DOCUMENTED success
   * path -- "once a season reconciles this is a cheap no-op" -- because the table holds season 2025
   * only (252,768 rows, weeks 1-18, newest game_date 2026-01-04) and no 2026 regular-season game
   * has been played yet.
   *
   * Marking a probe seasonal SUPPRESSES a real alarm for months, so it is done per job, on
   * evidence, and never speculatively. import-season-stats is a plausible next candidate and is
   * deliberately NOT marked: it is currently healthy, and exempting a job that has not been shown
   * to need it is how a monitor quietly stops monitoring.
   */
  '/api/cron/import-player-game-stats': {
    table: 'player_game_stats',
    column: 'updatedAt',
    seasonal: { sport: 'NFL' },
  },
  '/api/cron/import-stat-lines': { table: 'fantasy_stat_lines', column: 'fetched_at' },
  '/api/cron/import-depth-charts': { table: 'depth_charts', column: 'fetchedAt' },
  /* ⚠ KEY MATCHES THE FULL PATH INCLUDING QUERY, so adding `&limit=500` to the cron orphaned
     this entry: the job read as unclassified AND the probe read as pointing at no cron. */
  '/api/cron/sync-player-images?sport=all&limit=500': { table: 'sports_core_player_images', column: 'fetched_at' },
  /*
   * ⚠ `lastUpdatedAt`, NOT `createdAt`. This job UPSERTS, so `createdAt` freezes at first insert
   * and never moves again no matter how many times the row is refreshed.
   *
   * Measured cost of getting it wrong: the monitor reported this job 32.8 days stale and I went
   * looking for a month-old failure. `lastUpdatedAt` was 2.8 days — exactly the scheduler outage,
   * same as everything else. The job was never broken.
   *
   * THE GENERAL RULE: probe a WRITE-TIME column. `createdAt` is only a freshness signal on an
   * append-only table (`adp_data` and `player_news` below are genuinely append-only, which is why
   * they keep it). On anything that upserts it measures the wrong event entirely, and it fails in
   * the direction that wastes the most time — a false alarm on a healthy job.
   */
  '/api/cron/recompute-allfantasy-adp': { table: 'allfantasy_adp_snapshots', column: 'lastUpdatedAt' },
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
  // MOVED OFF SportsGame 2026-08-23. This probe read the same table+column as import-schedules,
  // so ANY import-schedules run reported import-scores healthy. With the fast tier dead, that was
  // a silent false green for a job that had not run at all -- strictly worse than the wrong-table
  // probes fixed earlier, because those were permanently RED and therefore loud.
  // No column can separate them (both write rolling_insights, thesportsdb AND api_sports rows),
  // and source='espn' is not exclusive either -- 'espn' is an NflRedraftProviderId, so the
  // redraft canonical sync can write it. The route now records a heartbeat instead.
  '/api/cron/import-scores': { heartbeat: 'cron-import-scores' },
  // The outbox drain fires as `?relayOnly=1` on the SAME route as the daily ingest, so it needs
  // its own job_name or the ingest's heartbeat would report the drain healthy on a day it never
  // ran -- the shared-probe false green fixed for import-scores just above.
  // Every 6h, so 9h allows one missed fire before it goes red.
  '/api/cron/decision-os-activity-ingest?relayOnly=1': { heartbeat: 'cron-decision-os-relay-drain' },
  // The outbox drain fires as `?relayOnly=1` on the SAME route as the daily ingest, so it needs
  // its own job_name or the ingest's heartbeat would report the drain healthy on a day it never
  // ran -- the shared-probe false green fixed for import-scores just above.
  // Every 6h, so 9h allows one missed fire before it goes red.
  '/api/cron/import-news': { table: 'player_news', column: 'created_at' },

  /*
   * WAS AN OUTPUT PROBE ON `notification_outbox.sentAt`, DELIBERATELY, AND THE REASONING IS KEPT
   * HERE BECAUSE IT WAS GOOD. The original note read: "A heartbeat here would report green for the
   * exact bug this job was written to end: `notification_outbox` was write-only for months (4 rows,
   * all pending, attemptCount 0, newest 2026-06-21) because no consumer existed... Do not mute it
   * to get a green board."
   *
   * That was right when written. It is superseded 2026-09-02 on measurement, not on preference:
   *
   *   1. THE CONSUMER EXISTS AND RUNS. `sync_job_runs` holds 796 rows for
   *      `cron-notification-outbox-relay`, most recent minutes ago, and the fast-tier dispatcher
   *      logs it OK on every fire (389ms / 1567ms / 513ms in one window). The write-only-queue bug
   *      the output probe was guarding is fixed, and a heartbeat detects its return.
   *   2. THOSE FOUR ROWS ARE CLOSED, NOT STUCK. All four are `status='skipped'` with `lastError`
   *      "Retired 2026-08-30: ... Stale on arrival; not delivered by operator decision." They are
   *      the pre-consumer backlog, retired on purpose. The queue holds no live work.
   *   3. SO max(sentAt) IS NULL FOR A THIRD REASON THE NOTE DID NOT ANTICIPATE — not "producers
   *      idle pre-season", not "drain broken", but "the only rows that ever existed were retired
   *      unsent by decision". No amount of waiting resolves that; it needs new traffic.
   *
   * 🛑 AND THE PROBE DID NOT REPORT ANY OF THAT — IT REPORTED SOMETHING FALSE. An all-NULL column
   * makes the checker emit CONFIG `"sentAt" is NULL on all 4 rows -- wrong column for this table`.
   * The column is correct. A monitor asserting a false cause is worse than one that is merely
   * pessimistic: it sends the next reader to fix a mapping that was never broken.
   *
   * ⚠ WHAT THIS TRADE COSTS, STATED PLAINLY: the heartbeat proves the relay RAN, not that mail
   * WENT OUT. A relay that runs and silently delivers nothing now reads green. That regression is
   * real and it is the original author's point. Restoring the strong claim without the false
   * diagnosis means fixing the CHECKER — teaching it to separate "column exists, all NULL"
   * (honest EMPTY/STALE) from "column absent" (CONFIG) — and then this can go back to
   * { table: 'notification_outbox', column: 'sentAt' }. That is the better long-term fix and it
   * is not done here.
   */
  '/api/cron/notification-outbox-relay': { heartbeat: 'cron-notification-outbox-relay' },

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
  /*
   * ⚠ '/api/guillotine/eliminate' REMOVED — THE ROUTE IS DELIBERATELY GONE.
   * 47151092e ("refactor(guillotine): delete the second elimination engine and its route")
   * deleted app/api/guillotine/eliminate/route.ts along with lib/guillotine/
   * eliminationEngine.ts (358 lines), consolidating onto guillotineChopAudit. Nothing
   * writes the 'cron-guillotine-eliminate' heartbeat any more — verified: this entry was
   * its ONLY remaining reference in the repo.
   *
   * A probe pointing at a deleted route cannot go green, so it reports a dead cron
   * forever and teaches everyone to ignore the freshness check. Removing it is the fix;
   * __tests__/cron-heartbeat-route-contracts.test.ts asserts every probe has a route and
   * is what caught this.
   */
  '/api/tournament/automation': { heartbeat: 'cron-tournament-automation' },
  // draft-tick WAS instrumented, but only below its DRAFT_TICK_CRON_ENABLED early-return -- so
  // the default path (flag off) recorded nothing and the job looked identical whether it ran
  // every minute or had not run since March. The wrap now spans the whole tick.
  '/api/cron/draft-tick': { heartbeat: 'cron-draft-tick' },
  '/api/cron/legacy-import-drain': { heartbeat: 'cron-legacy-import-drain' },
  '/api/brackets/playoffs/cron/refresh-schedule?sport=all&provider=espn': {
    heartbeat: 'cron-playoff-schedule-refresh',
  },

  /*
   * A HEARTBEAT because there is no single output table that means "this ran". The orchestrator
   * rotates <=25 leagues per fire and fans out across drafts, matchups, season state and
   * TransactionFact; every one of those tables is also written by another job, so a table probe
   * here would be satisfied by that other job and report this one healthy while it did nothing --
   * the same masking already recorded under the sync-player-images and import-news variants.
   *
   * Its gates are also season-aware by design, so a correct run out of season writes no rows at
   * all. An output probe would be red for months and train everyone to ignore the board.
   *
   * ⚠ CONTEXT WORTH KEEPING: until this probe was added the job was invisible in BOTH directions
   * -- `20 STAR/4 * * *` was declared in cron-schedule.json but absent from cron-slow-tier.yml, so
   * nothing fired it, and no probe watched it. It had never run on the Actions scheduler at all.
   * The missing trigger was added in the same change as this entry; landing either one alone
   * leaves a job that runs unwatched, or a probe that reports a job nothing is running.
   */
  '/api/cron/sleeper-historical-refresh': { heartbeat: 'cron-sleeper-historical-refresh' },

  /*
   * Already instrumented before it was probed -- the route has recorded
   * `cron-domain-os-refresh` via withSyncJobRun all along, and nothing was reading it. A
   * heartbeat rather than an output probe because the refresh is a no-op whenever no domain
   * has gone stale, which is the ordinary outcome between events.
   */
  '/api/cron/domain-os-refresh': { heartbeat: 'cron-domain-os-refresh' },

  /*
   * Both tournament jobs are CONDITIONAL in the strongest sense: the announcement sweep posts
   * only rows whose `scheduledFor` has arrived, and most hours none have. An output probe on
   * `TournamentAnnouncement.postedAt` would therefore sit red between broadcasts and teach
   * everyone to ignore the board -- the failure this monitor exists to prevent.
   *
   * ⚠ NEITHER ROUTE RECORDED A HEARTBEAT UNTIL THIS CHANGE. The instrumentation was added in the
   * same commit; a probe naming a job_name nothing writes reports CONFIG forever. Dry runs stay
   * unrecorded on purpose -- the probe matches on job_name alone, so a hand-issued smoke test
   * would be indistinguishable from a scheduled fire and could hide a dead scheduler.
   */
  '/api/cron/tournament-announcements': { heartbeat: 'cron-tournament-announcements' },

  /*
   * Keyed on the `?auto=1` path because that is the only form the scheduler calls, and it is
   * also the only form that records: an explicit season/week call is a human backfilling, and
   * letting that refresh the heartbeat would mask a scheduler that had stopped.
   */
  '/api/cron/tournament-weekly-scores?auto=1': { heartbeat: 'cron-tournament-weekly-scores' },

  /*
   * The last user-facing blind spot, and the one with the highest cost of silence: this sweep's
   * product of record is a push notification about an injured starter, which is the most
   * time-critical thing the platform knows. It could have stopped delivering entirely and no
   * monitor would have said a word.
   *
   * ⚠ NOT A TABLE PROBE, AND `SportsInjury` IS THE TRAP. The route's game-window fold does write
   * that table, so it looks probeable -- but `/api/cron/import-injuries` writes the same
   * `SportsInjury.fetchedAt` every 30 minutes and is already probed on it. A table probe here
   * would be satisfied by THAT job and report this one healthy while it sent nothing, which is
   * the same masking recorded under the sync-player-images and import-news variants.
   *
   * It moved out of NO_PROBE in the commit that instrumented the handler; the old entry said
   * "only a heartbeat could ever cover it, and the handler does not record one yet". It does now.
   */
  '/api/cron/alert-sweep': { heartbeat: 'cron-alert-sweep' },

  /*
   * THE THREE "WRITES NOWHERE" SUSPECTS, RESOLVED 2026-09-02 — AND NONE OF THEM WAS BROKEN.
   * All three sat in NO_PROBE on notes that named a table the job never touches, or read a
   * feature flag as a dead job. Each note sent the next reader hunting for a bug that was not
   * there, which is the same defect the UNPOPULATED state was added to stop the checker itself
   * committing. Measured against production before moving any of them.
   *
   *   import-standings      writes `SportsDataCache` under `<SPORT>:standings:<season>:<abbrev>`,
   *                         NOT a `standings` table. 64 live NFL rows. Working the whole time.
   *   ?source=tsdb-only     `ingestSchedule` upserts `sportsGame` (26,924 rows), NOT
   *                         `fantasy_schedule_games`. And "tsdb-only" matching neither "all" nor
   *                         "rolling_insights" nor "api_sports" is the DESIGN — it is how this
   *                         mode runs the TSDB block alone, documented in the route.
   *   trade-weekly-recalib  gated on TRADE_ENGINE_WEEKLY_RECALIBRATION_ENABLED, default off. Its
   *                         own docstring says it no-ops with zero Prisma calls when disabled, so
   *                         TradeLearningStats holding zero rows is the CORRECT state.
   *
   * ⚠ ALL THREE ARE HEARTBEATS, AND NONE OF THEM COULD BE AN OUTPUT PROBE. Every table they do
   * write is written far more often by another job — SportsDataCache by many, `sportsGame` by
   * import-scores every two minutes — so a table probe would be satisfied by that other job and
   * report these healthy while they did nothing. The shared-probe false green, three more times.
   *
   * ⚠ AND NONE OF THEM EMITTED A HEARTBEAT UNTIL THIS CHANGE. withSyncJobRun was added to all
   * three routes in the same commit; a probe naming a job_name nothing writes reports CONFIG
   * forever. Expect exactly that until each next fires — six hours, four hours, and up to a week
   * respectively.
   */
  '/api/cron/import-standings': { heartbeat: 'cron-import-standings' },
  '/api/cron/import-schedules?source=tsdb-only': { heartbeat: 'cron-import-schedules-tsdb' },

  /*
   * ⚠ THIS ONE RECORDS WHILE ITS FEATURE FLAG IS OFF, DELIBERATELY. The wrap sits outside the
   * flag check, so the row answers "did the weekly cron fire" — true and checkable whether or not
   * the recalibration itself is enabled. Recording only on the enabled path would report CONFIG
   * for as long as the flag stays off, which is indistinguishable from a dead scheduler and is
   * exactly the confusion this probe exists to remove. A disabled fire records `success` with the
   * reason in `warnings` and the count in rowsSkipped: the job did what it is configured to do.
   */
  '/api/cron/trade-weekly-recalibration': { heartbeat: 'cron-trade-weekly-recalibration' },

  /*
   * Offseason-conditional, and the reason it is a HEARTBEAT rather than a `seasonal` output
   * probe like import-player-game-stats above: this job had NO telemetry of any kind, so out of
   * season a suppressed output probe would have left it completely unwatched for seven months --
   * the "crons died and nothing told us" hole, reopened. The heartbeat is the weaker claim but it
   * is the only one available here that survives the offseason.
   *
   * Until the season starts it refuses every player with `no_games_played` and writes no
   * AFProjectionSnapshot row at all; since #596 it reports that as HTTP 200 + ok:false rather
   * than the daily 500 it used to throw.
   *
   * ⚠ IN-SEASON THIS IS TOO WEAK. From Week 1 a heartbeat cannot tell a working run from one
   * that fires daily and silently writes nothing. Restore the output probe then --
   * { table: 'AFProjectionSnapshot', column: 'computedAt', seasonal: { sport: 'NFL' } } -- which
   * keeps the strong claim in season and self-suppresses out of it.
   */
  '/api/cron/compute-projections': { heartbeat: 'cron-compute-projections' },
}

/** Where heartbeats are read from. One row per run, whether or not the run found work to do. */
/**
 * Months (1-12, UTC) in which a sport produces the data a seasonal probe watches.
 *
 * ⚠ THIS IS A CALENDAR, NOT A GUESS AT WHETHER A JOB WORKS. It answers one question: can this job
 * possibly have new data to import right now? Out of season the honest answer is no, and holding a
 * three-day freshness allowance against it means the probe goes STALE every offseason for months.
 *
 * ⚠ AND THAT IS NOT A COSMETIC PROBLEM. An alarm that is red for months is one people stop reading.
 * cron-freshness failed hourly for 61 hours while live scoring was dead and nobody looked, because
 * it had been failing on seasonal probes long before that. A probe that cries wolf costs more than
 * no probe at all.
 *
 * Mirrors `regularSeasonPeriod` in lib/sport-defaults/SeasonCalendarResolver.ts. Duplicated rather
 * than imported because this script deliberately runs on the Node standard library alone — it must
 * work in a bare checkout with no install. Keep the two in sync.
 *
 * ⚠ NOT DERIVED FROM THE DATA, DELIBERATELY. The obvious "are there recent games?" signal cannot
 * yet distinguish preseason from regular season: `SportsGame.seasonType` was added 2026-08-22 and
 * is still NULL on all pre-existing rows, so a preseason slate would read as "in season" and defeat
 * the point. Revisit once that column is populated.
 */
const SEASON_WINDOWS = {
  NFL: [9, 10, 11, 12, 1],
}

/**
 * True when `sport` is inside its regular season, plus a TRAILING grace period.
 *
 * ⚠ THE GRACE IS TRAILING ONLY, AND THE SYMMETRIC VERSION IS A BUG I WROTE FIRST. Granting grace on
 * both sides made 23 August "in season" because three weeks later is September — which re-armed the
 * alarm across the whole preseason gap this function exists to exempt. The two directions are not
 * symmetric:
 *
 *   AFTER a season ends, the data is still legitimately fresh for a while (January's stats do not
 *   rot on 1 February), so a strict month cutoff would false-alarm.
 *   BEFORE a season starts, there is no data yet BY DEFINITION. Grace there does not prevent a
 *   false alarm, it creates one.
 */
export function isInSeason(sport, now = new Date(), graceDays = 21) {
  const months = SEASON_WINDOWS[String(sport).toUpperCase()]
  if (!months) return true // Unknown sport: judge it normally rather than silently exempting it.
  const monthOf = (d) => d.getUTCMonth() + 1
  if (months.includes(monthOf(now))) return true
  return months.includes(monthOf(new Date(now.getTime() - graceDays * 86_400_000)))
}

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
  '/api/cron/import-player-game-stats?multiSport=1&days=3':
    'writes the same player_game_stats.updatedAt the NFL job an hour earlier probes, so a table ' +
    'probe here reports this one healthy on that run instead. The NFL probe is scoped with ' +
    'seasonal.sport; this sweep covers the other sports and needs either its own heartbeat or a ' +
    'probe scoped to a sport the NFL job never touches.',
  '/api/cron/import-schedules?riProfiles=1':
    'syncRollingInsightsTeamsToDb/PlayersToDb write sportsTeam and sportsPlayer — the same ' +
    'sports_players that import-players and ?rosters=1 already write, and those run more often, so ' +
    'any table probe here is satisfied by another job. Needs a heartbeat on the route, which is ' +
    'the same fix ?rosters=1 is waiting on.',

  /*
   * The two in-season image sweeps, added 2026-08-30 alongside the fantasy-position priority tier.
   * They exist because `?sport=all` rotates the sport order by day-of-year, so NFL and NCAAF each
   * got the budget one day in seven — which is how 408 of 7,427 rostered NFL players ended up with
   * a headshot while this job's probe stayed green all season.
   *
   * Unprobed for the ordinary reason: they write the same sports_core_player_images.fetched_at that
   * `?sport=all` already probes an hour earlier, so a table probe here is satisfied by that job
   * instead. Same shape as ?riProfiles=1 above, and the same fix — a per-route heartbeat.
   */
  '/api/cron/sync-player-images?sport=NFL&limit=500&scope=players':
    'writes the same sports_core_player_images.fetched_at that ?sport=all probes, so a table probe ' +
    'here is satisfied by that job. Needs its own heartbeat.',
  '/api/cron/sync-player-images?sport=NCAAF&limit=500&scope=players':
    'writes the same sports_core_player_images.fetched_at that ?sport=all probes, so a table probe ' +
    'here is satisfied by that job. Needs its own heartbeat.',

  // The eight CONDITIONAL jobs that used to live here -- waivers, redraft score-sync and
  // waiver-process, tournament automation, draft-tick, legacy-import-drain
  // and the playoff schedule refresh -- are now instrumented with withSyncJobRun and have moved
  // up into PROBES as heartbeats. They are the reason heartbeat probes exist: every one of them
  // correctly writes nothing for most of the year, so an output probe on them is red for
  // two-thirds of the season and trains everyone to ignore the alarm.

  // ── NO DURABLE OUTPUT AT ALL ──
  '/api/cron/draft-pool-prewarm': 'WRITES NOTHING DURABLE -- warms a cache. The `draft_pool_cache_warm` job_name exists in sync_job_runs but has 0 cron-triggered runs, so the cron path does not record one.',

  // ── HAS NEVER PRODUCED ANYTHING ──

  /*
   * Classified 2026-08-30. It had been an UNCLASSIFIED gap since it was added, which is the one
   * state this module treats as a bug rather than a decision -- and it kept
   * __tests__/cron-tier-and-freshness.test.ts red, which in turn made that whole guard easy to
   * ignore.
   *
   * `?xnews=1` is a query-param mode of the SAME route as the base import-news job, and it writes
   * the same player_news rows. The base job runs every 15 minutes against this one's 6 hours, so
   * any table probe here is satisfied by the base job's writes long before this one is due --
   * the shared-probe false green. Zero new rows is also a legitimate outcome (X may have had
   * nothing in the window), so an output probe would be wrong even if it were not shared.
   *
   * The fix is the same one ?riProfiles=1 and ?rosters=1 are waiting on: a per-mode heartbeat.
   * Its notification dispatch half is separately covered now -- see the outbox relay probe above.
   */
  '/api/cron/import-news?xnews=1&sport=NFL':
    'a query-param mode of the import-news route writing the same player_news the base job writes ' +
    'every 15 minutes, so a table probe here is satisfied by that job. Zero new rows is also ' +
    'legitimate (X may have nothing in the window). Needs a per-mode heartbeat.',

  /*
   * The backfill sweeper, added with the route in 5e0624675 / 4b7a82d1c.
   *
   * ⚠ THIS ONE IS UNPROBEABLE FOR A REASON THE OTHERS ARE NOT, AND IT IS THE INTERESTING ONE.
   * Every entry above is unprobed because it SHARES a table with a job that runs more often --
   * the shared-probe false green. This job's problem is the opposite: on a healthy platform it
   * correctly writes NOTHING. It exists to re-drive historical backfills that died mid-run, so
   * zero writes is the SUCCESS case and the steady state. Any output probe would therefore
   * report it stale precisely when it is working, and green only when leagues are broken.
   *
   * It also has no freshness column to probe even when it does work: it stamps
   * League.settings.historicalBackfillStatus, a JSON blob that the import path and the manual
   * retry route both write, so a table probe would be satisfied by either of those instead --
   * the same shared-probe shape as ?riProfiles=1 above, on top of the inversion.
   *
   * The fix is a heartbeat, and it must be a real one: the route does not call withSyncJobRun
   * today, so pointing a heartbeat probe at it now would report CONFIG forever rather than
   * measure anything. Checked before writing this rather than assumed.
   */
  '/api/cron/import-backfill-sweeper':
    'a repair job whose healthy steady state is writing NOTHING -- it re-drives historical ' +
    'backfills stuck at pending, so zero writes means every league is fine. An output probe ' +
    'would read stale exactly when it is working and green only when leagues are broken. It ' +
    'also stamps League.settings JSON that the import and manual-retry paths both write, so a ' +
    'table probe would be satisfied by those. Needs a withSyncJobRun heartbeat on the route, ' +
    'which it does not emit yet.',
}

/**
 * Fallback order when a probe names no explicit column. WRITE-TIME columns first; `createdAt` is
 * last because on an upsert table it freezes at first insert and never moves again.
 *
 * ⚠ `lastUpdatedAt` is in here because a real table used exactly that spelling and the list
 * missed it — `allfantasy_adp_snapshots` would have fallen through to `createdAt` and reported a
 * healthy job as a month stale. Add spellings when you meet them.
 *
 * ⚠ NOTHING THAT DESCRIBES THE WORLD RATHER THAN OUR WRITE. `expiresAt`, `startTime`,
 * `forecastForTime`, `reportDate`, `occurredAt` are all timestamps on these tables and all wrong:
 * the first three are usually in the FUTURE, and event-time columns like `occurredAt` would mask a
 * dead ingester the moment a provider backfills. Freshness means "when did WE last write this".
 */
const FRESHNESS_COLUMN_PREFERENCE = [
  'fetchedAt', 'fetched_at', 'capturedAt', 'captured_at', 'computedAt', 'computed_at',
  'lastUpdatedAt', 'last_updated_at', 'lastUpdated', 'last_updated',
  'updatedAt', 'updated_at', 'createdAt', 'created_at',
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

/**
 * Turn one probe's row counts into a state. Pure, and exported so the states can be TESTED.
 *
 * ⚠ EXTRACTED FROM THE MIDDLE OF THE QUERY LOOP ON PURPOSE. It used to be an inline if/else with
 * a live `pg` client either side of it, so the only way to exercise a state was to reach a
 * database holding data in exactly that shape — which meant in practice that no state was ever
 * exercised, and a new one could be added with nothing to prove it fires. This file's own header
 * says a monitor that has never gone red is not evidence; that applies to the monitor's own
 * classifier first.
 *
 * The four callers' inputs map straight from `maxAge()`:
 *   rowCount        count(*)      — rows in the table
 *   timestampCount  count(col)    — rows where the freshness column is NOT NULL
 *   ageMs           now - max(col), or null when there is no timestamp at all
 *
 * ⚠ ORDER IS LOAD-BEARING. UNPOPULATED and EMPTY are decided BEFORE the seasonal softening,
 * because a column nothing has written is broken in or out of season. Moving the season check
 * above them would let an out-of-season job report IDLE — healthy — while its probe pointed at a
 * column that does not get written at all.
 */
export function classifyFreshness({ rowCount, timestampCount, ageMs, allowanceMs, outOfSeason = false }) {
  if (rowCount > 0 && timestampCount === 0) return 'UNPOPULATED'
  if (ageMs == null) return 'EMPTY'
  if (ageMs > allowanceMs && outOfSeason) return 'IDLE'
  return ageMs > allowanceMs ? 'STALE' : 'OK'
}

/** The states that do NOT fail a run. Kept beside the classifier so the two cannot drift apart. */
export const HEALTHY_STATES = new Set(['OK', 'IDLE'])

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
  // One clock for the whole run, so a probe evaluated late cannot land on the other side of a
  // season boundary from one evaluated early.
  const now = new Date()
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
  await pinSessionToUtc(client)

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
          hb = await maxAge(client, {
            table: HEARTBEAT_TABLE,
            column: HEARTBEAT_TIME_COLUMN,
            where: `"${HEARTBEAT_NAME_COLUMN}" = $1`,
            params: [probe.heartbeat],
          })
        } catch (err) {
          results.push({ ...base, state: 'CONFIG', detail: err.message })
          continue
        }
        const newest = hb.newest
        const runCount = hb.rowCount
        // A job_name that has never appeared is a registry error, not a dead cron -- most likely the
        // name was renamed in code. Reporting it as STALE would send someone hunting a scheduler.
        if (runCount === 0) {
          results.push({ ...base, state: 'CONFIG', detail: `no sync_job_runs rows for job_name "${probe.heartbeat}"` })
          continue
        }
        const ageMs = hb.ageMs
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
        row = await maxAge(client, { table: probe.table, column })
      } catch (err) {
        results.push({ ...base, column, state: 'CONFIG', detail: err.message })
        continue
      }

      const { newest, rowCount, timestampCount: tsCount, ageMs } = row

      /*
       * ⚠ `UNPOPULATED` WAS `CONFIG`, DETAILED "wrong column for this table" — AN ASSERTED CAUSE
       * THE COUNTS CANNOT ESTABLISH. Two different situations produce an all-NULL column, and
       * `count(col)` against `count(*)` cannot tell them apart:
       *
       *   the probe names the WRONG COLUMN   — `player_game_stats` holds 252,768 rows with
       *                                        `fetched_at` NULL on every one. The map is wrong.
       *   the column is RIGHT, nothing set it — `notification_outbox.sentAt` was NULL on all 4
       *                                        rows because the only rows that ever existed were
       *                                        retired unsent by operator decision (2026-08-30).
       *
       * Reporting the first as fact sent the reader to fix a mapping that was never broken, which
       * is worse than a stale red: it spends someone's attention on a non-bug and teaches them the
       * board lies. Whether the column EXISTS is a different question, answered above, and still a
       * real CONFIG. What is left here is an observation, so it is reported as one.
       *
       * ⚠ IT STILL FAILS THE RUN. `HEALTHY_STATES` holds only OK and IDLE, so the alarm is exactly
       * as loud as before — the wording changed, the severity did not. A column nothing has ever
       * populated is a finding under either cause, and softening it here would be the "green board"
       * the outbox probe's original author rightly warned against.
       *
       * Out of season IDLE means "stale, and expected to be" — not OK, which would claim the data
       * is fresh when it is not. UNPOPULATED and EMPTY are decided BEFORE that softening, inside
       * classifyFreshness: a column nothing writes is broken in or out of season.
       */
      const state = classifyFreshness({
        rowCount,
        timestampCount: tsCount,
        ageMs,
        allowanceMs,
        outOfSeason: Boolean(probe.seasonal && !isInSeason(probe.seasonal.sport, now)),
      })
      results.push({
        ...base,
        column,
        rowCount,
        newest: newest?.toISOString() ?? null,
        ageMs,
        state,
        caveat: probe.caveat ?? null,
        detail:
          state === 'UNPOPULATED'
            ? `"${column}" exists on "${probe.table}" but is NULL on all ${rowCount} row(s) -- either this probe names the wrong column, or the column is correct and nothing has populated it yet. Find what writes it before changing the map.`
            : undefined,
      })
    }
  } finally {
    await client.end()
  }

  // IDLE is a healthy outcome: the job is correct and simply has nothing to do this month.
  const bad = results.filter((r) => !HEALTHY_STATES.has(r.state))

  if (asJson) {
    console.log(JSON.stringify({ results, unmonitored, failing: bad.length }, null, 2))
  } else {
    console.log('\n=== Cron freshness ===')
    console.log('Judged on max(freshness column) per table, against each job\'s own declared cadence.\n')
    for (const r of [...results].sort((a, b) => a.state.localeCompare(b.state) || a.path.localeCompare(b.path))) {
      const mark =
        r.state === 'OK' ? 'ok  '
        : r.state === 'IDLE' ? 'idle'
        : r.state === 'STALE' ? 'STALE'
        : r.state === 'EMPTY' ? 'EMPTY'
        : r.state === 'UNPOPULATED' ? 'NULLCOL'
        : 'CONFIG'
      /*
       * Show the detail whenever there is one, rather than only for CONFIG. Every CONFIG result
       * sets `detail`, and UNPOPULATED now does too; for the rest it is undefined and the age
       * string is the useful line. Keying on the STATE meant a new state printed
       * "never old (allow 3.0d)" and buried the reason it was flagged.
       */
      const age = r.detail ?? `${fmtAge(r.ageMs)} old (allow ${fmtAge(r.allowanceMs)})`
      const kind = r.kind === 'heartbeat' ? 'hb ' : '   '
      console.log(`  ${mark.padEnd(7)} ${r.tier.padEnd(5)} ${kind}${r.path.padEnd(52)} ${age}`)
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
