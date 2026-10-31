import 'server-only'

/**
 * AUTO DRAFT: the computer drafts every seat until the board is full.
 *
 * An "auto" draft is a commissioner's instruction at creation (execution mode `auto`, read by
 * DraftUISettingsResolver from `requested_draft_type`). Until now the room still waited on a
 * 90-second clock per pick, so a 20-team, 15-round Survivor draft took five hours of nobody
 * clicking. This fills the board with best-available picks in bounded bursts from the draft tick,
 * then finishes the draft through `completeDraftSession`, so rosters, the season and the Survivor
 * setup (tribes, idols, chats) follow exactly as after a live room.
 *
 * Every pick goes through the same `submitPick` path the expired-timer autopick uses, with the
 * expected overall pinned, so a browser in the room and this loop can never double-draft a slot.
 */

import { prisma } from '@/lib/prisma'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'
import { getDraftUISettingsForLeague } from '@/lib/draft-defaults/DraftUISettingsResolver'
import { isLeagueRosterDraftReady } from '@/lib/league/league-roster-draft-gate'
import { invalidateLeagueDraftCaches } from '@/lib/league/invalidateLeagueDraftCaches'
import { resolveCurrentOnTheClock } from '@/lib/live-draft-engine/CurrentOnTheClockResolver'
import { resolvePickOwner } from '@/lib/live-draft-engine/PickOwnershipResolver'
import { submitBestAvailableAutopickForExpiredTimer } from '@/lib/live-draft-engine/autopickBestAvailableSubmit'
import { appendPickToRosterDraftSnapshot } from '@/lib/live-draft-engine/RosterAssignmentService'
import { completeDraftSession } from '@/lib/live-draft-engine/DraftSessionService'

type SlotOrderEntry = { slot: number; rosterId: string; displayName: string }
type TradedPickRecord = { round: number; originalRosterId: string; previousOwnerName: string; newRosterId: string; newOwnerName: string }

export type AutoDraftFillOutcome = {
  leagueId: string
  /** Picks this call made. */
  picks: number
  /** The draft finished (board full and `completeDraftSession` succeeded), now or earlier. */
  completed: boolean
  /** Why the loop stopped. */
  stopped:
    | 'board_full'
    | 'complete_refused'
    | 'budget'
    | 'not_auto'
    | 'roster_configuration_incomplete'
    | 'no_session'
    | 'sleeper_mirrored'
    | 'auction'
    | 'no_pool'
    | 'submit_failed'
    | `status_${string}`
}

export interface FillAutoDraftBoardOptions {
  /** Picks this call may make before yielding (the next tick continues). */
  maxPicks?: number
  /** Epoch ms after which no further pick is started. */
  deadlineAt?: number
}

