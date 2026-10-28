import { describe, expect, it, vi } from 'vitest'
import { loadStoryData } from '@/lib/storyline-studio/loadStoryData'
import { buildWeeklyHooks } from '@/lib/storyline-studio/hookEngine'
import { nativeRosterSeat } from '@/lib/redraft/nativePlayerWeeklyScores'

const fact = (season: number, week: number, a: string, b: string, sa: number, sb: number, winner: string | null) => ({
  season,
  weekOrPeriod: week,
  teamA: a,
  teamB: b,
  scoreA: sa,
  scoreB: sb,
  winnerTeamId: winner,
})

function importedDb(over: { dynasty?: unknown[]; settings?: unknown } = {}) {
  return {
    league: {
      findUnique: vi.fn(async () => ({
        id: 'l1', name: 'L', platform: 'sleeper', platformLeagueId: 'sl-2026', sport: 'NFL', season: 2026, settings: over.settings ?? { current_week: 7 },
      })),
    },
    matchupFact: {
      findMany: vi.fn(async () => [
        fact(2025, 3, '1', '2', 120, 100, '1'),
        fact(2026, 7, '1', '3', 110, 90, '1'),
        fact(2026, 7, '2', '4', 95, 99, '4'),
        fact(2026, 8, '1', '2', 0, 0, null),
        fact(2026, 8, '3', '4', 0, 0, null),
      ]),
    },
    leagueTeam: {
      findMany: vi.fn(async () => [
        { externalId: '1', teamName: 'Hawks', ownerName: 'a' },
        { externalId: '2', teamName: null, ownerName: 'Bea' },
        { externalId: '3', teamName: 'Bears', ownerName: 'c' },
        { externalId: '4', teamName: 'Owls', ownerName: 'd' },
      ]),
    },
    leagueDynastySeason: { findMany: vi.fn(async () => over.dynasty ?? []) },
    leaguePlayerWeeklyScore: {
      findMany: vi.fn(async ({ where }: { where: { leagueId: string } }) =>
        where.leagueId === 'sl-2026' ? [{ week: 7, playerId: 'p1', rosterId: 1, points: 30, isStarter: true }] : [{ week: 4, playerId: 'p1', rosterId: 7, points: 22, isStarter: true }],
      ),
    },
    draftFact: { findMany: vi.fn(async () => [{ season: 2026, round: 9, pickNumber: 100, playerId: 'p1', managerId: '1', metadata: { playerSnapshot: { name: 'Joe Runner' } } }]) },
    sportsPlayer: { findMany: vi.fn(async () => []) },
  }
}

describe('loadStoryData — imported', () => {
  it('reads this week past a fully played marker week, names teams from LeagueTeam, and maps rosters', async () => {
    const db = importedDb({
      dynasty: [
        {
          season: 2025,
          platformLeagueId: 'sl-2025',
          metadata: {
            playoffStructure: {
              canonicalRosterIdByHistoricalRosterId: { '7': '2', '8': '1' },
              bracketPlacementVersion: 2,
              championRosterId: 8,
              runnerUpRosterId: 7,
              winnersBracket: [{ round: 3, matchup: 9, team1: 8, team2: 7, winner: 8, loser: 7, placement: 1 }],
            },
          },
        },
      ],
    })
    const out = await loadStoryData(db as never, 'l1')
    const d = out!.data
    expect(d.week).toBe(8)
    expect(d.matchups).toEqual([{ a: '1', b: '2' }, { a: '3', b: '4' }])
    expect(d.teams.get('2')?.name).toBe('Bea')
    expect(d.playoffs).toEqual([{ season: 2025, round: 3, winner: '1', loser: '2', title: true }])
    // Last season's roster 7 is today's team 2.
    expect(d.playerWeeks).toContainEqual({ season: 2025, week: 4, team: '2', playerId: 'p1', points: 22, starter: true })
    expect(d.playerWeeks).toContainEqual({ season: 2026, week: 7, team: '1', playerId: 'p1', points: 30, starter: true })
    expect(d.playerNames.get('p1')).toBe('Joe Runner')
    expect(d.sources.fixtures).toBe('dw_matchup_facts')
    // Only this season's played weeks are read for player scores.
    expect(db.leaguePlayerWeeklyScore.findMany.mock.calls[0][0].where).toMatchObject({ leagueId: 'sl-2026', week: { lte: 7 } })
  })

  it('a first-season league (no stored seasons) still reads this season’s draft and player weeks', async () => {
    const out = await loadStoryData(importedDb() as never, 'l1')
    expect(out!.data.draftPicks).toEqual([{ season: 2026, round: 9, pick: 100, team: '1', playerId: 'p1' }])
    expect(out!.data.playerWeeks.every((w) => w.season === 2026)).toBe(true)
  })
})

