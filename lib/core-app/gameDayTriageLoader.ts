import 'server-only'

import { prisma } from '@/lib/prisma'
import { triageRows, type GameDayTriage, type TriageStarter } from './gameDayTriage'
import { readInjuryClaims } from './injuryClaims'
import type { SectionState } from './leagueHome'
import { isBestBallLeagueRow } from './leagueBestBall'
import { composePlayerIdentities } from './playerIdentityCompose'
import { displayPosition } from './positionLabels'
import { unresolvedClubNames, weekKickoffs } from './playerGame'
import { collectRosterIds, loadEspnToSleeperMap, rosterIdSpaceOf } from './rosterIdSpace'
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

/*
 * ⚠ THIS WAS 40, AND IT SILENTLY DROPPED THE LEAGUES A MULTI-LEAGUE MANAGER HAS
 * MOST. The caller passes `playedLeagues`, sorted by NAME, so leagues 41+ were
 * whichever came last alphabetically — never read, never named. Measured on
 * production 2026-09-27: the largest account holds 64 NFL leagues for 2026 and six
 * accounts hold 20+; the finder read "40 of 65 lineups" for exactly the user this
 * screen is for. Every read below is one `IN (…)` query whatever the count, so the
 * bound exists only to stop a pathological account, and reaching it is said on
 * screen (`leaguesNotRead`) rather than swallowed. Ids are de-duplicated first
 * (559c56580), so a repeated id cannot spend the bound.
 */
const MAX_LEAGUES = 250

