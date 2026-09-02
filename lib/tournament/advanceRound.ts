/**
 * Move the tournament into the round it has already been set up for.
 *
 * 🛑 THE CALENDAR EXISTED AND NOTHING WALKED IT. `roundScaffold` creates every
 * round at import; `commitRedraftPlan` fills the next one with slots; attaching a
 * league gives each slot something to read. And after all of that
 * `TournamentShell.currentRoundNumber` is still 1 — which is the number every
 * read on the hub scopes to. The board, compliance and the weekly ingest would
 * keep showing the regular season while the real tournament played on without
 * them.
 *
 * ⚠ IT IS A SEPARATE, DELIBERATE STEP RATHER THAN A SIDE EFFECT OF ATTACHING.
 * A commissioner attaches eight leagues one at a time over an evening, and the
 * hub flipping to the new round after the first one would leave seven empty
 * leagues on screen and the old standings gone. The move happens when they say
 * the round is ready.
 */
import 'server-only'
import { prisma } from '@/lib/prisma'

export type RoundReadiness = {
  currentRoundNumber: number
  /** The round the tournament would move into. Null when there is none. */
  nextRoundNumber: number | null
  nextRoundLabel: string | null
  /** Slots created for the next round. */
  slotCount: number
  /** Slots that still have no league behind them. */
  waitingForLeagues: string[]
  ready: boolean
  reason: string | null
}

export type AdvanceOutcome =
  | { ok: true; movedTo: number; label: string }
  | { ok: false; error: string; status: 400 | 404 }

async function readReadiness(
  tournamentId: string,
  commissionerUserId: string,
): Promise<RoundReadiness | null> {
  const shell = await prisma.tournamentShell.findFirst({
    where: { id: tournamentId, commissionerId: commissionerUserId },
    select: { id: true, currentRoundNumber: true },
  })
  if (!shell) return null

  const current = shell.currentRoundNumber || 1
  const rounds = await prisma.tournamentRound.findMany({
    where: { tournamentId },
    orderBy: { roundNumber: 'asc' },
    select: { id: true, roundNumber: true, roundType: true, roundLabel: true },
  })

  /* Same "next play round" rule as everywhere else — a bubble is not a stage. */
  const next = rounds
    .filter((r) => r.roundNumber > current && r.roundType !== 'bubble')
    .sort((a, b) => a.roundNumber - b.roundNumber)[0]

  if (!next) {
    return {
      currentRoundNumber: current,
      nextRoundNumber: null,
      nextRoundLabel: null,
      slotCount: 0,
      waitingForLeagues: [],
      ready: false,
      reason: 'This is the last round on the calendar.',
    }
  }

  const slots = await prisma.tournamentLeague.findMany({
    where: { tournamentId, roundId: next.id },
    select: { name: true, leagueId: true },
  })
  const waiting = slots.filter((s) => !s.leagueId).map((s) => s.name)

  let reason: string | null = null
  if (slots.length === 0) {
    reason = `${next.roundLabel} has no leagues yet — record the redraft first.`
  } else if (waiting.length > 0) {
    /*
     * ⚠ REFUSED WHILE ANY SLOT IS EMPTY, and this is the guard that matters.
     * Moving with three of eight leagues attached makes the board read as though
     * five leagues' worth of managers have vanished — and the cut would then be
     * computed against a third of the field.
     */
    reason = `${waiting.length} of ${slots.length} leagues still have nothing attached: ${waiting.join(', ')}.`
  }

  return {
    currentRoundNumber: current,
    nextRoundNumber: next.roundNumber,
    nextRoundLabel: next.roundLabel,
    slotCount: slots.length,
    waitingForLeagues: waiting,
    ready: reason == null,
    reason,
  }
}

export async function getRoundReadiness(
  tournamentId: string,
  commissionerUserId: string,
): Promise<RoundReadiness | null> {
  return readReadiness(tournamentId, commissionerUserId)
}

export async function advanceToNextRound(args: {
  tournamentId: string
  commissionerUserId: string
}): Promise<AdvanceOutcome> {
  const readiness = await readReadiness(args.tournamentId, args.commissionerUserId)
  if (!readiness) return { ok: false, error: 'Tournament not found', status: 404 }
  if (!readiness.ready || readiness.nextRoundNumber == null) {
    return { ok: false, error: readiness.reason ?? 'That round is not ready.', status: 400 }
  }

  const rounds = await prisma.tournamentRound.findMany({
    where: { tournamentId: args.tournamentId },
    select: { id: true, roundNumber: true },
  })
  const fromRound = rounds.find((r) => r.roundNumber === readiness.currentRoundNumber)
  const toRound = rounds.find((r) => r.roundNumber === readiness.nextRoundNumber)
  if (!toRound) return { ok: false, error: 'That round no longer exists.', status: 400 }

  /*
   * ⚠ THE OLD ROUND IS COMPLETED, NOT DELETED. Its leagues and every record in
   * them stay exactly where they are — the board simply stops scoping to them.
   * A tournament that discards its own regular season cannot answer "how did I
   * get here", which is most of what a commissioner is asked in week 12.
   */
  await prisma.$transaction([
    ...(fromRound
      ? [
          prisma.tournamentRound.update({
            where: { id: fromRound.id },
            data: { status: 'complete', roundCompletedAt: new Date() },
          }),
        ]
      : []),
    prisma.tournamentRound.update({
      where: { id: toRound.id },
      data: { status: 'active', roundStartedAt: new Date() },
    }),
    prisma.tournamentShell.update({
      where: { id: args.tournamentId },
      data: { currentRoundNumber: readiness.nextRoundNumber },
    }),
    prisma.tournamentAuditLog.create({
      data: {
        tournamentId: args.tournamentId,
        roundNumber: readiness.nextRoundNumber,
        action: 'round.advanced',
        actorType: 'commissioner',
        actorId: args.commissionerUserId,
        targetType: 'round',
        targetId: toRound.id,
        data: {
          from: readiness.currentRoundNumber,
          to: readiness.nextRoundNumber,
          leagues: readiness.slotCount,
        },
      },
    }),
  ])

  return { ok: true, movedTo: readiness.nextRoundNumber, label: readiness.nextRoundLabel ?? '' }
}