/** Fill one league's auto draft until the board is full, a budget is spent, or something refuses. */
export async function fillAutoDraftBoard(leagueId: string, opts: FillAutoDraftBoardOptions = {}): Promise<AutoDraftFillOutcome> {
  const maxPicks = Math.max(1, Math.trunc(opts.maxPicks ?? 400))
  const deadlineAt = opts.deadlineAt ?? Date.now() + 45_000
  let picks = 0
  const stop = (stopped: AutoDraftFillOutcome['stopped'], completed = false): AutoDraftFillOutcome => ({ leagueId, picks, completed, stopped })

  const ui = await getDraftUISettingsForLeague(leagueId)
  if (ui.executionMode !== 'auto') return stop('not_auto')
  if (!(await isLeagueRosterDraftReady(leagueId))) return stop('roster_configuration_incomplete')

  while (picks < maxPicks) {
    const session = await prisma.draftSession.findFirst({
      where: { leagueId },
      orderBy: CURRENT_DRAFT_SESSION_ORDER,
      include: { picks: { orderBy: { overall: 'asc' } } },
    })
    if (!session) return stop('no_session')
    if (session.sleeperDraftId) return stop('sleeper_mirrored')
    if (session.status !== 'in_progress') return stop(`status_${session.status}`, session.status === 'completed')
    if (session.draftType === 'auction') return stop('auction')

    const slotOrder = (session.slotOrder as unknown as SlotOrderEntry[]) ?? []
    const tradedPicks = Array.isArray(session.tradedPicks) ? (session.tradedPicks as unknown as TradedPickRecord[]) : []
    const totalPicks = session.rounds * session.teamCount
    const current = resolveCurrentOnTheClock({
      totalPicks,
      picks: session.picks.map((p) => ({
        overall: p.overall,
        playerName: p.playerName,
        position: p.position,
        pickMetadata: (p as { pickMetadata?: unknown | null }).pickMetadata ?? null,
      })),
      teamCount: session.teamCount,
      draftType: session.draftType as 'snake' | 'linear' | 'auction',
      thirdRoundReversal: session.thirdRoundReversal,
      slotOrder,
    })
    if (!current) {
      // Board full: finish through the one path that runs every post-draft hook.
      const completed = await completeDraftSession(leagueId)
      invalidateLeagueDraftCaches(leagueId)
      return stop(completed ? 'board_full' : 'complete_refused', completed)
    }
    if (Date.now() >= deadlineAt) {
      invalidateLeagueDraftCaches(leagueId)
      return stop('budget')
    }

    const owner = resolvePickOwner(current.round, current.slot, slotOrder, tradedPicks)
    const rosterId = owner?.rosterId ?? current.rosterId
    const result = await submitBestAvailableAutopickForExpiredTimer(leagueId, rosterId, current.overall)
    if (!result.ok) {
      invalidateLeagueDraftCaches(leagueId)
      return stop(result.error)
    }
    picks += 1
    await appendPickToRosterDraftSnapshot(leagueId, rosterId, {
      playerName: result.pick.playerName,
      position: result.pick.position,
      team: result.pick.team ?? null,
      playerId: result.pick.playerId ?? null,
      byeWeek: result.pick.byeWeek ?? null,
    }).catch(() => {})
  }
  invalidateLeagueDraftCaches(leagueId)
  return stop('budget')
}

export interface FillAutoDraftBoardsOptions {
  /** In-progress sessions to look at per tick. */
  maxLeagues?: number
  /** Wall-clock budget for the whole scan. */
  budgetMs?: number
}

export type FillAutoDraftBoardsSummary = {
  scanned: number
  /** Leagues that were auto drafts and received at least one pick. */
  filled: number
  picks: number
  completed: number
  outcomes: AutoDraftFillOutcome[]
  errors: Array<{ leagueId: string; message: string }>
}

/**
 * Every in-progress snake/linear draft we run: the auto ones get picks, the rest are reported as
 * `not_auto` and untouched. Called from the draft tick each minute; a board bigger than one tick's
 * budget finishes over the following ticks.
 */
export async function fillAutoDraftBoards(opts: FillAutoDraftBoardsOptions = {}): Promise<FillAutoDraftBoardsSummary> {
  const maxLeagues = Math.min(Math.max(opts.maxLeagues ?? 10, 1), 50)
  const deadlineAt = Date.now() + Math.max(1_000, opts.budgetMs ?? 40_000)
  const candidates = await prisma.draftSession.findMany({
    where: { status: 'in_progress', sleeperDraftId: null, draftType: { in: ['snake', 'linear'] } },
    select: { leagueId: true },
    orderBy: { startedAt: 'asc' },
    take: maxLeagues,
  })
  const summary: FillAutoDraftBoardsSummary = { scanned: candidates.length, filled: 0, picks: 0, completed: 0, outcomes: [], errors: [] }
  for (const { leagueId } of candidates) {
    if (Date.now() >= deadlineAt) break
    try {
      const outcome = await fillAutoDraftBoard(leagueId, { deadlineAt })
      summary.outcomes.push(outcome)
      summary.picks += outcome.picks
      if (outcome.picks > 0) summary.filled += 1
      if (outcome.completed) summary.completed += 1
    } catch (error) {
      summary.errors.push({ leagueId, message: error instanceof Error ? error.message : String(error) })
    }
  }
  return summary
}
