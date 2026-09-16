import { prisma } from '@/lib/prisma'

/**
 * The team a Chimmy request names, kept only when it is the CALLER'S OWN team in the verified league.
 *
 * 🛑 `teamId` ARRIVES FROM THE CLIENT. The league is membership-checked before anything reads it, but
 * the team was not: a member could send another member's team id and have that team's dynasty
 * projection and team snapshots read into their answer, labelled as their own. This keeps the id only
 * when a `LeagueTeam` in that league is claimed by the caller.
 *
 * Both id spaces are accepted because both are sent: the AI coaching page sends `LeagueTeam.id` (a
 * UUID), while URL-driven entries send the platform's team id (`externalId`). The result is always
 * the `externalId` — the id the downstream stores key on (`DynastyProjection.teamId` is written from
 * `LeagueTeam.externalId`), so a coaching-page request now finds its projection instead of missing it.
 *
 * Null whenever the answer is not a proven yes: no team named, no verified league, no signed-in user,
 * not the caller's team, or the lookup failed.
 */
export async function resolveCallerTeamId(args: {
  leagueId: string | null | undefined
  userId: string | null | undefined
  teamId: string | null | undefined
}): Promise<string | null> {
  const teamId = typeof args.teamId === 'string' ? args.teamId.trim() : ''
  if (!teamId || !args.leagueId || !args.userId) return null
  try {
    const team = await prisma.leagueTeam.findFirst({
      where: {
        leagueId: args.leagueId,
        claimedByUserId: args.userId,
        OR: [{ id: teamId }, { externalId: teamId }],
      },
      select: { externalId: true },
    })
    const externalId = team?.externalId?.trim()
    return externalId || null
  } catch {
    return null
  }
}
