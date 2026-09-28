import { prisma } from '@/lib/prisma'
import { getBlockedEitherWayUserIds } from '@/lib/moderation/BlockUserService'

/**
 * League-mates: the people the viewer shares at least one league with, for the DM / huddle picker.
 *
 * ⚠ MEMBERSHIP IS `resolveLeagueMembership`'s FOUR PATHS, AND MUST STAY SO (lib/league-access.ts):
 *
 *   League.userId                owner / commissioner
 *   RedraftLeagueMember.userId   redraft leagues
 *   Roster.platformUserId        roster-backed members — the LARGEST population
 *   LeagueTeam.claimedByUserId   claim-only managers
 *
 * The single-league `@` autocomplete (`/api/leagues/[leagueId]/members/autocomplete`) reads claimed
 * teams only, which would hide every roster-backed member here. Same reason `memberLeaguePlatformIdsFor`
 * spells out all four. `LeagueTeam.platformUserId` is deliberately not a path, as there.
 *
 * ⚠ ONE QUERY SHAPE, NO N+1. Three reads regardless of how many leagues the viewer is in: the
 * viewer's leagues WITH every member column in one `findMany`, the block list (in parallel), and one
 * `appUser.findMany` over the union. Nothing is looked up per league or per person.
 *
 * 🛑 NEVER EMAIL. The user select names its four columns; a display-name fallback is the username,
 * never the address. Postgres only — no provider is called from here.
 */

export type LeagueMate = {
  id: string
  displayName: string
  username: string
  avatarUrl: string | null
  /** Names of the leagues the viewer shares with them, de-duplicated (a league has a row per season). */
  sharedLeagues: string[]
}

/** How many people one answer carries. The picker shows a short list, not a directory. */
export const LEAGUE_MATES_LIMIT = 20
/** Upper bound on the rows read before ranking — a guard against a pathological league count. */
const CANDIDATE_READ_CAP = 500
const QUERY_MAX = 64
const UNNAMED_LEAGUE = 'Unnamed league'

/** Trimmed, a leading `@` dropped (people type handles), capped. Empty means "everyone". */
export function normalizeLeagueMateQuery(raw: string | null | undefined): string {
  return String(raw ?? '')
    .trim()
    .replace(/^@+/, '')
    .trim()
    .slice(0, QUERY_MAX)
}

/** 0 = the name or handle starts with the query (or a word in the name does), 1 = it only contains it. */
function matchRank(q: string, username: string, displayName: string): number {
  if (!q) return 0
  const needle = q.toLowerCase()
  const u = username.toLowerCase()
  const d = displayName.toLowerCase()
  if (u.startsWith(needle) || d.startsWith(needle)) return 0
  if (d.split(/\s+/).some((w) => w.startsWith(needle))) return 0
  return 1
}

export async function listLeagueMates(
  viewerId: string,
  rawQuery?: string | null,
  limit: number = LEAGUE_MATES_LIMIT,
): Promise<LeagueMate[]> {
  if (!viewerId) return []
  const q = normalizeLeagueMateQuery(rawQuery)
  const take = Math.max(1, Math.min(Math.floor(limit) || LEAGUE_MATES_LIMIT, LEAGUE_MATES_LIMIT))

  const [leagues, blocked] = await Promise.all([
    prisma.league.findMany({
      where: {
        OR: [
          { userId: viewerId },
          { redraftMembers: { some: { userId: viewerId } } },
          { rosters: { some: { platformUserId: viewerId } } },
          { teams: { some: { claimedByUserId: viewerId } } },
        ],
      },
      select: {
        name: true,
        userId: true,
        redraftMembers: { select: { userId: true } },
        rosters: { select: { platformUserId: true } },
        teams: { where: { claimedByUserId: { not: null } }, select: { claimedByUserId: true } },
      },
    }),
    // Throws BlockListUnavailableError rather than answering "nobody is blocked".
    getBlockedEitherWayUserIds(viewerId),
  ])

  /* Who shares which leagues with the viewer, by name. */
  const sharedById = new Map<string, Set<string>>()
  for (const league of leagues) {
    const name = league.name?.trim() || UNNAMED_LEAGUE
    const members = new Set<string>()
    if (league.userId) members.add(league.userId)
    for (const m of league.redraftMembers) if (m.userId) members.add(m.userId)
    for (const r of league.rosters) if (r.platformUserId) members.add(r.platformUserId)
    for (const t of league.teams) if (t.claimedByUserId) members.add(t.claimedByUserId)
    members.delete(viewerId)
    for (const id of members) {
      if (blocked.has(id)) continue
      let names = sharedById.get(id)
      if (!names) sharedById.set(id, (names = new Set()))
      names.add(name)
    }
  }
  if (sharedById.size === 0) return []

  const users = await prisma.appUser.findMany({
    where: {
      id: { in: [...sharedById.keys()] },
      ...(q
        ? {
            OR: [
              { username: { contains: q, mode: 'insensitive' as const } },
              { displayName: { contains: q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    },
    // 🛑 Four columns, named. Never `email`, and never a bare `select: undefined` that returns them all.
    select: { id: true, username: true, displayName: true, avatarUrl: true },
    take: CANDIDATE_READ_CAP,
  })

  const mates: Array<LeagueMate & { rank: number }> = []
  for (const u of users) {
    // Belt and braces: the id list already excludes them, but a mocked or widened read must not.
    if (u.id === viewerId || blocked.has(u.id)) continue
    const names = sharedById.get(u.id)
    const username = (u.username ?? '').trim()
    if (!names || !username) continue
    const displayName = (u.displayName ?? '').trim() || username
    mates.push({
      id: u.id,
      displayName,
      username,
      avatarUrl: u.avatarUrl ?? null,
      sharedLeagues: [...names].sort((a, b) => a.localeCompare(b)),
      rank: matchRank(q, username, displayName),
    })
  }

  /* Best match first; then the people you share the most leagues with; then by name. */
  mates.sort(
    (a, b) =>
      a.rank - b.rank ||
      b.sharedLeagues.length - a.sharedLeagues.length ||
      a.displayName.localeCompare(b.displayName),
  )

  return mates.slice(0, take).map(({ rank: _rank, ...mate }) => mate)
}
