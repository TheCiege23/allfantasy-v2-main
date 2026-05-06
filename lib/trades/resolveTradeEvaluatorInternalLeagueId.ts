/**
 * Map trade-evaluator `league_id` (Sleeper platform id or internal AF league UUID) to Prisma `league.id`.
 */

import { prisma } from '@/lib/prisma'

export async function resolveTradeEvaluatorInternalLeagueId(
  leagueIdRaw: string | undefined,
  userId: string,
): Promise<string | null> {
  if (!leagueIdRaw?.trim()) return null
  const raw = leagueIdRaw.trim()

  const direct = await prisma.league.findFirst({
    where: { id: raw },
    select: { id: true },
  })
  if (direct) return direct.id

  const sleeper = await prisma.league.findFirst({
    where: {
      userId,
      platform: 'sleeper',
      platformLeagueId: raw,
    },
    orderBy: { season: 'desc' },
    select: { id: true },
  })
  return sleeper?.id ?? null
}
