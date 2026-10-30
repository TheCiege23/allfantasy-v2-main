import { loadRookieAuctionAvailability } from './rookieAuctionAvailability'
import { planRookieAuction, type RookieAuctionTrade } from './rookieAuctionPickPolicy'
import { parseRookieAuctionSettings } from './rookieAuctionSettings'
import { seasonDraftSessionError } from '@/lib/tournament/seasonDraftBoard'
import { completeSeasonDraft } from '@/lib/tournament/seasonDraftCompletion'
import { prepareSeasonDraftPool } from '@/lib/tournament/seasonDraftRefresh'
import { isLeagueRosterDraftReady } from '@/lib/league/league-roster-draft-gate'
import { loadSeasonDraftContext, validateSeasonDraftPlayer } from '@/lib/tournament/seasonDraftRuntime'
import { nextSeasonNominator } from '@/lib/tournament/seasonAuctionPolicy'
import { seasonAuctionBidDeadline } from '@/lib/tournament/seasonDraftPolicy'
import type { SeasonRules } from '@/lib/tournament/seasonRules'
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
import { recordArchiveEvent, updateSessionWithArchive, json } from '@/lib/draft-archive/events'
import { isEligibleForPlayerPool, isRookieRestrictedPlayerPool, resolveServerRookieStatus } from '@/lib/live-draft-engine/serverRookieStatus'

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
  nominationClockSeconds?: number
  bidExtensionSeconds?: number
}

export function getAuctionConfigFromSession(session: {
  auctionBudgetPerTeam?: number | null
  timerSeconds?: number | null
}, policy?: SeasonRules['draftPolicy']): AuctionConfig {
  return {
    budgetPerTeam: policy?.auctionBudget ?? session.auctionBudgetPerTeam ?? DEFAULT_BUDGET,
    minBid: policy?.minimumBid ?? DEFAULT_MIN_BID,
    minBidIncrement: DEFAULT_MIN_INCREMENT,
    bidTimerSeconds: policy?.nominationClockSeconds ?? session.timerSeconds ?? DEFAULT_BID_TIMER_SECONDS,
    ...(policy ? { nominationClockSeconds: policy.nominationClockSeconds, bidExtensionSeconds: policy.bidExtensionSeconds } : {}),
  }
}

export async function getAuctionConfigForLeague(leagueId: string, session: Parameters<typeof getAuctionConfigFromSession>[0]) {
  const season = await loadSeasonDraftContext(leagueId)
  return getAuctionConfigFromSession(session, season?.config.rules?.draftPolicy)
}

