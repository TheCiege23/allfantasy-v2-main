/**
 * Live draft engine types.
 * Supports NFL, NHL, NBA, MLB, NCAAB, NCAAF, SOCCER.
 */

export type DraftSessionStatus = 'pre_draft' | 'in_progress' | 'paused' | 'completed'

export type DraftType = 'snake' | 'linear' | 'auction'

export interface SlotOrderEntry {
  slot: number
  rosterId: string
  displayName: string
  platformUserId?: string
}

/** One traded pick: ownership change for (round, slot) from originalRosterId to newRosterId. */
export interface TradedPickRecord {
  round: number
  originalRosterId: string
  previousOwnerName: string
  newRosterId: string
  newOwnerName: string
  season?: string
}

export interface DraftSessionSnapshot {
  id: string
  leagueId: string
  status: DraftSessionStatus
  draftType: DraftType
  rounds: number
  teamCount: number
  thirdRoundReversal: boolean
  /** Slice 1 — typed draft session flags surfaced to client for read-consistency.
   * Behavior wiring lands in later slices (6 trades, 8 custom rankings). */
  onClockTradeTimerBehavior: 'inherit_remaining' | 'reset_timer'
  inDraftPlayerTradesEnabled: boolean
  customRankingsEnabled: boolean
  timerSeconds: number | null
  timerEndAt: string | null
  pausedRemainingSeconds: number | null
  slotOrder: SlotOrderEntry[]
  /** Resolved pick ownership for display; used for future picks and current-on-clock. */
  tradedPicks: TradedPickRecord[]
  version: number
  picks: DraftPickSnapshot[]
  currentPick: CurrentOnTheClock | null
  timer: TimerState
  updatedAt: string
  /** Present when draftType === 'auction'. */
  auction?: AuctionSessionSnapshot
  /** True when long timer or overnight pause (slow draft). */
  isSlowDraft?: boolean
  /** Keeper draft: config and locks for board. */
  keeper?: KeeperSessionSnapshot
  /** Devy draft: which rounds are devy-only. */
  devy?: DevySessionSnapshot
  /** C2C draft: college vs pro rounds. */
  c2c?: C2CSessionSnapshot
  /** rookie | startup | supplemental | dispersal | standard — from draft session. */
  draftModeLabel?: string | null
  /** Dispersal / specialty pool rules when configured on the session. */
  dispersalPool?: {
    eligibleRosterIds?: string[]
    protectedPlayerIds?: string[]
    allowedAssetTypes?: string[]
  } | null
  /** Whether any AI provider is currently available for orphan AI drafter mode. */
  orphanAiProviderAvailable?: boolean
  /** Effective orphan drafter mode after provider fallback ('cpu' when AI unavailable). */
  orphanDrafterEffectiveMode?: 'cpu' | 'ai'
  /** Commissioner-assigned AI teams + trade rules (when configured on draft session). */
  commissionerAiDraft?: {
    assignedAiTeams: Array<{
      teamId: string
      teamName: string
      aiStyle: string
      tradeAggression: string
      active: boolean
    }>
    tradeRules: {
      allowOutbound: boolean
      allowInbound: boolean
      blockAiToAi: boolean
      proposalCooldownSeconds: number
      maxProposalsPerRound: number
      acceptConfidenceMin: number
    }
  }
  /** Viewer-specific: wired from GET `/draft/session`, `POST /draft/pick`, `POST /draft/controls`. */
  currentUserRosterId?: string
  /** Viewer-specific: orphan roster ids (GET `/draft/session`). */
  orphanRosterIds?: string[]
  /** Viewer-specific: matches GET `/draft/session` orphan AI toggle. */
  aiManagerEnabled?: boolean
  /** Viewer-specific: commissioner orphan drafter mode (cpu vs ai). */
  orphanDrafterMode?: 'cpu' | 'ai'
  /** Weighted lottery / order metadata from league draft config. */
  draftOrderMode?: string
  lotteryLastRunAt?: string
  /** True when league has no persisted roster slots — room can load but picks/timer must be blocked. */
  rosterConfigurationIncomplete?: boolean
  /** User-facing banner copy when roster configuration blocks drafting (paired with rosterConfigurationIncomplete). Cleared as null when configuration is valid. */
  rosterConfigurationMessage?: string | null
  /** The userId who triggered a commissioner pause, or null. Only meaningful when status === 'paused'. */
  pausedByUserId?: string | null
  /** Whether picks are allowed during the overnight auto-pause window. Client uses this to show/hide the pick panel. Server enforcement added in Commit 4. */
  allowPicksDuringOvernightPause?: boolean
  /** Viewer-specific auto-pick preference. Null when no authenticated viewer; populated from `LiveDraftAutopickPreference`. */
  viewerAutopick?: {
    enabled: boolean
    mode: 'standard' | 'ai_queue'
    isProEligible: boolean
    updatedAt: string | null
  } | null
}

export interface C2CSessionSnapshot {
  enabled: boolean
  /** 1-based round numbers that are college-only; all other rounds are pro-only. */
  collegeRounds: number[]
}

export interface DevySessionSnapshot {
  enabled: boolean
  /** 1-based round numbers that are devy-only (e.g. [14, 15]). */
  devyRounds: number[]
}

