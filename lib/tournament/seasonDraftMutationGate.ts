import { prisma } from '@/lib/prisma'
import { seasonSetupBlocked } from './seasonNativeContract'

export const SEASON_DRAFT_MUTATION_BLOCKED = 'Tournament draft rules are frozen. Use the tournament hub for supported controls.'

/** Marker presence fails closed even for malformed bindings and manually changed statuses. */
export async function isSeasonTournamentDraft(leagueId: string): Promise<boolean> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
  return seasonSetupBlocked(league?.settings)
}
