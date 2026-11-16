import 'server-only'

import { prisma } from '@/lib/prisma'
import { getUpcomingPickOwners } from '@/lib/live-draft-engine/DraftOrderService'
import { getCurrentUserRosterIdForLeague } from '@/lib/live-draft-engine/auth'
import type { DraftType } from '@/lib/live-draft-engine/types'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'
import { resolveCoreDepth } from '@/lib/core-app/corePaywall'
import { draftHistoryFacts } from './draftEdge'
import { loadDraftHistoryPicks } from './draftEdgeLoader'
import { historyLines, managersBeforeNextPick, parseSlotOrder, thisDraftFact } from './liveDraftManagersFacts'

/**
 * "Before your next pick" — the managers on the clock ahead of you in the LIVE draft, each with what
 * they have taken in this draft (everyone) and their history in this league's past drafts
 * (Competitive Edge only). The rules and the privacy contract are in ./liveDraftManagersFacts.ts.
 *
 * DB-FIRST: the draft session, its picks, and the Sleeper draft history the import already wrote.
 * Null for an auction (no pick order), a draft with no slot order, or a viewer with no slot — the
 * honest answer is to show nothing rather than guess who is next.
 */

export type ManagerAhead = {
  name: string
  slot: number
  thisDraft: string
  /** Empty unless `history` is 'shown'. */
  history: string[]
}

export type ManagersAhead = {
  managers: ManagerAhead[]
  /** 'locked': the viewer's plan has no Competitive Edge. 'unavailable': no league history to read. */
  history: 'shown' | 'locked' | 'unavailable'
}

export async function loadManagersAhead(input: {
  leagueId: string
  userId: string
  /**
   * The viewer's slot when the caller already resolved it (`resolveViewerDraftIdentity`). Without it
   * this matches on the AF `Roster.id`, which never matches a Sleeper-mirrored draft's slot order.
   */
  viewerSlot?: number
}): Promise<ManagersAhead | null> {
  const session = await prisma.draftSession.findFirst({
    where: { leagueId: input.leagueId },
    orderBy: CURRENT_DRAFT_SESSION_ORDER,
    select: {
      id: true,
      status: true,
      draftType: true,
      teamCount: true,
      rounds: true,
      thirdRoundReversal: true,
      nextOverallPick: true,
      slotOrder: true,
    },
  })
  if (!session || session.draftType === 'auction' || session.status === 'completed') return null
  const slotOrder = parseSlotOrder(session.slotOrder)
  if (slotOrder.length === 0) return null

  const mine = input.viewerSlot != null
    ? slotOrder.find((e) => e.slot === input.viewerSlot)
    : await (async () => {
        const viewerRosterId = await getCurrentUserRosterIdForLeague(input.leagueId, input.userId).catch(() => null)
        return slotOrder.find((e) => e.rosterId === viewerRosterId)
      })()
  if (!mine) return null

  const teamCount = Math.max(1, session.teamCount)
  const totalPicks = Math.max(0, session.rounds) * teamCount
  const nextOverall = Math.max(1, session.nextOverallPick ?? 1)
  const upcoming = getUpcomingPickOwners(
    nextOverall,
    teamCount * 2,
    teamCount,
    session.draftType as DraftType,
    session.thirdRoundReversal,
    slotOrder,
    totalPicks,
  )
  const ahead = managersBeforeNextPick(upcoming, mine.slot)
  if (ahead.length === 0) return { managers: [], history: 'unavailable' }

  const picks = await prisma.draftPick.findMany({
    where: { sessionId: session.id, slot: { in: ahead.map((a) => a.slot) } },
    select: { slot: true, position: true, overall: true },
    orderBy: { overall: 'asc' },
  })
  const positionsBySlot = new Map<number, string[]>()
  for (const p of picks) {
    if (!p.position) continue
    const list = positionsBySlot.get(p.slot) ?? []
    list.push(p.position)
    positionsBySlot.set(p.slot, list)
  }

  // Past-draft history is Competitive Edge: read only for a plan that includes it.
  const access = await resolveCoreDepth(input.userId, 'competitive_edge').catch(() => null)
  let history: ManagersAhead['history'] = access?.unlocked ? 'unavailable' : 'locked'
  const historyBySlot = new Map<number, string[]>()
  if (access?.unlocked) {
    const pastPicks = await loadDraftHistoryPicks(input.leagueId).catch(() => null)
    if (pastPicks && pastPicks.length > 0) {
      history = 'shown'
      const ownerBySlot = await sleeperOwnerBySlot(ahead.map((a) => ({ slot: a.slot, rosterId: a.rosterId })), slotOrder)
      for (const a of ahead) {
        const owner = ownerBySlot.get(a.slot)
        if (!owner) continue
        historyBySlot.set(a.slot, historyLines(draftHistoryFacts({ name: a.displayName, ownerSleeperId: owner, picks: pastPicks })))
      }
    }
  }

  return {
    managers: ahead.map((a) => ({
      name: a.displayName,
      slot: a.slot,
      thisDraft: thisDraftFact(positionsBySlot.get(a.slot) ?? []),
      history: historyBySlot.get(a.slot) ?? [],
    })),
    history,
  }
}

/**
 * The Sleeper user id behind each slot — what draft history is keyed by. The slot order's own
 * `platformUserId` first; else the AF roster's (`Roster.platformUserId`). A slot with neither gets no
 * history line rather than a guess: a slot number is not a person (./draftEdge.ts).
 */
async function sleeperOwnerBySlot(
  ahead: ReadonlyArray<{ slot: number; rosterId: string }>,
  slotOrder: ReadonlyArray<{ slot: number; rosterId: string; platformUserId?: string }>,
): Promise<Map<number, string>> {
  const out = new Map<number, string>()
  const needRoster: string[] = []
  for (const a of ahead) {
    const entry = slotOrder.find((e) => e.slot === a.slot)
    if (entry?.platformUserId) out.set(a.slot, entry.platformUserId)
    else needRoster.push(a.rosterId)
  }
  if (needRoster.length > 0) {
    const rosters = await prisma.roster
      .findMany({ where: { id: { in: needRoster } }, select: { id: true, platformUserId: true } })
      .catch(() => [])
    const byId = new Map(rosters.map((r) => [r.id, r.platformUserId?.trim() || null]))
    for (const a of ahead) {
      if (out.has(a.slot)) continue
      const owner = byId.get(a.rosterId)
      if (owner) out.set(a.slot, owner)
    }
  }
  return out
}
