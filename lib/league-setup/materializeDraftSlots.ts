/**
 * Materialize placeholder draft slots into real Roster rows (Slice 4.5).
 *
 * Why: league creation leaves `slotOrder` populated with synthetic
 * `placeholder-N` rosterIds for slots the commissioner hasn't filled yet. The
 * commissioner pick-edit flow and post-draft roster assignment require real
 * `Roster` rows, so we replace those placeholders with AI-managed rosters
 * (platformUserId prefixed with "orphan-" to match existing conventions).
 *
 * Scope: only creates rosters + rewrites slotOrder. Does NOT configure AI
 * personality, draft strategy, or team cosmetics — those belong to a later
 * slice. Safe to run multiple times (idempotent).
 */

import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { isOrphanPlatformUserId } from '@/lib/orphan-ai-manager/orphan-platform-ids'
import type { SlotOrderEntry } from '@/lib/live-draft-engine/types'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'

export interface MaterializeDraftSlotsResult {
  createdCount: number
  replacedCount: number
  alreadyMaterializedCount: number
  slotOrder: SlotOrderEntry[]
}

export interface MaterializeDraftSlotsError {
  ok: false
  status: number
  error: string
  code?: string
}

export type MaterializeDraftSlotsOutcome =
  | ({ ok: true } & MaterializeDraftSlotsResult)
  | MaterializeDraftSlotsError

/** A slotOrder rosterId is a placeholder when no Roster row exists for it in the league. */
function looksLikePlaceholderId(rosterId: string): boolean {
  return typeof rosterId === 'string' && rosterId.startsWith('placeholder-')
}

export async function materializeDraftSlots(
  leagueId: string,
): Promise<MaterializeDraftSlotsOutcome> {
  if (!leagueId) return { ok: false, status: 400, error: 'Missing leagueId' }

  const [league, session, existingRosters] = await Promise.all([
    prisma.league.findUnique({ where: { id: leagueId }, select: { id: true } }),
    prisma.draftSession.findFirst({
      where: { leagueId },
      orderBy: CURRENT_DRAFT_SESSION_ORDER,
      select: { id: true, slotOrder: true, teamCount: true },
    }),
    prisma.roster.findMany({ where: { leagueId }, select: { id: true, platformUserId: true } }),
  ])
  if (!league) return { ok: false, status: 404, error: 'League not found' }
  if (!session) return { ok: false, status: 404, error: 'Draft session not found' }

  const slotOrderIn: SlotOrderEntry[] = Array.isArray(session.slotOrder)
    ? (session.slotOrder as unknown as SlotOrderEntry[])
    : []
  if (slotOrderIn.length === 0) {
    return {
      ok: true,
      createdCount: 0,
      replacedCount: 0,
      alreadyMaterializedCount: 0,
      slotOrder: [],
    }
  }

  const realRosterIdSet = new Set(existingRosters.map((r) => r.id))

  // Classify each slot. A placeholder slot is any whose rosterId isn't in the
  // league's roster table (covers the `placeholder-N` naming plus any stale id).
  const slotsNeedingMaterialization: SlotOrderEntry[] = []
  for (const entry of slotOrderIn) {
    if (!realRosterIdSet.has(entry.rosterId)) slotsNeedingMaterialization.push(entry)
  }
  const alreadyMaterializedCount = slotOrderIn.length - slotsNeedingMaterialization.length

  if (slotsNeedingMaterialization.length === 0) {
    return {
      ok: true,
      createdCount: 0,
      replacedCount: 0,
      alreadyMaterializedCount,
      slotOrder: slotOrderIn,
    }
  }

  // Transaction: create rosters + rewrite slotOrder + link LeagueEntrySlot rows.
  const { slotOrderOut, created } = await prisma.$transaction(
    async (tx) => {
      const nextSlotOrder: SlotOrderEntry[] = []
      let createdInTx = 0

      for (const entry of slotOrderIn) {
        if (realRosterIdSet.has(entry.rosterId)) {
          nextSlotOrder.push(entry)
          continue
        }

        // Synthetic orphan platformUserId so it's unique within the league.
        const orphanId = `orphan-${randomUUID()}`
        const roster = await tx.roster.create({
          data: {
            leagueId,
            platformUserId: orphanId,
            playerData: { draftPicks: [] } as Prisma.InputJsonValue,
            settings: {
              aiManaged: true,
              aiManagerType: 'default',
              createdBy: 'materializeDraftSlots',
            } as Prisma.InputJsonValue,
          },
          select: { id: true },
        })
        createdInTx += 1
        nextSlotOrder.push({
          slot: entry.slot,
          rosterId: roster.id,
          displayName: entry.displayName || `Team ${entry.slot}`,
        })
      }

      await tx.draftSession.update({
        where: { id: session.id },
        data: {
          slotOrder: nextSlotOrder as unknown as Prisma.InputJsonValue,
          version: { increment: 1 },
          updatedAt: new Date(),
        },
      })

      // Best-effort: link LeagueEntrySlot rows to the new roster ids so the rest
      // of the league setup flow sees materialized slots. Skip if model isn't
      // available in this build.
      const txAny = tx as unknown as {
        leagueEntrySlot?: {
          updateMany: (args: unknown) => Promise<unknown>
        }
      }
      if (txAny.leagueEntrySlot?.updateMany) {
        for (const entry of nextSlotOrder) {
          await txAny.leagueEntrySlot.updateMany({
            where: { leagueId, slotNumber: entry.slot, rosterId: null },
            data: { rosterId: entry.rosterId, status: 'FILLED' },
          })
        }
      }

      return { slotOrderOut: nextSlotOrder, created: createdInTx }
    },
    { timeout: 30_000, maxWait: 10_000 },
  )

  return {
    ok: true,
    createdCount: created,
    replacedCount: created,
    alreadyMaterializedCount,
    slotOrder: slotOrderOut,
  }
}

/** Exposed for repair-script reuse — maps placeholder ids from a stale slotOrder
 *  to real roster ids created by materializeDraftSlots. */
export function buildPlaceholderRemap(
  beforeSlotOrder: SlotOrderEntry[],
  afterSlotOrder: SlotOrderEntry[],
): Map<string, string> {
  const remap = new Map<string, string>()
  const bySlotAfter = new Map(afterSlotOrder.map((e) => [e.slot, e.rosterId] as const))
  for (const before of beforeSlotOrder) {
    if (!looksLikePlaceholderId(before.rosterId)) continue
    const real = bySlotAfter.get(before.slot)
    if (real && real !== before.rosterId) remap.set(before.rosterId, real)
  }
  return remap
}
