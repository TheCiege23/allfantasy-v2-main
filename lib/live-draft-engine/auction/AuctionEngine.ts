/**
 * Auction draft engine — deterministic nomination, bidding, timer, budget, roster validation.
 * No AI required for core mechanics. Supports all sports (NFL, NHL, NBA, MLB, NCAAB, NCAAF, SOCCER).
 */

import { prisma } from '@/lib/prisma'
import { canPlaceAuctionBid } from '@/lib/mock-draft/draft-engine'
import { withAuctionLock } from '@/lib/draft/draftLock'
import { logStructured } from '@/lib/logging/structured'
import type {
  AuctionState,
  AuctionBudgets,
  AuctionNomination,
  SlotOrderEntry,
} from '@/lib/live-draft-engine/types'
import { computeTimerEndAt } from '@/lib/live-draft-engine/DraftTimerService'
import { getSalaryCapConfig } from '@/lib/salary-cap/SalaryCapLeagueConfig'
import { processWinningContractBid } from '@/lib/salary-cap/ContractBidService'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'

const DEFAULT_BUDGET = 200
const DEFAULT_MIN_BID = 1
const DEFAULT_MIN_INCREMENT = 1
const DEFAULT_BID_TIMER_SECONDS = 35

function getTeamRosterSlotsRemaining(picksCountForRoster: number, rounds: number): number {
  return Math.max(0, rounds - picksCountForRoster)
}

function normalizeNominationIndex(index: number, slotOrderLength: number): number {
  if (slotOrderLength <= 0) return 0
  const safe = Number.isFinite(index) ? Math.floor(index) : 0
  return ((safe % slotOrderLength) + slotOrderLength) % slotOrderLength
}

function timerHasExpired(timerEndAt: Date | null | undefined, now: Date): boolean {
  return Boolean(timerEndAt && timerEndAt.getTime() <= now.getTime())
}

export interface AuctionConfig {
  budgetPerTeam: number
  minBid: number
  minBidIncrement: number
  bidTimerSeconds: number
}

export function getAuctionConfigFromSession(session: {
  auctionBudgetPerTeam?: number | null
  timerSeconds?: number | null
}): AuctionConfig {
  return {
    budgetPerTeam: session.auctionBudgetPerTeam ?? DEFAULT_BUDGET,
    minBid: DEFAULT_MIN_BID,
    minBidIncrement: DEFAULT_MIN_INCREMENT,
    bidTimerSeconds: session.timerSeconds ?? DEFAULT_BID_TIMER_SECONDS,
  }
}

export function getAuctionStateFromSession(session: {
  auctionState?: unknown
}): AuctionState | null {
  const raw = session.auctionState
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  return {
    nominationOrderIndex: Number(o.nominationOrderIndex ?? 0),
    currentNomination: (o.currentNomination as AuctionNomination) ?? null,
    currentBid: Number(o.currentBid ?? 0),
    currentBidderRosterId: (o.currentBidderRosterId as string) ?? null,
    bidTimerEndAt: (o.bidTimerEndAt as string) ?? null,
    minNextBid: Number(o.minNextBid ?? 0),
  }
}

export function getBudgetsFromSession(session: {
  auctionBudgetPerTeam?: number | null
  auctionBudgets?: unknown
  slotOrder?: unknown
}): AuctionBudgets {
  const slotOrder = (session.slotOrder as unknown as SlotOrderEntry[] | undefined) ?? []
  const defaultBudget = session.auctionBudgetPerTeam ?? DEFAULT_BUDGET
  const raw = session.auctionBudgets
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as AuctionBudgets
  }
  const budgets: AuctionBudgets = {}
  for (const entry of slotOrder) {
    budgets[entry.rosterId] = defaultBudget
  }
  return budgets
}

/** Who is the current nominator (0-based index into slotOrder). */
export function getCurrentNominatorIndex(auctionState: AuctionState | null): number {
  return auctionState?.nominationOrderIndex ?? 0
}

/** Minimum next bid for current auction. */
export function getMinNextBid(auctionState: AuctionState | null, minIncrement: number): number {
  if (!auctionState) return DEFAULT_MIN_BID
  const current = auctionState.currentBid ?? 0
  if (current <= 0) return DEFAULT_MIN_BID
  return current + minIncrement
}

