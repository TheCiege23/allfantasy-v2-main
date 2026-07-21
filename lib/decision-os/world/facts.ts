/**
 * Decision OS — Phase 2 Canonical World Assembly: the stable, provider-agnostic FACT CONTRACT.
 *
 * This is the origin-blind substrate that future lineup/waiver/trade/commissioner assemblers consume.
 * Decision OS business logic must NEVER branch on where a league came from (import / sync / native /
 * future provider). Origin survives ONLY inside `provenance` (metadata), `freshness`, `completeness`
 * warnings, and `uncertainty` — never as a fact the rules switch on.
 *
 * Nothing in this file performs IO. See `port.ts` for the (read-only) data-access surface and
 * `index.ts` (`resolveCanonicalWorld`) for the orchestrator.
 */

/** Raw inputs the read-only port returns (one row group per league). Decoupled from Prisma types. */
export interface RawLeagueRow {
  id: string
  sport: string
  season: number
  scoring: string | null
  scoringPresetId: string | null
  leagueType: string | null
  isDynasty: boolean
  rosterSize: number | null
  starters: unknown
  irSlots: number | null
  taxiSlots: number | null
  waiverType: string | null
  waiverBudget: number | null
  waiverMinBid: number | null
  waiverHours: number | null
  tradeReviewHours: number | null
  tradeDeadlineWeek: number | null
  draftPickTrading: boolean | null
  settings: unknown
  lastSyncedAt: Date | null
  syncStatus: string | null
  /** Provenance only — never read by decision logic. */
  platform: string | null
  /** Provenance only. */
  platformLeagueId: string | null
}

export interface RawTeamRow {
  id: string
  externalId: string
  ownerName: string
  teamName: string
  wins: number
  losses: number
  ties: number
  pointsFor: number
  pointsAgainst: number
  currentRank: number | null
  role: string
  isOrphan: boolean
  isCommissioner: boolean
  isCoCommissioner: boolean
  platformUserId: string | null
  claimedByUserId: string | null
}

export interface RawRosterRow {
  id: string
  platformUserId: string
  playerData: unknown
  faabRemaining: number | null
  waiverPriority: number | null
  settings: unknown
  /**
   * PROVENANCE ONLY — which canonical store this raw roster was read from (`Roster.playerData` vs the
   * native `RedraftRoster` / `RedraftRosterPlayer` relation). Drives `provenance.sourceModels` honesty;
   * NEVER read by decision logic or folded into origin-blind `RosterFacts`. Absent ⇒ treated as `Roster`
   * (the historical single source), so existing callers/fixtures are unaffected.
   */
  sourceModel?: 'Roster' | 'RedraftRoster'
}

export interface RawPerformanceRow {
  teamId: string
  week: number
  season: number
  points: number
  opponent: string | null
  result: string | null
}

export interface CanonicalWorldRawInput {
  league: RawLeagueRow
  teams: RawTeamRow[]
  rosters: RawRosterRow[]
  performances: RawPerformanceRow[]
}

/**
 * Raw player-metadata row the read-only port returns when enriching canonical roster ids. Decoupled
 * from Prisma. Sourced from the persisted SportsPlayer cache (the same table the existing imported-
 * league lineup scan reads); `externalId` / `sleeperId` are the provider lookup keys (provenance only).
 * Bye week and projections are intentionally ABSENT — no provider-id-keyed source carries them, so the
 * enrichment seam leaves them null rather than fabricating.
 */
export interface RawPlayerMetadataRow {
  externalId: string
  sleeperId: string | null
  name: string | null
  position: string | null
  team: string | null
  /** Injury / availability status string as persisted (e.g. OUT / QUESTIONABLE); null when unknown. */
  status: string | null
  /** Provenance: which import source produced the cached row. */
  source: string | null
}

/**
 * Raw injury-context row for the F2.3 injury/availability enrichment seam. Decoupled from Prisma.
 * Sourced from the persisted SportsPlayer cache — the SAME table as F2.1 player metadata but
 * selecting freshness fields (fetchedAt / expiresAt / updatedAt) that F2.1 does not read.
 * Provider / lookup keys survive ONLY as provenance (externalId / sleeperId); business logic
 * consumes normalized injury/freshness facts only. Richer fields (practiceStatus / gameStatus /
 * bodyPart) are intentionally ABSENT — no player-id-keyed read-only source carries them in a
 * joinable namespace; they stay null + warned in the derived view (see ADR_F2_3_INJURY_STATUS.md).
 */
