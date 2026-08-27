import 'server-only'
import { prisma } from '@/lib/prisma'

/**
 * RESOLVE A LEAGUE THE USER NAMED, WITHOUT EVER TRUSTING THE MODEL WITH AN ID.
 *
 * The chat panel promises "Answers cover every league you play. Ask about one by
 * name, or pick it above." The first half was false: every league tool read the
 * league from the SESSION, so with the scope set to "All leagues" nothing was
 * selected, every tool returned its no-league result, and the model filled the
 * silence — telling a commissioner his 32-team league had 18 teams with equal
 * FAAB budgets. Naming a league did nothing at all.
 *
 * ⚠ THE MODEL SUPPLIES A NAME, NEVER AN ID, AND THAT DISTINCTION IS THE WHOLE
 * SECURITY MODEL. A tool taking a leagueId is a tool that can be handed somebody
 * else's leagueId. A name is resolved here, server-side, against leagues this
 * user is demonstrably in.
 *
 * ⚠ AND WE ONLY EVER LOOK INSIDE THEIR OWN LEAGUES. The candidate set is built
 * from the user's memberships FIRST and the name is matched within it. Searching
 * all leagues by name and filtering afterwards would give the same answers while
 * making "does a league called X exist?" answerable by anyone — the ordering is
 * the protection, not the filter.
 *
 * Membership mirrors `resolveLeagueMembership` in lib/league-access.ts, which is
 * the one predicate that decides this. All four paths are covered; in particular
 * the claim path keys on `claimedByUserId` and NEVER on the nullable
 * `platformUserId` of LeagueTeam, which is not an AppUser id.
 */

export type NamedLeague = {
  id: string
  name: string
  sport: string
  season: number
}

export type LeagueNameLookup =
  | { kind: 'match'; league: NamedLeague }
  | { kind: 'ambiguous'; candidates: NamedLeague[] }
  | { kind: 'none'; known: NamedLeague[] }

/** Nobody plays more than this many; the cap only stops a pathological account. */
const MAX_LEAGUES = 400

/** How many names to offer back when we cannot resolve one. */
const MAX_SUGGESTIONS = 12

/** Every league id this user is a member of, by any of the four routes. */
async function memberLeagueIds(userId: string): Promise<string[]> {
  const [owned, redraft, rosters, claimed] = await Promise.all([
    prisma.league
      .findMany({ where: { userId }, select: { id: true }, take: MAX_LEAGUES })
      .catch(() => []),
    prisma.redraftLeagueMember
      .findMany({ where: { userId }, select: { leagueId: true }, take: MAX_LEAGUES })
      .catch(() => []),
    prisma.roster
      .findMany({
        where: { platformUserId: userId },
        select: { leagueId: true },
        distinct: ['leagueId'],
        take: MAX_LEAGUES,
      })
      .catch(() => []),
    prisma.leagueTeam
      .findMany({
        where: { claimedByUserId: userId },
        select: { leagueId: true },
        distinct: ['leagueId'],
        take: MAX_LEAGUES,
      })
      .catch(() => []),
  ])

  const ids = new Set<string>()
  for (const r of owned) ids.add(r.id)
  for (const r of redraft) if (r.leagueId) ids.add(r.leagueId)
  for (const r of rosters) if (r.leagueId) ids.add(r.leagueId)
  for (const r of claimed) if (r.leagueId) ids.add(r.leagueId)
  return [...ids]
}

/** Fold case, punctuation and spacing so "KBFL!" matches "kbfl". */
function normalise(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

/**
 * Find the one league this user means by `query`.
 *
 * ⚠ AMBIGUITY IS AN ANSWER, NOT A PROBLEM TO GUESS PAST. Someone in sixty-five
 * leagues has several called "Dynasty something"; picking one produces a
 * confident, precise answer about a league they did not ask about, which is
 * indistinguishable from a correct one. Two matches means we ask.
 */
export async function findLeagueByName(
  userId: string,
  query: string,
): Promise<LeagueNameLookup> {
  const wanted = normalise(query ?? '')
  const ids = await memberLeagueIds(userId)

  const leagues = ids.length
    ? await prisma.league
        .findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true, sport: true, season: true },
          orderBy: { season: 'desc' },
          take: MAX_LEAGUES,
        })
        .catch(() => [])
    : []

  const named: NamedLeague[] = leagues
    .filter((l) => l.name)
    .map((l) => ({ id: l.id, name: l.name as string, sport: String(l.sport), season: l.season }))

  if (!wanted) return { kind: 'none', known: named.slice(0, MAX_SUGGESTIONS) }

  /* Exact first — an exact name must never lose to a longer one containing it. */
  const exact = named.filter((l) => normalise(l.name) === wanted)
  if (exact.length === 1) return { kind: 'match', league: exact[0] }
  if (exact.length > 1) return { kind: 'ambiguous', candidates: exact.slice(0, MAX_SUGGESTIONS) }

  const partial = named.filter((l) => {
    const n = normalise(l.name)
    return n.includes(wanted) || wanted.includes(n)
  })
  if (partial.length === 1) return { kind: 'match', league: partial[0] }
  if (partial.length > 1) return { kind: 'ambiguous', candidates: partial.slice(0, MAX_SUGGESTIONS) }

  return { kind: 'none', known: named.slice(0, MAX_SUGGESTIONS) }
}