/**
 * Nomination core — runs under withAuctionLock; not exported directly.
 */
async function _nominatePlayerCore(
  leagueId: string,
  nomination: AuctionNomination,
  nominatorRosterId: string
): Promise<{ success: boolean; error?: string; code?: 'ROSTER_CONFIGURATION_INCOMPLETE' }> {
  const { isLeagueRosterDraftReady } = await import('@/lib/league/league-roster-draft-gate')
  if (!(await isLeagueRosterDraftReady(leagueId))) {
    return {
      success: false,
      error: 'Roster configuration is incomplete.',
      code: 'ROSTER_CONFIGURATION_INCOMPLETE',
    }
  }

  const session = await prisma.draftSession.findFirst({
    where: { leagueId },
    orderBy: CURRENT_DRAFT_SESSION_ORDER,
    include: { picks: { orderBy: { overall: 'asc' } } },
  })
  if (!session || session.draftType !== 'auction') {
    return { success: false, error: 'Auction session not found' }
  }
  if (session.status !== 'in_progress') {
    return { success: false, error: 'Draft is not in progress' }
  }

  const slotOrder = (session.slotOrder as unknown as SlotOrderEntry[]) ?? []
  if (slotOrder.length === 0) {
    return { success: false, error: 'Draft order is not configured' }
  }
  const state = getAuctionStateFromSession(session)
  const config = getAuctionConfigFromSession(session)
  const nominationIndex = normalizeNominationIndex(state?.nominationOrderIndex ?? 0, slotOrder.length)
  const currentNominator = slotOrder[nominationIndex]
  if (!currentNominator || currentNominator.rosterId !== nominatorRosterId) {
    return { success: false, error: 'You are not the current nominator' }
  }
  if (state?.currentNomination) {
    return { success: false, error: 'A player is already on the block' }
  }

  const playerName = nomination.playerName?.trim()
  if (!playerName) return { success: false, error: 'Player name required' }

  const existingNames = new Set(
    session.picks.map((p) => p.playerName.trim().toLowerCase())
  )
  if (existingNames.has(playerName.toLowerCase())) {
    return { success: false, error: 'Player already drafted' }
  }

  const bidTimerEndAt = computeTimerEndAt(config.bidTimerSeconds)
  const minNextBid = config.minBid

  const newState: AuctionState = {
    nominationOrderIndex: nominationIndex,
    currentNomination: {
      playerName,
      position: nomination.position ?? '',
      team: nomination.team ?? null,
      playerId: nomination.playerId ?? null,
      byeWeek: nomination.byeWeek ?? null,
    },
    currentBid: 0,
    currentBidderRosterId: null,
    bidTimerEndAt: bidTimerEndAt.toISOString(),
    minNextBid,
  }

  await prisma.draftSession.update({
    where: { id: session.id },
    data: {
      auctionState: newState as any,
      timerEndAt: bidTimerEndAt,
      pausedRemainingSeconds: null,
      version: { increment: 1 },
      updatedAt: new Date(),
    },
  })
  return { success: true }
}

/**
 * Bid core — runs under withAuctionLock; not exported directly.
 */
