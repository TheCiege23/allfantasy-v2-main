/**
 * Phase 2A — Universal Chimmy Context Engine
 * ------------------------------------------
 * Shared interfaces for every context provider feeding Chimmy.
 *
 * Design contract:
 *  - Every provider MUST return `ProviderResult<T>` and MUST NOT throw.
 *  - Bundle fields are nullable; a single failed provider must not break the AI flow.
 *  - Bundle contents are server-only and MAY contain non-PII profile data.
 *    Never serialize raw emails, payment-method tokens, or Stripe customer IDs.
 *  - DB-first: providers read from Postgres/Supabase. No external API fetches.
 */

import type { AIAccessStatus } from "@/lib/ai-access/AIAccessResolver"
import type {
  LeagueDifficultyRating,
  RankingSnapshot,
} from "@/lib/ranking/types"
import type { ManagerReplayInsightSetV1 } from "@/lib/replay-framework/insights/managerReplayInsight"

/** Generic envelope returned by every provider. */
export type ProviderResult<T> = {
  ok: boolean
  data: T | null
  /** Short, human-readable error (never raw stack). */
  error?: string
  /** ISO timestamp when this slice was produced (post-cache). */
  fetchedAt: string
  /** True when satisfied from in-process cache. */
  cached?: boolean
  /** Approximate ms to fetch (post-cache reads ~0). */
  durationMs?: number
}

/** Inputs every provider receives. Providers ignore fields they don't need. */
export type ChimmyContextRequest = {
  /** Authenticated viewer; MUST come from server session, never request body. */
  userId: string
  /** Optional: email for AIAccessResolver trial start lookup. */
  userEmail?: string | null
  /** Optional active league context. Guarded by `assertLeagueMember` upstream. */
  leagueId?: string | null
  /** Optional active matchup week. */
  week?: number | null
  /** Optional active season. */
  season?: number | null
  /** Optional sport hint (NFL, NBA, etc.). */
  sport?: string | null
  /** When true, bypass per-request cache reads (writes still occur). */
  forceRefresh?: boolean
  /** Internal: per-request memoization map shared across providers. */
  perRequestMemo?: Map<string, unknown>
}

/** Base provider interface. */
export interface ChimmyContextProvider<T> {
  /** Unique stable id used for cache keys + debug logs. */
  readonly name: string
  /** Default per-provider TTL in ms; engine may override. */
  readonly defaultTtlMs: number
  /** Fetch a slice; MUST resolve, never reject. */
  load(request: ChimmyContextRequest): Promise<ProviderResult<T>>
}

// ─── Slice shapes ─────────────────────────────────────────────────────────────

export type UserContextSlice = {
  userId: string
  displayName: string
  username: string | null
  timezone: string | null
  preferredLanguage: string | null
  createdAt: string | null
}

export type SubscriptionContextSlice = {
  hasAccess: boolean
  reason: AIAccessStatus["reason"]
  hasSubscription: boolean
  planLabel: string | null
  inTrial: boolean
  trialDaysRemaining: number
  trialEndsAt: string | null
  tokenBalance: number
  message: string
}

export type LeagueSummary = {
  id: string
  name: string | null
  platform: string
  sport: string | null
  season: number | null
  format: string | null
  scoring: string | null
  numTeams: number | null
  isCommissioner: boolean
  role: "commissioner" | "member" | "imported"
}

export type LeagueContextSlice = {
  activeLeague: LeagueSummary | null
  allLeagues: LeagueSummary[]
  sleeperUsername: string | null
}

export type MatchupContextSlice = {
  leagueId: string
  week: number | null
  yourTeamId: string | null
  opponentTeamId: string | null
  yourProjectedPoints: number | null
  opponentProjectedPoints: number | null
  status: "scheduled" | "in_progress" | "final" | "unknown"
  // ─── Phase 2C Batch 3: additive optional fields ───────────────────────────
  /** Resolved season for the matchup (e.g. 2025). */
  season?: number | null
  /** Viewer's actual scored points (from TeamWeekResult.totalPoints). */
  yourActualPoints?: number | null
  /** Opponent's actual scored points (from TeamWeekResult.totalPoints). */
  opponentActualPoints?: number | null
  /** Opponent LeagueTeam.teamName when resolvable. */
  opponentTeamName?: string | null
  /** Resolved playoff start week (League.playoffStartWeek / RedraftSeason). */
  playoffStartWeek?: number | null
  /** True when `week >= playoffStartWeek`. */
  isPlayoffWeek?: boolean
  /** `max(0, playoffStartWeek - week)`; null when unknown. */
  weeksUntilPlayoffs?: number | null
  /** Where the current-week value originated (debug / observability). */
  currentWeekSource?:
    | "requestOverride"
    | "redraftSeason"
    | "teamWeekResult"
    | "weeklyMatchup"
    | "leagueSettings"
    | "fallback"
    | null
  // ─── Phase 2C Batch 4 Sub-batch B: projection + intelligence (additive) ──
  /** Projected margin = yourProjectedPoints − opponentProjectedPoints. */
  projectedMargin?: number | null
  /** Categorical leader based on actual (in-progress/final) or projected margin. */
  projectedLeader?: "you" | "opponent" | "even" | "unknown"
  /** 0-1 win probability; `null` until the formula is finalized. */
  projectedWinProbability?: number | null
  /** Urgency signal tags emitted by `computeUrgency`. */
  urgencySignals?: string[]
  /** Urgency level mapped by `computeUrgency` from accumulated score. */
  urgencyLevel?:
    | "critical"
    | "high"
    | "moderate"
    | "low"
    | "none"
    | "unknown"
  /** Numeric urgency score (0-100); `null` when no signal source is available. */
  urgencyScore?: number | null
  /**
   * Recommendation priority assigned by `prioritizeRecommendation`. Stays
   * `"unknown"` until the priority formula is finalized.
   */
  recommendationPriority?:
    | "critical"
    | "important"
    | "optional"
    | "watchlist"
    | "unknown"
}