describe('loadStoryData — native', () => {
  it('reads redraft tables, keys teams by owner across seasons, and has no player weeks when none are stored', async () => {
    const db = {
      league: { findUnique: vi.fn(async () => ({ id: 'n1', name: 'N', platform: 'manual', platformLeagueId: null, sport: 'NFL', season: 2026, settings: {} })) },
      redraftSeason: { findMany: vi.fn(async () => [{ id: 's26', season: 2026, currentWeek: 5, sport: 'NFL' }, { id: 's25', season: 2025, currentWeek: 17, sport: 'NFL' }]) },
      redraftRoster: {
        findMany: vi.fn(async () => [
          { id: 'r26a', seasonId: 's26', ownerId: 'uA', ownerName: 'Ann', teamName: 'Hawks', wins: 3, losses: 1, ties: 0, pointsFor: 400 },
          { id: 'r26b', seasonId: 's26', ownerId: 'uB', ownerName: 'Ben', teamName: 'Owls', wins: 1, losses: 3, ties: 0, pointsFor: 300 },
          { id: 'r25a', seasonId: 's25', ownerId: 'uA', ownerName: 'Ann', teamName: 'Old Hawks', wins: 0, losses: 0, ties: 0, pointsFor: 0 },
          { id: 'r25b', seasonId: 's25', ownerId: 'uB', ownerName: 'Ben', teamName: 'Old Owls', wins: 0, losses: 0, ties: 0, pointsFor: 0 },
        ]),
      },
      redraftMatchup: {
        findMany: vi.fn(async () => [
          { id: 'm25', seasonId: 's25', week: 3, status: 'final', homeRosterId: 'r25a', awayRosterId: 'r25b', homeScore: 100, awayScore: 90 },
          { id: 'm26', seasonId: 's26', week: 5, status: 'scheduled', homeRosterId: 'r26a', awayRosterId: 'r26b', homeScore: 0, awayScore: 0 },
        ]),
      },
      redraftPlayoffMatchup: { findMany: vi.fn(async () => []) },
      leaguePlayerWeeklyScore: { findMany: vi.fn(async () => []) },
      redraftRosterPlayer: { findMany: vi.fn(async () => []) },
    }
    const out = await loadStoryData(db as never, 'n1')
    const d = out!.data
    expect(d.week).toBe(5)
    expect(d.matchups).toEqual([{ a: 'owner:uA', b: 'owner:uB', matchupId: 'm26' }])
    expect(d.fixtures.find((f) => f.season === 2025)).toMatchObject({ a: 'owner:uA', b: 'owner:uB', final: true })
    expect(d.teams.get('owner:uA')?.name).toBe('Hawks')
    expect(d.playerWeeks).toEqual([])
  })

  /*
   * Native per-player rows (lib/redraft/nativePlayerWeeklyScores.ts). League.id and the synthetic
   * platform id are DIFFERENT here on purpose: the rows are keyed on League.id, and a loader that read
   * them by platformLeagueId would find nothing and this test would say so.
   */
  const LEAGUE_ID = 'b3a7c0de-native-league'
  const PLATFORM_ID = 'manual-1726000000000'
  function nativeDb(rows: Array<{ seasonYear: number; week: number; playerId: string; rosterId: number | null; points: number; isStarter: boolean }>) {
    return {
      league: { findUnique: vi.fn(async () => ({ id: LEAGUE_ID, name: 'N', platform: 'manual', platformLeagueId: PLATFORM_ID, sport: 'NFL', season: 2026, settings: {} })) },
      redraftSeason: { findMany: vi.fn(async () => [{ id: 's26', season: 2026, currentWeek: 5, sport: 'NFL' }, { id: 's25', season: 2025, currentWeek: 17, sport: 'NFL' }]) },
      redraftRoster: {
        findMany: vi.fn(async () => [
          { id: 'r26a', seasonId: 's26', ownerId: 'uA', ownerName: 'Ann', teamName: 'Hawks', wins: 3, losses: 1, ties: 0, pointsFor: 400 },
          { id: 'r26b', seasonId: 's26', ownerId: 'uB', ownerName: 'Ben', teamName: 'Owls', wins: 1, losses: 3, ties: 0, pointsFor: 300 },
          { id: 'r25a', seasonId: 's25', ownerId: 'uA', ownerName: 'Ann', teamName: 'Old Hawks', wins: 0, losses: 0, ties: 0, pointsFor: 0 },
          { id: 'r25b', seasonId: 's25', ownerId: 'uB', ownerName: 'Ben', teamName: 'Old Owls', wins: 0, losses: 0, ties: 0, pointsFor: 0 },
        ]),
      },
      redraftMatchup: {
        findMany: vi.fn(async () => [
          { id: 'm25', seasonId: 's25', week: 3, status: 'final', homeRosterId: 'r25a', awayRosterId: 'r25b', homeScore: 25, awayScore: 52 },
          { id: 'm26w4', seasonId: 's26', week: 4, status: 'final', homeRosterId: 'r26a', awayRosterId: 'r26b', homeScore: 90, awayScore: 80 },
          { id: 'm26', seasonId: 's26', week: 5, status: 'scheduled', homeRosterId: 'r26a', awayRosterId: 'r26b', homeScore: 0, awayScore: 0 },
        ]),
      },
      redraftPlayoffMatchup: { findMany: vi.fn(async () => []) },
      leaguePlayerWeeklyScore: { findMany: vi.fn(async (_args: { where: unknown }) => rows) },
      redraftRosterPlayer: {
        findMany: vi.fn(async () => [
          { playerId: 'p-rb', playerName: 'Rex Runner' },
          { playerId: 'p-a1', playerName: 'Al One' },
          { playerId: 'p-a2', playerName: 'Al Two' },
        ]),
      },
    }
  }
  const NATIVE_ROWS = [
    // 2025 week 3: Ben's back outscored Ann's whole lineup (15 + 10) by himself.
    { seasonYear: 2025, week: 3, playerId: 'p-rb', rosterId: nativeRosterSeat('r25b'), points: 40, isStarter: true },
    { seasonYear: 2025, week: 3, playerId: 'p-b2', rosterId: nativeRosterSeat('r25b'), points: 12, isStarter: true },
    { seasonYear: 2025, week: 3, playerId: 'p-a1', rosterId: nativeRosterSeat('r25a'), points: 15, isStarter: true },
    { seasonYear: 2025, week: 3, playerId: 'p-a2', rosterId: nativeRosterSeat('r25a'), points: 10, isStarter: true },
    // 2026 week 4: the same back now plays for Ann.
    { seasonYear: 2026, week: 4, playerId: 'p-rb', rosterId: nativeRosterSeat('r26a'), points: 18, isStarter: true },
    { seasonYear: 2026, week: 4, playerId: 'p-a1', rosterId: nativeRosterSeat('r26a'), points: 7, isStarter: false },
    // A seat no roster of that season owns is dropped, not attributed.
    { seasonYear: 2026, week: 4, playerId: 'p-ghost', rosterId: 12345, points: 99, isStarter: true },
    { seasonYear: 2026, week: 4, playerId: 'p-null', rosterId: null, points: 99, isStarter: true },
  ]

  it('reads finalized allfantasy rows by League.id and maps each season’s seat to that season’s team', async () => {
    const db = nativeDb(NATIVE_ROWS)
    const d = (await loadStoryData(db as never, LEAGUE_ID))!.data
    expect(db.leaguePlayerWeeklyScore.findMany.mock.calls[0]![0].where).toEqual({
      leagueId: LEAGUE_ID,
      source: 'allfantasy',
      seasonYear: { in: [2026, 2025] },
      isFinalized: true,
    })
    expect(d.playerWeeks).toContainEqual({ season: 2025, week: 3, team: 'owner:uB', playerId: 'p-rb', points: 40, starter: true })
    expect(d.playerWeeks).toContainEqual({ season: 2026, week: 4, team: 'owner:uA', playerId: 'p-rb', points: 18, starter: true })
    expect(d.playerWeeks).toContainEqual({ season: 2026, week: 4, team: 'owner:uA', playerId: 'p-a1', points: 7, starter: false })
    expect(d.playerWeeks.some((w) => w.playerId === 'p-ghost' || w.playerId === 'p-null')).toBe(false)
    expect(d.playerNames.get('p-rb')).toBe('Rex Runner')
    expect(d.sources.playerWeeks).toBe('league_player_weekly_scores (allfantasy)')
  })

  it('renders a revenge game and a one-man army from those rows, and nothing for an unnamed player', async () => {
    const d = (await loadStoryData(nativeDb(NATIVE_ROWS) as never, LEAGUE_ID))!.data
    const hooks = buildWeeklyHooks(d, 'en').byMatchup[0]!.hooks
    const revenge = hooks.find((h) => h.kind === 'revenge_game')!
    expect(revenge.text).toContain('Rex Runner')
    expect(revenge.text).toContain('Owls')
    expect(revenge.text).toContain('40')
    expect(revenge.facts.every((f) => f.source === 'league_player_weekly_scores (allfantasy)')).toBe(true)
    const army = hooks.find((h) => h.kind === 'one_man_army')!
    expect(army.text).toContain('Rex Runner scored 40')
    expect(army.text).toContain('(25)')
    // p-b2 has no name on any roster row, so no hook may mention him.
    expect(hooks.some((h) => h.players.includes('p-b2'))).toBe(false)
  })

  it('no rows, no player hooks', async () => {
    const d = (await loadStoryData(nativeDb([]) as never, LEAGUE_ID))!.data
    const kinds = buildWeeklyHooks(d, 'en').byMatchup[0]!.hooks.map((h) => h.kind)
    expect(kinds).not.toContain('revenge_game')
    expect(kinds).not.toContain('one_man_army')
  })
})