async function _placeBidCore(
  leagueId: string,
  rosterId: string,
  amount: number
): Promise<{ success: boolean; error?: string; code?: 'ROSTER_CONFIGURATION_INCOMPLETE' }> {
  const { isLeagueRosterDraftReady } = await import('@/lib/league/league-roster-draft-gate')
  if (!(await isLeagueRosterDraftReady(leagueId))) {
    return {
      success: false,
      error: 'Roster configuration is incomplete.',
      code: 'ROSTER_CONFIGURATION_INCOMPLETE',
    }
  }

  const session = await prisma.draftSession.findFirst({
    where: { leagueId },
    orderBy: CURRENT_DRAFT_SESSION_ORDER,
    include: { picks: { orderBy: { overall: 'asc' } } },
  })
  if (!session || session.draftType !== 'auction') {
    return { success: false, error: 'Auction session not found' }
  }
  if (session.status !== 'in_progress') {
    return { success: false, error: 'Draft is not in progress' }
  }

  const state = getAuctionStateFromSession(session)
  if (!state?.currentNomination) {
    return { success: false, error: 'No player currently on the block' }
  }
  if (timerHasExpired(session.timerEndAt, new Date())) {
    return { success: false, error: 'Bidding window expired' }
  }

  const config = getAuctionConfigFromSession(session)
  const budgets = getBudgetsFromSession(session)
  const myBudget = budgets[rosterId] ?? 0
  const picksByRosterCount = session.picks.filter((p) => p.rosterId === rosterId).length
  const rosterSlotsRemaining = getTeamRosterSlotsRemaining(picksByRosterCount, session.rounds)
  if (rosterSlotsRemaining <= 0) {
    return { success: false, error: 'Roster is full' }
  }

  const minNext = getMinNextBid(state, config.minBidIncrement)
  if (amount < minNext) {
    return { success: false, error: `Minimum bid is $${minNext}` }
  }

  const canBid = canPlaceAuctionBid({
    budget: myBudget,
    bid: amount,
    rosterSlotsRemaining,
    minimumBid: config.minBid,
  })
  if (!canBid) {
    return { success: false, error: 'Bid exceeds remaining budget or invalid' }
  }

  const bidTimerEndAt = computeTimerEndAt(config.bidTimerSeconds)
  const newState: AuctionState = {
    ...state,
    currentBid: amount,
    currentBidderRosterId: rosterId,
    bidTimerEndAt: bidTimerEndAt.toISOString(),
    minNextBid: amount + config.minBidIncrement,
  }

  await prisma.draftSession.update({
    where: { id: session.id },
    data: {
      auctionState: newState as any,
      timerEndAt: bidTimerEndAt,
      pausedRemainingSeconds: null,
      version: { increment: 1 },
      updatedAt: new Date(),
    },
  })
  return { success: true }
}

/**
 * Resolve the current auction: assign player to high bidder, deduct budget, create pick, advance nominator.
 * Called when bid timer expires or commissioner forces sell. If no bids, player is not assigned (pass).
 */
export interface ResolveAuctionOptions {
  /** Commissioner-forced resolution can bypass timer expiry. */
  force?: boolean
  now?: Date
}

/**
 * Resolve core — runs under withAuctionLock; not exported directly.
 */
