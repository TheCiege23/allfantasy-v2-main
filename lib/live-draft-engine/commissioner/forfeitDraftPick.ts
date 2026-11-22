import { prisma } from '@/lib/prisma'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'
import { getSlotInRoundForOverall } from '@/lib/live-draft-engine/DraftOrderService'
import type { SlotOrderEntry } from '@/lib/live-draft-engine/types'
import { skipForfeitedPicksOnClock } from '@/lib/live-draft-engine/forfeitedPickSkips'
import { submitPick } from '@/lib/live-draft-engine/PickSubmissionService'

/**
 * Commissioner penalty: FORFEIT a team's pick in the live draft (2026-11-19).
 *
 * Reuses the forfeit the engine already honours (`forfeitedPickSkips.ts`, built for the tanking
 * penalty): a `FutureDraftPick` row for (league, season, round, ORIGINAL team) with status
 * `forfeited`, tagged with this draft session. When the draft reaches that pick it is skipped and the
 * board cell reads "(Forfeited)". If the pick is on the clock right now it is skipped at once.
 *
 * Redraft leagues have no pick inventory (`loadNativeFuturePicks` returns null for them), so the
 * row is read only by the skip; in a native dynasty league it also removes the pick from trading,
 * which is what a forfeited pick should mean.
 */
export type ForfeitDraftPickResult =
  | { ok: true; overall: number; skippedNow: number }
  | {
      ok: false
      code: 'NO_SESSION' | 'INVALID_STATUS' | 'AUCTION' | 'BAD_ROUND' | 'TEAM_NOT_IN_DRAFT' | 'PICK_ALREADY_MADE'
      error: string
    }

/** Pure: the overall pick number a team's slot gets in a round. */
export function overallForSlotInRound(args: {
  round: number
  slot: number
  teamCount: number
  draftType: string
  thirdRoundReversal: boolean
}): number | null {
  const { round, slot, teamCount, draftType, thirdRoundReversal } = args
  for (let overall = (round - 1) * teamCount + 1; overall <= round * teamCount; overall++) {
    if (getSlotInRoundForOverall({ overall, teamCount, draftType: draftType as never, thirdRoundReversal }) === slot) return overall
  }
  return null
}

export async function forfeitDraftPick(args: {
  leagueId: string
  round: number
  /** The team whose slot the pick belongs to (its ORIGINAL owner, whoever holds it now). */
  originalRosterId: string
  reason: string
}): Promise<ForfeitDraftPickResult> {
  const session = await prisma.draftSession.findFirst({
    where: { leagueId: args.leagueId },
    orderBy: CURRENT_DRAFT_SESSION_ORDER,
    select: {
      id: true,
      status: true,
      draftType: true,
      rounds: true,
      teamCount: true,
      thirdRoundReversal: true,
      slotOrder: true,
      picks: { select: { overall: true } },
    },
  })
  if (!session) return { ok: false, code: 'NO_SESSION', error: 'There is no draft to change.' }
  if (!['pre_draft', 'in_progress', 'paused'].includes(session.status)) {
    return { ok: false, code: 'INVALID_STATUS', error: 'The draft is finished, so its picks are on the record.' }
  }
  if (session.draftType === 'auction') {
    return { ok: false, code: 'AUCTION', error: 'Auction drafts have no picks to forfeit.' }
  }
  const round = Math.floor(args.round)
  if (!(round >= 1 && round <= session.rounds)) {
    return { ok: false, code: 'BAD_ROUND', error: `Choose a round from 1 to ${session.rounds}.` }
  }
  const slotOrder = (Array.isArray(session.slotOrder) ? session.slotOrder : []) as unknown as SlotOrderEntry[]
  const seat = slotOrder.find((e) => e.rosterId === args.originalRosterId)
  if (!seat) return { ok: false, code: 'TEAM_NOT_IN_DRAFT', error: 'That team is not in this draft.' }
  const overall = overallForSlotInRound({
    round,
    slot: seat.slot,
    teamCount: session.teamCount,
    draftType: session.draftType,
    thirdRoundReversal: Boolean(session.thirdRoundReversal),
  })
  if (overall == null) return { ok: false, code: 'TEAM_NOT_IN_DRAFT', error: 'That team has no pick in that round.' }
  if (session.picks.some((p) => p.overall === overall)) {
    return { ok: false, code: 'PICK_ALREADY_MADE', error: 'That pick has already been made. Use "Fix a pick" to change it.' }
  }

  const league = await prisma.league.findUnique({ where: { id: args.leagueId }, select: { season: true } })
  const pickSeason = Number.isInteger(league?.season) ? Number(league!.season) : new Date().getUTCFullYear()
  const data = {
    status: 'forfeited' as const,
    currentOwnerId: args.originalRosterId,
    forfeitedAt: new Date(),
    forfeitReason: `commissioner: ${args.reason.trim() || 'penalty'}`.slice(0, 128),
    usedInDraftSessionId: session.id,
  }
  await prisma.futureDraftPick.upsert({
    where: {
      leagueId_pickSeason_round_originalRosterId: {
        leagueId: args.leagueId,
        pickSeason,
        round,
        originalRosterId: args.originalRosterId,
      },
    },
    create: { leagueId: args.leagueId, pickSeason, round, originalRosterId: args.originalRosterId, ...data },
    update: data,
  })

  const skippedNow = session.status === 'in_progress' ? await skipForfeitedPicksOnClock(args.leagueId, submitPick) : 0
  return { ok: true, overall, skippedNow }
}
