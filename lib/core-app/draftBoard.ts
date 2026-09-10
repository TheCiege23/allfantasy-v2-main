import 'server-only'

import { prisma } from '@/lib/prisma'
import { loadLeagueFor } from './loadLeagueFor'
import { leagueDisplayName, type SectionState, type UnavailableSection } from './leagueHome'

/**
 * The per-league draft board — "on the clock: board, queue, recommendations and
 * the pick-trade panel".
 *
 * ── 2026-09-08: THIS WAS `warRoom.ts`, AND THE RENAME IS THE POINT ───────────
 *
 * The War Room is now the season-long Decision OS hub, so a draft grid is a
 * Draft HQ concern in every phase a draft can be in. Nothing about the
 * derivation below changed in the move — only the name and the screen that
 * renders it. The `af-wr-` CSS prefix in `af-war-room.css` is left alone
 * deliberately: renaming forty class names carries real risk and buys a reader
 * nothing the file header does not already say.
 *
 * The board is the real thing here. DraftPick holds every pick made, with its
 * overall number, round, roster and player, so the grid the handoff draws —
 * teams across, rounds down — is rendered from stored picks rather than mocked.
 *
 * ⚠ Pick-in-round is derived from `overall`, NOT from DraftPick.slot. `slot` is
 * the roster's draft slot, so using it collapses every column of a snake draft
 * onto one team. That mistake shipped in Draft HQ's made-pick labels and was
 * caught only because a second, independently computed list disagreed; the same
 * derivation is used here from the start.
 *
 * ⚠ Live state is reported only from what the session actually stores. A draft
 * that is `completed` is not "on the clock", and a countdown is shown only when
 * timerEndAt exists — never invented from a default pick length.
 */

export type BoardCell = {
  round: number
  pickInRound: number
  overall: number
  label: string
  rosterId: string
  playerName: string | null
  position: string | null
  isYours: boolean
  isOnTheClock: boolean
}

export type BoardColumn = {
  slot: number
  rosterId: string
  displayName: string
  isYours: boolean
}

export type DraftBoardData = {
  league: { id: string; name: string; platform: string }
  session: SectionState<{
    status: string
    draftType: string
    rounds: number
    teamCount: number
    picksMade: number
    totalPicks: number
    currentRound: number | null
    currentPickOverall: number | null
  }>
  clock: SectionState<{ endsAt: Date | null; pausedSecondsRemaining: number | null; yoursOnClock: boolean }>
  board: SectionState<{ columns: BoardColumn[]; cells: BoardCell[] }>
  bestAvailable: UnavailableSection
  queue: UnavailableSection
  advice: UnavailableSection
}

export async function getDraftBoardData(leagueId: string, userId: string): Promise<DraftBoardData | null> {
  /* Gated read — see lib/core-app/loadLeagueFor.ts. A non-member gets null here. */
  const league = await loadLeagueFor(userId, leagueId, { id: true, name: true, platform: true })
  if (!league) return null

  const base = {
    league: {
      id: league.id,
      name: leagueDisplayName(league.name),
      platform: String(league.platform ?? 'manual').toLowerCase(),
    },
    bestAvailable: {
      available: false as const,
      reason:
        'ranking the best available needs the undrafted player pool scored for this league; no draft recommendation output is stored',
    },
    queue: {
      available: false as const,
      reason: 'no draft queue is stored for this league — build it on your platform and it drives the autopick there',
    },
    advice: {
      available: false as const,
      reason: 'pick-by-pick advice is not generated for imported drafts',
    },
  }

  const session = await prisma.draftSession.findFirst({
    where: { leagueId },
    select: {
      id: true,
      status: true,
      draftType: true,
      rounds: true,
      teamCount: true,
      slotOrder: true,
      timerEndAt: true,
      pausedRemainingSeconds: true,
    },
  })

  if (!session) {
    const none = { available: false as const, reason: 'no draft has been set up for this league' }
    return { ...base, session: none, clock: none, board: none }
  }

  const myTeam = await prisma.leagueTeam.findFirst({
    where: { leagueId, claimedByUserId: userId },
    select: { externalId: true },
  })
  const myRosterId = myTeam?.externalId != null ? String(myTeam.externalId) : null

  const order = Array.isArray(session.slotOrder)
    ? (session.slotOrder as Array<{ slot?: number; rosterId?: string; displayName?: string }>)
    : []

  const picks = await prisma.draftPick.findMany({
    where: { sessionId: session.id },
    orderBy: { overall: 'asc' },
    select: { overall: true, round: true, rosterId: true, playerName: true, position: true },
  })

  const totalPicks = session.rounds * session.teamCount
  const picksMade = picks.length
  const nextOverall = picksMade < totalPicks ? picksMade + 1 : null
  const currentRound =
    nextOverall != null ? Math.ceil(nextOverall / session.teamCount) : null

  const sessionState: DraftBoardData['session'] = {
    available: true,
    data: {
      status: session.status,
      draftType: session.draftType,
      rounds: session.rounds,
      teamCount: session.teamCount,
      picksMade,
      totalPicks,
      currentRound,
      currentPickOverall: nextOverall,
    },
  }

  // Only a running draft has a clock. A completed one is not "on the clock", and
  // a countdown with no stored timer would be a number we made up.
  const isRunning = session.status === 'in_progress' || session.status === 'paused'
  const onClockRosterId = (() => {
    if (!isRunning || nextOverall == null || order.length === 0) return null
    const roundIdx = Math.ceil(nextOverall / session.teamCount)
    const posInRound = nextOverall - (roundIdx - 1) * session.teamCount
    const reversed = session.draftType.toLowerCase() === 'snake' && roundIdx % 2 === 0
    const slot = reversed ? session.teamCount - posInRound + 1 : posInRound
    return order.find((o) => o.slot === slot)?.rosterId ?? null
  })()

  const clock: DraftBoardData['clock'] = !isRunning
    ? {
        available: false,
        reason:
          session.status === 'completed'
            ? 'this draft is complete — there is no clock'
            : 'this draft has not started, so nobody is on the clock',
      }
    : {
        available: true,
        data: {
          endsAt: session.timerEndAt,
          pausedSecondsRemaining: session.pausedRemainingSeconds ?? null,
          yoursOnClock: myRosterId != null && onClockRosterId === myRosterId,
        },
      }

  const columns: BoardColumn[] = order
    .slice()
    .sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0))
    .map((o) => ({
      slot: Number(o.slot ?? 0),
      rosterId: String(o.rosterId ?? ''),
      displayName: String(o.displayName ?? `Team ${o.slot ?? '?'}`),
      isYours: myRosterId != null && String(o.rosterId) === myRosterId,
    }))

  const cells: BoardCell[] = picks.map((p) => {
    const pickInRound = p.overall - (p.round - 1) * session.teamCount
    return {
      round: p.round,
      pickInRound,
      overall: p.overall,
      label: `${p.round}.${String(pickInRound).padStart(2, '0')}`,
      rosterId: String(p.rosterId),
      playerName: p.playerName,
      position: p.position,
      isYours: myRosterId != null && String(p.rosterId) === myRosterId,
      isOnTheClock: false,
    }
  })

  const board: DraftBoardData['board'] =
    columns.length === 0
      ? { available: false, reason: 'this draft has no order set, so the board cannot be laid out' }
      : picks.length === 0
        ? { available: false, reason: 'no picks have been made yet — the board is empty' }
        : { available: true, data: { columns, cells } }

  return { ...base, session: sessionState, clock, board }
}
