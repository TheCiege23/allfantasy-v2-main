/**
 * ONE definition of "how old is too old" for an injury claim.
 *
 * No prisma, no `server-only` — deliberately. These constants have to be
 * importable by a worker, a request path and the read port alike, and pulling
 * the port in just to reach a number would drag prisma into modules that do not
 * otherwise need it.
 *
 * ── WHY THIS MOVED OUT OF injuryReadPort.ts ─────────────────────────────────
 *
 * The port applies the rule to `SportsInjury`, which is refreshed every 30
 * minutes and is fine. `injury_reports` (InjuryReportRecord) is the OTHER
 * injury table, and it has **no scheduled writer**: `runInjuryImporter` is
 * reachable only from admin routes and one lazy request-path fallback, so the
 * only thing writing it on a schedule is the `?xnews=1` Grok pass — which runs
 * NFL only, four times a day.
 *
 * 🛑 MEASURED IN PRODUCTION, 2026-09-09. `injury_reports.created_at`, newest row
 * per sport:
 *
 *     NFL      0.1 days      <- Grok pass, healthy
 *     NCAAF   11.2 days      <- a one-off admin run, not a schedule
 *     SOCCER  11.5 days      <- same
 *     NBA    135.6 days
 *     NHL    135.6 days
 *     MLB    135.6 days
 *     NCAAB  135.8 days      <- last runInjuryImporter run, 2026-04-26
 *
 * Every non-NFL sport is serving LAST SEASON. That is not a stale cache, it is
 * a false statement about a player who is on a roster today, and it reached
 * surfaces through two hops rather than one:
 *
 *   1. `sports-data-importer` read this table unbounded and wrote
 *      `SportsPlayerRecord.injuryStatus` from it — laundering an April
 *      designation into a column with no date on it at all;
 *   2. `FantasyValueSnapshotService` then preferred that column, and preferred
 *      `injury_reports` over `SportsInjury`, so the fresh 30-minute row lost to
 *      a four-month-old one.
 *
 * ⚠ THE FIX IS A BOUND, NOT A SECOND INGEST. The obvious repair — schedule
 * `runInjuryImporter` — would be a second implementation of a job
 * `/api/cron/import-injuries` already does through different providers, and
 * CLAUDE.md is explicit that two implementations of one rule IS the bug.
 * `SportsInjury` is already current for every sport that has a source; the
 * correct behaviour when `injury_reports` has nothing recent is to return
 * nothing and let callers fall through to it.
 */

/**
 * Beyond this, a status is a claim we can no longer stand behind, but it may
 * still be describing the current season. Callers SURFACE this rather than
 * dropping the row — see `InjuryFact.stale`.
 */
export const INJURY_STALE_AFTER_HOURS = 36

/**
 * Beyond this, a report cannot be describing the CURRENT season and is dropped
 * outright rather than returned with a caveat.
 *
 * 120 days clears an offseason without touching in-season data. Measured against
 * production when this was added to the port: it keeps 1,224 of 1,230 live NFL
 * `SportsInjury` rows and drops exactly the archival items. Re-measured against
 * `injury_reports` on 2026-09-09: it keeps all 1,109 NFL rows and drops every
 * non-NFL sport, which is the intended outcome above.
 *
 * ⚠ This is deliberately applied to the REPORT date, never to `created_at` or a
 * season column. The ingest stamps the current season onto whatever it pulls, so
 * a 2022 row can carry `season = 2026`; and SOCCER's rows were *written* 11 days
 * ago while *reporting* on 2026-05-01. The report date is the only field that has
 * not been overwritten with something convenient.
 */
export const INJURY_PRIOR_SEASON_AFTER_HOURS = 120 * 24

/** The oldest report date that can still be describing the current season. */
export function priorSeasonCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - INJURY_PRIOR_SEASON_AFTER_HOURS * 3_600_000)
}

/**
 * Prisma `where` fragment bounding an `injury_reports` read to the current season.
 *
 * Spread this into any `injuryReportRecord` query that feeds a serving path:
 *
 *     where: { sport, ...currentSeasonReportWhere() }
 *
 * ⚠ NOT for the health/telemetry readers. `AdminProviderHealthService`,
 * `cachedProviderEvidence`, `fantasyDataEvidence`, `providerHealth` and
 * `nflDataCoverage` all read this table in order to REPORT ON ITS AGE. Bounding
 * those would hide the very staleness they exist to show — they would report
 * "0 rows" for a table holding 273, which reads as "no data" rather than "old
 * data" and is strictly less informative.
 */
export function currentSeasonReportWhere(now: Date = new Date()): { reportDate: { gte: Date } } {
  return { reportDate: { gte: priorSeasonCutoff(now) } }
}
