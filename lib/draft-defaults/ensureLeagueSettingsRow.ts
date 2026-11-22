import { prisma } from '@/lib/prisma'
import { getDraftConfigForLeague } from '@/lib/draft-defaults/DraftRoomConfigResolver'

/**
 * Gives a league its draft-settings row when it has none, and leaves an existing row alone.
 *
 * A league built outside the create form (a tournament's own leagues are) has no row. The row's
 * column default is 15 rounds, which is not that league's roster size: a 13-slot league then
 * drafts 13 rounds and stalls with two rounds nobody can fill. So the first row takes the round
 * count the draft room already resolves for the league.
 */
export async function ensureLeagueSettingsRow(
  leagueId: string,
  firstValues: Record<string, unknown> = {},
): Promise<void> {
  const existing = await prisma.leagueSettings.findUnique({ where: { leagueId }, select: { id: true } })
  if (existing) return
  const config = await getDraftConfigForLeague(leagueId).catch(() => null)
  const rounds = Number(config?.rounds)
  await prisma.leagueSettings.create({
    data: {
      leagueId,
      ...(Number.isInteger(rounds) && rounds >= 1 && rounds <= 50 ? { rounds } : {}),
      ...firstValues,
    } as never,
  })
}
