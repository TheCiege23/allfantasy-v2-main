import { prisma } from '@/lib/prisma'
import { getWeeklyEffectState } from './SurvivorEffectEngine'
import { getActiveRosterIdsForLeague } from './SurvivorRosterState'
import { excludeJuryRosterIds } from './juryGuards'

async function getCouncilContext(councilId: string) {
  return prisma.survivorTribalCouncil.findUnique({
    where: { id: councilId },
    select: {
      leagueId: true,
      week: true,
      phase: true,
      attendingTribeId: true,
    },
  })
}

export async function getEligibleRosterIdsForCouncil(councilId: string): Promise<string[]> {
  const council = await getCouncilContext(councilId)
  if (!council) return []

  // Jurors are out of the game: never voters or targets, whatever the elimination ledger says.
  const juryRosterIds = (await prisma.survivorJuryMember.findMany({ where: { leagueId: council.leagueId }, select: { rosterId: true } })).map((row) => row.rosterId)
  const activeRosterIds = excludeJuryRosterIds(await getActiveRosterIdsForLeague(council.leagueId), juryRosterIds)
  if (council.phase !== 'pre_merge' || !council.attendingTribeId) {
    return activeRosterIds
  }

  const tribeMembers = await prisma.survivorTribeMember.findMany({
    where: { tribeId: council.attendingTribeId },
    select: { rosterId: true },
  })

  const activeSet = new Set(activeRosterIds)
  return tribeMembers
    .map((member) => member.rosterId)
    .filter((rosterId) => activeSet.has(rosterId))
}

export async function getTargetableRosterIdsForCouncil(councilId: string): Promise<string[]> {
  const council = await getCouncilContext(councilId)
  if (!council) return []

  const eligibleRosterIds = await getEligibleRosterIdsForCouncil(councilId)
  const weeklyEffects = await getWeeklyEffectState(council.leagueId, council.week)
  if (council.phase === 'pre_merge' && council.attendingTribeId && weeklyEffects.immuneTribeIds.has(council.attendingTribeId)) {
    return []
  }

  return eligibleRosterIds.filter((rosterId) => !weeklyEffects.protectedRosterIds.has(rosterId))
}

export async function getCouncilsImmuneTribeIds(councilId: string): Promise<Set<string>> {
  const council = await prisma.survivorTribalCouncil.findUnique({
    where: { id: councilId },
    select: {
      leagueId: true,
      week: true,
    },
  })
  if (!council) return new Set<string>()
  return (await getWeeklyEffectState(council.leagueId, council.week)).immuneTribeIds
}