export interface RawInjuryContextRow {
  /** Provider lookup key — same as SportsPlayer.externalId (e.g. Sleeper player id). */
  externalId: string
  /** Alternate Sleeper-specific lookup key; null when absent. */
  sleeperId: string | null
  /** Injury / availability status string as persisted (e.g. "Q", "O", "IR", "Active"); null when unknown. */
  status: string | null
  /** Which import source produced the cached row (provenance only). */
  source: string | null
  /** When the cached row was fetched. Null when not tracked by this source. */
  fetchedAt: Date | null
  /** When the cached row is expected to expire / become stale. Null when not tracked. */
  expiresAt: Date | null
  /** When the cached row was last updated. Null when not tracked. */
  updatedAt: Date | null
}

/**
 * Raw ADP row for the F2.4 ADP/market-value enrichment seam. Decoupled from Prisma and sourced
 * from the already-persisted `AdpDataRecord` table — the SAME table Phase E trade enrichment reads
 * via `lib/decision-os/trade/loader.ts`. Format/scoring are carried as provenance (the projector
 * selects the best match for the league context). Business logic consumes normalized ADP facts
 * only; provider and format details live as provenance, never as decision inputs.
 *
 * Freshness note: `AdpDataRecord` has `createdAt` only (no `expiresAt`). Staleness is estimated
 * from age (>7 days → stale) rather than an explicit expiry contract — see ADR_F2_4 §4.1.
 */
export interface RawAdpRow {
  playerId: string
  adp: number
  adpChange: number | null
  adpSpread: number | null
  confidenceScore: number | null
  providerCount: number | null
  /** Format dimension: 'redraft' | 'dynasty' */
  format: string
  /** Scoring dimension: 'standard' | 'ppr' | 'half-ppr' | '2qb' | 'superflex' */
  scoring: string
  season: number
  week: number
  /** Import source / provider label (provenance only). */
  source: string
  /** When this row was inserted — only freshness signal available. */
  createdAt: Date
}

/**
 * Raw market-value row for the F2.4 market-value enrichment seam. Decoupled from Prisma and
 * sourced from `AllFantasyMarketPlayerValue` (published=true rows only). Keyed by
 * [sport, leagueConcept, playerId] — currently leagueConcept='redraft' is the only value written
 * (see ADR_F2_4 §2.2). Carries freshness via generatedAt + updatedAt.
 */
export interface RawMarketValueRow {
  playerId: string
  marketValue: number
  baseValue: number
  adjustmentPercent: number
  confidence: number
  sampleSize: number
  /** Trending direction: 'up' | 'down' | 'stable' */
  direction: string
  /** League concept context (provenance; currently always 'redraft'). */
  leagueConcept: string
  scoringFormat: string | null
  generatedAt: Date
  updatedAt: Date
}

/**
 * Raw weather row for the F2.6 weather enrichment seam. Sourced from `WeatherCache` (team-window
 * keyed: `weather:team-window:{TEAM}:{YYYY-MM-DD}`). Weather is team-level — all players on the
 * same team share the same WeatherCache entry. `expiresAt` is a real TTL (1h for team-window).
 * Never has live API data — port reads only already-persisted rows.
 */
export interface RawWeatherRow {
  cacheKey: string
  sport: string | null
  /** Optional event/game link — null in all team-window entries; present in game-specific entries. */
  eventId: string | null
  temperatureF: number | null
  feelsLikeF: number | null
  windSpeedMph: number | null
  windGustsMph: number | null
  windDirectionDeg: number | null
  precipChancePct: number | null
  rainInches: number | null
  snowInches: number | null
  conditionCode: string | null
  conditionLabel: string | null
  isIndoor: boolean
  isDome: boolean
  roofClosed: boolean
  fetchedAt: Date
  expiresAt: Date
  dataSource: string
}

/**
 * Raw projection row for the F2.5 projection enrichment seam. Sourced from `FantasyProjection`
 * (canonical fantasy projection cache — importers write provider-backed values only). `playerId` uses
 * the same canonical AF player ID namespace as canonical roster player IDs. `scoringPresetId` matches
 * `LeagueFacts.scoringPresetId` directly. `expiresAt` is a real TTL (no age-estimation needed).
 */
