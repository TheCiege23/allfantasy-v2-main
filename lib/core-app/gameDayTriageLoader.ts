import 'server-only'

import { prisma } from '@/lib/prisma'
import { normalizeTeamAbbrev } from '@/lib/team-abbrev'
import { triageRows, type GameDayTriage, type TriageInjury, type TriageStarter } from './gameDayTriage'
import type { SectionState } from './leagueHome'
import { asHeadshotUrl } from './playerIdentityCompose'
import { unresolvedClubNames, weekKickoffs } from './playerGame'
import { resolveSportsWeek } from './sportsWeek'

/**
 * Your flagged starters across every league — the finder's game-day home.
 *
 * Five bounded reads, on the finder's own joins:
 *   1. your claimed teams in the leagues you play (the same three-candidate
 *      predicate resolveLeagueSlots uses — platformUserId | externalId | userId);
 *   2. those leagues' names and platforms;
 *   3. your rosters there, and their `starters` ids;
 *   4. one catalog read for every starter, and one injury read for their names;
 *   5. the week's schedule, for every club's kickoff.
 *
 * ⚠ NEVER computeLineupActionsForUser. That engine costs hundreds of HTTP
 * calls and dozens of queries per user and must not run from a page render;
 * this list answers a narrower question with a handful of indexed reads.
 *
 * ⚠ INJURY ROWS MATCH BY NAME, SO THE CLUB IS CHECKED. Two NFL players can
 * share a name; a row that names a club is used only when it folds to the
 * starter's club, and a row with no club is accepted as the feed's word.
 */

const MAX_LEAGUES = 40

