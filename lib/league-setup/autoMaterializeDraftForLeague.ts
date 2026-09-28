/**
 * Slice 7 orchestrator — auto-materialize a league's draft session so every
 * joined human has a real slot and every remaining slot has an AI-managed
 * orphan roster. Idempotent and safe to call multiple times.
 *
 * Contract (strict):
 *   1. Every existing `Roster` in the league gets seated in a slot before any
 *      orphan is created. The Slice 5 partial path in buildSlotOrderForLeague
 *      is what enforces "humans-first".
 *   2. AI/orphan rosters only fill positions that are currently `placeholder-N`.
 *      Real roster ids in slotOrder are never replaced — materializeDraftSlots
 *      already checks `realRosterIdSet` before considering a slot "placeholder".
 *   3. Random draft-order settings (draftOrderSlots, weighted lottery) are
 *      honored by buildSlotOrderForLeague without change here.
 *
 * Failure mode: the orchestrator is wrapped in try/catch by callers and runs
 * best-effort. A failure never breaks league creation; the commissioner can
 * still click "Fill empty slots" in the Pre-Draft Setup card.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { buildSlotOrderForLeague } from '@/lib/live-draft-engine/DraftSessionService'
import { materializeDraftSlots } from '@/lib/league-setup/materializeDraftSlots'
import type { SlotOrderEntry } from '@/lib/live-draft-engine/types'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'

export interface AutoMaterializeResult {
  ok: true
  slotOrderSeeded: boolean
  materializedCreated: number
  materializedAlready: number
  finalSlotOrder: SlotOrderEntry[]
}

export interface AutoMaterializeFailure {
  ok: false
  reason: string
}

export type AutoMaterializeOutcome = AutoMaterializeResult | AutoMaterializeFailure

/**
 * Seed slotOrder with real rosters (humans-first) + placeholders, then replace
 * remaining placeholders with AI orphans. Returns the final slotOrder.
 */
export async function autoMaterializeDraftForLeague(leagueId: string): Promise<AutoMaterializeOutcome> {
  if (!leagueId) return { ok: false, reason: 'Missing leagueId' }

  const session = await prisma.draftSession.findFirst({
    where: { leagueId },
    orderBy: CURRENT_DRAFT_SESSION_ORDER,
    select: { id: true, teamCount: true, slotOrder: true },
  })
  if (!session) return { ok: false, reason: 'Draft session not found' }

  const teamCount = session.teamCount
  const currentSlotOrder: SlotOrderEntry[] = Array.isArray(session.slotOrder)
    ? (session.slotOrder as unknown as SlotOrderEntry[])
    : []

  // Step 1: seed slotOrder from rosters-first layout when it's empty or
  // shorter than teamCount. We deliberately do NOT overwrite a slotOrder the
  // league has already curated (draft-order settings, weighted lottery, etc.).
  let slotOrderSeeded = false
  if (currentSlotOrder.length < teamCount) {
    const next = await buildSlotOrderForLeague(leagueId)
    if (next.length === teamCount) {
      await prisma.draftSession.update({
        where: { id: session.id },
        data: {
          slotOrder: next as unknown as Prisma.InputJsonValue,
          version: { increment: 1 },
          updatedAt: new Date(),
        },
      })
      slotOrderSeeded = true
    }
  }

  // Step 2: replace remaining placeholders with orphan rosters. Idempotent —
  // returns 0/0/N when there's nothing to do.
  const result = await materializeDraftSlots(leagueId)
  if (!result.ok) return { ok: false, reason: result.error }

  return {
    ok: true,
    slotOrderSeeded,
    materializedCreated: result.createdCount,
    materializedAlready: result.alreadyMaterializedCount,
    finalSlotOrder: result.slotOrder,
  }
}
