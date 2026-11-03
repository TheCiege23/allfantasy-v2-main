import { loadRookieAuctionAvailability } from './rookieAuctionAvailability'
import { prepareSeasonDraftPool } from '@/lib/tournament/seasonDraftRefresh'
import { loadSeasonDraftContext, loadSeasonDraftPlayers } from '@/lib/tournament/seasonDraftRuntime'
import { nextSeasonNominator } from '@/lib/tournament/seasonAuctionPolicy'
import { selectSeasonAutodraft } from '@/lib/tournament/seasonDraftPolicy'
/**
 * Deterministic auction automation tick.
 * Handles timer-expiry resolution, optional auto-bid, and optional auto-nomination.
 */

import type { LeagueSport } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { DEFAULT_SPORT, normalizeToSupportedSport } from '@/lib/sport-scope'
import { getDraftUISettingsForLeague } from '@/lib/draft-defaults/DraftUISettingsResolver'
import { getOrphanRosterIdsForLeague } from '@/lib/orphan-ai-manager/orphanRosterResolver'
import { isChimmyRunning } from '@/lib/inactive-manager/inactiveManagerMode'
import { readPlayableChimmyLineups } from '@/lib/inactive-manager/chimmyPlayable'
import { canPlaceAuctionBid } from '@/lib/mock-draft/draft-engine'
import { getLiveADP } from '@/lib/adp-data'
import { getPlayerPoolForLeague } from '@/lib/sport-teams/SportPlayerPoolResolver'
import { appendPickToRosterDraftSnapshot } from '@/lib/live-draft-engine/RosterAssignmentService'
import type { AuctionNomination, SlotOrderEntry } from '@/lib/live-draft-engine/types'
import {
  getAuctionConfigForLeague,
  getAuctionStateFromSession,
  getAuctionNominationOrder,
  getBudgetsFromSession,
  nominatePlayer,
  placeBid,
  resolveAuctionWin,
} from './AuctionEngine'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'
import { isEligibleForPlayerPool, isRookieRestrictedPlayerPool, loadServerRookieStatusResolver } from '@/lib/live-draft-engine/serverRookieStatus'

export type AuctionAutomationAction =
  | { type: 'auto_bid'; rosterId: string; amount: number }
  | { type: 'auto_resolve'; sold: boolean; winnerRosterId?: string; amount?: number }
  | { type: 'auto_nominate'; rosterId: string; playerName: string; position: string }

export type AuctionAutomationTickResult = {
  changed: boolean
  actions: AuctionAutomationAction[]
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase()
}

function normalizeNominationIndex(index: number, slotOrderLength: number): number {
  if (slotOrderLength <= 0) return 0
  const safe = Number.isFinite(index) ? Math.floor(index) : 0
  return ((safe % slotOrderLength) + slotOrderLength) % slotOrderLength
}

function isExpired(timerEndAt: Date | null | undefined, now: Date): boolean {
  return Boolean(timerEndAt && timerEndAt.getTime() <= now.getTime())
}

function dedupeNominationKey(playerName: string, position: string): string {
  return `${normalizeName(playerName)}|${String(position || '').trim().toUpperCase()}`
}

async function loadAutoNominationCandidates(
  leagueId: string,
  sport: LeagueSport,
  draftedNames: Set<string>
): Promise<AuctionNomination[]> {
  const candidates: AuctionNomination[] = []
  const seen = new Set<string>()
  const push = (candidate: AuctionNomination | null | undefined) => {
    if (!candidate?.playerName || !candidate?.position) return
    const nameKey = normalizeName(candidate.playerName)
    if (!nameKey || draftedNames.has(nameKey)) return
    const key = dedupeNominationKey(candidate.playerName, candidate.position)
    if (seen.has(key)) return
    seen.add(key)
    candidates.push({
      playerName: candidate.playerName.trim(),
      position: candidate.position.trim().toUpperCase(),
      team: candidate.team ?? null,
      playerId: candidate.playerId ?? null,
      byeWeek: candidate.byeWeek ?? null,
    })
  }

  if (sport === 'NFL') {
    const adp = await getLiveADP('redraft', 300).catch(() => [])
    for (const entry of adp) {
      push({
        playerName: String(entry.name ?? ''),
        position: String(entry.position ?? ''),
        team: entry.team ?? null,
        playerId: null,
        byeWeek: entry.bye ?? null,
      })
    }
  }

  const pool = await getPlayerPoolForLeague(leagueId, sport, { limit: 500 }).catch(() => [])
  for (const player of pool) {
    push({
      playerName: String(player.full_name ?? ''),
      position: String(player.position ?? ''),
      team: player.team_abbreviation ?? null,
      playerId: player.external_source_id ?? player.player_id ?? null,
      byeWeek: null,
    })
  }

  return candidates
}