export type RosterPlayerLite = {
  playerId: string
  name: string
  position: string | null
  team: string | null
  slot: string | null
}

export type RosterContextSlice = {
  leagueId: string
  teamId: string | null
  starters: RosterPlayerLite[]
  bench: RosterPlayerLite[]
  // ─── Phase 2C Batch 4 Sub-batch C: roster intelligence (additive) ────────
  /** Sum of starter projected points; `null` when no projection was loaded. */
  starterProjectedTotal?: number | null
  /** Per-position starter projected totals. */
  byPosition?: Record<string, number>
  /** Per-position depth counts (starters + bench). */
  depthByPosition?: Record<string, { starters: number; bench: number }>
  /** Tags from `computeRosterIntel`: `shallow_depth:RB`, `weak_position:WR`, etc. */
  weaknessSignals?: string[]
  /** Tags from `computeRosterIntel`: `deep_position:RB`, `elite_position:QB`, etc. */
  strengthSignals?: string[]
  /** Always `"unknown"` until the identity formula is finalized. */
  teamIdentityHint?:
    | "contender"
    | "rebuild"
    | "boom_bust"
    | "depth_heavy"
    | "injury_prone"
    | "youth_focused"
    | "unknown"
  /** Probabilistic identity scores (0-100 each, NOT normalized). */
  teamIdentityScores?: Record<
    "contender" | "rebuild" | "boom_bust" | "depth_heavy" | "injury_prone" | "youth_focused" | "unknown",
    number
  >
}

export type StandingsRow = {
  teamId: string
  teamName: string | null
  rank: number | null
  wins: number | null
  losses: number | null
  ties: number | null
  pointsFor: number | null
  pointsAgainst: number | null
}

export type StandingsContextSlice = {
  leagueId: string
  rows: StandingsRow[]
}

export type RankingContextSlice = {
  snapshot: RankingSnapshot | null
}

export type LeagueDifficultyContextSlice = {
  rating: LeagueDifficultyRating | null
}

// ─── Phase 2C Batch 4 Sub-batch E: derived intelligence (additive) ────────
/**
 * Recommendation severity ladder. Derived (for now) from urgency level via
 * `SEVERITY_TUNABLES`. Will switch to `recommendationPriority` once that
 * formula is finalized.
 */
export type RecommendationSeverity =
  | "CRITICAL"
  | "HIGH"
  | "MODERATE"
  | "LOW"
  | "WATCHLIST"

/**
 * Unified strategic intelligence slice. NOT loaded by a provider — derived
 * on-the-fly from the rest of the bundle. Safe to omit; consumers must
 * treat `null` as "no intel surfaced".
 */
