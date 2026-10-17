/**
 * [NEW] lib/big-brother/BigBrotherNominationEnforcement.ts
 * Enforce nominations: HOH must nominate 2; auto-nominate on timeout using config fallback.
 * PROMPT 3.
 */

import { prisma } from '@/lib/prisma'
import { getBigBrotherConfig } from './BigBrotherLeagueConfig'
import { getEligibility } from './BigBrotherEligibilityEngine'
import { setNominations } from './BigBrotherNominationEngine'
import { setReplacementNominee } from './BigBrotherNominationEngine'
import { getBigBrotherSeasonPoints as getSeasonPointsFromRosterPerformance } from './BigBrotherScores'
import { appendBigBrotherAudit } from './BigBrotherAuditLog'
import { announceNominationCeremony } from './BigBrotherChatAnnouncements'
import type { AutoNominationFallback } from './types'

/** Seeded pick for random fallback. */
function seededPickTwo<T>(arr: T[], seed: number): [T, T] {
  if (arr.length < 2) return arr.length === 1 ? [arr[0], arr[0]] : ([] as unknown as [T, T])
  let s = seed
  const a = arr[Math.abs(s % arr.length)]
  s = (s * 1103515245 + 12345) >>> 0
  const rest = arr.filter((x) => x !== a)
  const b = rest[Math.abs(s % rest.length)]
  return [a, b]
}

function hashSeed(str: string): number {
  let h = 0
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0
  return Math.abs(h) || 1
}

/**
 * Run auto-nomination when HOH misses deadline. Picks 2 eligible rosters by config fallback.
 */
export async function runAutoNomination(cycleId: string, options?: { systemUserId?: string | null }): Promise<{ ok: boolean; nominee1?: string; nominee2?: string; error?: string }> {
  const cycle = await prisma.bigBrotherCycle.findUnique({
    where: { id: cycleId },
    select: { leagueId: true, configId: true, week: true, hohRosterId: true },
  })
  if (!cycle) return { ok: false, error: 'Cycle not found' }
  const config = await getBigBrotherConfig(cycle.leagueId)
  if (!config) return { ok: false, error: 'Not a Big Brother league' }

  const eligibility = await getEligibility(cycle.leagueId, { cycleId })
  if (!eligibility) return { ok: false, error: 'Eligibility not found' }

  const canBeNominated = eligibility.canBeNominated.filter((id) => id !== cycle.hohRosterId)
  if (canBeNominated.length < 2) return { ok: false, error: 'Not enough eligible players to auto-nominate' }

  const fallback = config.autoNominationFallback as AutoNominationFallback
  let nominee1: string
  let nominee2: string

  if (fallback === 'commissioner') {
    return { ok: false, error: 'Auto-nomination disabled; commissioner must nominate' }
  }

  if (fallback === 'random') {
    const seed = hashSeed(`${cycle.leagueId}:${cycle.configId}:${cycle.week}:auto_nom`)
    const [a, b] = seededPickTwo(canBeNominated, seed)
    nominee1 = a
    nominee2 = b
  } else {
    const points: Record<string, number> = {}
    for (const rosterId of canBeNominated) {
      points[rosterId] = await getSeasonPointsFromRosterPerformance(cycle.leagueId, rosterId, cycle.week)
    }
    const sorted = [...canBeNominated].sort((a, b) => (points[a] ?? 0) - (points[b] ?? 0))
    nominee1 = sorted[0]
    nominee2 = sorted[1]
  }

  const result = await setNominations(cycleId, nominee1, nominee2)
  if (!result.ok) return result

  await appendBigBrotherAudit(cycle.leagueId, cycle.configId, 'auto_nomination', {
    cycleId,
    week: cycle.week,
    nominee1RosterId: nominee1,
    nominee2RosterId: nominee2,
    fallback,
  })

  await announceNominationCeremony({
    leagueId: cycle.leagueId,
    week: cycle.week,
    nominee1RosterId: nominee1,
    nominee2RosterId: nominee2,
    systemUserId: options?.systemUserId,
  })

  return { ok: true, nominee1, nominee2 }
}

/**
 * Run auto replacement nominee when HOH misses deadline after veto used.
 */
export async function runAutoReplacementNominee(cycleId: string, options?: { systemUserId?: string | null }): Promise<{ ok: boolean; replacementRosterId?: string; error?: string }> {
  const cycle = await prisma.bigBrotherCycle.findUnique({
    where: { id: cycleId },
    select: {
      leagueId: true,
      configId: true,
      week: true,
      hohRosterId: true,
      vetoSavedRosterId: true,
      vetoWinnerRosterId: true,
      nominee1RosterId: true,
      nominee2RosterId: true,
      vetoUsed: true,
    },
  })
  if (!cycle?.vetoUsed) return { ok: false, error: 'Veto not used or cycle not found' }

  const config = await getBigBrotherConfig(cycle.leagueId)
  if (!config) return { ok: false, error: 'Not a Big Brother league' }

  const excluded = [cycle.hohRosterId, cycle.vetoWinnerRosterId, cycle.vetoSavedRosterId, cycle.nominee1RosterId, cycle.nominee2RosterId].filter(Boolean) as string[]
  const evicted = await prisma.bigBrotherCycle.findMany({
    where: { leagueId: cycle.leagueId, evictedRosterId: { not: null } },
    select: { evictedRosterId: true },
  })
  const evictedIds = new Set(evicted.map((c) => c.evictedRosterId).filter(Boolean) as string[])
  const rosters = await prisma.roster.findMany({
    where: { leagueId: cycle.leagueId, id: { notIn: [...evictedIds] } },
    select: { id: true },
  })
  const eligible = rosters.map((r) => r.id).filter((id) => !excluded.includes(id))
  if (eligible.length === 0) return { ok: false, error: 'No eligible replacement' }

  const fallback = config.autoNominationFallback as AutoNominationFallback
  let replacement: string

  if (fallback === 'commissioner') {
    return { ok: false, error: 'Commissioner must name replacement' }
  }

  if (fallback === 'random') {
    const seed = hashSeed(`${cycle.leagueId}:${cycle.configId}:${cycle.week}:auto_replacement`)
    replacement = eligible[Math.abs(seed % eligible.length)]
  } else {
    const points: Record<string, number> = {}
    for (const rosterId of eligible) {
      points[rosterId] = await getSeasonPointsFromRosterPerformance(cycle.leagueId, rosterId, cycle.week)
    }
    const sorted = [...eligible].sort((a, b) => (points[a] ?? 0) - (points[b] ?? 0))
    replacement = sorted[0]
  }

  const result = await setReplacementNominee(cycleId, replacement)
  if (!result.ok) return result

  await appendBigBrotherAudit(cycle.leagueId, cycle.configId, 'auto_replacement_nominee', {
    cycleId,
    week: cycle.week,
    replacementRosterId: replacement,
    fallback,
  })

  return { ok: true, replacementRosterId: replacement }
}
