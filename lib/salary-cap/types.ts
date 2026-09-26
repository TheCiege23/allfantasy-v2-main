/**
 * Salary Cap League — shared types (PROMPT 339).
 */

import type { LeagueSport } from '@prisma/client'

export type SalaryCapMode = 'dynasty' | 'bestball'
export type StartupDraftType = 'auction' | 'snake'
export type FutureDraftType = 'auction' | 'snake' | 'weighted_lottery'
export type ContractStatus = 'active' | 'expired' | 'cut' | 'traded' | 'tagged' | 'option_exercised'
export type ContractSource =
  | 'startup_auction'
  | 'rookie_draft'
  | 'waiver_bid'
  | 'extension'
  | 'franchise_tag'
  | 'trade'

/** Config loaded from DB (SalaryCapLeagueConfig + sport). */
export interface SalaryCapConfig {
  leagueId: string
  configId: string
  sport: LeagueSport
  mode: SalaryCapMode
  startupCap: number
  /** Declared startup season, falling back to persisted configuration creation year. */
  capStartYear?: number
  season?: number | null
  capGrowthPercent: number
  contractMinYears: number
  contractMaxYears: number
  rookieContractYears: number
  minimumSalary: number
  deadMoneyEnabled: boolean
  deadMoneyPercentPerYear: number
  rolloverEnabled: boolean
  rolloverMax: number
  capFloorEnabled: boolean
  capFloorAmount: number | null
  extensionsEnabled: boolean
  franchiseTagEnabled: boolean
  rookieOptionEnabled: boolean
  startupDraftType: StartupDraftType
  futureDraftType: FutureDraftType
  auctionHoldback: number
  weightedLotteryEnabled: boolean
  lotteryOddsConfig: unknown
  compPickEnabled: boolean
  compPickFormula: unknown
  offseasonPhase: string | null
  offseasonPhaseEndsAt: Date | null
}

/** Team ledger row (cap state per roster per year). */
export interface TeamLedgerRow {
  rosterId: string
  capYear: number
  totalCapHit: number
  deadMoneyHit: number
  rolloverUsed: number
  capSpace: number
}

/** Player contract (active or historical). */
export interface PlayerContractRow {
  id: string
  rosterId: string
  playerId: string
  playerName: string | null
  position: string | null
  salary: number
  yearsTotal: number
  yearSigned: number
  contractYear: number
  status: ContractStatus
  source: ContractSource
  deadMoneyRemaining: Record<number, number> | null
}

/** Cap legality result. */
export interface CapLegalityResult {
  legal: boolean
  totalCapHit: number
  capSpace: number
  overBy?: number
  underFloorBy?: number
  errors: string[]
}

/** Future cap projection (per year). */
export interface FutureCapYear {
  capYear: number
  capCeiling: number
  totalCapHit: number
  deadMoney: number
  projectedSpace: number
  contractCount: number
}

/** Trade cap impact (both sides). */
export interface TradeCapImpact {
  /** Existing contract commitments only; excludes unsigned future acquisitions. */
  years?: Array<{ capYear: number; fromCapHit: number; toCapHit: number;
    fromCap: number; toCap: number; fromLegal: boolean; toLegal: boolean }>
  fromRosterId: string
  toRosterId: string
  fromCapHitDelta: number
  toCapHitDelta: number
  fromLegal: boolean
  toLegal: boolean
  fromFutureLegal: boolean
  toFutureLegal: boolean
  errors: string[]
}

/** Contract bid (waiver/FA). */
export interface ContractBidInput {
  rosterId: string
  playerId: string
  salary: number
  years: number
  faabBid?: number
}

/** Extension eligibility. */
export interface ExtensionEligibility {
  eligible: boolean
  contractId: string
  currentSalary: number
  extensionPrice: number
  maxExtensionYears: number
  reason?: string
}

/** Franchise tag eligibility. */
export interface FranchiseTagEligibility {
  eligible: boolean
  tagCost: number
  alreadyUsed: boolean
  reason?: string
}
