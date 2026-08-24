/**
 * Persist a drafted college player as an owned DevyRights row.
 *
 * The live-draft engine validates and commits devy_pick / c2c_college picks,
 * but nothing durably recorded the ownership — DevyRights had no creator
 * anywhere in the repo, so the promotion route and lifecycle automation had
 * no rows to operate on. PickSubmissionService calls this after the pick
 * transaction commits.
 *
 * Entry states match the lifecycle engines' own transition tables:
 * devy_pick → NCAA_DEVY_ACTIVE (DevyLifecycleAutomation advances it through
 * DECLARED → PROMOTION_ELIGIBLE); c2c_college → COLLEGE_ACTIVE.
 */

import { prisma } from '@/lib/prisma'
import { DEVY_LIFECYCLE_STATE } from '@/lib/devy/types'
import { C2C_LIFECYCLE_STATE } from '@/lib/merged-devy-c2c/types'
import { appendDevyLifecycleEvent } from '@/lib/devy/lifecycle/DevyAuditLog'

export interface RecordDraftedDevyRightsInput {
  leagueId: string
  rosterId: string
  playerName: string
  /** DevyPlayer.id when the draft pool supplied one; resolved by name otherwise. */
  devyPlayerId?: string | null
  assetType: 'devy_pick' | 'c2c_college'
  /** Defaults to resolveDevySeasonYear(). */
  seasonYear?: number
}

export interface RecordDraftedDevyRightsResult {
  ok: boolean
  /** false when the row already existed (idempotent retry or lost race). */
  created: boolean
  rightsId?: string
  reason?: 'devy_player_not_found' | 'league_or_roster_missing'
}

/** Same season convention the promotion route uses: the devy season rolls in April. */
export function resolveDevySeasonYear(now: Date = new Date()): number {
  return now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
}

async function resolveDevyPlayer(
  devyPlayerId: string | null | undefined,
  playerName: string,
): Promise<{ id: string; confidence: number } | null> {
  if (devyPlayerId) {
    const byId = await prisma.devyPlayer.findUnique({
      where: { id: devyPlayerId },
      select: { id: true, graduatedToNFL: true },
    })
    if (byId && !byId.graduatedToNFL) return { id: byId.id, confidence: 100 }
  }
  const name = playerName.trim()
  if (!name) return null
  // Mirrors validateDevyEligibilityAsync / validateC2CEligibilityAsync, which
  // already accepted this pick by the same lookup.
  const byName = await prisma.devyPlayer.findFirst({
    where: {
      devyEligible: true,
      graduatedToNFL: false,
      OR: [
        { normalizedName: name.toLowerCase() },
        { name: { equals: name, mode: 'insensitive' } },
      ],
    },
    select: { id: true },
  })
  return byName ? { id: byName.id, confidence: 80 } : null
}

export async function recordDraftedDevyRights(
  input: RecordDraftedDevyRightsInput,
): Promise<RecordDraftedDevyRightsResult> {
  const resolved = await resolveDevyPlayer(input.devyPlayerId, input.playerName)
  if (!resolved) return { ok: false, created: false, reason: 'devy_player_not_found' }

  const uniqueWhere = {
    leagueId_rosterId_devyPlayerId: {
      leagueId: input.leagueId,
      rosterId: input.rosterId,
      devyPlayerId: resolved.id,
    },
  }

  const existing = await prisma.devyRights.findUnique({ where: uniqueWhere })
  if (existing) return { ok: true, created: false, rightsId: existing.id }

  const state =
    input.assetType === 'c2c_college'
      ? C2C_LIFECYCLE_STATE.COLLEGE_ACTIVE
      : DEVY_LIFECYCLE_STATE.NCAA_DEVY_ACTIVE

  let rightsId: string
  try {
    const created = await prisma.devyRights.create({
      data: {
        leagueId: input.leagueId,
        rosterId: input.rosterId,
        devyPlayerId: resolved.id,
        state,
        seasonYear: input.seasonYear ?? resolveDevySeasonYear(),
        sourceConfidence: resolved.confidence,
      },
    })
    rightsId = created.id
  } catch (error) {
    const code = (error as { code?: string })?.code
    if (code === 'P2002') {
      // A concurrent retry won the race on the unique triple; the row exists.
      const raced = await prisma.devyRights.findUnique({ where: uniqueWhere })
      return { ok: true, created: false, rightsId: raced?.id }
    }
    if (code === 'P2003') {
      // League or Roster FK missing for this draft slot — labeled, never invented.
      return { ok: false, created: false, reason: 'league_or_roster_missing' }
    }
    throw error
  }

  await appendDevyLifecycleEvent({
    leagueId: input.leagueId,
    eventType: 'pool_assignment',
    rosterId: input.rosterId,
    devyPlayerId: resolved.id,
    payload: { action: 'draft_rights_created', rightsId, state, assetType: input.assetType },
  }).catch(() => {
    // Audit append is best-effort; the rights row is already committed.
  })

  return { ok: true, created: true, rightsId }
}
