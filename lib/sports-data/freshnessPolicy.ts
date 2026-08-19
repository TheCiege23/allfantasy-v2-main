/**
 * How stale each class of sports data is allowed to be, and therefore what gets
 * stored once versus re-fetched on a schedule.
 *
 * This exists because "how often should we call the provider" was previously
 * decided per call site, which is how a page ends up fetching a stadium's
 * capacity on every request and a live score once an hour — exactly backwards.
 *
 * THE RULE: the app reads from the database. Nothing on a request path calls a
 * provider. Ingestion writes; surfaces read. `scripts/check-db-first-api-boundary.mjs`
 * enforces this, and thesportsdb.com is now one of the hosts it watches.
 *
 * The tiers below are about how often the WRITER runs, never about whether a
 * reader may skip the database.
 */

export type FreshnessTier = 'static' | 'slow' | 'daily' | 'gameday' | 'live'

export type DataClass =
  | 'leagues'
  | 'venues'
  | 'team_identity'
  | 'season_list'
  | 'historical_schedule'
  | 'roster'
  | 'player_bio'
  | 'player_season_stats'
  | 'current_schedule'
  | 'standings'
  | 'injuries'
  | 'live_scores'
  | 'play_by_play'

export type FreshnessRule = {
  tier: FreshnessTier
  /** How old a row may be before a reader should treat it as stale. */
  maxAgeSeconds: number
  /** Where the data comes from. Null where no provider we use serves it. */
  provider: 'thesportsdb' | 'espn' | 'rolling_insights' | 'cfbd' | 'none'
  why: string
}

const MIN = 60
const HOUR = 60 * MIN
const DAY = 24 * HOUR

export const FRESHNESS: Record<DataClass, FreshnessRule> = {
  // ── Static: ingest once, refresh occasionally to pick up corrections ──
  leagues: {
    tier: 'static',
    maxAgeSeconds: 30 * DAY,
    provider: 'thesportsdb',
    why: 'The set of leagues changes when a competition is founded or renamed. Monthly is generous.',
  },
  venues: {
    tier: 'static',
    maxAgeSeconds: 30 * DAY,
    provider: 'thesportsdb',
    why: 'Stadium name, capacity and location. Changes on a renovation or naming-rights deal, not on a schedule.',
  },
  team_identity: {
    tier: 'static',
    maxAgeSeconds: 7 * DAY,
    provider: 'thesportsdb',
    why: 'Badge, colours, founded year, home venue. Weekly catches a rebrand or relocation without paying for it daily.',
  },
  season_list: {
    tier: 'static',
    maxAgeSeconds: 7 * DAY,
    provider: 'thesportsdb',
    why: 'Which seasons exist for a league. Grows once a year.',
  },
  historical_schedule: {
    tier: 'static',
    maxAgeSeconds: 365 * DAY,
    provider: 'thesportsdb',
    why: 'A COMPLETED season is immutable. Backfill once and never refetch — this is the single biggest saving available, and re-pulling it is pure waste.',
  },

  // ── Slow: roster and biography churn ──
  roster: {
    tier: 'slow',
    maxAgeSeconds: 1 * DAY,
    provider: 'thesportsdb',
    why: 'Signings, cuts and call-ups land daily in season. Not worth more than daily — a roster does not change mid-game in a way this feed reflects.',
  },
  player_bio: {
    tier: 'slow',
    maxAgeSeconds: 7 * DAY,
    provider: 'thesportsdb',
    why: 'Height, weight, birthdate, jersey number, headshot. Effectively static per player; weekly picks up a number change.',
  },
  player_season_stats: {
    tier: 'daily',
    maxAgeSeconds: 12 * HOUR,
    provider: 'thesportsdb',
    why: 'Season aggregates only move after games finish, so an overnight pass plus one midday pass covers every league we carry.',
  },

  // ── Daily: the schedule itself moves ──
  current_schedule: {
    tier: 'daily',
    maxAgeSeconds: 6 * HOUR,
    provider: 'thesportsdb',
    why: 'Kickoff times shift, games get flexed, weather postpones. A stale start time is worse than a missing one because lineup locks are computed from it.',
  },
  standings: {
    tier: 'daily',
    maxAgeSeconds: 6 * HOUR,
    provider: 'thesportsdb',
    why: 'Soccer only — TheSportsDB returns an empty body for all five US leagues, so US standings must be derived from ingested results rather than fetched.',
  },

  // ── Game day: the reason people open the app on a Sunday ──
  injuries: {
    tier: 'gameday',
    maxAgeSeconds: 1 * HOUR,
    provider: 'espn',
    why: 'TheSportsDB serves NO injury feed at all — verified, not assumed. ESPN is the source, covering NFL and NCAAF. Hourly in-week, and it is the single most decision-relevant feed before a lineup lock.',
  },

  // ── Live: only while games are in progress ──
  live_scores: {
    tier: 'live',
    maxAgeSeconds: 60,
    provider: 'thesportsdb',
    why: 'v2 /livescore/{sport} with the key in an X-API-KEY header. Only meaningful while games are running; polling it overnight burns quota for identical rows.',
  },
  play_by_play: {
    tier: 'live',
    maxAgeSeconds: 60,
    provider: 'none',
    why: 'TheSportsDB timelines and event stats are populated for SOCCER only — null for every US sport sampled. There is no play-by-play source wired for NFL/NBA/MLB/NHL today, so no surface may imply one exists.',
  },
}