export type IntelligenceContextSlice = {
  urgencyLevel:
    | "critical"
    | "high"
    | "moderate"
    | "low"
    | "none"
    | "unknown"
  urgencyScore: number | null
  recommendationPriority:
    | "critical"
    | "important"
    | "optional"
    | "watchlist"
    | "unknown"
  recommendationSeverity: RecommendationSeverity
  /** Identity hint sourced from `RosterContextSlice.teamIdentityHint`. */
  teamIdentity:
    | "contender"
    | "rebuild"
    | "boom_bust"
    | "depth_heavy"
    | "injury_prone"
    | "youth_focused"
    | "unknown"
  /** Short tag list (e.g. `["bye_conflict","injury_exposure"]`). */
  strategicRisks: string[]
  /** Short coaching hint slugs (e.g. `["address_wr_depth"]`). */
  coachingHints: string[]
  /** One-line playoff status summary; `null` when no playoff data. */
  playoffOutlook: string | null
  /** One-line roster summary; `null` when no roster intel. */
  rosterOutlook: string | null
  /** One-line competitive context summary; `null` when fully unknown. */
  competitiveContextSummary: string | null
  /**
   * Phase 3A.1 — Adaptive intelligence surface (additive, optional).
   * Populated when `computeStrategicRisks` and `adaptCoachingHints` are
   * wired through `buildIntelligenceBundle`. Consumers must treat these
   * as optional and tolerate `null`/`[]` for fail-safe behavior.
   *
   * Slim structural types are used here to avoid a circular module import
   * with the intel/* synthesizers; the canonical types live in
   * `intel/strategicRisk.ts` and `intel/coachingAdaptation.ts`.
   */
  strategicRiskScores?: {
    roster: number
    injury: number
    volatility: number
    playoff: number
    matchup: number
    structural: number
    composite: number
    signals: Record<
      "roster" | "injury" | "volatility" | "playoff" | "matchup" | "structural",
      string[]
    >
  } | null
  /** Top 3 risk dimensions, sorted desc by score (zero-score dims dropped). */
  topRisks?: Array<{
    dimension:
      | "roster"
      | "injury"
      | "volatility"
      | "playoff"
      | "matchup"
      | "structural"
    score: number
  }>
  /** Coaching hints ordered desc by adaptive relevance score. */
  adaptiveCoachingHints?: Array<{
    slug: string
    theme:
      | "stance"
      | "injury"
      | "schedule"
      | "roster"
      | "playoff"
      | "matchup"
      | "unknown"
    score: number
    rationale: string[]
  }>
}

export type ImportedHistorySlice = {
  source: "sleeper" | "espn" | "yahoo" | "fantrax" | "mfl" | "fleaflicker" | "unknown" | null
  totalLeagues: number
  totalSeasons: number
  careerRecord: string | null
  winPercentage: number | null
  championships: number
  archetype: string | null
  recentLeagues: Array<{
    name: string
    season: number
    record: string | null
    champion: boolean
  }>
}

export type SportsScheduleGame = {
  sport: string
  homeTeam: string
  awayTeam: string
  /** ISO string or human-readable local time from the data source. */
  startTime: string | null
  status: "scheduled" | "in_progress" | "final" | "unknown"
  homeScore: number | null
  awayScore: number | null
}

export type SportsScheduleSlice = {
  /** YYYY-MM-DD in UTC (proxy for "today"). */
  date: string
  games: SportsScheduleGame[]
  /**
   * True when real live-data was returned from the DB / sports API.
   * False means the prompt MUST include the "no guessing" guardrail.
   */
  hasRealData: boolean
}

/**
 * Historical Replay insight slice (Phase 22 — Chimmy Historical Replay Context).
 * Carries ONLY the user-safe `ManagerReplayInsightSetV1` contract (never the
 * internal `DecisionReplayCorrelationSummary` — no `perTradeImpacts`,
 * `byLineupInvolvement`, raw IDs, etc.). Observational/display-only: it is
 * rendered into an explicitly-labelled, disclaimer-carrying prompt section and
 * must never be transformed into a recommendation.
 *
 * `status`: `disabled` = feature off / no league → no section rendered;
 * `empty` = enabled but no completed-trade history → honest empty section so
 * Chimmy can say so plainly; `ready` = insight set present.
 */
export type ReplayInsightSlice = {
  status: "disabled" | "empty" | "ready"
  insightSet: ManagerReplayInsightSetV1 | null
}

/**
 * Reserved hook for future vector-store memory retrieval.
 * Phase 2A: always empty array. Phase 3+: top-K retrieved summaries.
 */
export type MemoryRef = {
  type: "matchup" | "trade" | "draft" | "season_summary" | "user_note"
  id: string
  summary: string
}

/** Final aggregated bundle handed to consumers (chat route, debug endpoints). */
export type ChimmyContextBundle = {
  user: UserContextSlice | null
  aiAccess: SubscriptionContextSlice | null
  activeLeague: LeagueSummary | null
  leagues: LeagueSummary[]
  matchup: MatchupContextSlice | null
  roster: RosterContextSlice | null
  standings: StandingsContextSlice | null
  rankings: RankingContextSlice | null
  leagueDifficulty: LeagueDifficultyContextSlice | null
  importedHistory: ImportedHistorySlice | null
  sportsSchedule: SportsScheduleSlice | null
  /** Historical Replay insights (Phase 22) — observational only; null when disabled/unavailable. */
  replayInsights: ReplayInsightSlice | null
  /** Future memory retrieval hook (vector store). Phase 2A: []. */
  memoryRefs: MemoryRef[]
  /** Provenance: which providers ran, succeeded, failed, were cached. */
  meta: {
    builtAt: string
    durationMs: number
    providers: Array<{
      name: string
      ok: boolean
      cached: boolean
      durationMs: number
      error?: string
    }>
  }
}

/** Free-form recommendation context — reserved for Phase 2B. */
export type RecommendationsContextSlice = {
  hints: string[]
}
