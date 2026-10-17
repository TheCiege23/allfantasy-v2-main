// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rows: vi.fn(), teams: vi.fn(), facts: vi.fn(), metadata: vi.fn(), finished: vi.fn() }))
vi.mock('@/lib/core-app/finishedNflWeeks', () => ({ loadFinishedNflWeeks: mocks.finished }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  weeklyMatchup: { findMany: mocks.rows }, leagueTeam: { findMany: mocks.teams },
  matchupFact: { findMany: mocks.facts }, sportsGame: { findMany: vi.fn(async () => []) },
} }))
vi.mock('@/lib/core-app/leagueWeekMetadata', () => ({ readLeagueWeekMetadata: mocks.metadata }))
vi.mock('@/lib/core-app/seasonPhase', () => ({ getFirstStatedKickoff: vi.fn(async () => null) }))
import { getWeekBoard, getRivalryRadar } from '@/lib/core-app/weekBoard'

const sports = ['NFL', 'NBA', 'MLB', 'NHL', 'NCAAB', 'NCAAF', 'SOCCER']
const leagues = sports.map((sport) => ({ id: sport, name: sport, platform: 'sleeper', platformLeagueId: 'P' + sport }))
function meeting(sport: string, seasonYear: number, week: number, mine = 0, theirs = 0) {
  return [
    { leagueId: 'P' + sport, seasonYear, week, matchupId: 1, rosterId: '1', pointsFor: mine, pointsAgainst: theirs, win: mine > theirs ? 1 : 0 },
    { leagueId: 'P' + sport, seasonYear, week, matchupId: 1, rosterId: '2', pointsFor: theirs, pointsAgainst: mine, win: theirs > mine ? 1 : 0 },
  ]
}
function metadata(sport: string, season: number, week: number) {
  return { id: sport, platformLeagueId: 'P' + sport, sport, season, status: 'in_season', settings: { leg: String(week) } }
}
function cards(board: Awaited<ReturnType<typeof getWeekBoard>>) { return [...board.coinFlips, ...board.leaning, ...board.unprojected] }
beforeEach(() => {
  vi.resetAllMocks()
  mocks.rows.mockResolvedValue([])
  mocks.facts.mockResolvedValue([])
  mocks.metadata.mockResolvedValue([])
  mocks.finished.mockResolvedValue(new Set())
  mocks.teams.mockImplementation(async (args: { where: { claimedByUserId?: string } }) => leagues.flatMap((l) =>
    (args.where.claimedByUserId ? ['1'] : ['1', '2']).map((externalId) => ({ externalId, teamName: 'Manager ' + externalId, avatarUrl: null,
      league: { platformLeagueId: l.platformLeagueId, platform: l.platform } }))))
})