/** Polling cadence for a tier, in seconds, when its sport has games in progress. */
export const GAMEDAY_POLL_SECONDS: Record<FreshnessTier, number | null> = {
  static: null,
  slow: null,
  daily: null,
  gameday: 15 * MIN,
  live: 60,
}

export function isStale(dataClass: DataClass, fetchedAt: Date | null | undefined, now = new Date()): boolean {
  if (!fetchedAt) return true
  const ageSeconds = (now.getTime() - fetchedAt.getTime()) / 1000
  return ageSeconds > FRESHNESS[dataClass].maxAgeSeconds
}

/**
 * How old the data is, phrased for a user.
 *
 * The design handoff requires the last-sync age to be shown and to turn `--warn`
 * when stale, "rather than silently showing old numbers". This is the shared
 * calculation behind that, so every surface agrees on when to raise the warning.
 */
export function describeAge(
  dataClass: DataClass,
  fetchedAt: Date | null | undefined,
  now = new Date()
): { label: string; stale: boolean } {
  if (!fetchedAt) return { label: 'never synced', stale: true }
  const seconds = Math.max(0, Math.floor((now.getTime() - fetchedAt.getTime()) / 1000))
  const stale = isStale(dataClass, fetchedAt, now)

  if (seconds < 60) return { label: `${seconds}s ago`, stale }
  if (seconds < HOUR) return { label: `${Math.floor(seconds / 60)}m ago`, stale }
  if (seconds < DAY) return { label: `${Math.floor(seconds / HOUR)}h ago`, stale }
  return { label: `${Math.floor(seconds / DAY)}d ago`, stale }
}

/** Data classes a given sport can actually serve, so nothing promises what is absent. */
export function availableFor(sport: string): Record<DataClass, boolean> {
  const isSoccer = sport.toUpperCase() === 'SOCCER'
  const isCollege = sport.toUpperCase() === 'NCAAF' || sport.toUpperCase() === 'NCAAB'
  return {
    leagues: true,
    venues: true,
    team_identity: true,
    season_list: true,
    historical_schedule: true,
    // College returns coaches and the odd alumnus — 20 players across 231 NCAAF
    // teams — so it is present but must never be presented as a depth chart.
    roster: !isCollege,
    player_bio: !isCollege,
    player_season_stats: !isCollege,
    current_schedule: true,
    standings: isSoccer,
    injuries: sport.toUpperCase() === 'NFL' || sport.toUpperCase() === 'NCAAF',
    live_scores: true,
    play_by_play: isSoccer,
  }
}