export async function loadGameDayTriage(userId: string | null | undefined, leagueIds: string[], nowIso: string = new Date().toISOString()): Promise<SectionState<GameDayTriage>> {
  if (!userId) return { available: false, reason: 'sign in to see your flagged starters' }
  const unique = [...new Set(leagueIds)]
  const ids = unique.slice(0, MAX_LEAGUES)
  const leaguesNotRead = Math.max(0, unique.length - ids.length)
  if (ids.length === 0) return { available: false, reason: 'connect a league to see your starters here' }

  const teams = await prisma.leagueTeam
    .findMany({ where: { claimedByUserId: userId, leagueId: { in: ids } }, select: { id: true, leagueId: true, platformUserId: true, externalId: true } })
    .catch(() => [] as Array<{ id: string; leagueId: string; platformUserId: string | null; externalId: string }>)
  const candidatesByLeague = new Map<string, Set<string>>()
  for (const t of teams) {
    const set = candidatesByLeague.get(t.leagueId) ?? new Set<string>()
    for (const c of [t.platformUserId, t.externalId, userId]) if (c) set.add(c)
    candidatesByLeague.set(t.leagueId, set)
  }
  // Your team's platform id per league — the ESPN teamId / Yahoo team number a lineup deep link needs (as playerFinder.resolveLeagueSlots).
  const teamIdByLeague = new Map<string, string>()
  for (const t of teams) if (t.externalId && !teamIdByLeague.has(t.leagueId)) teamIdByLeague.set(t.leagueId, t.externalId)
  const claimedLeagueIds = [...candidatesByLeague.keys()]
  const allCandidates = [...new Set([...candidatesByLeague.values()].flatMap((s) => [...s]))]
  if (claimedLeagueIds.length === 0) return { available: false, reason: 'none of your leagues has a claimed team, so there is no starting lineup to read' }

  type LeagueRow = {
    id: string
    name: string | null
    platform: string | null
    platformLeagueId: string | null
    season: number | null
    status: string | null
    lifecycleState: string | null
    bestBallMode: boolean | null
    leagueVariant: string | null
    guillotineMode: boolean | null
    leagueType: string | null
    settings: unknown
  }
  const [leagues, rawRosters, chopped, eliminations] = await Promise.all([
    prisma.league
      .findMany({
        where: { id: { in: claimedLeagueIds } },
        select: {
          id: true,
          name: true,
          platform: true,
          platformLeagueId: true,
          season: true,
          status: true,
          lifecycleState: true,
          bestBallMode: true,
          leagueVariant: true,
          guillotineMode: true,
          leagueType: true,
          settings: true,
        },
      })
      .catch(() => [] as LeagueRow[]),
    prisma.roster
      .findMany({ where: { leagueId: { in: claimedLeagueIds }, platformUserId: { in: allCandidates } }, select: { id: true, leagueId: true, platformUserId: true, playerData: true, updatedAt: true } })
      .catch(() => [] as Array<{ id: string; leagueId: string; platformUserId: string | null; playerData: unknown; updatedAt: Date | null }>),
    prisma.guillotineRosterState.findMany({ where: { leagueId: { in: claimedLeagueIds }, choppedAt: { not: null } }, select: { leagueId: true, rosterId: true } }).catch(() => []),
    prisma.guillotineElimination.findMany({
      where: { leagueId: { in: claimedLeagueIds }, eliminatedOwnerId: { in: [userId, ...teams.map((t) => t.platformUserId).filter((id): id is string => Boolean(id))] } },
      select: { leagueId: true, season: { select: { season: true } } },
    }).catch(() => []),
  ])
  const leagueById = new Map<string, LeagueRow>(leagues.map((l) => [l.id, l]))

  /*
   * ⚠ BEST BALL HAS NO LINEUP TO SET. The platform starts the best scorers after the
   * fact, so a hurt player in its `starters` is not a decision — and listing him put an
   * "Open lineup" button on a screen with nothing to change (Jaxson Dart, IR, "starting
   * in Dynasty BestBall League!"). Those leagues are left out and counted instead.
   */
  const bestBall = new Set(leagues.filter((l) => isBestBallLeagueRow(l)).map((l) => l.id))

  /*
   * ⚠ ONLY SLEEPER-ID ROSTERS ARE READ AS THEY ARE. Everything below looks players up by
   * Sleeper id, so a roster speaking another vocabulary must be translated or left out:
   *
   *   - ESPN rosters hold ESPN ids. The card translated them since 2026-09-07
   *     (rosterIdSpace.ts); this list did not, so every ESPN starter dropped out without a
   *     word. They are translated now — and an id WITHOUT a link is dropped, not kept:
   *     looked up raw, ESPN 4046 would be read as whoever is Sleeper 4046, a different
   *     person, and his injury would flag your lineup.
   *   - Yahoo / MFL / Fantrax / Fleaflicker ids have no link on PlayerIdentityMap yet. The
   *     same collision applies, so those leagues are counted, not read.
   */
  const platformOf = new Map(leagues.map((l) => [l.id, l.platform]))
  const readable = rawRosters.filter((r) => !bestBall.has(r.leagueId) && rosterIdSpaceOf(platformOf.get(r.leagueId)) !== 'other')
  const espnMap = await loadEspnToSleeperMap(
    collectRosterIds(readable.filter((r) => rosterIdSpaceOf(platformOf.get(r.leagueId)) === 'espn').map((r) => r.playerData)),
  )
  const otherLeagues = new Set(leagues.filter((l) => !bestBall.has(l.id) && rosterIdSpaceOf(l.platform) === 'other').map((l) => l.id))
  const teamByLeague = new Map(teams.map((t) => [t.leagueId, t]))
  const choppedTeams = new Set(chopped.map((row) => `${row.leagueId}:${row.rosterId}`))

  // One roster per league — the first that matches your candidates — and its starters.
  const startersByLeague = new Map<string, string[]>()
  /*
   * "Lineups as of …" — the OLDEST roster read, because the list is only as current as its
   * stalest league. `Roster.updatedAt` bumps on every successful roster sync (the collector's
   * teams_rosters scope updates every row it writes), so it is when we last saw the lineup.
   */
  let oldestRosterMs: number | null = null
  for (const r of readable) {
    if (startersByLeague.has(r.leagueId)) continue
    if (!r.platformUserId || !candidatesByLeague.get(r.leagueId)?.has(r.platformUserId)) continue
    const at = r.updatedAt ? new Date(r.updatedAt).getTime() : NaN
    if (Number.isFinite(at) && (oldestRosterMs === null || at < oldestRosterMs)) oldestRosterMs = at
    const pd = (r.playerData ?? {}) as Record<string, unknown>
    const league = leagueById.get(r.leagueId)
    if (!league) continue
    // A league that is not in season has no lineup to fix (559c56580).
    const stage = String(pd.leagueStatus ?? league.status ?? league.lifecycleState ?? '').toLowerCase()
    if (['pre_draft', 'predraft', 'setup', 'drafting', 'draft', 'complete', 'completed', 'season_over', 'archived'].includes(stage)) continue
    // The roster's own best-ball flag, for a league the column/settings rule above missed — counted like the rest.
    if (pd.bestBall === true) {
      bestBall.add(r.leagueId)
      continue
    }
    // A guillotine team already chopped has no lineup left to set (559c56580).
    const team = teamByLeague.get(r.leagueId)
    const guillotine = league.guillotineMode === true || league.leagueVariant === 'guillotine' || String(league.leagueType).toLowerCase() === 'guillotine'
    const all = Array.isArray(pd.players) ? pd.players.filter((id) => id && id !== '0') : []
    const eliminated = pd.eliminated === true || pd.chopped === true ||
      [team?.externalId, team?.id, r.id].some((id) => id && choppedTeams.has(`${r.leagueId}:${id}`)) ||
      eliminations.some((e) => e.leagueId === r.leagueId && e.season.season === league.season) ||
      (guillotine && all.length === 0)
    if (eliminated) continue
    const raw = Array.isArray(pd.starters) ? pd.starters.map((x) => (x == null ? '' : String(x))).filter((x) => x && x !== '0') : []
    const isEspn = rosterIdSpaceOf(platformOf.get(r.leagueId)) === 'espn'
    const starters = isEspn ? raw.map((id) => espnMap.get(id) ?? '').filter(Boolean) : raw
    startersByLeague.set(r.leagueId, starters)
  }
  const coverage = {
    leaguesNotRead,
    bestBallLeagues: bestBall.size,
    unsupportedLeagues: otherLeagues.size,
    rostersAsOf: oldestRosterMs === null ? null : new Date(oldestRosterMs).toISOString(),
  }
  const allIds = [...new Set([...startersByLeague.values()].flat())]
  if (allIds.length === 0) {
    return { available: true, data: { rows: [], week: null, leaguesRead: startersByLeague.size, startersRead: 0, ...coverage } }
  }

  const players = await prisma.sportsPlayer
    .findMany({
      where: { sleeperId: { in: allIds } },
      select: { sleeperId: true, sport: true, externalId: true, name: true, position: true, team: true, imageUrl: true },
    })
    .catch(() => [] as Array<{ sleeperId: string | null; sport: string; externalId: string; name: string; position: string | null; team: string | null; imageUrl: string | null }>)
  // The catalog holds several provider rows per Sleeper id. Compose fields, as My Team and
  // Matchup do; the arbitrary headshot-first row can carry the wrong club or position.
  const identities = composePlayerIdentities(players)
  const playerById = new Map<string, (typeof players)[number]>()
  for (const p of players) {
    if (!p.sleeperId) continue
    const cur = playerById.get(p.sleeperId)
    if (!cur || p.externalId === p.sleeperId) playerById.set(p.sleeperId, p)
  }

  const sport = [...playerById.values()][0]?.sport ?? 'NFL'
  // One claim per name, with the club check against namesakes — shared with the shares list (injuryClaims.ts).
  const [injuries, sportsWeek] = await Promise.all([
    // Name and club from the COMPOSED identity, not an arbitrary catalog row — the row can carry a
    // stale club, and a wrong club drops the player's own injury as a namesake's.
    readInjuryClaims(sport, [...identities.values()].flatMap((p) => (p.name ? [{ name: p.name, team: p.team ?? null }] : []))),
    resolveSportsWeek(sport).catch(() => null),
  ])

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
      const identity = identities.get(id)
      if (!identity?.name) continue
      starters.push({
        sleeperId: p.sleeperId,
        sport: identity.sport ?? p.sport,
        externalId: p.externalId,
        name: identity.name,
        position: displayPosition(identity.position),
        team: identity.team,
        imageUrl: identity.imageUrl,
        leagueId,
        leagueName: league?.name ?? 'League',
        platform: String(league?.platform ?? 'manual').toLowerCase(),
        platformLeagueId: league?.platformLeagueId ?? null,
        season: league?.season ?? null,
        teamId: teamIdByLeague.get(leagueId) ?? null,
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
      ...coverage,
    },
  }
}
