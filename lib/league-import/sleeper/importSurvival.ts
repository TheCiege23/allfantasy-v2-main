import { prisma } from '@/lib/prisma'
import { isLeagueTombstoned } from '@/lib/league-delete/leagueTombstones'
import { getLeagueInfo, getLeagueMatchups, getLeagueRosters } from '@/lib/sleeper-client'
import { isCompletedSleeperEliminationCandidate, verifySleeperSurvival, type SleeperSurvivalEvidence } from './survivalEvidence'

type OwnerSeason = {
  userId: string
  platformLeagueId: string
  season: number
}

export async function saveSleeperSurvivalEvidence(owner: OwnerSeason, evidence: SleeperSurvivalEvidence): Promise<boolean> {
  const { userId, platformLeagueId, season } = owner
  if (await isLeagueTombstoned({ userId, platform: 'sleeper', platformLeagueId })) return false
  const key = { userId, platformLeagueId, season }
  const data = { evidence }
  await prisma.sleeperCareerSurvival.upsert({
    where: { userId_platformLeagueId_season: key },
    create: { ...key, ...data },
    update: data,
  })
  return true
}

export async function importSleeperSurvival(
  owner: OwnerSeason, league: unknown, rosters: unknown, sleeperUserId: string,
): Promise<void> {
  try {
    const evidence = await verifySleeperSurvival(league, rosters, sleeperUserId, week => getLeagueMatchups(owner.platformLeagueId, week))
    if (evidence) await saveSleeperSurvivalEvidence(owner, evidence)
  } catch (err) {
    console.warn('[sleeper-survival] Could not import completed result', err)
  }
}

export async function importSleeperSurvivalById(owner: OwnerSeason, sleeperUserId: string): Promise<void> {
  try {
    const league = await getLeagueInfo(owner.platformLeagueId)
    if (!isCompletedSleeperEliminationCandidate(league)) return
    const rosters = await getLeagueRosters(owner.platformLeagueId)
    await importSleeperSurvival(owner, league, rosters, sleeperUserId)
  } catch (err) {
    console.warn('[sleeper-survival] Could not read the imported league', err)
  }
}