async function _resolveAuctionWinCore(
  leagueId: string,
  options?: ResolveAuctionOptions
): Promise<{
  success: boolean
  error?: string
  sold?: boolean
  winnerRosterId?: string
  amount?: number
}> {
  const session = await prisma.draftSession.findFirst({
    where: { leagueId },
    orderBy: CURRENT_DRAFT_SESSION_ORDER,
    include: { picks: { orderBy: { overall: 'asc' } } },
  })
  if (!session || session.draftType !== 'auction') {
    return { success: false, error: 'Auction session not found' }
  }
  if (session.status !== 'in_progress') {
    return { success: false, error: 'Draft is not in progress' }
  }

  const state = getAuctionStateFromSession(session)
  if (!state?.currentNomination) {
    return { success: false, error: 'No player on the block' }
  }

  const slotOrder = (session.slotOrder as unknown as SlotOrderEntry[]) ?? []
  if (slotOrder.length === 0) {
    return { success: false, error: 'Draft order is not configured' }
  }
  const now = options?.now ?? new Date()
  const force = Boolean(options?.force)
  if (!force && !timerHasExpired(session.timerEndAt, now)) {
    return { success: false, error: 'Bid timer has not expired yet' }
  }

  const config = getAuctionConfigFromSession(session)
  const teamCount = session.teamCount
  const totalPicks = session.rounds * teamCount
  const picksCount = session.picks.length

  let winnerRosterId = state.currentBidderRosterId
  let amount = state.currentBid
  if (winnerRosterId && amount > 0) {
    const budgets = getBudgetsFromSession(session)
    const winnerBudget = budgets[winnerRosterId] ?? 0
    const winnerPicks = session.picks.filter((pick) => pick.rosterId === winnerRosterId).length
    const rosterSlotsRemaining = getTeamRosterSlotsRemaining(winnerPicks, session.rounds)
    const stillValid = canPlaceAuctionBid({
      budget: winnerBudget,
      bid: amount,
      rosterSlotsRemaining,
      minimumBid: config.minBid,
    })
    if (!stillValid) {
      winnerRosterId = null
      amount = 0
    }
  }

  const sold = Boolean(winnerRosterId && amount > 0)
  const shouldCompleteAfterResolution = picksCount + (sold ? 1 : 0) >= totalPicks
  const nomination = state.currentNomination
  const nominationIndex = normalizeNominationIndex(state.nominationOrderIndex, slotOrder.length)
  const nextNominationIndex = normalizeNominationIndex(nominationIndex + 1, slotOrder.length)
  const nextNominationTimerEndAt = shouldCompleteAfterResolution
    ? null
    : computeTimerEndAt(config.bidTimerSeconds, now)
  const nextAuctionState: AuctionState = {
    nominationOrderIndex: nextNominationIndex,
    currentNomination: null,
    currentBid: 0,
    currentBidderRosterId: null,
    bidTimerEndAt: nextNominationTimerEndAt?.toISOString() ?? null,
    minNextBid: config.minBid,
  }

  await prisma.$transaction(async (tx) => {
    if (sold && winnerRosterId && amount > 0) {
      const budgets = getBudgetsFromSession(session)
      const newBudgets = { ...budgets }
      newBudgets[winnerRosterId] = Math.max(0, (budgets[winnerRosterId] ?? 0) - amount)

      const winnerEntry = slotOrder.find((e) => e.rosterId === winnerRosterId)
      const overall = picksCount + 1
      const round = Math.ceil(overall / teamCount)
      const slot = ((overall - 1) % teamCount) + 1

      await (tx as any).draftPick.create({
        data: {
          sessionId: session.id,
          sportType: (session as any).sportType ?? null,
          overall,
          round,
          slot,
          rosterId: winnerRosterId,
          displayName: winnerEntry?.displayName ?? null,
          playerName: nomination.playerName,
          position: nomination.position,
          team: nomination.team ?? null,
          byeWeek: nomination.byeWeek ?? null,
          playerId: nomination.playerId ?? null,
          source: 'user',
          amount,
        },
      })

      await (tx as any).draftSession.update({
        where: { id: session.id },
        data: {
          auctionState: nextAuctionState as any,
          auctionBudgets: newBudgets,
          timerEndAt: nextNominationTimerEndAt,
          pausedRemainingSeconds: null,
          status: shouldCompleteAfterResolution ? 'completed' : 'in_progress',
          version: { increment: 1 },
          updatedAt: new Date(),
        },
      })
    } else {
      await (tx as any).draftSession.update({
        where: { id: session.id },
        data: {
          auctionState: nextAuctionState as any,
          timerEndAt: nextNominationTimerEndAt,
          pausedRemainingSeconds: null,
          status: shouldCompleteAfterResolution ? 'completed' : 'in_progress',
          version: { increment: 1 },
          updatedAt: new Date(),
        },
      })
    }
  })

  if (sold && winnerRosterId && amount > 0 && nomination) {
    void tryAssignAuctionContract(
      leagueId,
      winnerRosterId,
      nomination.playerId ?? null,
      nomination.playerName,
      nomination.position,
      amount
    )
  }

  return {
    success: true,
    sold,
    winnerRosterId: winnerRosterId ?? undefined,
    amount: amount > 0 ? amount : undefined,
  }
}

// ── Distributed-lock public wrappers ─────────────────────────────────────────
// Each auction mutation acquires a per-league Redis/Postgres lock before
// executing the JSON read-modify-write sequence so concurrent bids and
// nominations on separate Vercel instances can't silently overwrite each other.
//
// Fail-open: if both lock layers are unavailable, the core function runs
// anyway — the Prisma transaction inside resolveAuctionWin is the last guard.

/**
 * Nominate a player for auction. Serialised by per-league auction lock.
 */