export interface RawProjectionRow {
  playerId: string
  sport: string
  /** Stored as a string in the DB (e.g. '2026'). Compare with String(LeagueFacts.season). */
  season: string
  week: number
  /** Matches LeagueFacts.scoringPresetId directly ('ppr', 'half_ppr', 'standard', '2qb', etc.). */
  scoringPresetId: string
  projectedPoints: number
  /** Raw stat breakdown — carried as provenance, never parsed for decision logic. */
  stats: unknown
  source: string
  fetchedAt: Date
  expiresAt: Date
}

/** One warehouse per-game fact row (dw_player_game_facts) — see ADR F2.9. */
export interface RawPlayerGameFactRow {
  /** Raw provider id — same id space as EnrichedPlayer.playerId (verified in the P0 release). */
  playerId: string
  sport: string
  season: number | null
  weekOrRound: number | null
  fantasyPoints: number
  /** Canonical stat keys — carried as provenance, never parsed for decision logic. */
  normalizedStats: unknown
  createdAt: Date
}

/**
 * Raw news row for the F2.7 news-signal enrichment seam. Sourced from `PlayerNewsRecord`
 * (`player_news` table) — the already-persisted provider news cache written by the 15-min
 * import cron. Joined by `sport` + case-insensitive `playerName` (see ADR_F2_7 §3).
 *
 * No `expiresAt` field in source — freshness is age-estimated from `publishedAt`.
 * `playerId` is excluded from `RawNewsRow` because it is in the PROVIDER's namespace,
 * not the canonical AF player ID namespace (see ADR_F2_7 §2.6).
 * `source` is carried as provenance only — never branched on.
 */
export interface RawNewsRow {
  id: string
  sport: string
  /** Provider player name — the join key (case-insensitive exact match against EnrichedPlayer.name). */
  playerName: string
  team: string | null
  headline: string
  body: string
  /** Heuristic tier from importer: 'high' | 'medium' | 'low'. Carried as-is. */
  impact: string
  fantasyRelevant: boolean
  /** Import source label (e.g. 'rolling_insights', 'clearsports', 'espn', 'cache'). Provenance only. */
  source: string
  publishedAt: Date
  createdAt: Date
}

/**
 * Raw league activity counts for the F2.8 league-intelligence enrichment seam. Returned by a single
 * port call that issues three `_count` Prisma queries (WaiverClaim, AfLeagueTrade,
 * AfRosterMoveHistory) for a given leagueId + lookback window.
 * No row data is fetched — counts only. Decoupled from Prisma.
 */
export interface RawLeagueActivityCounts {
  waiverClaimCount: number
  tradeCount: number
  rosterMoveCount: number
  lookbackDays: number
  loadedAt: Date
}

/**
 * Raw league reputation row for the F2.8 league-intelligence enrichment seam. Sourced from
 * `LeagueReputation` (`league_reputations` — `leagueId` unique). Carried as provenance only;
 * health score is computed independently from canonical signals (see ADR_F2_8 §3).
 * `overallScore` / sub-scores are stored as Prisma Decimal — mapped to `number | null` here.
 */
export interface RawLeagueReputationRow {
  leagueId: string
  overallScore: number | null
  tier: string | null
  completionRate: number | null
  retentionRate: number | null
  stabilityScore: number | null
  longevityScore: number | null
  competitivenessScore: number | null
  totalSeasons: number
  lastComputedAt: Date
}

/**
 * Raw season-schedule row for the F2.2 schedule/bye enrichment seam. Decoupled from Prisma and sourced
 * from already-persisted schedule caches only (`FantasyScheduleGame` first, `GameSchedule` fallback).
 * Provider/source survive ONLY as provenance/freshness metadata; business logic consumes normalized team
 * schedule facts only.
 */
export interface RawScheduleGameRow {
  sport: string
  season: number
  week: number
  homeTeam: string | null
  awayTeam: string | null
  kickoffTime: Date | null
  status: string | null
  source: string | null
  fetchedAt: Date | null
  expiresAt: Date | null
  updatedAt: Date | null
  sourceModel: 'FantasyScheduleGame' | 'GameSchedule'
}

