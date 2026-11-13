/**
 * Rookie & Devy Draft Lock System
 *
 * Before the league's rookie/devy draft:
 * - Players eligible for the draft are LOCKED from waiver claims
 * - Players still appear in the waiver tab (visible but not claimable)
 * - Lock is released after the draft completes
 *
 * This prevents managers from scooping draft-eligible players
 * off waivers before the draft happens.
 */

import { prisma } from '@/lib/prisma'

type DraftLockStatus = {
  isLocked: boolean
  lockType: 'rookie' | 'devy' | 'rookie_and_devy' | null
  lockedAt: Date | null
  lockedBy: string | null
  draftSessionId: string | null
  eligiblePlayerCount: number
  reason: string
}

/**
 * Check if rookie/devy draft lock is active for a league.
 */
export async function getDraftLockStatus(leagueId: string): Promise<DraftLockStatus> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { settings: true },
  })

  if (!league) {
    return { isLocked: false, lockType: null, lockedAt: null, lockedBy: null, draftSessionId: null, eligiblePlayerCount: 0, reason: 'League not found' }
  }

  const settings = (league.settings ?? {}) as Record<string, unknown>
  const lockConfig = settings.rookie_devy_lock as Record<string, unknown> | undefined

  if (!lockConfig || lockConfig.isLocked !== true) {
    return { isLocked: false, lockType: null, lockedAt: null, lockedBy: null, draftSessionId: null, eligiblePlayerCount: 0, reason: 'No lock active' }
  }

  return {
    isLocked: true,
    lockType: (lockConfig.lockType as DraftLockStatus['lockType']) ?? 'rookie',
    lockedAt: lockConfig.lockedAt ? new Date(lockConfig.lockedAt as string) : null,
    lockedBy: (lockConfig.lockedBy as string) ?? null,
    draftSessionId: (lockConfig.draftSessionId as string) ?? null,
    eligiblePlayerCount: Number(lockConfig.eligiblePlayerCount ?? 0),
    reason: (lockConfig.reason as string) ?? 'Locked for upcoming draft',
  }
}

