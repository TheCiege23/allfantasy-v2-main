import { prisma } from '@/lib/prisma'
import { acceptedCoOwnerRosterId } from '@/lib/team-coowners/access'

const dispersalDraftClient = prisma.dispersalDraft

/** Resolves Sleeper-style roster id (`LeagueTeam.externalId`) for the logged-in user. */
export async function getRosterIdForLeagueUser(leagueId: string, userId: string): Promise<string | null> {
  const team = await prisma.leagueTeam.findFirst({
    where: { leagueId, claimedByUserId: userId },
    select: { externalId: true },
  })
  return team?.externalId ?? await acceptedCoOwnerRosterId(leagueId, userId)
}

export async function requireDispersalDraftForLeague(draftId: string, leagueId: string) {
  const draft = await dispersalDraftClient.findFirst({
    where: { id: draftId, leagueId },
    select: { id: true },
  })
  if (!draft) {
    const err = new Error('Draft not found') as Error & { status?: number }
    err.status = 404
    throw err
  }
  return draft
}
