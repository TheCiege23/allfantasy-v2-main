import { prisma } from '@/lib/prisma'

export type LeagueForAi = {
  id: string
  userId: string
  platform: string
  platformLeagueId: string
  name: string | null
  sport: string
  season?: number
  scoring?: string | null
  settings: unknown
}

export async function assertLeagueAccess(
  leagueId: string,
  appUserId: string
): Promise<LeagueForAi | null> {
  const league = await prisma.league.findFirst({
    where: { id: leagueId },
    select: {
      id: true,
      userId: true,
      platform: true,
      platformLeagueId: true,
      name: true,
      sport: true,
      season: true,
      scoring: true,
      settings: true,
    },
  })
  if (!league?.platformLeagueId) return null

  const isCommish = league.userId === appUserId
  if (isCommish) {
    return { ...league, sport: String(league.sport) }
  }

  const claimed = await prisma.leagueTeam.findFirst({
    where: { leagueId, claimedByUserId: appUserId },
    select: { id: true },
  })
  if (!claimed) return null

  return { ...league, sport: String(league.sport) }
}

export function requireSleeper(league: LeagueForAi): string | null {
  if (league.platform !== 'sleeper') return null
  return league.platformLeagueId
}
