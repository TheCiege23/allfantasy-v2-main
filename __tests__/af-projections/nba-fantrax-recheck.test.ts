import { beforeEach, describe, expect, it, vi } from 'vitest'
import cle from '@/__tests__/fixtures/survivor-official-nba/cle-dal.json'
import { runNbaFantraxProjectionRecheck } from '@/lib/af-projections/nbaFantraxRecheck'

const db = vi.hoisted(() => ({
  sportsDataCache: { findUniqueOrThrow: vi.fn() }, league: { findUniqueOrThrow: vi.fn() },
  playerIdentityMap: { findMany: vi.fn() }, sportsPlayer: { findMany: vi.fn() },
  fantasyStatLine: { findMany: vi.fn(), upsert: vi.fn() }, aFProjectionSnapshot: { findMany: vi.fn() },
}))
const feeds = vi.hoisted(() => ({ fetchOfficialNbaRoster: vi.fn(), fetchOfficialNbaGameLog: vi.fn(),
  fetchOfficialNbaSchedule: vi.fn(), fetchOfficialNbaLiveBox: vi.fn(), fetchOfficialNbaPlayer: vi.fn() }))
const publish = vi.hoisted(() => vi.fn())
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/workers/providers/officialNbaLive', () => feeds)
vi.mock('@/lib/season-week/seasonWeekService', () => ({ resolveSportWeek: () => Promise.resolve({
  ok: true, state: 'playing', seasonType: 'regular', sportWeek: 4,
}) }))
vi.mock('@/lib/af-projections/writeAfProjectionSnapshots', () => ({ writeAfProjectionSnapshots: publish }))
vi.mock('@/lib/af-projections/leaguePlayerMetrics', () => ({ loadLeaguePlayerMetrics: () => Promise.resolve({ season: 2026, week: 4, rows: [] }) }))

const now = new Date('2026-11-20T04:00:00Z')
const first = structuredClone(cle)
const second = structuredClone(cle)
second.game.gameId = '0022600999'
second.game.gameTimeUTC = '2026-11-19T00:00:00Z'
const person = first.game.homeTeam.players.find(p => p.played === '1')!
function resultSet(name: string, headers: string[], rowSet: unknown[][]) {
  return { resultSets: [{ name, headers, rowSet }] }
}
function fixtureFor(box: typeof first) {
  const { game } = box
  return { gameId: game.gameId, gameStatus: game.gameStatus, homeTeam: game.homeTeam, awayTeam: game.awayTeam, gameDateTimeUTC: game.gameTimeUTC }
}
function gameLog(box: typeof first, date: string) {
  const p = box.game.homeTeam.players.find(row => row.personId === person.personId)!
  const s = p.statistics
  return ['22026', p.personId, box.game.gameId, date, box.game.homeTeam.teamTricode, 25, s.points, s.fieldGoalsMade,
    s.fieldGoalsAttempted, s.threePointersMade, s.threePointersAttempted, s.freeThrowsMade, s.freeThrowsAttempted,
    s.reboundsOffensive, s.reboundsDefensive, s.reboundsTotal, s.assists, s.steals, s.blocks, s.turnovers, s.foulsPersonal]
}
function nbaRoster(active: boolean) {
  const team = first.game.homeTeam.teamTricode
  const teamId = first.game.homeTeam.teamId
  return resultSet('CommonAllPlayers', ['PERSON_ID', 'DISPLAY_FIRST_LAST', 'ROSTERSTATUS', 'TEAM_ID', 'TEAM_ABBREVIATION'], [
    [person.personId, person.name, active ? 1 : 0, active ? teamId : 0, active ? team : ''],
    ...Array.from({ length: 300 }, (_, n) => [2100000 + n, 'Another Player ' + n, 1, teamId, team]),
  ])
}
function logFor(...rows: unknown[][]) {
  return resultSet('LeagueGameLog', ['SEASON_ID', 'PLAYER_ID', 'GAME_ID', 'GAME_DATE', 'TEAM_ABBREVIATION', 'MIN', 'PTS', 'FGM', 'FGA',
    'FG3M', 'FG3A', 'FTM', 'FTA', 'OREB', 'DREB', 'REB', 'AST', 'STL', 'BLK', 'TOV', 'PF'], rows)
}