export async function loadGameDayTriage(userId: string | null | undefined, leagueIds: string[], nowIso: string = new Date().toISOString()): Promise<SectionState<GameDayTriage>> {
  if (!userId) return { available: false, reason: 'sign in to see your flagged starters' }
  const ids = leagueIds.slice(0, MAX_LEAGUES)
  if (ids.length === 0) return { available: false, reason: 'connect a league to see your starters here' }

  const teams = await prisma.leagueTeam
    .findMany({ where: { claimedByUserId: userId, leagueId: { in: ids } }, select: { leagueId: true, platformUserId: true, externalId: true } })
    .catch(() => [] as Array<{ leagueId: string; platformUserId: string | null; externalId: string }>)
  const candidatesByLeague = new Map<string, Set<string>>()
  for (const t of teams) {
    const set = candidatesByLeague.get(t.leagueId) ?? new Set<string>()
    for (const c of [t.platformUserId, t.externalId, userId]) if (c) set.add(c)
    candidatesByLeague.set(t.leagueId, set)
  }
  const claimedLeagueIds = [...candidatesByLeague.keys()]
  const allCandidates = [...new Set([...candidatesByLeague.values()].flatMap((s) => [...s]))]
  if (claimedLeagueIds.length === 0) return { available: false, reason: 'none of your leagues has a claimed team, so there is no starting lineup to read' }

  const [leagues, rosters] = await Promise.all([
    prisma.league
      .findMany({ where: { id: { in: claimedLeagueIds } }, select: { id: true, name: true, platform: true } })
      .catch(() => [] as Array<{ id: string; name: string; platform: string | null }>),
    prisma.roster
      .findMany({ where: { leagueId: { in: claimedLeagueIds }, platformUserId: { in: allCandidates } }, select: { leagueId: true, platformUserId: true, playerData: true } })
      .catch(() => [] as Array<{ leagueId: string; platformUserId: string | null; playerData: unknown }>),
  ])
  const leagueById = new Map(leagues.map((l) => [l.id, l]))

  // One roster per league — the first that matches your candidates — and its starters.
  const startersByLeague = new Map<string, string[]>()
  for (const r of rosters) {
    if (startersByLeague.has(r.leagueId)) continue
    if (!r.platformUserId || !candidatesByLeague.get(r.leagueId)?.has(r.platformUserId)) continue
    const pd = (r.playerData ?? {}) as Record<string, unknown>
    const starters = Array.isArray(pd.starters) ? pd.starters.map((x) => (x == null ? '' : String(x))).filter((x) => x && x !== '0') : []
    startersByLeague.set(r.leagueId, starters)
  }
  const allIds = [...new Set([...startersByLeague.values()].flat())]
  if (allIds.length === 0) {
    return { available: true, data: { rows: [], week: null, leaguesRead: startersByLeague.size, startersRead: 0 } }
  }

  const players = await prisma.sportsPlayer
    .findMany({
      where: { sleeperId: { in: allIds } },
      select: { sleeperId: true, sport: true, externalId: true, name: true, position: true, team: true, imageUrl: true },
    })
    .catch(() => [] as Array<{ sleeperId: string | null; sport: string; externalId: string; name: string; position: string | null; team: string | null; imageUrl: string | null }>)
  // The catalog holds a row per source; keep one per id, preferring the row with a headshot.
  const playerById = new Map<string, (typeof players)[number]>()
  for (const p of players) {
    if (!p.sleeperId) continue
    const cur = playerById.get(p.sleeperId)
    if (!cur || (!cur.imageUrl && p.imageUrl)) playerById.set(p.sleeperId, p)
  }

  const names = [...new Set([...playerById.values()].map((p) => p.name))]
  const sport = [...playerById.values()][0]?.sport ?? 'NFL'
  const [injuryRows, sportsWeek] = await Promise.all([
    prisma.sportsInjury
      .findMany({
        where: { sport, playerName: { in: names } },
        orderBy: { fetchedAt: 'desc' },
        select: { playerName: true, team: true, status: true, description: true, date: true },
      })
      .catch(() => [] as Array<{ playerName: string; team: string | null; status: string | null; description: string | null; date: Date | null }>),
    resolveSportsWeek(sport).catch(() => null),
  ])
  const clubByName = new Map<string, string | null>()
  for (const p of playerById.values()) clubByName.set(p.name.trim().toLowerCase(), normalizeTeamAbbrev(p.team))
  const injuries = new Map<string, TriageInjury>()
  for (const r of injuryRows) {
    const key = r.playerName.trim().toLowerCase()
    if (injuries.has(key)) continue // freshest first, by the orderBy
    const rowClub = normalizeTeamAbbrev(r.team)
    const club = clubByName.get(key) ?? null
    if (rowClub && club && rowClub !== club) continue // a namesake on another club
    injuries.set(key, { status: r.status, description: r.description, reportedAt: r.date ? r.date.toISOString() : null })
  }

  const games = sportsWeek
    ? await prisma.sportsGame
        .findMany({
          where: { sport, season: sportsWeek.season, week: sportsWeek.week, seasonType: sportsWeek.seasonType },
          orderBy: { startTime: 'asc' },
          take: 400,
          select: { homeTeam: true, awayTeam: true, startTime: true, seasonType: true, venue: true },
        })
        .catch(() => [])
    : []
  const kickoffs = weekKickoffs(games)

  const starters: TriageStarter[] = []
  for (const [leagueId, ids] of startersByLeague) {
    const league = leagueById.get(leagueId)
    for (const id of ids) {
      const p = playerById.get(id)
      if (!p || !p.sleeperId) continue
      starters.push({
        sleeperId: p.sleeperId,
        sport: p.sport,
        externalId: p.externalId,
        name: p.name,
        position: p.position,
        team: p.team,
        imageUrl: asHeadshotUrl(p.imageUrl),
        leagueId,
        leagueName: league?.name ?? 'League',
        platform: String(league?.platform ?? 'manual').toLowerCase(),
      })
    }
  }

  return {
    available: true,
    data: {
      rows: triageRows({ starters, injuries, kickoffs, nowIso, week: sportsWeek?.week ?? null, unresolved: unresolvedClubNames(games).length }),
      week: sportsWeek ? { season: sportsWeek.season, week: sportsWeek.week } : null,
      leaguesRead: startersByLeague.size,
      startersRead: starters.length,
    },
  }
}
