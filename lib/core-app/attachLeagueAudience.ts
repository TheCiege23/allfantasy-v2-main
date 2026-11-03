import 'server-only'
import { prisma } from '@/lib/prisma'
import { leagueAudience, type LeagueAudience } from '@/lib/league-privacy/leagueAudience'
import { isNativePlatform } from '@/lib/public-discovery/externalListing'

/**
 * Marks each league made here PUBLIC or PRIVATE (lib/league-privacy/leagueAudience.ts), so
 * /leagues can say which on every card. A league on Sleeper, ESPN and the rest stays `null`:
 * who can see it is that platform's setting, not ours.
 *
 * One read, native ids only, settings and nothing else. A failed read leaves every label off
 * rather than guessing one — "private" printed on a public league would be a wrong answer.
 */
export async function attachLeagueAudience(
  leagues: Array<{ id: string; platform?: string | null; audience?: LeagueAudience | null }>,
): Promise<void> {
  const native = leagues.filter((l) => isNativePlatform(l.platform))
  for (const league of leagues) league.audience = null
  if (native.length === 0) return
  let rows: Array<{ id: string; settings: unknown }>
  try {
    rows = await prisma.league.findMany({
      where: { id: { in: native.map((l) => l.id) } },
      select: { id: true, settings: true },
    })
  } catch {
    return
  }
  const audienceById = new Map(rows.map((row) => [row.id, leagueAudience(row.settings)]))
  for (const league of native) league.audience = audienceById.get(league.id) ?? null
}
