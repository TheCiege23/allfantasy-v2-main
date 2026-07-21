/**
 * Player data availability — the honesty layer for the Player Intelligence Center.
 *
 * Every metric the Players UI can render is declared here together with whether a
 * real production source exists for it, per sport. UI components read availability
 * from this registry instead of assuming a number is renderable, so a field with no
 * source renders an explicit "unavailable" state rather than a zero, a dash that
 * reads as zero, or an invented value.
 *
 * The matrix below was verified against production (Neon project `icy-field-51189449`,
 * database `neondb`) on 2026-07-19 by counting rows in the backing tables. Re-verify
 * before widening any entry — flipping a field to `available` here immediately makes
 * the UI render it as fact.
 *
 * Verified row counts behind the calls made here:
 *   SportsPlayer ............ NFL 17,257 / NCAAF 44,897 / NCAAB 18,209 / MLB 7,295
 *                             NHL 4,115 / SOCCER 2,310 / NBA 1,756 (no WNBA, no PGA)
 *   SportsPlayer.imageUrl ... NFL 16,475 (95%), SOCCER 737 (32%), all others 0
 *   SportsInjury ............ NFL 458 / MLB 243 / NBA 126 / NHL 115 / SOCCER 81
 *                             NCAAF 1 / NCAAB 1
 *   SportsNews .............. 4,595 rows
 *   player_season_stats ..... NFL only — 2025:2,103  2024:1,941  2023:1,142
 *   SportsGame .............. MLB 3,017 / SOCCER 406 / NFL 338 / NCAAF 97 / NBA 64
 *                             NHL 50 / NCAAB 1
 *   AFProjectionSnapshot .... 0          fantasy_projections ......... 64
 *   allfantasy_market_player_values ... 0   redraft_trade_value_snapshots ... 6
 *   trending_players ........ 0          player_game_stats ........... 0
 *
 * Market value / ranks / 30-day trend are NOT sourced from those empty tables — they
 * come from the live FantasyCalc API (keyless, ~700ms, joined on sleeperId), which is
 * why they are `available` for NFL while the DB tables sit empty. See
 * `lib/players/playerIntelligenceService.ts`.
 */

/** Sports that have at least one row in `SportsPlayer`. */
export const SPORTS_WITH_PLAYERS = [
  'NFL',
  'NCAAF',
  'NCAAB',
  'MLB',
  'NHL',
  'SOCCER',
  'NBA',
] as const

export type SupportedSport = (typeof SPORTS_WITH_PLAYERS)[number]

/**
 * Sports the product markets but which have ZERO player rows in production.
 * The sport rail may show these, but only as explicitly unavailable — never as a
 * selectable filter that would return an empty grid with no explanation.
 */
export const SPORTS_WITHOUT_DATA = ['WNBA', 'PGA'] as const

/**
 * Competition labels that do NOT exist as distinct sports in our data.
 * Production stores a single undifferentiated `SOCCER` pool of 2,310 players; there
 * is no column that separates MLS from EPL from UCL from the World Cup. Presenting
 * them as four independent selectors would imply a filter we cannot honour.
 */
export const SOCCER_COMPETITION_ALIASES = ['MLS', 'EPL', 'UCL', 'WORLD_CUP'] as const

export type PlayerMetricKey =
  // Identity + bio
  | 'identity'
  | 'headshot'
  | 'bio'
  // Status
  | 'injuryStatus'
  | 'news'
  // Performance
  | 'seasonStats'
  | 'gameLog'
  | 'weeklyProjection'
  | 'restOfSeasonProjection'
  // Market
  | 'marketValue'
  | 'overallRank'
  | 'positionRank'
  | 'valueTrend30Day'
  | 'valueVolatility'
  // League context
  | 'schedule'
  | 'crossLeagueRosterStatus'
  // Crowd signals
  | 'ownershipPercent'
  | 'startPercent'
  | 'waiverAddDropTrend'

export type AvailabilityState =
  /** A real production source exists and is wired. */
  | 'available'
  /** Source exists but coverage is partial — render, and disclose the gap. */
  | 'partial'
  /** No production source. Render an explicit empty state, never a number. */
  | 'no-source'
  /** Source exists for other sports but not this one. */
  | 'unsupported-for-sport'

export interface MetricAvailability {
  state: AvailabilityState
  /** Shown to the user when the metric cannot be rendered. Plain language, no jargon. */
  reason?: string
  /** Where a rendered value comes from, for the data-provenance affordance. */
  source?: string
}

type SportMatrix = Partial<Record<PlayerMetricKey, MetricAvailability>>

const NO_PROJECTIONS: MetricAvailability = {
  state: 'no-source',
  reason:
    'Projections are not available yet — no projection provider is connected. We show usage and market value instead of inventing a number.',
}

