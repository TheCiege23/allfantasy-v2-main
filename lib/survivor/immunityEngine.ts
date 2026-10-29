import { prisma } from '@/lib/prisma'
import { getRosterTeamMap } from '@/lib/zombie/rosterTeamMap'
import { getSurvivorConfig } from './SurvivorLeagueConfig'
import { getLeagueSeasonForSurvivor } from './SurvivorTimelineResolver'
import { postHostMessage } from './hostEngine'

export type ImmunityResult = { immuneTribeId: string | null; losingTribeId: string | null }

async function rosterWeekPoints(leagueId: string, rosterId: string, week: number): Promise<number> {
  const map = await getRosterTeamMap(leagueId)
  const teamId = map.rosterIdToTeamId.get(rosterId)
  if (!teamId) return 0
  const season = await getLeagueSeasonForSurvivor(leagueId)
  const perf = await prisma.teamPerformance.findFirst({
    where: { teamId, week, season },
    select: { points: true },
  })
  return perf?.points ?? 0
}

export async function awardTribeImmunity(leagueId: string, week: number): Promise<ImmunityResult> {
  const config = await getSurvivorConfig(leagueId)
  if (!config) return { immuneTribeId: null, losingTribeId: null }

  const tribes = await prisma.survivorTribe.findMany({
    where: { configId: config.configId, isActive: true },
    include: { members: true },
  })

  let best: { id: string; score: number } | null = null
  let worst: { id: string; score: number } | null = null
  for (const t of tribes) {
    let score = 0
    for (const m of t.members) {
      score += await rosterWeekPoints(leagueId, m.rosterId, week)
    }
    if (!best || score > best.score) best = { id: t.id, score }
    if (!worst || score < worst.score) worst = { id: t.id, score }
  }

  if (best?.id) {
    await prisma.survivorPlayer.updateMany({
      where: { leagueId, tribeId: best.id },
      data: { hasImmunityThisWeek: true, immunitySource: 'tribe_win' },
    })
  }

  await postHostMessage(leagueId, 'immunity_announcement', { week, bestTribeId: best?.id }, 'league_chat').catch(
    () => {},
  )

  return { immuneTribeId: best?.id ?? null, losingTribeId: worst?.id ?? null }
}

export async function awardIndividualImmunity(leagueId: string, week: number): Promise<void> {
  const players = await prisma.survivorPlayer.findMany({
    where: { leagueId, playerState: 'active' },
  })
  let top: { userId: string; pts: number } | null = null
  for (const p of players) {
    if (!p.redraftRosterId) continue
    const pts = await rosterWeekPoints(leagueId, p.redraftRosterId, week)
    if (!top || pts > top.pts) top = { userId: p.userId, pts }
  }
  if (top) {
    await prisma.survivorPlayer.updateMany({
      where: { leagueId, userId: top.userId },
      data: { hasImmunityThisWeek: true, immunitySource: 'individual_win' },
    })
  }
}

export async function clearWeeklyImmunity(leagueId: string): Promise<void> {
  // The weekly necklace (tribe_top_score) is worn until the next lineup lock, not the week flip;
  // clearExpiredTribeImmunity takes it off.
  await prisma.survivorPlayer.updateMany({
    where: { leagueId, OR: [{ immunitySource: null }, { immunitySource: { not: 'tribe_top_score' } }] },
    data: { hasImmunityThisWeek: false, immunitySource: null },
  })
}
