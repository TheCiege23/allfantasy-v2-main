import { commissionerAccess } from '@/lib/league/commissionerAccess'
import { resolveActingRoster } from '@/lib/league/viewerTeams'

/**
 * May this user move players on `rosterId`? Yes when they run that team (their own, an extra team they
 * manage, or the team they co-own), or when they are a commissioner allowed to make roster moves for any
 * team. League membership alone is not enough (2026-11-24 audit: any member could bench, taxi or IR
 * another team through the C2C and devy roster routes).
 */
export async function canMoveRosterPlayers(leagueId: string, userId: string, rosterId: string): Promise<boolean> {
  if (!leagueId || !userId || !rosterId) return false
  const acting = await resolveActingRoster(leagueId, userId, rosterId).catch(() => null)
  if (acting?.ok && acting.rosterId === rosterId) return true
  const commish = await commissionerAccess(leagueId, userId, 'rosters').catch(() => null)
  return Boolean(commish?.ok)
}