beforeEach(() => {
  vi.resetAllMocks()
  db.sportsDataCache.findUniqueOrThrow.mockResolvedValue({ data: { leagueId: 'league', rosterIds: ['fantrax1'] } })
  db.league.findUniqueOrThrow.mockResolvedValue({ sport: 'NBA', season: 2026, platform: 'fantrax' })
  db.playerIdentityMap.findMany.mockResolvedValue([{ id: 'canonical', fantraxId: 'fantrax1', canonicalName: person.name, position: 'PG',
    dob: '2001-01-01', rollingInsightsId: 'provider1', sleeperNbaId: null }])
  db.sportsPlayer.findMany.mockResolvedValue([])
  db.fantasyStatLine.findMany.mockResolvedValue([])
  db.aFProjectionSnapshot.findMany.mockResolvedValue([])
  feeds.fetchOfficialNbaRoster.mockResolvedValue(nbaRoster(true))
  feeds.fetchOfficialNbaGameLog.mockResolvedValue(logFor(gameLog(first, '2026-11-14'), gameLog(second, '2026-11-18')))
  feeds.fetchOfficialNbaSchedule.mockResolvedValue({ leagueSchedule: { seasonYear: '2026-27', gameDates: [
    { games: [fixtureFor(first), fixtureFor(second)] },
  ] } })
  feeds.fetchOfficialNbaPlayer.mockResolvedValue(resultSet('CommonPlayerInfo', ['PERSON_ID', 'DISPLAY_FIRST_LAST', 'BIRTHDATE'],
    [[person.personId, person.name, '2001-01-01T00:00:00']]))
  feeds.fetchOfficialNbaLiveBox.mockImplementation((id: string) => Promise.resolve(id === first.game.gameId ? first : second))
  publish.mockResolvedValue({ written: 1, errors: [] })
})

describe('hourly Fantrax NBA final-box rechecks', () => {
  it('publishes the canonical sample once and retries an unwritten snapshot from the saved boxes', async () => {
    const result = await runNbaFantraxProjectionRecheck(now)
    expect(result).toMatchObject({ checked: 1, activeVerified: 1, boxesVerified: 2, warnings: [],
      writer: [{ written: 1, seasonLinesWritten: 1 }] })
    const data = db.fantasyStatLine.upsert.mock.calls[0][0].create
    expect(data).toMatchObject({ playerId: 'canonical', sport: 'NBA', source: 'af_verified_nba_boxes', stats: {
      verifiedNbaTeam: first.game.homeTeam.teamTricode, officialPlayerId: String(person.personId),
      regular_season: { games_played: 2, points: 2 * person.statistics.points },
    } })
    expect(publish).toHaveBeenCalledWith({ playerIds: ['canonical'], sport: 'NBA', targetSeason: 2026, targetWeek: 4, writeWeeklySnapshots: false })

    db.fantasyStatLine.findMany.mockResolvedValue([{ playerId: 'canonical', stats: data.stats }])
    const recovered = await runNbaFantraxProjectionRecheck(now)
    expect(recovered.writer).toEqual([{ written: 1, seasonLinesWritten: 0 }])
    expect(feeds.fetchOfficialNbaLiveBox).toHaveBeenCalledTimes(2)
    expect(publish).toHaveBeenCalledTimes(2)

    db.aFProjectionSnapshot.findMany.mockResolvedValue([{ playerId: 'canonical', adjustmentFactors: {
      sourceSeason: 2026, verifiedBoxVersion: data.stats.verifiedBoxVersion,
    } }])
    expect((await runNbaFantraxProjectionRecheck(now)).writer).toEqual([{ written: 0, seasonLinesWritten: 0 }])
  })

  it('leaves a one-game sample unpublished while the other game is in progress', async () => {
    feeds.fetchOfficialNbaSchedule.mockResolvedValue({ leagueSchedule: { seasonYear: '2026-27', gameDates: [
      { games: [fixtureFor(first), { ...fixtureFor(second), gameStatus: 2 }] },
    ] } })
    expect((await runNbaFantraxProjectionRecheck(now)).activeVerified).toBe(0)
    expect(db.fantasyStatLine.upsert).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
  })

  it('checks DOB before accepting a same-name player with two finals', async () => {
    feeds.fetchOfficialNbaPlayer.mockResolvedValue(resultSet('CommonPlayerInfo', ['PERSON_ID', 'DISPLAY_FIRST_LAST', 'BIRTHDATE'],
      [[person.personId, person.name, '1999-01-01T00:00:00']]))
    expect((await runNbaFantraxProjectionRecheck(now)).awaitingIdentity).toBe(1)
    expect(feeds.fetchOfficialNbaLiveBox).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
  })

  it('retains the verified history when the official roster marks a watched player inactive', async () => {
    await runNbaFantraxProjectionRecheck(now)
    const old = db.fantasyStatLine.upsert.mock.calls[0][0].create.stats
    db.fantasyStatLine.findMany.mockResolvedValue([{ playerId: 'canonical', stats: old }])
    feeds.fetchOfficialNbaRoster.mockResolvedValue(nbaRoster(false))
    await runNbaFantraxProjectionRecheck(now)
    expect(db.fantasyStatLine.upsert.mock.calls[1][0].create.stats).toMatchObject({
      verifiedGameIds: old.verifiedGameIds, regular_season: old.regular_season, verifiedNbaInactiveSince: '2026-11-19',
    })
  })

  it('rejects an official date or stat conflict without persisting a partial sample', async () => {
    const suspect = gameLog(second, '2026-11-18')
    suspect[6] = Number(suspect[6]) + 2
    feeds.fetchOfficialNbaGameLog.mockResolvedValue(logFor(gameLog(first, '2026-11-14'), suspect))
    const result = await runNbaFantraxProjectionRecheck(now)
    expect(result.warnings).toEqual([expect.stringContaining('NBA final box and game log disagree')])
    expect(db.fantasyStatLine.upsert).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
  })
})
