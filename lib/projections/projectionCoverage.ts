/**
 * Which sports have a WEEKLY projection feed, and what to say when one does not.
 *
 * The deliberate mirror of `injuryCoverageFor` in `lib/injuries/injuryReadPort.ts`, for the
 * same reason and against the same failure: a surface that renders an empty projection where
 * no feed exists is making a claim ("we have no opinion on this player") that is different
 * from the truth ("nobody sells weekly college projections"). Only one of those tells a
 * manager to go look somewhere else.
 *
 * ⚠ THE FACTS HERE WERE MEASURED, NOT ASSUMED, and they already existed in prose. The map
 * below is lifted from `HAS_PROJECTION_SOURCE` in `app/api/cron/import-projections/route.ts`,
 * which recorded on 2026-08-13 that every provider in the chain fails for `projections` on
 * NCAAF and that CollegeFootballData — the only college feed we hold a key for — 404s on
 * `/projections/player`. That knowledge was trapped inside a cron route: the ingest knew not
 * to bother, and every reader downstream had no way to find out. This module is the shared
 * definition site so the writer and the readers cannot disagree.
 *
 * ⚠ "NO WEEKLY FEED" IS NOT "NO PROJECTIONS". Read `seasonLongAvailable` before writing any
 * copy. Measured 2026-08-30 in production, `AFProjectionSnapshot` holds 10,188 NCAAF rows
 * computed that morning — MORE than the NFL's 1,576 — because that table is COMPUTED from
 * `fantasy_stat_lines` (NCAAF has 13,433) rather than imported from a vendor. They are
 * season-long (`week` is null for every row, in both sports), so they cannot answer "what
 * will he do this Saturday", but they are real and they are current. Telling a college
 * manager "no projections exist" would be false.
 */

/** The shape both callers and tests destructure. */
export interface ProjectionCoverage {
  /** A vendor weekly projection feed lands rows in `fantasy_projections` for this sport. */
  weeklyFeedAvailable: boolean
  /** Computed season-long rows exist in `AFProjectionSnapshot` for this sport. */
  seasonLongAvailable: boolean
  /** Present only when `weeklyFeedAvailable` is false. Render this, never a bare blank. */
  reason: string | null
}

/**
 * Sports with a real weekly vendor feed. NFL's is Sleeper.
 *
 * Adding a sport here is a claim that `fantasy_projections` actually receives rows for it —
 * check the table before editing, not the intent of a cron.
 */
const WEEKLY_FEED_SPORTS = new Set(['NFL'])

/**
 * Sports whose season-long projections are computed locally by `lib/af-projections`.
 *
 * Everything with a `fantasy_stat_lines` base ends up here, which as of 2026-08-30 is every
 * supported sport except SOCCER (no player season stats from Rolling Insights — see
 * `support_consequences` in contracts/rolling-insights/ENDPOINTS.yaml).
 */
const SEASON_LONG_SPORTS = new Set(['NFL', 'NCAAF', 'NCAAB', 'NBA', 'NHL', 'MLB'])

const NO_WEEKLY_FEED_REASON: Record<string, string> = {
  NCAAF:
    'No weekly college projection feed exists — every provider we carry fails for college ' +
    'projections and CollegeFootballData returns 404. Season-long AllFantasy projections are ' +
    'computed from real college stat lines and are shown instead.',
}

const GENERIC_NO_WEEKLY_FEED =
  'No weekly projection feed is published for this sport. Season-long AllFantasy projections ' +
  'are computed from stat lines where a base exists.'

/**
 * What can be said about projections for this sport.
 *
 * Callers should render `reason` alongside (or instead of) an empty weekly projection rather
 * than leaving the space blank — blank reads as "no opinion", which is a different and
 * usually wrong claim.
 */
export function projectionCoverageFor(sport: string | null | undefined): ProjectionCoverage {
  const key = String(sport ?? '').trim().toUpperCase()
  const weeklyFeedAvailable = WEEKLY_FEED_SPORTS.has(key)
  const seasonLongAvailable = SEASON_LONG_SPORTS.has(key)

  if (weeklyFeedAvailable) {
    return { weeklyFeedAvailable: true, seasonLongAvailable, reason: null }
  }

  return {
    weeklyFeedAvailable: false,
    seasonLongAvailable,
    reason: NO_WEEKLY_FEED_REASON[key] ?? GENERIC_NO_WEEKLY_FEED,
  }
}