describe('Your Week uses each league scoring calendar', () => {
  it('moves HailShiva from the final Week 4 slate to its scheduled Week 5 before the marker advances', async () => {
    mocks.metadata.mockResolvedValue([metadata('NFL', 2026, 4)])
    mocks.finished.mockResolvedValue(new Set(['2026:4']))
    mocks.rows.mockResolvedValue([...meeting('NFL', 2026, 4, 110, 90), ...meeting('NFL', 2026, 5).map(r => ({ ...r, rosterId: r.rosterId === '2' ? '3' : r.rosterId }))])
    mocks.teams.mockImplementation(async (args: { where: { claimedByUserId?: string } }) =>
      (args.where.claimedByUserId ? ['1'] : ['1', '2', '3']).map(externalId => ({ externalId, teamName: externalId === '2' ? 'Paid' : externalId === '3' ? 'Rittnasty' : 'Tenzy SF', avatarUrl: null, league: { platformLeagueId: 'PNFL', platform: 'sleeper' } })))
    const board = await getWeekBoard('u1', [leagues[0]], 'NFL')
    expect(cards(board).map(c => [c.season, c.week])).toEqual([[2026, 5]])
    expect(cards(board)[0].opponent.name).toBe('Rittnasty')
    expect(board.leagueBoard).toMatchObject({ season: 2026, week: 5, yours: { week: 5 }, records: { '1': { wins: 1, losses: 0 } } })
  })

  it('retains the marked week without a next-week schedule or a finished NFL calendar', async () => {
    mocks.metadata.mockResolvedValue([metadata('NFL', 2026, 4)])
    mocks.finished.mockResolvedValue(new Set(['2026:4']))
    mocks.rows.mockResolvedValue([...meeting('NFL', 2026, 4, 110, 90), ...meeting('NFL', 2026, 6)])
    expect((await getWeekBoard('u1', [leagues[0]], 'NFL')).leagueBoard?.week).toBe(4)
    mocks.finished.mockResolvedValue(new Set())
    mocks.rows.mockResolvedValue([...meeting('NFL', 2026, 4, 110, 90), ...meeting('NFL', 2026, 5)])
    expect((await getWeekBoard('u1', [leagues[0]], 'NFL')).leagueBoard?.week).toBe(4)
  })
  it('keeps all seven sports in a portfolio across different periods and seasons', async () => {
    const periods = [4, 20, 27, 12, 11, 6, 9]
    mocks.metadata.mockResolvedValue(sports.map((sport, i) => metadata(sport, sport === 'SOCCER' ? 2027 : 2026, periods[i])))
    mocks.rows.mockResolvedValue(sports.flatMap((sport, i) => meeting(sport, sport === 'SOCCER' ? 2027 : 2026, periods[i])))
    const board = await getWeekBoard('u1', leagues)
    expect(cards(board).map((c) => [c.leagueId, c.season, c.week])).toEqual(sports.map((sport, i) => [sport, sport === 'SOCCER' ? 2027 : 2026, periods[i]]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))))
    expect(board.withoutSchedule).toBe(0)
    expect(board.season).toBeNull()
    expect(board.week).toBeNull()
    const radar = await getRivalryRadar('u1', leagues)
    expect(radar.even).toHaveLength(7)
    expect(radar.even.every((r) => r.thisWeek != null)).toBe(true)
  })

  it('derives a separate earliest unplayed period when provider markers are absent', async () => {
    mocks.rows.mockResolvedValue([...meeting('NFL', 2026, 3, 100, 90), ...meeting('NFL', 2026, 4), ...meeting('NFL', 2026, 18),
      ...meeting('NBA', 2025, 19, 100, 90), ...meeting('NBA', 2025, 20), ...meeting('NBA', 2025, 25)])
    const board = await getWeekBoard('u1', leagues.slice(0, 2))
    expect(cards(board).map((c) => [c.leagueId, c.season, c.week])).toEqual([['NBA', 2025, 20], ['NFL', 2026, 4]])
  })

  it('uses the focused league season for its header, matchup, rivalry and records', async () => {
    mocks.metadata.mockResolvedValue([metadata('NFL', 2026, 4), metadata('NBA', 2027, 20)])
    mocks.rows.mockResolvedValue([...meeting('NFL', 2026, 3, 100, 90), ...meeting('NFL', 2026, 4), ...meeting('NBA', 2027, 20)])
    const board = await getWeekBoard('u1', leagues.slice(0, 2), 'NFL')
    expect(board.leagueBoard).toMatchObject({ season: 2026, week: 4, yours: { season: 2026, week: 4 }, rivalry: { wins: 1, losses: 0, ties: 0 }, records: { '1': { wins: 1, losses: 0 } } })
  })

  it('does not show an old fixture as current when the stated period is not synced', async () => {
    mocks.metadata.mockResolvedValue([metadata('NFL', 2026, 4)])
    mocks.rows.mockResolvedValue(meeting('NFL', 2026, 3, 100, 90))
    const board = await getWeekBoard('u1', [leagues[0]], 'NFL')
    expect(cards(board)).toHaveLength(0)
    expect(board.withoutSchedule).toBe(1)
    expect(board.leagueBoard).toMatchObject({ season: 2026, week: 4, yours: null })
  })

  it('keeps an authoritative period header when there are no matchup rows at all', async () => {
    mocks.metadata.mockResolvedValue([metadata('NFL', 2026, 4)])
    const board = await getWeekBoard('u1', [leagues[0]], 'NFL')
    expect(board.leagueBoard).toMatchObject({ season: 2026, week: 4, yours: null })
    expect(board.historyIncomplete).toBe(false)
  })

  it('uses imported results in the stated season when only an older season has live rows', async () => {
    mocks.metadata.mockResolvedValue([{ ...metadata('NBA', 2026, 1), settings: {} }])
    mocks.rows.mockResolvedValue(meeting('NBA', 2025, 20, 100, 90))
    mocks.facts.mockResolvedValue([{ leagueId: 'NBA', season: 2026, weekOrPeriod: 8, teamA: '1', teamB: '2', scoreA: 110, scoreB: 95 }])
    const board = await getWeekBoard('u1', [leagues[1]], 'NBA')
    expect(cards(board).map((c) => [c.leagueId, c.season, c.week])).toEqual([['NBA', 2026, 8]])
    expect(board.leagueBoard).toMatchObject({ season: 2026, week: 8, records: { '1': { wins: 1, losses: 0 } } })
    expect(board.withoutSchedule).toBe(0)
  })

  it('falls back to imported history per league without letting it move another league slate', async () => {
    mocks.rows.mockResolvedValue(meeting('NFL', 2026, 4))
    mocks.facts.mockResolvedValue([{ leagueId: 'NBA', season: 2030, weekOrPeriod: 8, teamA: '1', teamB: '2', scoreA: 100, scoreB: 90 }])
    const board = await getWeekBoard('u1', leagues.slice(0, 2))
    expect(cards(board).map((c) => [c.leagueId, c.season, c.week])).toEqual([['NBA', 2030, 8], ['NFL', 2026, 4]])
  })
})

