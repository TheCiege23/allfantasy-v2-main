import 'server-only'

import { prisma } from '@/lib/prisma'
import { leagueDisplayName, type SectionState, type UnavailableSection } from './leagueHome'

/**
 * Draft HQ — "before the draft: your picks, the lottery, the board settings and
 * a prepared queue".
 *
 * Real, from DraftSession: status, draft type, rounds, team count, and the draft
 * order (slotOrder, a JSON array of { slot, rosterId, displayName }). 28 of 46
 * stored sessions carry an order.
 *
 * Your pick SLOTS are computed, not stored — snake order is deterministic given
 * your slot, the round count and the team count, so deriving 1.02 / 2.11 / 3.02
 * is arithmetic rather than invention.
 *
 * ⚠ But they are labelled ORIGINAL slots, because pick TRADES are not ingested.
 * DraftPick.tradedPickMeta exists for picks already made; nothing records that a
 * future pick changed hands. So "you hold 2.01, acquired from @dre" — which the
 * handoff shows — cannot be said, and claiming a traded-away pick is still yours
 * would be worse than saying nothing.
 *
 * ⚠ The weighted lottery in the handoff has NO model at all. There is no lottery
 * table, no ball counts, no odds. That section reports itself unavailable rather
 * than computing odds from standings, which would look authoritative and be
 * entirely our own invention.
 */

export type PickSlot = {
  round: number
  pickInRound: number
  overall: number
  label: string
}

export type MadePick = {
  overall: number
  round: number
  label: string
  playerName: string
  position: string
  team: string | null
}

export type DraftHqData = {
  league: { id: string; name: string; platform: string; format: string | null }
  session: SectionState<{
    status: string
    draftType: string
    rounds: number
    teamCount: number
    yourSlot: number | null
  }>
  /** Original pick slots, before any trades we cannot see. */
  pickSlots: SectionState<PickSlot[]>
  /** What you actually drafted, when the draft has run. */
  madePicks: SectionState<MadePick[]>
  lottery: UnavailableSection
  queue: UnavailableSection
  keepers: UnavailableSection
}

/**
 * Snake order. Odd rounds run 1..n, even rounds reverse — so a slot-2 team in a
 * 12-team league picks 1.02 then 2.11.
 */
export function computePickSlots(
  slot: number,
  rounds: number,
  teamCount: number,
  draftType: string
): PickSlot[] {
  const out: PickSlot[] = []
  const snake = draftType.toLowerCase() === 'snake'
  for (let round = 1; round <= rounds; round += 1) {
    const reversed = snake && round % 2 === 0
    const pickInRound = reversed ? teamCount - slot + 1 : slot
    out.push({
      round,
      pickInRound,
      overall: (round - 1) * teamCount + pickInRound,
      label: `${round}.${String(pickInRound).padStart(2, '0')}`,
    })
  }
  return out
}

export async function getDraftHqData(leagueId: string, userId: string): Promise<DraftHqData | null> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { id: true, name: true, platform: true, leagueType: true },
  })
  if (!league) return null

  const base = {
    league: {
      id: league.id,
      name: leagueDisplayName(league.name),
      platform: String(league.platform ?? 'manual').toLowerCase(),
      format: league.leagueType ?? null,
    },
    lottery: {
      available: false as const,
      reason:
        'there is no lottery data in this system — no ball counts, no odds, nothing recorded. Odds derived from standings would be our invention, not this league’s rules',
    },
    queue: {
      available: false as const,
      reason: 'no pre-draft queue has been saved for this league',
    },
    keepers: {
      available: false as const,
      reason: 'no keeper declarations recorded for this league',
    },
  }

  const session = await prisma.draftSession.findFirst({
    where: { leagueId },
    select: { id: true, status: true, draftType: true, rounds: true, teamCount: true, slotOrder: true },
  })

  if (!session) {
    const none = { available: false as const, reason: 'no draft has been set up for this league' }
    return { ...base, session: none, pickSlots: none, madePicks: none }
  }

  const myTeam = await prisma.leagueTeam.findFirst({
    where: { leagueId, claimedByUserId: userId },
    select: { externalId: true, teamName: true },
  })

  const order = Array.isArray(session.slotOrder)
    ? (session.slotOrder as Array<{ slot?: number; rosterId?: string; displayName?: string }>)
    : []

  const mySlotEntry = myTeam?.externalId
    ? order.find((o) => String(o.rosterId) === String(myTeam.externalId))
    : undefined
  const yourSlot = typeof mySlotEntry?.slot === 'number' ? mySlotEntry.slot : null

  const sessionState: DraftHqData['session'] = {
    available: true,
    data: {
      status: session.status,
      draftType: session.draftType,
      rounds: session.rounds,
      teamCount: session.teamCount,
      yourSlot,
    },
  }

  const pickSlots: SectionState<PickSlot[]> =
    yourSlot == null
      ? {
          available: false,
          reason:
            order.length === 0
              ? 'this draft has no order set, so pick slots cannot be worked out yet'
              : 'your team is not in this draft’s order, so we cannot say which picks are yours',
        }
      : {
          available: true,
          data: computePickSlots(yourSlot, session.rounds, session.teamCount, session.draftType),
        }

  const made = myTeam?.externalId
    ? await prisma.draftPick.findMany({
        where: { sessionId: session.id, rosterId: String(myTeam.externalId) },
        orderBy: { overall: 'asc' },
        select: { overall: true, round: true, slot: true, playerName: true, position: true, team: true },
      })
    : []

  const madePicks: SectionState<MadePick[]> =
    made.length > 0
      ? {
          available: true,
          data: made.map((p) => ({
            overall: p.overall,
            round: p.round,
            // ⚠ DraftPick.slot is the ROSTER's draft slot, not the pick-in-round.
            // Labelling from it printed every pick as ".02" for a slot-2 team —
            // so a snake draft read as if the same team picked second in every
            // round. The pick-in-round has to come from `overall`: pick 23 of a
            // 12-team round 2 is 2.11, which is what the computed slots above
            // already said, and the two disagreeing is what exposed this.
            label: `${p.round}.${String(p.overall - (p.round - 1) * session.teamCount).padStart(2, '0')}`,
            playerName: p.playerName,
            position: p.position,
            team: p.team,
          })),
        }
      : {
          available: false,
          reason:
            session.status === 'pre_draft'
              ? 'this draft has not run yet'
              : 'no picks recorded for your team in this draft',
        }

  return { ...base, session: sessionState, pickSlots, madePicks }
}