// ──────────────────────────────────────────────────────────────────────────
// Fact contract (origin-blind)
// ──────────────────────────────────────────────────────────────────────────

export interface LeagueRosterSettingsFacts {
  rosterSize: number | null
  starterSlots: string[] | null
  irSlots: number | null
  taxiSlots: number | null
}

export interface LeagueWaiverSettingsFacts {
  type: string | null
  budget: number | null
  minBid: number | null
  hours: number | null
}

export interface LeagueTradeSettingsFacts {
  reviewHours: number | null
  deadlineWeek: number | null
  pickTrading: boolean | null
}

export interface LeagueFacts {
  leagueId: string
  sport: string
  season: number
  leagueType: string | null
  isDynasty: boolean
  scoringPresetId: string | null
  /** Resolved scoring settings blob (provider-neutral); null when unknown. */
  scoringSettings: unknown
  rosterSettings: LeagueRosterSettingsFacts
  waiverSettings: LeagueWaiverSettingsFacts
  tradeSettings: LeagueTradeSettingsFacts
  /** Latest week with canonical data; null when not derivable. See `currentWeekBasis`. */
  currentWeek: number | null
  currentWeekBasis: 'team_performance' | 'unavailable'
}

export interface FaabFacts {
  budget: number | null
  used: number | null
  remaining: number | null
  /** True when `remaining` was derived (budget − used) rather than read from a stored remaining value. */
  remainingDerived: boolean
}

export interface TeamRecordFacts {
  wins: number
  losses: number
  ties: number
}

/** Provider/source identifiers — PROVENANCE ONLY. Never consumed by decision business logic. */
export interface TeamSourceProvenance {
  sourceTeamId: string | null
  sourceManagerId: string | null
}

export interface TeamFacts {
  teamId: string
  displayName: string
  ownerName: string
  /** Resolved AF user id when claimed, else the raw provider manager id (provenance-typed). */
  managerUserId: string | null
  isCommissioner: boolean
  isCoCommissioner: boolean
  isOrphan: boolean
  rank: number | null
  record: TeamRecordFacts
  pointsFor: number
  /** Null when neither stored nor derivable from performances. */
  pointsAgainst: number | null
  pointsAgainstBasis: 'stored' | 'derived_from_performances' | 'unavailable'
  faab: FaabFacts
  source: TeamSourceProvenance
}

export interface RosterSlotProjection {
  starters: string[]
  bench: string[]
  reserve: string[]
  taxi: string[]
}

export interface RosterFacts {
  rosterId: string
  /** Joined canonical LeagueTeam id; null when no team could be matched (flagged in completeness). */
  teamId: string | null
  playerIds: string[]
  starterIds: string[]
  benchIds: string[]
  reserveIds: string[]
  taxiIds: string[]
  playerCount: number
  /**
   * Per-team waiver order for priority-based leagues; null for FAAB leagues or when unset. Honest carry
   * from `Roster.waiverPriority` — the canonical-sourced fact the waiver bridge consumes (`waiver ←
   * canonical`, see PHASE_2_CANONICAL_BRIDGE_ARCHITECTURE §2). No logic: surfaced exactly as persisted.
   */
  waiverPriority: number | null
  /** Player ids are raw/unenriched here (no position/injury/bye). Enrichment is a downstream concern. */
  playerMetadataEnriched: boolean
}

export interface WorldFreshness {
  lastSyncedAt: string | null
  isStale: boolean
  staleReason: string | null
}

export interface WorldProvenance {
  /** Canonical models actually read to assemble this world. */
  sourceModels: string[]
  /** Provider name — METADATA ONLY (telemetry/debug). Never a decision input. */
  provider: string | null
  sourceLeagueId: string | null
  assembledAt: string
  freshness: WorldFreshness
}

export interface WorldCompleteness {
  /** 0–100 honest completeness score. */
  dataCompleteness: number
  /** Soft gaps the world degraded around (not fatal). */
  warnings: string[]
  /** Fields explicitly unavailable — marked, never silently omitted. */
  unsupported: string[]
}

export interface CanonicalWorld {
  league: LeagueFacts
  teams: TeamFacts[]
  rosters: RosterFacts[]
  provenance: WorldProvenance
  completeness: WorldCompleteness
}