const NO_CROWD_SIGNALS: MetricAvailability = {
  state: 'no-source',
  reason:
    'Rostered and started percentages come from platform-wide crowd data we do not collect yet.',
}

const NO_GAME_LOG: MetricAvailability = {
  state: 'no-source',
  reason: 'Game-by-game logs are not ingested yet. Season totals are available below.',
}

/**
 * NFL is the only sport with headshot coverage AND season stats AND a live market
 * feed, which is why it is the sport the Player Intelligence Center ships against.
 */
const NFL_MATRIX: SportMatrix = {
  identity: { state: 'available', source: 'SportsPlayer' },
  headshot: { state: 'available', source: 'SportsPlayer.imageUrl' },
  bio: { state: 'available', source: 'SportsPlayer' },
  injuryStatus: { state: 'available', source: 'SportsInjury' },
  news: { state: 'available', source: 'SportsNews' },
  seasonStats: {
    state: 'partial',
    source: 'player_season_stats',
    reason: 'Season totals cover 2023–2025. The current season has not been ingested yet.',
  },
  gameLog: NO_GAME_LOG,
  weeklyProjection: NO_PROJECTIONS,
  restOfSeasonProjection: NO_PROJECTIONS,
  marketValue: { state: 'available', source: 'FantasyCalc (live)' },
  overallRank: { state: 'available', source: 'FantasyCalc (live)' },
  positionRank: { state: 'available', source: 'FantasyCalc (live)' },
  valueTrend30Day: { state: 'available', source: 'FantasyCalc (live)' },
  valueVolatility: { state: 'available', source: 'FantasyCalc (live)' },
  schedule: {
    state: 'partial',
    source: 'SportsGame',
    reason: 'Schedule coverage is incomplete — some weeks have no fixture rows.',
  },
  crossLeagueRosterStatus: { state: 'available', source: 'rosters + LegacyRoster' },
  ownershipPercent: NO_CROWD_SIGNALS,
  startPercent: NO_CROWD_SIGNALS,
  waiverAddDropTrend: {
    state: 'no-source',
    reason: 'Waiver add/drop trends require platform trend sync, which has not run.',
  },
}

/**
 * The six non-NFL sports share a shape: real identity rows, no headshots (except
 * soccer, partially), no stats, no market feed. Injury coverage varies enough to be
 * worth expressing per sport rather than lumping together.
 */
function buildSparseMatrix(options: {
  headshots: AvailabilityState
  headshotReason?: string
  injuries: AvailabilityState
  injuryReason?: string
  schedule: AvailabilityState
  scheduleReason?: string
}): SportMatrix {
  return {
    identity: { state: 'available', source: 'SportsPlayer' },
    headshot: {
      state: options.headshots,
      source: 'SportsPlayer.imageUrl',
      reason: options.headshotReason,
    },
    bio: { state: 'available', source: 'SportsPlayer' },
    injuryStatus: {
      state: options.injuries,
      source: 'SportsInjury',
      reason: options.injuryReason,
    },
    news: { state: 'available', source: 'SportsNews' },
    seasonStats: {
      state: 'unsupported-for-sport',
      reason: 'Season statistics are only ingested for the NFL right now.',
    },
    gameLog: NO_GAME_LOG,
    weeklyProjection: NO_PROJECTIONS,
    restOfSeasonProjection: NO_PROJECTIONS,
    marketValue: {
      state: 'unsupported-for-sport',
      reason: 'Market values come from an NFL-only trade market. No equivalent exists for this sport.',
    },
    overallRank: { state: 'unsupported-for-sport', reason: 'Requires a market feed this sport does not have.' },
    positionRank: { state: 'unsupported-for-sport', reason: 'Requires a market feed this sport does not have.' },
    valueTrend30Day: { state: 'unsupported-for-sport', reason: 'Requires a market feed this sport does not have.' },
    valueVolatility: { state: 'unsupported-for-sport', reason: 'Requires a market feed this sport does not have.' },
    schedule: { state: options.schedule, source: 'SportsGame', reason: options.scheduleReason },
    crossLeagueRosterStatus: {
      state: 'unsupported-for-sport',
      reason: 'Imported leagues are NFL-only today.',
    },
    ownershipPercent: NO_CROWD_SIGNALS,
    startPercent: NO_CROWD_SIGNALS,
    waiverAddDropTrend: NO_CROWD_SIGNALS,
  }
}

const NO_HEADSHOTS = 'No headshots are stored for this sport yet — initials are shown instead.'

