/**
 * Rivalry week for a league that plays on another platform (Fantrax, Sleeper, ESPN, Yahoo, MFL…).
 *
 * Its schedule lives on that platform, so nothing here can rewrite a week. What the commissioner
 * gets is the pairing itself: each team's biggest rival, with the facts behind it, ready to copy and
 * set up over there. The rivalries come from the same rule a league that plays here uses
 * (`nativeRivalries.ts`): every head-to-head game on file, close games, playoff meetings, and shared
 * divisions.
 *
 * DB-first: the stored weekly results (`WeeklyMatchup`), the team list and the league row. No
 * provider is called.
 */
import { prisma } from '@/lib/prisma'
import { parseStandingsDivisions } from '@/lib/league-import/standingsDivisions'
import { pairRivalryWeek } from './rivalryWeek'
import { scoreNativeRivalries, type NativeRivalryGame } from './nativeRivalries'
import type { RivalryWeekPreviewPair } from './rivalryWeekService'

type StoredRow = { seasonYear: number; week: number; rosterId: string; matchupId: number | null; pointsFor: number; pointsAgainst: number }

/**
 * Stored result rows as games. A game is the two rows that share a matchup id in one week; a row on
 * its own is a bye or a field-format week, and a 0-0 pair is a fixture that has not been played.
 */
export function gamesFromStoredRows(rows: readonly StoredRow[], playoffStartWeek?: number | null): NativeRivalryGame[] {
  const groups = new Map<string, StoredRow[]>()
  for (const row of rows) {
    if (row.matchupId == null) continue
    const key = `${row.seasonYear}|${row.week}|${row.matchupId}`
    groups.set(key, [...(groups.get(key) ?? []), row])
  }
  const games: NativeRivalryGame[] = []
  for (const pair of groups.values()) {
    if (pair.length !== 2) continue
    const [a, b] = pair as [StoredRow, StoredRow]
    if (a.rosterId === b.rosterId) continue
    if (!(a.pointsFor > 0 || b.pointsFor > 0)) continue
    games.push({
      a: a.rosterId,
      b: b.rosterId,
      aScore: a.pointsFor,
      bScore: b.pointsFor,
      playoff: playoffStartWeek != null && playoffStartWeek > 1 && a.week >= playoffStartWeek,
    })
  }
  return games
}

/** The pairings, from teams, games and divisions. Null when the league has no rivalries to pair. */
export function importedRivalryPairs(input: {
  teams: ReadonlyArray<{ id: string; name: string }>
  games: readonly NativeRivalryGame[]
  divisionOf?: ReadonlyMap<string, string> | null
}): RivalryWeekPreviewPair[] | null {
  const ids = input.teams.map((team) => team.id)
  const rivalries = scoreNativeRivalries({ teams: ids, games: input.games, divisionOf: input.divisionOf ?? null })
  if (!rivalries.some((r) => r.score > 0)) return null
  const reasons = new Map(rivalries.map((r) => [[r.a, r.b].sort().join('|'), r.reasons]))
  const nameOf = new Map(input.teams.map((team) => [team.id, team.name]))
  return pairRivalryWeek(ids, rivalries).map((p) => ({
    homeRosterId: p.home,
    awayRosterId: p.away,
    homeName: nameOf.get(p.home) ?? 'Team',
    awayName: p.away ? nameOf.get(p.away) ?? 'Team' : null,
    rivalry: p.rivalry,
    reasons: p.rivalry && p.away ? reasons.get([p.home, p.away].sort().join('|')) ?? [] : [],
    context: null,
  }))
}

type Result =
  | { ok: true; platform: string; pairs: RivalryWeekPreviewPair[] }
  | { ok: false; status: number; code: 'LEAGUE_NOT_FOUND' | 'NOT_ENOUGH_TEAMS' | 'NO_RIVALRIES'; message: string }

export async function previewImportedRivalryWeek(leagueId: string): Promise<Result> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { platform: true, platformLeagueId: true, settings: true },
  })
  if (!league) return { ok: false, status: 404, code: 'LEAGUE_NOT_FOUND', message: 'League not found.' }
  const [teams, rows] = await Promise.all([
    prisma.leagueTeam.findMany({
      where: { leagueId, lifecycleState: { not: 'ARCHIVED' } },
      select: { externalId: true, teamName: true, ownerName: true },
      orderBy: { externalId: 'asc' },
    }),
    league.platformLeagueId
      ? prisma.weeklyMatchup.findMany({
          where: { leagueId: league.platformLeagueId },
          select: { seasonYear: true, week: true, rosterId: true, matchupId: true, pointsFor: true, pointsAgainst: true },
        })
      : Promise.resolve([] as StoredRow[]),
  ])
  const named = teams
    .filter((team) => String(team.externalId ?? '').length > 0)
    .map((team) => ({ id: String(team.externalId), name: team.teamName?.trim() || team.ownerName?.trim() || 'Team' }))
  if (named.length < 2) return { ok: false, status: 409, code: 'NOT_ENOUGH_TEAMS', message: 'Rivalry week needs at least two teams.' }
  const divisions = parseStandingsDivisions(league.settings)
  const pairs = importedRivalryPairs({
    teams: named,
    // No playoff week is passed: the league row's playoff week is a default for an imported league, and
    // calling a regular-season game a playoff meeting would put a false fact on the pairing.
    games: gamesFromStoredRows(rows),
    divisionOf: divisions ? new Map(Object.entries(divisions.teams)) : null,
  })
  if (!pairs) {
    return {
      ok: false,
      status: 409,
      code: 'NO_RIVALRIES',
      message: 'This league has no rivalries yet. They come from head-to-head games and from divisions, so try again once some games are on file.',
    }
  }
  return { ok: true, platform: String(league.platform ?? '').toLowerCase(), pairs }
}
