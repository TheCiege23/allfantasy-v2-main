import { prisma } from '@/lib/prisma'
import { clientLeagueSettings } from '@/lib/league/clientLeagueSettings'

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

  // 🛑 These settings are pasted into model prompts (chimmy-setup, draft-help, commish-note…) and
  // the model's text comes back to the user. The retired manager-label keys must reach neither
  // (Milestone 32; lib/league/clientLeagueSettings.ts).
  const forAi = { ...league, sport: String(league.sport), settings: clientLeagueSettings(league.settings) }

  const isCommish = league.userId === appUserId
  if (isCommish) {
    return forAi
  }

  const claimed = await prisma.leagueTeam.findFirst({
    where: { leagueId, claimedByUserId: appUserId },
    select: { id: true },
  })
  if (!claimed) return null

  return forAi
}

export function requireSleeper(league: LeagueForAi): string | null {
  if (league.platform !== 'sleeper') return null
  return league.platformLeagueId
}
