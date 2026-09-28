/**
 * Slice 7.1 — Invite-time rebalance.
 *
 * When a human accepts an invite and is given a new Roster, they need a
 * draft slot. If the league has already auto-materialized (Slice 7), every
 * slot is occupied by a commissioner + orphan AI managers. We evict the
 * lowest-numbered orphan slot and seat the human there.
 *
 * Hard rules:
 *   1. Humans always outrank orphans. Never evict a human.
 *   2. If the human is already in slotOrder, no-op.
 *   3. If the draft has started (status in_progress/completed), refuse — we
 *      will NOT transfer players from an orphan to a newly-arrived human.
 *   4. Pre-draft test picks (commissioner pick-edit ASSIGN before the draft
 *      starts) ARE remapped so the board stays coherent.
 *   5. Evicted orphan Roster row is safety-deleted only if nothing still
 *      references it after the remap.
 *
 * Caller (invite engine) runs this best-effort. Failure MUST NOT break invite
 * acceptance — the human's Roster creation is the critical path.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { isOrphanPlatformUserId } from '@/lib/orphan-ai-manager/orphan-platform-ids'
import type { SlotOrderEntry } from '@/lib/live-draft-engine/types'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'

export type EvictOrphanReason =
  | 'ALREADY_SEATED'
  | 'NO_ORPHAN_SLOT_AVAILABLE'
  | 'DRAFT_ALREADY_STARTED'
  | 'SESSION_NOT_FOUND'
  | 'ROSTER_NOT_IN_LEAGUE'

export interface EvictOrphanResult {
  ok: true
  rebalanced: boolean
  reason?: EvictOrphanReason
  evictedRosterId?: string
  slotIndex?: number
  slotOrder?: SlotOrderEntry[]
  picksRemapped?: number
  orphanDeleted?: boolean
}

export interface EvictOrphanFailure {
  ok: false
  error: string
}

export type EvictOrphanOutcome = EvictOrphanResult | EvictOrphanFailure

export interface EvictOrphanInput {
  leagueId: string
  humanRosterId: string
  /** Optional; falls back to "Team {slot}" when missing. */
  humanDisplayName?: string | null
}

/** Session is "locked" against picker remaps once the real draft starts. */
function draftHasStarted(status: string): boolean {
  return status === 'in_progress' || status === 'completed'
}

