/**
 * [NEW] lib/big-brother/BigBrotherNominationEngine.ts
 * Nomination and replacement nominee. Validates: not HOH, not saved (for replacement). PROMPT 2/6.
 */

import { prisma } from '@/lib/prisma'
import { getBigBrotherConfig } from './BigBrotherLeagueConfig'
import { getExcludedRosterIds } from './bigBrotherGuard'

const FINAL_NOMINEE_COUNT = 2

/**
 * Set initial nominations (nominee1, nominee2). HOH cannot be nominated.
 */
export async function setNominations(
  cycleId: string,
  nominee1RosterId: string,
  nominee2RosterId: string
): Promise<{ ok: boolean; error?: string }> {
  const cycle = await prisma.bigBrotherCycle.findUnique({
    where: { id: cycleId },
    select: { leagueId: true, configId: true, hohRosterId: true },
  })
  if (!cycle) return { ok: false, error: 'Cycle not found' }
  if (nominee1RosterId === nominee2RosterId) return { ok: false, error: 'Nominees must be different' }
  if (cycle.hohRosterId && (nominee1RosterId === cycle.hohRosterId || nominee2RosterId === cycle.hohRosterId)) {
    return { ok: false, error: 'HOH cannot be nominated' }
  }

  const members = await prisma.roster.findMany({ where: { leagueId: cycle.leagueId, id: { in: [nominee1RosterId, nominee2RosterId] } }, select: { id: true } })
  if (new Set(members.map(r => r.id)).size !== 2) return { ok: false, error: 'Nominees must belong to this league' }
  const excluded = await getExcludedRosterIds(cycle.leagueId)
  if (excluded.includes(nominee1RosterId) || excluded.includes(nominee2RosterId)) {
    return { ok: false, error: 'Cannot nominate evicted player' }
  }

  await prisma.bigBrotherCycle.update({
    where: { id: cycleId },
    data: {
      nominee1RosterId,
      nominee2RosterId,
      replacementNomineeRosterId: null,
    },
  })
  return { ok: true }
}

/**
 * Set replacement nominee after veto is used. Cannot be HOH or the saved nominee.
 */
export async function setReplacementNominee(
  cycleId: string,
  replacementRosterId: string
): Promise<{ ok: boolean; error?: string }> {
  const cycle = await prisma.bigBrotherCycle.findUnique({
    where: { id: cycleId },
    select: {
      leagueId: true,
      hohRosterId: true,
      vetoUsed: true,
      vetoSavedRosterId: true,
      vetoWinnerRosterId: true,
      nominee1RosterId: true,
      nominee2RosterId: true,
    },
  })
  if (!cycle) return { ok: false, error: 'Cycle not found' }
  if (!cycle.vetoUsed) return { ok: false, error: 'Veto was not used; no replacement needed' }
  if (replacementRosterId === cycle.hohRosterId) return { ok: false, error: 'HOH cannot be replacement nominee' }
  if (cycle.vetoSavedRosterId && replacementRosterId === cycle.vetoSavedRosterId) {
    return { ok: false, error: 'Saved player cannot be replacement nominee' }
  }

  if (replacementRosterId === cycle.vetoWinnerRosterId || replacementRosterId === cycle.nominee1RosterId || replacementRosterId === cycle.nominee2RosterId) return { ok: false, error: 'Replacement must be a different eligible houseguest' }
  const member = await prisma.roster.findFirst({ where: { leagueId: cycle.leagueId, id: replacementRosterId }, select: { id: true } })
  if (!member) return { ok: false, error: 'Replacement must belong to this league' }
  const excluded = await getExcludedRosterIds(cycle.leagueId)
  if (excluded.includes(replacementRosterId)) return { ok: false, error: 'Cannot nominate evicted player' }

  await prisma.bigBrotherCycle.update({
    where: { id: cycleId },
    data: { replacementNomineeRosterId: replacementRosterId },
  })
  return { ok: true }
}

/**
 * Get roster IDs that are on the block for this cycle (final ballot: either nominee1/2 or replacement for the saved one).
 */
export async function getFinalNomineeRosterIds(cycleId: string): Promise<string[]> {
  const cycle = await prisma.bigBrotherCycle.findUnique({
    where: { id: cycleId },
    select: {
      nominee1RosterId: true,
      nominee2RosterId: true,
      vetoUsed: true,
      vetoSavedRosterId: true,
      replacementNomineeRosterId: true,
    },
  })
  if (!cycle) return []
  const n1 = cycle.nominee1RosterId
  const n2 = cycle.nominee2RosterId
  if (!n1 || !n2) return []
  if (!cycle.vetoUsed) return [n1, n2]
  const saved = cycle.vetoSavedRosterId
  const replacement = cycle.replacementNomineeRosterId
  if (saved === n1 && replacement) return [n2, replacement]
  if (saved === n2 && replacement) return [n1, replacement]
  // Veto used but replacement not yet set: only the non-saved nominee is on the block
  if (saved === n1) return [n2]
  if (saved === n2) return [n1]
  return [n1, n2]
}
