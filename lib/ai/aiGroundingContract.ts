/**
 * AllFantasy AI Grounding Contract — v1
 *
 * The canonical data shape for every AI call across every sport.
 * Every Chimmy response is built from exactly one of these contracts.
 *
 * DESIGN PRINCIPLES:
 *   null  = "not loaded" — AI must NOT speculate, must cite missingData
 *   []    = "loaded but empty" — AI may say "no data found"
 *   computedInsights = the ONLY numbers AI may cite
 *   forbiddenClaims  = always enforced, regardless of what the user asks
 *   sourceFreshness  = must be cited for any factual claim
 *
 * WORKFLOW:
 *   1. Sport plugin builds the contract in buildGroundingPacket()
 *   2. The caller calls validateAIResponse(response, contract) after generation
 *   3. Front-end reads sourceFreshness.shortDisplay for the answer chip
 */
import type { SportKey, FeatureKey, UserRole, DataFreshnessTier } from "./engine/types"

// ─── Freshness labels ─────────────────────────────────────────────────────────

type FreshnessShortLabel =
  | "Live"
  | "Cached"
  | "Pool data"
  | "Historical"
  | "General knowledge"
  | "Unavailable"

export type FreshnessLabel = {
  tier: DataFreshnessTier
  /** Full sentence Chimmy cites before any factual claim. */
  display: string
  /** Short chip shown in the UI next to the answer. */
  shortDisplay: FreshnessShortLabel
  poolDataLabel: string
  ageMinutes: number | null
}

export function buildFreshnessLabel(
  tier: DataFreshnessTier,
  fetchedAt: Date | null,
): FreshnessLabel {
  const poolDataLabel = "AllFantasy pool data"
  switch (tier) {
    case "live":
      return {
        tier,
        display: "Live data",
        shortDisplay: "Live",
        poolDataLabel,
        ageMinutes: 0,
      }
    case "cached": {
      if (!fetchedAt) {
        return {
          tier,
          display: "Cached data (age unknown)",
          shortDisplay: "Cached",
          poolDataLabel,
          ageMinutes: null,
        }
      }
      const ageMs = Date.now() - fetchedAt.getTime()
      const ageMinutes = Math.round(ageMs / 60_000)
      const timeStr =
        ageMinutes < 1
          ? "just now"
          : ageMinutes < 60
            ? `${ageMinutes} min ago`
            : `${Math.round(ageMinutes / 60)}h ago`
      return {
        tier,
        display: `Cached · updated ${timeStr}`,
        shortDisplay: "Cached",
        poolDataLabel,
        ageMinutes,
      }
    }
    case "schedule_only":
      return {
        tier,
        display: "Schedule data only — live scores not loaded",
        shortDisplay: "Pool data",
        poolDataLabel,
        ageMinutes: null,
      }
    case "pool_only":
      return {
        tier,
        display: "AllFantasy pool data",
        shortDisplay: "Pool data",
        poolDataLabel,
        ageMinutes: null,
      }
    default:
      return {
        tier: "none",
        display: "No sports data available",
        shortDisplay: "Unavailable",
        poolDataLabel,
        ageMinutes: null,
      }
  }
}

// ─── Contract sub-types ───────────────────────────────────────────────────────

type ContractPick = {
  matchId: string
  matchDescription: string
  pickedTeam: string
  phase: string
  pointsAtStake: number
  result: "correct" | "incorrect" | "pending" | null
}

type ContractLeaderboardRow = {
  rank: number
  displayName: string
  score: number
  maxPossible: number | null
  isCurrentUser: boolean
  isTied: boolean
}

type ContractFixture = {
  matchId: string
  homeTeam: string
  awayTeam: string
  kickoffUtc: string | null
  round: string
  venue: string | null
  status: "scheduled" | "live" | "final" | "postponed" | "cancelled"
}

type ContractLiveScore = {
  matchId: string
  homeTeam: string
  awayTeam: string
  homeScore: number
  awayScore: number
  minute: number | null
  extraTime: boolean
  status: "live" | "half_time" | "extra_time" | "penalties"
}

type ContractOddsRow = {
  matchId: string
  /** null = unknown — AI must NOT guess which team is favored. */
  favorite: string | null
  underdog: string | null
  favoriteMoneyline: number | null
  overUnder: number | null
  spread: number | null
  source: string
  asOf: string | null
}

// ─── The contract ─────────────────────────────────────────────────────────────

