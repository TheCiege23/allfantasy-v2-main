import { prisma } from '@/lib/prisma'

/**
 * A manager's verified record, assembled from seasons we actually imported.
 *
 * ⚠ THIS FILE STORES WHAT HAPPENED, NEVER WHAT IT WAS WORTH. Every row records
 * the league's FORMAT and SIZE alongside the result, and applies no weighting
 * of any kind. Difficulty weights live in `difficultyWeights.ts` and are applied
 * at read time.
 *
 * That separation is the whole design. Weights will change — a guillotine is
 * harder than a redraft, a 150-team tournament is not automatically harder than
 * a 22-team zombie league, and the honest ranking of those is a judgement that
 * will be revised. If a weight were ever baked into a stored number, revising it
 * would silently rewrite the history every user has already seen and compared.
 * Facts are permanent; the formula is not.
 *
 * ⚠ EVERY NUMBER HERE IS BACKED BY AN IMPORTED SEASON. `SeasonResult` holds
 * 3,422 rows across 2020-2026 for 56 leagues, written by the Sleeper historical
 * backfill from the `previous_league_id` chain and the playoff bracket. Nothing
 * in this module estimates, projects or fills a gap — a manager with two
 * imported seasons has a two-season career, and saying so is the point of a
 * system whose value is being verifiable.
 */

/** One season a manager played, with the context needed to weight it later. */
export type ManagerSeasonFact = {
  leagueId: string
  leagueName: string | null
  season: string
  /** redraft | dynasty | guillotine | zombie | … — never normalised away. */
  leagueType: string
  /** Teams in that league THAT season. Size is an input to difficulty, not difficulty. */
  teamCount: number
  wins: number
  losses: number
  pointsFor: number
  pointsAgainst: number
  champion: boolean
}

/** The components. Deliberately no level, no grade, no score. */
export type ManagerCareerFacts = {
  managerId: string
  managerName: string | null
  seasonsPlayed: number
  wins: number
  losses: number
  /** Null rather than 0 when nobody has played a game — 0% is a claim. */
  winRate: number | null
  championships: number
  /** Distinct leagues, so ten seasons in one league is not ten careers. */
  leaguesPlayed: number
  pointsFor: number
  pointsAgainst: number
  /** Seasons grouped by format, so a weighting pass has what it needs. */
  byLeagueType: Record<string, { seasons: number; championships: number; wins: number; losses: number }>
  seasons: ManagerSeasonFact[]
  /** The span we can actually speak to. */
  firstSeason: string | null
  lastSeason: string | null
}

const dec = (v: unknown): number => {
  if (v == null) return 0
  const n = typeof v === 'object' && 'toNumber' in (v as object)
    ? (v as { toNumber(): number }).toNumber()
    : Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * Career facts for one manager.
 *
 * ⚠ KEYED ON `platformUserId`, NOT ON OUR USER ID. A manager's identity across
 * imported leagues is their Sleeper id — the same person appears in ten leagues
 * under one platform id and may have no AllFantasy account at all. Keying on our
 * uuid would return an empty career for most of the people a ranking is supposed
 * to rank.
 */
export async function managerCareerFacts(platformUserId: string): Promise<ManagerCareerFacts | null> {
  /*
   * The join is rosterId -> LeagueTeam.externalId, verified against production.
   * SeasonResult is keyed by (leagueId, season, rosterId) and carries no owner,
   * so the manager is resolved through the team row for that league.
   */
  const teams = await prisma.leagueTeam
    .findMany({
      where: { platformUserId },
      select: {
        leagueId: true,
        externalId: true,
        ownerName: true,
        league: { select: { name: true, leagueType: true } },
      },
    })
    .catch(() => [])

  if (teams.length === 0) return null

  const byLeagueRoster = new Map<string, (typeof teams)[number]>()
  for (const t of teams) if (t.externalId) byLeagueRoster.set(`${t.leagueId}:${t.externalId}`, t)

  const results = await prisma.seasonResult
    .findMany({
      where: { leagueId: { in: [...new Set(teams.map((t) => t.leagueId))] } },
      select: {
        leagueId: true, season: true, rosterId: true,
        wins: true, losses: true, pointsFor: true, pointsAgainst: true, champion: true,
      },
    })
    .catch(() => [])

  /*
   * Team counts come from the roster rows, because League has no size column.
   * Counted per league rather than assumed from the format: guillotine leagues
   * here run 11 to 22 teams, so "guillotine" alone does not tell you the size.
   */
  const counts = await prisma.leagueTeam
    .groupBy({ by: ['leagueId'], _count: { _all: true } })
    .catch(() => [])
  const teamCountByLeague = new Map(counts.map((c) => [c.leagueId, c._count._all]))

  const seasons: ManagerSeasonFact[] = []
  for (const r of results) {
    const team = byLeagueRoster.get(`${r.leagueId}:${r.rosterId}`)
    if (!team) continue // a different manager's roster in a league we share
    seasons.push({
      leagueId: r.leagueId,
      leagueName: team.league?.name ?? null,
      season: r.season,
      leagueType: team.league?.leagueType ?? 'unknown',
      teamCount: teamCountByLeague.get(r.leagueId) ?? 0,
      wins: r.wins ?? 0,
      losses: r.losses ?? 0,
      pointsFor: dec(r.pointsFor),
      pointsAgainst: dec(r.pointsAgainst),
      champion: r.champion,
    })
  }

  if (seasons.length === 0) return null

  const byLeagueType: ManagerCareerFacts['byLeagueType'] = {}
  let wins = 0, losses = 0, championships = 0, pointsFor = 0, pointsAgainst = 0
  for (const s of seasons) {
    wins += s.wins; losses += s.losses
    pointsFor += s.pointsFor; pointsAgainst += s.pointsAgainst
    if (s.champion) championships += 1
    const b = (byLeagueType[s.leagueType] ??= { seasons: 0, championships: 0, wins: 0, losses: 0 })
    b.seasons += 1; b.wins += s.wins; b.losses += s.losses
    if (s.champion) b.championships += 1
  }

  const played = wins + losses
  const ordered = [...seasons].sort((a, b) => a.season.localeCompare(b.season))

  return {
    managerId: platformUserId,
    managerName: teams[0]?.ownerName ?? null,
    seasonsPlayed: seasons.length,
    wins,
    losses,
    // Null, not 0. A manager with no completed games has no win rate, and
    // rendering 0% would read as "loses everything" rather than "no data".
    winRate: played > 0 ? wins / played : null,
    championships,
    leaguesPlayed: new Set(seasons.map((s) => s.leagueId)).size,
    pointsFor: Math.round(pointsFor * 100) / 100,
    pointsAgainst: Math.round(pointsAgainst * 100) / 100,
    byLeagueType,
    seasons: ordered,
    firstSeason: ordered[0]?.season ?? null,
    lastSeason: ordered[ordered.length - 1]?.season ?? null,
  }
}