const AVAILABILITY_BY_SPORT: Record<SupportedSport, SportMatrix> = {
  NFL: NFL_MATRIX,
  NCAAF: buildSparseMatrix({
    headshots: 'no-source',
    headshotReason: NO_HEADSHOTS,
    injuries: 'no-source',
    injuryReason: 'Injury reporting is not wired for college football.',
    schedule: 'partial',
    scheduleReason: 'Only a small number of fixtures are stored.',
  }),
  NCAAB: buildSparseMatrix({
    headshots: 'no-source',
    headshotReason: NO_HEADSHOTS,
    injuries: 'no-source',
    injuryReason: 'Injury reporting is not wired for college basketball.',
    schedule: 'no-source',
    scheduleReason: 'No fixtures are stored for this sport.',
  }),
  MLB: buildSparseMatrix({
    headshots: 'no-source',
    headshotReason: NO_HEADSHOTS,
    injuries: 'available',
    schedule: 'available',
  }),
  NHL: buildSparseMatrix({
    headshots: 'no-source',
    headshotReason: NO_HEADSHOTS,
    injuries: 'available',
    schedule: 'partial',
    scheduleReason: 'Only a small number of fixtures are stored.',
  }),
  SOCCER: buildSparseMatrix({
    headshots: 'partial',
    headshotReason: 'About a third of soccer players have a headshot stored.',
    injuries: 'available',
    schedule: 'available',
  }),
  NBA: buildSparseMatrix({
    headshots: 'no-source',
    headshotReason: NO_HEADSHOTS,
    injuries: 'available',
    schedule: 'partial',
    scheduleReason: 'Only a small number of fixtures are stored.',
  }),
}

const UNKNOWN_SPORT: MetricAvailability = {
  state: 'no-source',
  reason: 'This sport is not supported yet.',
}

export function isSupportedSport(sport: string): sport is SupportedSport {
  return (SPORTS_WITH_PLAYERS as readonly string[]).includes(sport)
}

/**
 * Availability for one metric in one sport. Callers should branch on `state` rather
 * than testing a value for null — a null value and an unsupported metric are
 * different things and the UI says so differently.
 */
export function getMetricAvailability(
  sport: string,
  metric: PlayerMetricKey,
): MetricAvailability {
  if (!isSupportedSport(sport)) return UNKNOWN_SPORT
  return AVAILABILITY_BY_SPORT[sport][metric] ?? UNKNOWN_SPORT
}

export function isMetricRenderable(sport: string, metric: PlayerMetricKey): boolean {
  const state = getMetricAvailability(sport, metric).state
  return state === 'available' || state === 'partial'
}

/**
 * Metrics a sport cannot render at all — used to hide table columns and filter
 * controls wholesale rather than showing a grid of empty cells.
 */
export function getUnavailableMetrics(sport: string): PlayerMetricKey[] {
  if (!isSupportedSport(sport)) return []
  const matrix = AVAILABILITY_BY_SPORT[sport]
  return (Object.keys(matrix) as PlayerMetricKey[]).filter(
    (key) => !isMetricRenderable(sport, key),
  )
}

/**
 * Data staleness. Production ingestion is materially behind — as of 2026-07-19 the
 * newest NFL `fetchedAt` was 26 days old and every other sport was 79 days old — so
 * a freshness indicator that says "up to date" without checking would be false.
 * Callers pass the real observation timestamp; this only classifies it.
 */
export type FreshnessLevel = 'fresh' | 'aging' | 'stale' | 'unknown'

export interface FreshnessAssessment {
  level: FreshnessLevel
  label: string
  detail: string
  ageMs: number | null
}

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

export function assessFreshness(observedAt: Date | string | null | undefined, now = Date.now()): FreshnessAssessment {
  if (!observedAt) {
    return {
      level: 'unknown',
      label: 'Unknown',
      detail: 'We do not have a timestamp for when this data was last refreshed.',
      ageMs: null,
    }
  }

  const observed = observedAt instanceof Date ? observedAt : new Date(observedAt)
  const ageMs = now - observed.getTime()

  if (!Number.isFinite(ageMs) || ageMs < 0) {
    return {
      level: 'unknown',
      label: 'Unknown',
      detail: 'The refresh timestamp for this data could not be read.',
      ageMs: null,
    }
  }

  if (ageMs < 6 * HOUR) {
    return { level: 'fresh', label: 'Up to date', detail: describeAge(ageMs), ageMs }
  }
  if (ageMs < 3 * DAY) {
    return {
      level: 'aging',
      label: 'Aging',
      detail: `Last refreshed ${describeAge(ageMs)}.`,
      ageMs,
    }
  }
  return {
    level: 'stale',
    label: 'Stale',
    detail: `Last refreshed ${describeAge(ageMs)}. Treat roster and team details as out of date.`,
    ageMs,
  }
}

function describeAge(ageMs: number): string {
  const days = Math.floor(ageMs / DAY)
  if (days >= 1) return `${days} day${days === 1 ? '' : 's'} ago`
  const hours = Math.floor(ageMs / HOUR)
  if (hours >= 1) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const minutes = Math.max(1, Math.floor(ageMs / (60 * 1000)))
  return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
}