describe('history failures are not empty histories', () => {
  it.each(['rows', 'teams'] as const)('propagates a failed primary %s read from both readers', async (query) => {
    mocks[query].mockRejectedValue(new Error('read unavailable'))
    await expect(getWeekBoard('u1', leagues)).rejects.toThrow('read unavailable')
    await expect(getRivalryRadar('u1', leagues)).rejects.toThrow('read unavailable')
  })

  it('keeps usable current matchups while flagging a failed optional history read', async () => {
    mocks.rows.mockResolvedValue(meeting('NFL', 2026, 4))
    mocks.facts.mockRejectedValue(new Error('history unavailable'))
    const board = await getWeekBoard('u1', [leagues[0]])
    expect(cards(board)).toHaveLength(1)
    expect(board.historyIncomplete).toBe(true)
    expect((await getRivalryRadar('u1', [leagues[0]])).historyIncomplete).toBe(true)
  })

  it('distinguishes a genuinely empty history from an optional read failure with no current rows', async () => {
    expect((await getWeekBoard('u1', leagues)).historyIncomplete).toBe(false)
    mocks.facts.mockRejectedValue(new Error('history unavailable'))
    expect((await getWeekBoard('u1', leagues)).historyIncomplete).toBe(true)
    expect((await getRivalryRadar('u1', leagues)).historyIncomplete).toBe(true)
  })

  it('flags failed metadata even when row-based period resolution can preserve the board', async () => {
    mocks.rows.mockResolvedValue(meeting('NFL', 2026, 4))
    mocks.metadata.mockImplementation(async (_ids: string[], _space: string, onError: () => void) => { onError(); return [] })
    const board = await getWeekBoard('u1', [leagues[0]])
    expect(cards(board)).toHaveLength(1)
    expect(board.historyIncomplete).toBe(true)
  })
})
