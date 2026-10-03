/**
 * Weighted draft lottery: types and config.
 * Draft ORDER mode is separate from draft FORMAT (snake/linear/auction).
 */

export type DraftOrderMode = 'randomize' | 'manual' | 'weighted_lottery'

export type LotteryEligibilityMode = 'non_playoff' | 'bottom_n' | 'all_teams' | 'custom'

export type LotteryWeightingMode =
  | 'inverse_standings'
  | 'inverse_points_for'
  | 'inverse_max_pf'
  | 'custom_weights'

export type LotteryFallbackOrder = 'reverse_standings' | 'reverse_max_pf' | 'manual'

export type LotteryTiebreakMode = 'lower_points_for' | 'lower_max_pf' | 'seeded_random'

export interface WeightedLotteryConfig {
  enabled: boolean
  /** How many teams participate in the lottery (e.g. 6 = bottom 6). */
  lotteryTeamCount: number
  /** How many picks are assigned by lottery (e.g. 6 = first 6 picks). */
  lotteryPickCount: number
  eligibilityMode: LotteryEligibilityMode
  /** When eligibilityMode is bottom_n, this is the N. */
  bottomN?: number
  weightingMode: LotteryWeightingMode
  fallbackOrder: LotteryFallbackOrder
  tiebreakMode: LotteryTiebreakMode
  /** Stored for audit; set when lottery is run. */
  randomSeed?: string | null
  auditSeed?: string | null
  allowCommissionerOverride: boolean
}

export const DEFAULT_WEIGHTED_LOTTERY_CONFIG: WeightedLotteryConfig = {
  enabled: false,
  lotteryTeamCount: 6,
  lotteryPickCount: 6,
  eligibilityMode: 'non_playoff',
  weightingMode: 'inverse_standings',
  fallbackOrder: 'reverse_max_pf',
  tiebreakMode: 'lower_max_pf',
  allowCommissionerOverride: true,
}

/** One team's lottery eligibility and weight. */
export interface LotteryEligibleTeam {
  rosterId: string
  displayName: string
  teamIndex: number
  /** 1-based league rank, 1 = BEST (`LeagueTeam.currentRank`); the pool's worst has the highest. */
  rank: number
  wins: number
  losses: number
  ties: number
  pointsFor: number
  /** Weight for lottery (higher = better odds). */
  weight: number
  /** Display percentage (0–100). */
  oddsPercent: number
}

/** Result of running the lottery (one draw). */
export interface LotteryDrawResult {
  pickSlot: number
  rosterId: string
  displayName: string
  originalOrder: number
}

/** Full lottery result: lottery slots + fallback order + audit. */
export interface WeightedLotteryResult {
  lotteryDraws: LotteryDrawResult[]
  fallbackOrder: { slot: number; rosterId: string; displayName: string }[]
  /** Full slot order (1..teamCount) for DraftSession.slotOrder. */
  slotOrder: { slot: number; rosterId: string; displayName: string }[]
  seed: string
  runAt: string
  configSnapshot: Partial<WeightedLotteryConfig>
  oddsSnapshot: { rosterId: string; weight: number; oddsPercent: number }[]
}