export async function nominatePlayer(
  leagueId: string,
  nomination: AuctionNomination,
  nominatorRosterId: string
): Promise<{ success: boolean; error?: string; code?: 'ROSTER_CONFIGURATION_INCOMPLETE' }> {
  const result = await withAuctionLock(leagueId, () =>
    _nominatePlayerCore(leagueId, nomination, nominatorRosterId)
  )
  if (!result.acquired) {
    logStructured('warn', 'auction_engine', 'nomination_lock_contended', { leagueId })
    return { success: false, error: 'Auction busy; another action is in progress. Please retry.' }
  }
  return result.value
}

/**
 * Place an auction bid. Serialised by per-league auction lock.
 */
export async function placeBid(
  leagueId: string,
  rosterId: string,
  amount: number
): Promise<{ success: boolean; error?: string; code?: 'ROSTER_CONFIGURATION_INCOMPLETE' }> {
  const result = await withAuctionLock(leagueId, () =>
    _placeBidCore(leagueId, rosterId, amount)
  )
  if (!result.acquired) {
    logStructured('warn', 'auction_engine', 'bid_lock_contended', { leagueId, rosterId })
    return { success: false, error: 'Auction busy; another action is in progress. Please retry.' }
  }
  return result.value
}

/**
 * Resolve the current auction (assign player to high bidder). Serialised by per-league auction lock.
 */
export async function resolveAuctionWin(
  leagueId: string,
  options?: ResolveAuctionOptions
): Promise<{ success: boolean; error?: string; sold?: boolean; winnerRosterId?: string; amount?: number }> {
  const result = await withAuctionLock(leagueId, () =>
    _resolveAuctionWinCore(leagueId, options)
  )
  if (!result.acquired) {
    logStructured('warn', 'auction_engine', 'resolve_lock_contended', { leagueId })
    return { success: false, error: 'Auction busy; another action is in progress. Please retry.' }
  }
  return result.value
}

// ── Salary cap: assign contract when auction bid wins ────────────────────────
// Called outside the transaction so a contract write failure never rolls back the pick.
async function tryAssignAuctionContract(
  leagueId: string,
  rosterId: string,
  playerId: string | null,
  playerName: string,
  position: string,
  salary: number
): Promise<void> {
  try {
    const capConfig = await getSalaryCapConfig(leagueId)
    if (!capConfig) return
    // Only auto-assign for startup auction drafts (not future snake drafts)
    if (capConfig.startupDraftType !== 'auction') return
    await processWinningContractBid(
      leagueId,
      {
        rosterId,
        playerId: playerId ?? `auction-${Date.now()}`,
        salary,
        years: capConfig.rookieContractYears,
      },
      playerName,
      position
    )
  } catch (err) {
    console.error('[salary-cap] tryAssignAuctionContract failed', {
      leagueId,
      error: String(err),
    })
  }
}

/**
 * Initialize auction state and budgets when starting an auction draft.
 */
export async function initializeAuctionForSession(leagueId: string): Promise<boolean> {
  const session = await prisma.draftSession.findFirst({ where: { leagueId }, orderBy: CURRENT_DRAFT_SESSION_ORDER })
  if (!session || session.draftType !== 'auction') return false

  const slotOrder = (session.slotOrder as unknown as SlotOrderEntry[]) ?? []
  const budgetPerTeam = session.auctionBudgetPerTeam ?? DEFAULT_BUDGET
  const config = getAuctionConfigFromSession(session)
  const budgets: AuctionBudgets = {}
  for (const entry of slotOrder) {
    budgets[entry.rosterId] = budgetPerTeam
  }
  const nominationWindowEndAt = computeTimerEndAt(config.bidTimerSeconds)

  const initialAuctionState: AuctionState = {
    nominationOrderIndex: 0,
    currentNomination: null,
    currentBid: 0,
    currentBidderRosterId: null,
    bidTimerEndAt: nominationWindowEndAt.toISOString(),
    minNextBid: DEFAULT_MIN_BID,
  }

  await prisma.draftSession.update({
    where: { id: session.id },
    data: {
      auctionBudgets: budgets as any,
      auctionState: initialAuctionState as any,
      timerEndAt: nominationWindowEndAt,
      pausedRemainingSeconds: null,
      version: { increment: 1 },
      updatedAt: new Date(),
    },
  })
  return true
}