async function appendLatestAuctionPickToRoster(
  leagueId: string,
  sessionId: string,
  winnerRosterId: string
): Promise<void> {
  const latestPick = await prisma.draftPick.findFirst({
    where: { sessionId },
    orderBy: { overall: 'desc' },
    select: {
      playerName: true,
      position: true,
      team: true,
      playerId: true,
      byeWeek: true,
    },
  })
  if (!latestPick) return
  await appendPickToRosterDraftSnapshot(leagueId, winnerRosterId, {
    playerName: latestPick.playerName,
    position: latestPick.position,
    team: latestPick.team ?? null,
    playerId: latestPick.playerId ?? null,
    byeWeek: latestPick.byeWeek ?? null,
  }).catch(() => {})
}

/**
 * Run one deterministic automation pass for auction drafts.
 * Safe to call on every poll/reconnect; when no condition is met it is a no-op.
 */
/** Whether Chimmy runs this roster for its current owner (an empty seat or an absent manager's team). */
async function chimmyRunsRoster(leagueId: string, rosterId: string): Promise<boolean> {
  const [league, roster] = await Promise.all([
    prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true, userId: true } }),
    prisma.roster.findFirst({ where: { id: rosterId, leagueId }, select: { platformUserId: true } }),
  ])
  if (!league || !roster) return false
  return isChimmyRunning(await readPlayableChimmyLineups(league), rosterId, roster.platformUserId ?? null)
}