export async function evictOrphanForNewHumanRoster(
  input: EvictOrphanInput,
): Promise<EvictOrphanOutcome> {
  if (!input.leagueId) return { ok: false, error: 'Missing leagueId' }
  if (!input.humanRosterId) return { ok: false, error: 'Missing humanRosterId' }

  const session = await prisma.draftSession.findFirst({
    where: { leagueId: input.leagueId },
    orderBy: CURRENT_DRAFT_SESSION_ORDER,
    select: { id: true, status: true, slotOrder: true },
  })
  if (!session) {
    return { ok: true, rebalanced: false, reason: 'SESSION_NOT_FOUND' }
  }

  // Verify the provided rosterId actually belongs to this league — we refuse
  // to rewrite slotOrder with an id that wouldn't validate elsewhere.
  const humanRoster = await prisma.roster.findFirst({
    where: { id: input.humanRosterId, leagueId: input.leagueId },
    select: { id: true, platformUserId: true },
  })
  if (!humanRoster) {
    return { ok: true, rebalanced: false, reason: 'ROSTER_NOT_IN_LEAGUE' }
  }

  const slotOrder: SlotOrderEntry[] = Array.isArray(session.slotOrder)
    ? (session.slotOrder as unknown as SlotOrderEntry[])
    : []

  // Rule 2: already seated → no-op.
  if (slotOrder.some((entry) => entry.rosterId === input.humanRosterId)) {
    return { ok: true, rebalanced: false, reason: 'ALREADY_SEATED' }
  }

  // Rule 3: draft already started → we will not auto-transfer picks.
  if (draftHasStarted(session.status)) {
    return { ok: true, rebalanced: false, reason: 'DRAFT_ALREADY_STARTED' }
  }

  // Load roster rows referenced by slotOrder so we can classify orphan vs human.
  const slotRosterIds = Array.from(
    new Set(slotOrder.map((entry) => entry.rosterId).filter((id) => typeof id === 'string')),
  )
  const slotRosters = await prisma.roster.findMany({
    where: { id: { in: slotRosterIds }, leagueId: input.leagueId },
    select: { id: true, platformUserId: true },
  })
  const platformUserIdByRosterId = new Map<string, string>()
  for (const r of slotRosters) platformUserIdByRosterId.set(r.id, r.platformUserId)

  // Find the lowest orphan slot. Anything not mapped to a real Roster row is
  // skipped (should not happen post-Slice-7 but we don't want to evict a non-
  // existent id).
  const orphanIndex = slotOrder.findIndex((entry) => {
    const pu = platformUserIdByRosterId.get(entry.rosterId)
    return typeof pu === 'string' && isOrphanPlatformUserId(pu)
  })
  if (orphanIndex < 0) {
    return { ok: true, rebalanced: false, reason: 'NO_ORPHAN_SLOT_AVAILABLE' }
  }

  const evictedSlot = slotOrder[orphanIndex]
  const evictedRosterId = evictedSlot.rosterId

  const newDisplayName =
    (input.humanDisplayName?.trim() || '') ||
    evictedSlot.displayName ||
    `Team ${evictedSlot.slot}`

  let picksRemapped = 0
  let orphanDeleted = false

  await prisma.$transaction(
    async (tx) => {
      const nextSlotOrder: SlotOrderEntry[] = slotOrder.map((entry, i) =>
        i === orphanIndex
          ? { ...entry, rosterId: input.humanRosterId, displayName: newDisplayName }
          : entry,
      )

      await tx.draftSession.update({
        where: { id: session.id },
        data: {
          slotOrder: nextSlotOrder as unknown as Prisma.InputJsonValue,
          version: { increment: 1 },
          updatedAt: new Date(),
        },
      })

      // Remap pre-draft test picks + audit-log references from the orphan to
      // the human. Safe because draftHasStarted() returned false above.
      const remapPicks = await tx.draftPick.updateMany({
        where: { sessionId: session.id, rosterId: evictedRosterId },
        data: { rosterId: input.humanRosterId },
      })
      picksRemapped = remapPicks.count

      await tx.draftPickAuditLog.updateMany({
        where: { leagueId: input.leagueId, oldRosterId: evictedRosterId },
        data: { oldRosterId: input.humanRosterId },
      })
      await tx.draftPickAuditLog.updateMany({
        where: { leagueId: input.leagueId, newRosterId: evictedRosterId },
        data: { newRosterId: input.humanRosterId },
      })

      // Safety-delete the orphan Roster only if nothing still references it.
      const picksOnEvicted = await tx.draftPick.count({
        where: { sessionId: session.id, rosterId: evictedRosterId },
      })
      const auditOnEvicted = await tx.draftPickAuditLog.count({
        where: {
          leagueId: input.leagueId,
          OR: [{ oldRosterId: evictedRosterId }, { newRosterId: evictedRosterId }],
        },
      })
      const stillInSlotOrder = nextSlotOrder.some((s) => s.rosterId === evictedRosterId)
      if (picksOnEvicted === 0 && auditOnEvicted === 0 && !stillInSlotOrder) {
        await tx.roster.delete({ where: { id: evictedRosterId } })
        orphanDeleted = true
      }

      return nextSlotOrder
    },
    { timeout: 30_000, maxWait: 10_000 },
  )

  const finalSession = await prisma.draftSession.findUnique({
    where: { id: session.id },
    select: { slotOrder: true },
  })
  const finalSlotOrder: SlotOrderEntry[] = Array.isArray(finalSession?.slotOrder)
    ? (finalSession!.slotOrder as unknown as SlotOrderEntry[])
    : []

  return {
    ok: true,
    rebalanced: true,
    evictedRosterId,
    slotIndex: orphanIndex,
    slotOrder: finalSlotOrder,
    picksRemapped,
    orphanDeleted,
  }
}
