/**
 * Keeper draft types. Sport-aware; supports NFL, NHL, NBA, MLB, NCAAB, NCAAF, SOCCER.
 */

export interface KeeperConfig {
  /** Max number of keepers per roster. */
  maxKeepers: number
  /** Optional deadline (ISO string) after which keepers are locked. */
  deadline?: string | null
  /** Optional max keepers per position, e.g. { QB: 1, RB: 2 }. */
  maxKeepersPerPosition?: Record<string, number>
  costSystem?: string
  maxYears?: number
  roundPenalty?: number
  auctionPctIncrease?: number
  waiverAllowed?: boolean
  eligibilityRule?: string
  conflictRule?: string
  missedDeadlineRule?: string
  keptPlayersRemovedFromPool?: boolean
  keptPlayerRoundCostsEnabled?: boolean
  draftRoundAdjustmentsEnabled?: boolean
  keptPlayerBudgetDeductionsEnabled?: boolean
  rosterNeedsAccountForKeepers?: boolean
  /** Written by AF's automatic keeper placement (lib/keeper/keeperAutoBoard.ts). */
  autoPlacement?: import('../types').KeeperAutoPlacementSummary
}

export interface KeeperSelection {
  rosterId: string
  /** Round (1-based) that this keeper costs (that round's pick is "used"). */
  roundCost: number
  playerName: string
  position: string
  team: string | null
  playerId: string | null
  /** Set when commissioner overrides eligibility. */
  commissionerOverride?: boolean
  /** AF placed him from a locked keeper record (lib/keeper/keeperAutoBoard.ts). */
  autoPlaced?: true
  /** Why he is not in the round he cost — shown on the board. */
  placementNote?: string
}

export interface KeeperLock {
  round: number
  slot: number
  overall: number
  rosterId: string
  displayName: string | null
  playerName: string
  position: string
  team: string | null
  playerId: string | null
  isKeeper: true
  placementNote?: string
}
