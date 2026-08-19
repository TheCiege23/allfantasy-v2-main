/**
 * Fantasy OS Phase 4 — provider-neutral intelligence contracts (Part 3).
 *
 * These typed contracts are what the workspace surfaces consume. They never expose raw Sleeper payload
 * shapes. Every contract carries the shared source/freshness/truth envelope plus its own deterministic
 * metrics + evidence-backed insights + disclosed limitations.
 */
import type { SourceEnvelope } from './truth'
import type { Explanation } from './explanation'

export type YearlyPoint = { season: number; value: number }
export type YearlySeries = { key: string; label: string; unit: string; points: YearlyPoint[] }
export type StackedYearlyPoint = { season: number } & Record<string, number>
export type Distribution = { bucket: string; count: number }
export type RankedLeague = {
  /** Pseudonymous display key (deterministic) — never the raw provider league id in customer views. */
  ref: string
  season: number
  metric: number
  detail?: string
}

export type ContractBase = SourceEnvelope & {
  insights: Explanation[]
  limitations: string[]
}

// ── Platform ──────────────────────────────────────────────────────────────────
export type PlatformIntelligence = ContractBase & {
  kind: 'platform'
  totals: {
    leagueSeasons: number
    uniqueManagers: number
    commissioners: number
    rosters: number
    matchups: number
    transactions: number
    trades: number
    waivers: number
    freeAgents: number
    faab: number
    drafts: number
    draftPicks: number
    tradedFuturePicks: number
    continuityChains: number
  }
  leaguesByYear: YearlySeries
  transactionsByYear: YearlySeries
  tradesByYear: YearlySeries
  waiversByYear: YearlySeries
  freeAgentsByYear: YearlySeries
  draftsByYear: YearlySeries
  draftPicksByYear: YearlySeries
  /** Stacked composition (trades / waivers / freeAgents) per season. */
  activityCompositionByYear: StackedYearlyPoint[]
}

// ── League ────────────────────────────────────────────────────────────────────
export type LeagueOperationalStatus = 'active' | 'quiet' | 'dormant'
export type LeagueIntelligence = ContractBase & {
  kind: 'league'
  leagueSeasons: number
  distinctLeagueChains: number
  byFormat: Distribution[]
  byStatus: Distribution[]
  operationalHealth: { status: LeagueOperationalStatus; count: number; rule: string }[]
  mostActive: RankedLeague[]
  needsAttention: RankedLeague[]
}

// ── Commissioner ───────────────────────────────────────────────────────────────
export type CommissionerIntelligence = ContractBase & {
  kind: 'commissioner'
  commissionedLeagueSeasons: number
  commissionersInPortfolio: number
  commissionedByYear: YearlySeries
  activityUnderCommissioner: { transactions: number; trades: number; waivers: number }
  attentionFlags: { flag: string; count: number; rule: string }[]
}

// ── Trade ─────────────────────────────────────────────────────────────────────
export type TradeIntelligence = ContractBase & {
  kind: 'trade'
  totalTrades: number
  activeTradingLeagueSeasons: number
  quietLeagueSeasons: number
  tradedFuturePicks: number
  tradesByYear: YearlySeries
  yoyChangePct: number | null
  concentration: RankedLeague[]
}

// ── Waiver ────────────────────────────────────────────────────────────────────
export type WaiverIntelligence = ContractBase & {
  kind: 'waiver'
  waivers: number
  freeAgents: number
  faab: number
  activeLeagueSeasons: number
  waiversByYear: YearlySeries
  freeAgentsByYear: YearlySeries
  faabByYear: YearlySeries
  /** FAAB leagues / leagues with any waiver activity (valid denominator). */
  faabAdoptionPct: number | null
}

// ── Draft ─────────────────────────────────────────────────────────────────────
export type DraftIntelligence = ContractBase & {
  kind: 'draft'
  drafts: number
  draftPicks: number
  draftsByYear: YearlySeries
  draftPicksByYear: YearlySeries
  avgPicksPerDraft: number | null
  tradedFuturePicks: number
  /** Position metadata is not persisted → this is always Insufficient Evidence, never guessed. */
  positionalDistributionAvailable: false
}

// ── Manager ───────────────────────────────────────────────────────────────────
export type ManagerIntelligence = ContractBase & {
  kind: 'manager'
  uniqueManagers: number
  commissioners: number
  managersInMultipleLeagues: number
  managersAcrossMultipleSeasons: number
  participationDistribution: Distribution[]
  topByLeaguePresence: RankedLeague[]
  /** These inferences are intentionally NOT produced without a separately validated contract. */
  forbiddenInferences: string[]
}

export type AnyIntelligence =
  | PlatformIntelligence
  | LeagueIntelligence
  | CommissionerIntelligence
  | TradeIntelligence
  | WaiverIntelligence
  | DraftIntelligence
  | ManagerIntelligence
