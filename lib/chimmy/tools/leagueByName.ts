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
  /** Teams imported into this row. 0 means an empty shell — see the tie-break. */
  teamCount?: number
  /** The provider's own league id. Equal ids mean the SAME real-world league. */
  platformLeagueId?: string | null
  /** Who imported this copy. Used only to prefer the user's own row. */
  ownerUserId?: string | null
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

/**
 * Collapse rows that are the SAME real-world league imported more than once.
 *
 * ⚠ THIS IS NOT DEDUPLICATION BY GUESSWORK — `platformLeagueId` IS THE PROVIDER'S
 * OWN ID. Two rows carrying it are the same Sleeper league, not two leagues that
 * happen to share a name. Confirmed against production: KBFL exists twice on
 * platform id 1338541390891606016, both rows holding an identical 32 teams, 32
 * rosters and 2 claimed teams.
 *
 * ⚠ AND IT IS NOT A DATA BUG SO MUCH AS MULTI-TENANCY. `leagues.userId` is the
 * importer, so one Sleeper league produces one row PER MANAGER who imports it.
 * A user reaches their own copy as owner and a co-manager's copy through a
 * claimed team — which is exactly how one person ends up "in" the same league
 * twice and why asking them to choose was unanswerable. Both copies describe the
 * same 32 teams.
 *
 * Prefer the row the user imported; failing that the first, which the caller
 * ordered newest-first. Rows with no platform id are never collapsed — without
 * the provider's id there is no evidence they are the same thing.
 */
function collapseSameRealLeague(rows: NamedLeague[], userId: string): NamedLeague[] {
  const byPlatform = new Map<string, NamedLeague>()
  const out: NamedLeague[] = []

  for (const row of rows) {
    const key = row.platformLeagueId ? `${row.platformLeagueId}::${row.season}` : null
    if (!key) {
      out.push(row)
      continue
    }
    const held = byPlatform.get(key)
    if (!held) {
      byPlatform.set(key, row)
      continue
    }
    /* Their own import wins; otherwise keep the one already held (newest). */
    if (held.ownerUserId !== userId && row.ownerUserId === userId) byPlatform.set(key, row)
  }

  return [...out, ...byPlatform.values()]
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
  season?: number | null,
): Promise<LeagueNameLookup> {
  const wanted = normalise(query ?? '')
  const ids = await memberLeagueIds(userId)

  const leagues = ids.length
    ? await prisma.league
        .findMany({
          where: { id: { in: ids } },
          select: {
            id: true,
            name: true,
            sport: true,
            season: true,
            platformLeagueId: true,
            userId: true,
          },
          orderBy: [{ season: 'desc' }, { createdAt: 'desc' }],
          take: MAX_LEAGUES,
        })
        .catch(() => [])
    : []

  const named: NamedLeague[] = collapseSameRealLeague(
    leagues
      .filter((l) => l.name)
      .map((l) => ({
        id: l.id,
        name: l.name as string,
        sport: String(l.sport),
        season: l.season,
        platformLeagueId: l.platformLeagueId ?? null,
        ownerUserId: l.userId ?? null,
      })),
    userId,
  )

  if (!wanted) return { kind: 'none', known: named.slice(0, MAX_SUGGESTIONS) }

  /*
   * ⚠ THE SAME LEAGUE APPEARS ONCE PER SEASON. `League` carries a `season`
   * column and an import writes a row per season, so a long-running league is
   * several rows sharing one name — "which of the two KBFL leagues did you
   * mean?" was unanswerable because BOTH are called KBFL. A season narrows it
   * without ever letting the model hand us an id.
   */
  const pool =
    typeof season === 'number' && Number.isFinite(season)
      ? (() => {
          const inSeason = named.filter((l) => l.season === season)
          /* Only narrow if it finds something; a wrong year must not erase the league. */
          return inSeason.length > 0 ? inSeason : named
        })()
      : named

  /* Exact first — an exact name must never lose to a longer one containing it. */
  const exact = pool.filter((l) => normalise(l.name) === wanted)
  if (exact.length === 1) return { kind: 'match', league: exact[0] }
  if (exact.length > 1) return settleDuplicates(exact)

  const partial = pool.filter((l) => {
    const n = normalise(l.name)
    return n.includes(wanted) || wanted.includes(n)
  })
  if (partial.length === 1) return { kind: 'match', league: partial[0] }
  if (partial.length > 1) return settleDuplicates(partial)

  return { kind: 'none', known: named.slice(0, MAX_SUGGESTIONS) }
}

/**
 * Break a tie between rows that name, sport and season cannot separate.
 *
 * ⚠ THIS REPO REALLY DOES HOLD DUPLICATE LEAGUE ROWS. KBFL resolved to two rows
 * with the same name, the same sport and the same 2026 season, so the honest
 * "which did you mean?" became a question with no answer — the reader can see no
 * difference either, because there isn't one to describe.
 *
 * ⚠ THIS IS NOT GUESSING, AND THE DISTINCTION MATTERS. Choosing the only row
 * that has any teams in it is choosing the only row that can answer ANY
 * question; the empty shell would return "no standings are stored" no matter
 * what was asked. Picking between two POPULATED rows would be guessing, and
 * that still refuses — now with the team counts, so the question it asks is one
 * the user can actually act on.
 */
async function settleDuplicates(candidates: NamedLeague[]): Promise<LeagueNameLookup> {
  const counted = await Promise.all(
    candidates.slice(0, MAX_SUGGESTIONS).map(async (l) => ({
      ...l,
      teamCount: await prisma.leagueTeam.count({ where: { leagueId: l.id } }).catch(() => 0),
    })),
  )

  const populated = counted.filter((l) => (l.teamCount ?? 0) > 0)
  if (populated.length === 1) return { kind: 'match', league: populated[0] }

  /* Nothing separates them, or several are real. Ask, and say what differs. */
  return { kind: 'ambiguous', candidates: counted }
}
