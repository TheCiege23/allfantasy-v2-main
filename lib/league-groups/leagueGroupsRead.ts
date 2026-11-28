import 'server-only'
import { prisma } from '@/lib/prisma'
import { groupLeagues, readLeagueGroup, type GroupableLeague, type LeagueGroupView } from './leagueGroups'

/**
 * The reader's league groups (lib/league-groups/leagueGroups.ts).
 *
 * Membership is the format hubs' rule: the league's own owner row, or a league where the reader has
 * claimed a team. A group must never list a league the reader could not open.
 *
 * ⚠ THE READ IS BOUNDED. A hung query is not a rejection, so without a deadline the page would sit on
 * nothing forever — the same failure lib/core-app/formatHubs.ts records at /core/hubs/efl. Past the
 * deadline this REJECTS, and the page says it could not read the leagues: an empty list here would be
 * indistinguishable from "you have no groups".
 */
const READ_TIMEOUT_MS = 8_000

function withTimeout<T>(run: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`league groups read exceeded ${ms}ms`)), ms)
  })
  return Promise.race([run, deadline]).finally(() => clearTimeout(timer))
}

async function readMemberLeagues(userId: string): Promise<GroupableLeague[]> {
  const rows = await withTimeout(
    prisma.league.findMany({
      where: { OR: [{ userId }, { teams: { some: { claimedByUserId: userId } } }] },
      select: { id: true, name: true, sport: true, platform: true, leagueSize: true, season: true, userId: true, settings: true },
    }),
    READ_TIMEOUT_MS,
  )
  return rows.map((r) => ({ ...r, sport: String(r.sport) }))
}

export async function listLeagueGroupsFor(userId: string): Promise<LeagueGroupView[]> {
  return groupLeagues(await readMemberLeagues(userId), userId)
}

/**
 * Names of the groups this commissioner has already made, for the settings control's suggestions —
 * typing "Road To Glory" once and picking it from a list after is how seven leagues end up in ONE group
 * rather than in seven near-identical ones.
 */
export async function groupNamesSetBy(userId: string, opts: { excludeLeagueId?: string } = {}): Promise<string[]> {
  const leagues = await readMemberLeagues(userId)
  const names = new Map<string, string>()
  for (const l of leagues) {
    // Leaving out the league being edited lets a commissioner fix the spelling of a one-league group.
    if (l.id === opts.excludeLeagueId) continue
    const tag = readLeagueGroup(l.settings)
    if (tag && tag.setBy === userId) names.set(tag.name.toLowerCase(), tag.name)
  }
  return [...names.values()].sort((a, b) => a.localeCompare(b))
}