export async function runAuctionAutomationTick(leagueId: string): Promise<AuctionAutomationTickResult> {
  const actions: AuctionAutomationAction[] = []
  const now = new Date()

  const session = await prisma.draftSession.findFirst({
    where: { leagueId },
    orderBy: CURRENT_DRAFT_SESSION_ORDER,
    include: { picks: { orderBy: { overall: 'asc' } }, league: { select: { sport: true } } },
  })
  if (!session || session.draftType !== 'auction' || session.status !== 'in_progress') {
    return { changed: false, actions }
  }

  const state = getAuctionStateFromSession(session)
  if (!state) return { changed: false, actions }

  const slotOrder = (session.slotOrder as unknown as SlotOrderEntry[]) ?? []
  if (slotOrder.length === 0) return { changed: false, actions }

  const uiSettings = await getDraftUISettingsForLeague(leagueId)
  const config = await getAuctionConfigForLeague(leagueId, session)
  const budgets = getBudgetsFromSession(session)
  const season = await loadSeasonDraftContext(leagueId)
  if (season && await prepareSeasonDraftPool(leagueId)) return { changed: false, actions }
  const nominationOrder = getAuctionNominationOrder(slotOrder, state)
  const nominationIndex = season ? nextSeasonNominator(slotOrder, state.nominationOrderIndex, session.picks, session.rounds, budgets, config.minBid) : normalizeNominationIndex(state.nominationOrderIndex, nominationOrder.length)
  const currentNominator = nominationIndex === null ? undefined : nominationOrder[nominationIndex]
  const orphanRosterIds = uiSettings.orphanTeamAiManagerEnabled
    ? await getOrphanRosterIdsForLeague(leagueId)
    : []
  const nominatorIsOrphan = currentNominator != null && orphanRosterIds.includes(currentNominator.rosterId)
  /*
   * A team Chimmy manages (lib/inactive-manager, up to 4 per league) acts in an auction whatever the
   * orphan-AI setting says: nobody else will nominate or bid for it. It nominates as soon as it is its
   * turn, like a snake-draft Chimmy pick, rather than letting the nomination clock run down.
   */
  const nominatorIsChimmy = currentNominator != null && await chimmyRunsRoster(leagueId, currentNominator.rosterId)

  // Tournament expiry preserves the winning bid; no synthetic late bids.
  if (state.currentNomination && isExpired(session.timerEndAt, now)) {
    if (!season && state.currentBid <= 0 && currentNominator && (uiSettings.autoPickEnabled || nominatorIsChimmy)) {
      const nominatorBudget = budgets[currentNominator.rosterId] ?? 0
      const nominatorPicks = session.picks.filter((pick) => pick.rosterId === currentNominator.rosterId).length
      const rosterSlotsRemaining = Math.max(0, session.rounds - nominatorPicks)
      const autoBidAmount = config.minBid
      const canAutoBid = canPlaceAuctionBid({
        budget: nominatorBudget,
        bid: autoBidAmount,
        rosterSlotsRemaining,
        minimumBid: config.minBid,
      })
      if (canAutoBid) {
        const autoBid = await placeBid(leagueId, currentNominator.rosterId, autoBidAmount)
        if (autoBid.success) {
          actions.push({
            type: 'auto_bid',
            rosterId: currentNominator.rosterId,
            amount: autoBidAmount,
          })
        }
      }
    }

    const resolve = await resolveAuctionWin(leagueId, { now })
    if (resolve.success) {
      if (resolve.sold && resolve.winnerRosterId) {
        await appendLatestAuctionPickToRoster(leagueId, session.id, resolve.winnerRosterId)
      }
      actions.push({
        type: 'auto_resolve',
        sold: Boolean(resolve.sold),
        winnerRosterId: resolve.winnerRosterId,
        amount: resolve.amount,
      })
    }
    return { changed: actions.length > 0, actions }
  }

  // No active nomination: optional auto-nomination when nomination clock expires.
  const autoNominationAllowed =
    Boolean(season) || uiSettings.auctionAutoNominationEnabled || nominatorIsChimmy ||
    (uiSettings.orphanTeamAiManagerEnabled && nominatorIsOrphan)
  const nominateNow = isExpired(session.timerEndAt, now) || nominatorIsChimmy
  if (!state.currentNomination && autoNominationAllowed && nominateNow && currentNominator) {
    const normalizedSport = normalizeToSupportedSport(
      (session.league?.sport as string | null | undefined) ?? session.sportType ?? DEFAULT_SPORT
    ) as LeagueSport
    const draftedNames = new Set(session.picks.map((pick) => normalizeName(pick.playerName)))
    let first: AuctionNomination | undefined
    if (season) {
      const pool = await loadSeasonDraftPlayers(leagueId, season.config.sport)
      const taken = new Set(pool.filter(p => draftedNames.has(normalizeName(p.playerName))).map(p => p.playerId))
      const own = session.picks.filter(p => p.rosterId === currentNominator.rosterId && p.playerName.trim() && p.position.trim()).map(p => ({ playerId: p.playerId ?? '', playerName: p.playerName, position: p.position }))
      const selected = selectSeasonAutodraft(season.config, own, pool, taken)
      first = selected ? {
        playerName: selected.playerName,
        position: selected.position,
        team: selected.team ?? null,
        playerId: selected.playerId,
        byeWeek: null,
      } : undefined
    } else {
      const candidates = await loadAutoNominationCandidates(leagueId, normalizedSport, draftedNames)
      const resolve = isRookieRestrictedPlayerPool(session.playerPool) ? await loadServerRookieStatusResolver(leagueId) : null
      const available = session.draftModeLabel === 'rookie' ? await loadRookieAuctionAvailability(leagueId) : () => true
      first = candidates.find(candidate => available(candidate) && isEligibleForPlayerPool(session.playerPool, resolve?.({ playerId: candidate.playerId, playerName: candidate.playerName }) ?? null))
    }
    if (!first) return { changed: false, actions }

    const nominate = await nominatePlayer(leagueId, first, currentNominator.rosterId, season ? { autoMinimumBid: true } : undefined)
    if (nominate.success) {
      actions.push({
        type: 'auto_nominate',
        rosterId: currentNominator.rosterId,
        playerName: first.playerName,
        position: first.position,
      })
    }
  }

  return { changed: actions.length > 0, actions }
}