export interface KeeperSessionSnapshot {
  config: { maxKeepers: number; deadline?: string | null; maxKeepersPerPosition?: Record<string, number> }
  selections: Array<{ rosterId: string; roundCost: number; playerName: string; position: string; team: string | null; playerId: string | null; commissionerOverride?: boolean }>
  locks: Array<{ round: number; slot: number; overall: number; rosterId: string; displayName: string | null; playerName: string; position: string; team: string | null; playerId: string | null; isKeeper: true }>
}

export interface DraftPickSnapshot {
  id: string
  overall: number
  round: number
  slot: number
  rosterId: string
  displayName: string | null
  playerName: string
  position: string
  team: string | null
  byeWeek: number | null
  playerId: string | null
  /** Resolved at pick time (e.g. DB headshot URL) — keeps board/history working without re-resolving assets. */
  playerImageUrl?: string | null
  /** Commissioner pick editor cleared this cell; no player is assigned until reassigned. */
  pickEditorEmpty?: boolean
  tradedPickMeta: TradedPickMeta | null
  source: string
  pickLabel: string
  /** Auction: winning bid amount. */
  amount?: number | null
  createdAt: string
}

export interface TradedPickMeta {
  originalRosterId?: string
  previousOwnerName?: string
  newOwnerName?: string
  showNewOwnerInRed?: boolean
  tintColor?: string
}

export interface CurrentOnTheClock {
  overall: number
  round: number
  slot: number
  rosterId: string
  displayName: string
  pickLabel: string
}

/** Alias for pick rows in {@link DraftRoomCoreState} (same shape as API snapshots). */
export type DraftRoomPick = DraftPickSnapshot

/**
 * Minimal normalized draft room state (UI reducers, tests, fixtures).
 * Maps cleanly from {@link DraftSessionSnapshot} via `buildDraftRoomCoreState`.
 */
export interface DraftRoomCoreState {
  draftStarted: boolean
  currentOverall: number
  currentRound: number
  currentPickInRound: number
  /** Roster id of the manager on the clock (fantasy team slot). */
  currentTeamId: string
  /** ISO 8601 UTC end time for the active pick timer, or empty string when none. */
  timerEndAt: string
  picks: DraftRoomPick[]
}

/**
 * Payload recorded when a pick is committed (client log, optimistic updates, audits).
 * `teamId` is the roster that made the pick; `slot` is the draft board column (1…teamCount).
 */
export interface CommitPickPayload {
  playerId: string | null
  teamId: string
  overall: number
  round: number
  slot: number
  /** ISO 8601 UTC when the pick was committed */
  timestamp: string
}

export interface TimerState {
  status: 'running' | 'paused' | 'expired' | 'none'
  remainingSeconds: number | null
  timerEndAt: string | null
  /** Commissioner pause vs overnight slow-draft window (virtual pause while session may stay in_progress). */
  pauseReason?: 'commissioner' | 'overnight_window' | null
  /** When pauseReason is overnight_window: next instant the pause window ends (ISO UTC). */
  overnightResumeAt?: string | null
}

export interface QueueEntry {
  playerName: string
  position: string
  team?: string | null
  playerId?: string | null
  /** User pinned this row; AI reorder must not move it from its slot. */
  lockedByUser?: boolean
  /** Populated when queue row was written by AF Pro AI reorder persist path. */
  isAiAdjusted?: boolean
  /** 1-based rank before the last AI reorder (persist path). */
  aiOriginalRank?: number | null
  aiReason?: string | null
}

export type DraftEventType =
  | 'session_created'
  | 'session_started'
  | 'session_paused'
  | 'session_resumed'
  | 'session_completed'
  | 'pick_submitted'
  | 'pick_undone'
  | 'timer_reset'
  | 'autopick_triggered'
  | 'auction_nominated'
  | 'auction_bid'
  | 'auction_sold'

export interface DraftEvent {
  type: DraftEventType
  sessionId: string
  leagueId: string
  at: string
  payload?: Record<string, unknown>
}

// ————— Auction draft (deterministic) —————

export interface AuctionNomination {
  playerName: string
  position: string
  team: string | null
  playerId: string | null
  byeWeek?: number | null
}

export interface AuctionState {
  /** Index into slotOrder for who nominates next (0-based). */
  nominationOrderIndex: number
  /** Currently nominated player (on the block). */
  currentNomination: AuctionNomination | null
  /** Current high bid amount. */
  currentBid: number
  /** RosterId of current high bidder. */
  currentBidderRosterId: string | null
  /** When bid timer expires (UTC ISO). */
  bidTimerEndAt: string | null
  /** Minimum next bid (currentBid + minIncrement). */
  minNextBid: number
}

/** Per-roster remaining budget. */
export type AuctionBudgets = Record<string, number>

export interface AuctionSessionSnapshot {
  draftType: 'auction'
  budgetPerTeam: number
  budgets: AuctionBudgets
  auctionState: AuctionState
  /** Minimum bid increment (e.g. 1). */
  minBidIncrement: number
  /** Nomination order (same as slotOrder for auction). */
  nominationOrder: SlotOrderEntry[]
}
