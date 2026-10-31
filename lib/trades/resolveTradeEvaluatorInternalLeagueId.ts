/**
 * Map a native id or an imported provider league id to an authorized AF league row.
 */

import { prisma } from '@/lib/prisma'
import { resolveLeagueMembership } from '@/lib/league-access'

export async function resolveTradeEvaluatorInternalLeagueId(
  leagueIdRaw: string | undefined,
  userId: string,
): Promise<string | null> {
  if (!leagueIdRaw?.trim()) return null
  const raw = leagueIdRaw.trim()

  const direct = await prisma.league.findUnique({
    where: { id: raw },
    select: { id: true },
  })
  if (direct) {
    const access = await resolveLeagueMembership(direct.id, userId)
    return access.ok ? direct.id : null
  }

  // The same external id can have several seasons or older duplicate imports.
  // Check membership for each candidate; a Fantrax member may claim a league
  // owned by another AF account, including one of several teams in that league.
  const candidates = await prisma.league.findMany({
    where: { platformLeagueId: raw },
    orderBy: { season: 'desc' },
    select: { id: true },
  })
  for (const candidate of candidates) {
    const access = await resolveLeagueMembership(candidate.id, userId)
    if (access.ok) return candidate.id
  }
  return null
}