export function getAuctionStateFromSession(session: {
  auctionState?: unknown
}): AuctionState | null {
  const raw = session.auctionState
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  return {
    nominationOrderIndex: Number(o.nominationOrderIndex ?? 0),
    ...(Array.isArray(o.nominationOrder) ? { nominationOrder: o.nominationOrder as SlotOrderEntry[] } : {}),
    ...(Number.isInteger(o.nominationFallbackStart) ? { nominationFallbackStart: Number(o.nominationFallbackStart) } : {}),
    ...(o.rookieAuction ? { rookieAuction: o.rookieAuction } : {}),
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

/** The persisted first-pass nominations are followed by the regular repeating rotation. */
export function getAuctionNominationOrder(slotOrder: SlotOrderEntry[], state: AuctionState | null): SlotOrderEntry[] {
  return state?.nominationOrder?.length ? state.nominationOrder : slotOrder
}

export function advanceAuctionNominationIndex(state: AuctionState, orderLength: number): number {
  const next = Math.max(0, Math.floor(state.nominationOrderIndex)) + 1
  if (next < orderLength) return next
  const fallback = state.nominationFallbackStart
  return Number.isInteger(fallback) && fallback! >= 0 && fallback! < orderLength ? fallback! : 0
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
  nominatorRosterId: string,
  options?: { autoMinimumBid?: boolean }
): Promise<{ success: boolean; error?: string; code?: 'ROSTER_CONFIGURATION_INCOMPLETE' }> {
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
  const config = await getAuctionConfigForLeague(leagueId, session)
  const season = await loadSeasonDraftContext(leagueId)
  if (season && seasonDraftSessionError(season, session)) return { success: false, error: 'The auction session differs from its frozen tournament rules.' }
  if (season && options?.autoMinimumBid && !timerHasExpired(session.timerEndAt, new Date())) return { success: false, error: 'The nomination clock has not expired.' }
  const nominationOrder = getAuctionNominationOrder(slotOrder, state)
  const nominationIndex = season ? nextSeasonNominator(slotOrder, state?.nominationOrderIndex ?? 0, session.picks, session.rounds, getBudgetsFromSession(session), config.minBid) : normalizeNominationIndex(state?.nominationOrderIndex ?? 0, nominationOrder.length)
  if (nominationIndex === null) return { success: false, error: 'No eligible nominator remains. Review roster and budget readiness.' }
  const currentNominator = nominationOrder[nominationIndex]
  if (!currentNominator || currentNominator.rosterId !== nominatorRosterId) {
    return { success: false, error: 'You are not the current nominator' }
  }
  if (state?.currentNomination) {
    return { success: false, error: 'A player is already on the block' }
  }

  if (session.draftModeLabel === 'rookie') {
    const available = await loadRookieAuctionAvailability(leagueId)
    if (!available(nomination)) return { success: false, error: 'This player is already on a league roster.' }
  }
  if (isRookieRestrictedPlayerPool(session.playerPool)) {
    const rookie = await resolveServerRookieStatus({ leagueId, playerId: nomination.playerId, playerName: nomination.playerName })
    if (!isEligibleForPlayerPool(session.playerPool, rookie)) return { success: false, error: 'That player is not eligible for this draft pool.' }
  }
  const seasonError = await validateSeasonDraftPlayer(leagueId, season && options?.autoMinimumBid ? nominatorRosterId : null, session.picks, nomination)
  if (seasonError) return { success: false, error: seasonError }
  const playerName = nomination.playerName?.trim()
  if (!playerName) return { success: false, error: 'Player name required' }

  const existingNames = new Set(
    session.picks.map((p) => p.playerName.trim().toLowerCase())
  )
  if (existingNames.has(playerName.toLowerCase())) {
    return { success: false, error: 'Player already drafted' }
  }

  const bidTimerEndAt = computeTimerEndAt(config.bidTimerSeconds)
  const openingBid = season && options?.autoMinimumBid ? config.minBid : 0
  if (openingBid && !canPlaceAuctionBid({ budget: getBudgetsFromSession(session)[nominatorRosterId] ?? 0, bid: openingBid, rosterSlotsRemaining: session.rounds - session.picks.filter(p => p.rosterId === nominatorRosterId && p.playerName.trim()).length, minimumBid: config.minBid })) return { success: false, error: 'The automatic nomination cannot reserve a minimum bid.' }
  const minNextBid = openingBid ? openingBid + config.minBidIncrement : config.minBid

  const newState: AuctionState = {
    ...state,
    nominationOrderIndex: nominationIndex,
    currentNomination: {
      playerName,
      position: nomination.position ?? '',
      team: nomination.team ?? null,
      playerId: nomination.playerId ?? null,
      byeWeek: nomination.byeWeek ?? null,
    },
    currentBid: openingBid,
    currentBidderRosterId: openingBid ? nominatorRosterId : null,
    bidTimerEndAt: bidTimerEndAt.toISOString(),
    minNextBid,
  }

  const write = {
    where: { id: session.id },
    data: {
      auctionState: newState as any,
      timerEndAt: bidTimerEndAt,
      pausedRemainingSeconds: null,
      version: { increment: 1 },
      updatedAt: new Date(),
    },
  }
  if (season) {
    const changed = await prisma.$transaction(async tx => {
      const claim = await tx.draftSession.updateMany({ ...write, where: { id: session.id, version: session.version, status: 'in_progress' } })
      if (claim.count === 1) await recordArchiveEvent(tx, session, 'auction_nomination', { nomination: newState.currentNomination, nominatorRosterId })
      return claim
    })
    if (changed.count !== 1) return { success: false, error: 'Auction changed. Reload and retry.' }
  } else await updateSessionWithArchive(session, write.data, 'auction_nomination', { nomination: newState.currentNomination, nominatorRosterId })

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
  if (!Number.isSafeInteger(amount) || amount < 1) return { success: false, error: 'Auction bids must be positive whole dollars.' }
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

  const seasonError = await validateSeasonDraftPlayer(leagueId, rosterId, session.picks, state.currentNomination)
  if (seasonError) return { success: false, error: seasonError }
  const config = await getAuctionConfigForLeague(leagueId, session)
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

  const bidTimerEndAt = config.bidExtensionSeconds ? new Date(seasonAuctionBidDeadline(session.timerEndAt?.getTime() ?? NaN, Date.now(), config.bidExtensionSeconds)) : computeTimerEndAt(config.bidTimerSeconds)
  const newState: AuctionState = {
    ...state,
    currentBid: amount,
    currentBidderRosterId: rosterId,
    bidTimerEndAt: bidTimerEndAt.toISOString(),
    minNextBid: amount + config.minBidIncrement,
  }

  const write = {
    where: { id: session.id },
    data: {
      auctionState: newState as any,
      timerEndAt: bidTimerEndAt,
      pausedRemainingSeconds: null,
      version: { increment: 1 },
      updatedAt: new Date(),
    },
  }
  const season = await loadSeasonDraftContext(leagueId)
  if (season && seasonDraftSessionError(season, session)) return { success: false, error: 'The auction session differs from its frozen tournament rules.' }
  if (season) {
    const changed = await prisma.$transaction(async tx => {
      const claim = await tx.draftSession.updateMany({ ...write, where: { id: session.id, version: session.version, status: 'in_progress', timerEndAt: { gt: new Date() } } })
      if (claim.count === 1) await recordArchiveEvent(tx, session, 'auction_bid', { rosterId, amount })
      return claim
    })
    if (changed.count !== 1) return { success: false, error: 'Auction changed or bidding expired. Reload and retry.' }
  } else await updateSessionWithArchive(session, write.data, 'auction_bid', { rosterId, amount })

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
  const season = await loadSeasonDraftContext(leagueId)
  if (season && seasonDraftSessionError(season, session)) return { success: false, error: 'The auction session differs from its frozen tournament rules.' }
  const force = !season && Boolean(options?.force)
  if (!force && !timerHasExpired(session.timerEndAt, now)) {
    return { success: false, error: 'Bid timer has not expired yet' }
  }

  const config = await getAuctionConfigForLeague(leagueId, session)
  const teamCount = session.teamCount
  const totalPicks = session.rounds * teamCount
  const picksCount = season ? session.picks.filter(p => p.playerName.trim() && p.position.trim()).length : session.picks.length

  let winnerRosterId = state.currentBidderRosterId
  let amount = state.currentBid
  if (winnerRosterId && amount > 0) {
    const budgets = getBudgetsFromSession(session)
    const winnerBudget = budgets[winnerRosterId] ?? 0
    const winnerPicks = session.picks.filter((pick) => pick.rosterId === winnerRosterId).length
    const rosterSlotsRemaining = getTeamRosterSlotsRemaining(winnerPicks, session.rounds)
    const seasonError = await validateSeasonDraftPlayer(leagueId, winnerRosterId, session.picks, state.currentNomination)
    if (seasonError) return { success: false, error: seasonError }
    const stillValid = Number.isSafeInteger(amount) && canPlaceAuctionBid({
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

  if (winnerRosterId && session.draftModeLabel === 'rookie') {
    const available = await loadRookieAuctionAvailability(leagueId)
    if (!available(state.currentNomination)) return { success: false, error: 'This player is already on a league roster.' }
  }

  if (winnerRosterId && isRookieRestrictedPlayerPool(session.playerPool)) {
    const rookie = await resolveServerRookieStatus({ leagueId, playerId: state.currentNomination.playerId, playerName: state.currentNomination.playerName })
    if (!isEligibleForPlayerPool(session.playerPool, rookie)) return { success: false, error: 'That player is not eligible for this draft pool.' }
  }

  const sold = Boolean(winnerRosterId && amount > 0)
  const shouldCompleteAfterResolution = picksCount + (sold ? 1 : 0) >= totalPicks
  const nomination = state.currentNomination
  const nominationOrder = getAuctionNominationOrder(slotOrder, state)
  const nominationIndex = normalizeNominationIndex(state.nominationOrderIndex, nominationOrder.length)
  const nextBudgets = { ...getBudgetsFromSession(session) }
  if (sold && winnerRosterId) nextBudgets[winnerRosterId] = (nextBudgets[winnerRosterId] ?? 0) - amount
  const futurePicks = sold && winnerRosterId ? [...session.picks, { rosterId: winnerRosterId, playerName: nomination.playerName, position: nomination.position }] : session.picks
  const nextNominationIndex = season ? nextSeasonNominator(slotOrder, nominationIndex + 1, futurePicks, session.rounds, nextBudgets, config.minBid) : advanceAuctionNominationIndex({ ...state, nominationOrderIndex: nominationIndex }, nominationOrder.length)
  if (!shouldCompleteAfterResolution && nextNominationIndex === null) return { success: false, error: 'No eligible nominator remains. Review roster and budget readiness.' }
  const nextNominationTimerEndAt = shouldCompleteAfterResolution
    ? null
    : computeTimerEndAt(config.bidTimerSeconds, now)
  const nextAuctionState: AuctionState = {
    ...state,
    nominationOrderIndex: nextNominationIndex ?? 0,
    currentNomination: null,
    currentBid: 0,
    currentBidderRosterId: null,
    bidTimerEndAt: nextNominationTimerEndAt?.toISOString() ?? null,
    minNextBid: config.minBid,
  }

  try { await prisma.$transaction(async (tx) => {
    if (season) {
      const claimed = await tx.draftSession.updateMany({ where: { id: session.id, version: session.version, status: 'in_progress', timerEndAt: { lte: now } }, data: { version: { increment: 1 } } })
      if (claimed.count !== 1) throw new Error('SEASON_AUCTION_STALE')
    }
    if (sold && winnerRosterId && amount > 0) {
      const budgets = getBudgetsFromSession(session)
      const newBudgets = { ...budgets }
      newBudgets[winnerRosterId] = Math.max(0, (budgets[winnerRosterId] ?? 0) - amount)

      const winnerEntry = slotOrder.find((e) => e.rosterId === winnerRosterId)
      const overall = picksCount + 1
      const round = Math.ceil(overall / teamCount)
      const slot = ((overall - 1) % teamCount) + 1

      const archived = await recordArchiveEvent(tx, session, 'selection', { overall, nextOverall: overall + 1, winnerRosterId, amount }, now)
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
          pickedAt: now,
          pickMetadata: json({ archive: { eventId: archived.eventId, context: archived.context, timing: archived.selected, clockAllowanceSeconds: session.timerSeconds, selectionRosterId: winnerRosterId, auctionBudgetPerTeam: session.auctionBudgetPerTeam ?? DEFAULT_BUDGET, auctionEvidence: { version: 'auction-award-v1', capturedAt: now.toISOString(), rosterId: winnerRosterId, budgetBefore: budgets[winnerRosterId], slotsRemaining: getTeamRosterSlotsRemaining(session.picks.filter(p => p.rosterId === winnerRosterId).length, session.rounds), minimumBid: config.minBid } } }),
        },
      })

      await (tx as any).draftSession.update({
        where: { id: session.id },
        data: {
          auctionState: nextAuctionState as any,
          auctionBudgets: newBudgets,
          timerEndAt: nextNominationTimerEndAt,
          pausedRemainingSeconds: null,
          status: shouldCompleteAfterResolution && !season ? 'completed' : 'in_progress',
          ...(shouldCompleteAfterResolution && !season ? { completedAt: now } : {}),

          version: { increment: 1 },
          updatedAt: new Date(),
        },
      })
    } else {
      await recordArchiveEvent(tx, session, 'auction_pass', { nomination }, now)
      await (tx as any).draftSession.update({
        where: { id: session.id },
        data: {
          auctionState: nextAuctionState as any,
          timerEndAt: nextNominationTimerEndAt,
          pausedRemainingSeconds: null,
          status: shouldCompleteAfterResolution && !season ? 'completed' : 'in_progress',
          ...(shouldCompleteAfterResolution && !season ? { completedAt: now } : {}),

          version: { increment: 1 },
          updatedAt: new Date(),
        },
      })
    }
    if (shouldCompleteAfterResolution && !season) {
      await recordArchiveEvent(tx, { ...session, status: 'completed' }, 'complete', {}, now)
      const { applyPostDraftLifecycleInTransaction } = await import('@/server/services/leagueLifecycleService')
      await applyPostDraftLifecycleInTransaction(tx, leagueId)
    }
  }) } catch (error) {
    if (error instanceof Error && error.message === 'SEASON_AUCTION_STALE') return { success: false, error: 'Auction changed. Reload and retry.' }
    throw error
  }

  if (!season && shouldCompleteAfterResolution) {
    // The final sale is committed; the shared finalizer mirrors picks into the season rosters.
    try {
      const { runPostDraftFinalizationArtifacts } = await import('@/lib/live-draft-engine/postDraftFinalizeArtifacts')
      await runPostDraftFinalizationArtifacts(leagueId)
    } catch (error) {
      console.error('[auction] post-draft finalization pending', { leagueId, error: String(error) })
    }
  }

  if (season && shouldCompleteAfterResolution) {
    // Sale is already committed. Failed checkpoint remains recoverable through completion repair.
    try { await completeSeasonDraft(leagueId) } catch (error) { console.error('[seasonDraftCompletion] Auction checkpoint pending', error) }
  }


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
  nominatorRosterId: string,
  options?: { autoMinimumBid?: boolean }
): Promise<{ success: boolean; error?: string; code?: 'ROSTER_CONFIGURATION_INCOMPLETE' }> {
  const poolError = await prepareSeasonDraftPool(leagueId)
  if (poolError) return { success: false, error: poolError }
  const result = await withAuctionLock(leagueId, () =>
    _nominatePlayerCore(leagueId, nomination, nominatorRosterId, options)
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
  const poolError = await prepareSeasonDraftPool(leagueId)
  if (poolError) return { success: false, error: poolError }
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
  const poolError = await prepareSeasonDraftPool(leagueId)
  if (poolError) return { success: false, error: poolError }
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

/** Build the initial auction values for the same conditional write that starts the session. */
export async function buildInitialAuctionSessionUpdate(leagueId: string, session: {
  slotOrder?: unknown
  auctionBudgetPerTeam?: number | null
  timerSeconds?: number | null
  rounds?: number
  auctionState?: unknown
}) {
  const slotOrder = (session.slotOrder as unknown as SlotOrderEntry[]) ?? []
  const config = await getAuctionConfigForLeague(leagueId, session)
  const budgets: AuctionBudgets = {}
  for (const entry of slotOrder) budgets[entry.rosterId] = config.budgetPerTeam
  const saved = session.auctionState && typeof session.auctionState === 'object' ? (session.auctionState as Record<string, unknown>).rookieAuction : null
  let nominationOrder: SlotOrderEntry[] | undefined
  let nominationFallbackStart: number | undefined
  if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
    const raw = saved as Record<string, unknown>
    const parsed = parseRookieAuctionSettings(raw)
    if (!parsed.ok || !Array.isArray(raw.trades)) throw new Error('Rookie auction pick settings are invalid. Recreate the draft after resolving its settings.')
    const plan = planRookieAuction({ ...parsed.value, slotOrder, rounds: session.rounds ?? 0, trades: raw.trades as RookieAuctionTrade[] })
    Object.assign(budgets, plan.budgets)
    if (plan.policy === 'nominations') {
      nominationFallbackStart = plan.nominationOrder.length
      nominationOrder = [...plan.nominationOrder, ...slotOrder]
    }
  }
  const nominationWindowEndAt = computeTimerEndAt(config.bidTimerSeconds)
  const auctionState: AuctionState = {
    ...(saved ? { rookieAuction: saved } : {}),
    ...(nominationOrder ? { nominationOrder, nominationFallbackStart } : {}),
    nominationOrderIndex: 0,
    currentNomination: null,
    currentBid: 0,
    currentBidderRosterId: null,
    bidTimerEndAt: nominationWindowEndAt.toISOString(),
    minNextBid: config.minBid,
  }
  return { auctionBudgets: budgets as any, auctionState: auctionState as any, timerEndAt: nominationWindowEndAt, pausedRemainingSeconds: null }
}

/** Initialize an already-running tournament auction (or an explicit recovery initialization). */
export async function initializeAuctionForSession(leagueId: string): Promise<boolean> {
  const session = await prisma.draftSession.findFirst({ where: { leagueId }, orderBy: CURRENT_DRAFT_SESSION_ORDER })
  if (!session || session.draftType !== 'auction') return false
  const season = await loadSeasonDraftContext(leagueId)
  if (season && seasonDraftSessionError(season, session)) return false
  if (season && session.auctionState) return true
  const data = { ...(await buildInitialAuctionSessionUpdate(leagueId, session)), version: { increment: 1 }, updatedAt: new Date() }
  if (season) {
    const changed = await prisma.draftSession.updateMany({ where: { id: session.id, version: session.version, status: 'in_progress' }, data })
    return changed.count === 1
  }
  await prisma.draftSession.update({ where: { id: session.id }, data })
  return true
}