export type AIGroundingContract = {
  // ── Identity ──────────────────────────────────────────────────────────────
  readonly contractVersion: "af-contract-v1"
  sport: SportKey
  feature: FeatureKey
  userRole: UserRole
  /** Plan determines what Chimmy is allowed to reveal. */
  plan: string
  locale: string | null

  // ── Source disclosure — Chimmy MUST cite this for any factual claim ───────
  sourceFreshness: FreshnessLabel

  // ── Pool context — always present ─────────────────────────────────────────
  poolContext: {
    poolId: string
    poolName: string
    totalEntries: number
    sport: string
    format: string
    currentPhase: string
    prizePool: string | null
  }

  // ── Scoring system — null if not loaded ───────────────────────────────────
  scoringContext: {
    description: string
    pointsByRound: Record<string, number>
    bonusRules: string[]
    championMultiplier: number | null
  } | null

  // ── Current user's picks — null if guest / not loaded / private ───────────
  userPicks: ContractPick[] | null

  // ── Leaderboard — null if not loaded ──────────────────────────────────────
  leaderboard: ContractLeaderboardRow[] | null

  // ── Provider fixture schedule — null if not loaded ────────────────────────
  providerFixtures: ContractFixture[] | null

  /**
   * Live scores — null = live feed not loaded.
   * When null, Chimmy MUST NOT state any score or current match result.
   */
  liveScores: ContractLiveScore[] | null

  /**
   * Odds/favorites — null = no odds data loaded.
   * When null, Chimmy MUST NOT say "X is favored", "the favorite", or
   * reference any spread/moneyline/over-under value.
   */
  oddsData: ContractOddsRow[] | null

  /**
   * Pre-computed deterministic insights.
   * This is the ONLY source of numbers Chimmy may cite.
   * Every numeric claim in the AI response must trace back to this object.
   */
  computedInsights: Record<string, unknown>

  // ── Contract enforcement fields ───────────────────────────────────────────
  /**
   * Data that was NOT loaded. Chimmy must acknowledge these gaps honestly.
   * Generated by buildMissingDataList().
   */
  missingData: string[]

  /**
   * What Chimmy IS explicitly authorized to state in this context.
   * Generated by buildAllowedClaims().
   */
  allowedClaims: string[]

  /**
   * What Chimmy MUST NOT state, regardless of user question.
   * Generated by buildForbiddenClaims().
   */
  forbiddenClaims: string[]
}

// ─── Builder helpers ──────────────────────────────────────────────────────────

type ContractParts = Pick<
  AIGroundingContract,
  | "liveScores"
  | "oddsData"
  | "providerFixtures"
  | "scoringContext"
  | "userPicks"
  | "leaderboard"
>

export function buildMissingDataList(opts: ContractParts): string[] {
  const missing: string[] = []
  if (opts.liveScores === null) {
    missing.push("live match scores (live feed not loaded — do not guess any score)")
  }
  if (opts.oddsData === null) {
    missing.push("odds, spreads, and betting favorites (not loaded — do not mention)")
  }
  if (opts.providerFixtures === null) {
    missing.push("official fixture schedule from the sports provider")
  }
  if (opts.scoringContext === null) {
    missing.push("pool scoring rules")
  }
  if (opts.userPicks === null) {
    missing.push("your personal picks (not available in this context)")
  }
  if (opts.leaderboard === null) {
    missing.push("leaderboard standings")
  }
  return missing
}

export function buildAllowedClaims(
  opts: ContractParts & Pick<AIGroundingContract, "computedInsights">,
): string[] {
  const claims: string[] = ["AllFantasy pool pick distribution and entry data"]
  if (opts.liveScores !== null) {
    claims.push("current live match scores and status from provider")
  }
  if (opts.oddsData !== null) {
    claims.push("pre-match odds and favorites as provided by the odds source")
  }
  if (opts.providerFixtures !== null) {
    claims.push("official fixture schedule (teams, kickoff times, venues)")
  }
  if (opts.scoringContext !== null) {
    claims.push("pool scoring rules and point values per round")
  }
  if (opts.userPicks !== null) {
    claims.push("your picks and their current result status")
  }
  if (opts.leaderboard !== null) {
    claims.push("current leaderboard standings and scores")
  }
  if (Object.keys(opts.computedInsights).length > 0) {
    claims.push(
      "pre-computed pool analytics: leaderboard movement, swing scores, max possible points, rooting guide, parity, upset impact",
    )
  }
  return claims
}

export function buildForbiddenClaims(
  opts: Pick<AIGroundingContract, "liveScores" | "oddsData" | "plan">,
): string[] {
  const forbidden: string[] = [
    "betting advice or wagering recommendations of any kind",
    "DFS lineup advice or daily fantasy strategy",
    "another user's private picks or personal information",
    "score predictions stated as established fact rather than general knowledge",
  ]
  if (opts.liveScores === null) {
    forbidden.push(
      "any live match score, current result, or in-progress match state — live data is not loaded; if asked, say the live feed is unavailable",
    )
  }
  if (opts.oddsData === null) {
    forbidden.push(
      "which team is 'favored', 'the favorite', 'expected to win', or any odds/spread/over-under — no odds data is loaded; if asked, acknowledge it",
    )
  }
  if (opts.plan === "free") {
    forbidden.push(
      "premium-only analysis — if the user asks for deeper insight, invite them to upgrade",
    )
  }
  return forbidden
}

// ─── Serialization ────────────────────────────────────────────────────────────

