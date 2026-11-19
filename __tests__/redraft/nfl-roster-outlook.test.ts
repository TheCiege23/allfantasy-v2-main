/** @vitest-environment node */
/**
 * 🛑 MY TEAM SHOWED A NAME AND A CLUB CODE FOR EVERY NFL PLAYER. The roster holds bare ids ("11560");
 * the stored player rows it joined on are keyed "NFL:11560". Production, 2026-11-19, a league whose
 * draft had just ended: 15 of 15 players with no projection, opponent, kickoff or picture, while the
 * week's projections, schedule and game lines were all stored.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ projections: new Map<string, number>(), weather: new Map<string, unknown>(), weatherArgs: null as unknown }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/core-app/gameWeather', () => ({ getGameWeather: vi.fn(async (args: unknown) => { h.weatherArgs = args; return h.weather }) }))
vi.mock('@/lib/matchup-center/afProjections', () => ({ loadMatchupAfProjections: vi.fn(async () => h.projections) }))

import { applyNflRosterOutlook, byeWeeksFromSchedule, matchupTone, rankDefensesVsPosition, type AllowedRow, type SeasonFixture } from '@/lib/redraft/nflRosterOutlookModel'
import { clearNflRosterOutlookCache, loadNflRosterOutlook } from '@/lib/redraft/nflRosterOutlook'

const allowed = (defense: string, position: string, perGame: number[]): AllowedRow[] =>
  perGame.map((points, i) => ({ defense, position, week: i + 1, points }))

describe('rankDefensesVsPosition', () => {
  const ranks = rankDefensesVsPosition([
    ...allowed('MIN', 'QB', [9, 10, 8]),
    ...allowed('ARI', 'QB', [21, 20, 22]),
    ...allowed('CHI', 'QB', [16, 17, 18]),
    ...allowed('NYG', 'QB', [30, 30]), // two games: not enough to rank
    ...allowed('MIN', 'WR', [25, 26, 27]),
    ...allowed('MIN', 'LB', [5, 5, 5]), // not a ranked position
  ])
  it('1st allows the fewest, and the denominator is the defenses actually ranked', () => {
    expect(ranks.get('MIN|QB')).toMatchObject({ rank: 1, of: 3, position: 'QB', allowedPerGame: 9, games: 3 })
    expect(ranks.get('CHI|QB')).toMatchObject({ rank: 2, of: 3 })
    expect(ranks.get('ARI|QB')).toMatchObject({ rank: 3, of: 3, allowedPerGame: 21 })
  })
  it('a defense with too few games is left unranked rather than guessed', () => {
    expect(ranks.has('NYG|QB')).toBe(false)
  })
  it('each position is its own table', () => {
    expect(ranks.get('MIN|WR')).toMatchObject({ rank: 1, of: 1 })
    expect(ranks.has('MIN|LB')).toBe(false)
  })
  it('several players against one defense in one week are one game', () => {
    const r = rankDefensesVsPosition([
      { defense: 'SEA', position: 'RB', week: 1, points: 10 }, { defense: 'SEA', position: 'RB', week: 1, points: 6 },
      { defense: 'SEA', position: 'RB', week: 2, points: 20 }, { defense: 'SEA', position: 'RB', week: 3, points: 12 },
    ])
    expect(r.get('SEA|RB')).toMatchObject({ games: 3, allowedPerGame: 16 })
  })
})

describe('matchupTone', () => {
  it('thirds of the ranked field', () => {
    expect(matchupTone({ rank: 3, of: 32 })).toBe('hard')
    expect(matchupTone({ rank: 16, of: 32 })).toBe('even')
    expect(matchupTone({ rank: 28, of: 32 })).toBe('easy')
    expect(matchupTone(null)).toBeNull()
  })
})

describe('applyNflRosterOutlook', () => {
  const o = { projectedPoints: 20, opponent: 'NYG', homeAway: 'away' as const, kickoffTimeIso: '2026-11-22T18:00:00.000Z', opponentRank: null, headshotUrl: 'h', teamLogoUrl: 't', opponentLogoUrl: 'o', byeWeek: 7, weather: null }
  it('fills what the row lacks', () => {
    const [row] = applyNflRosterOutlook([{ id: '1', projectedPoints: null, headshotUrl: null, teamLogoUrl: null }], new Map([['1', o]]))
    expect(row).toMatchObject({ projectedPoints: 20, projectionsSource: 'allfantasy', headshotUrl: 'h', imageUrl: 'h', teamLogoUrl: 't', periodOpponent: 'NYG', periodHomeAway: 'away', periodKickoffIso: o.kickoffTimeIso, opponentLogoUrl: 'o', teamByeWeek: 7, periodWeather: null })
  })
  it('never replaces a projection, picture or opponent the row already carries', () => {
    const [row] = applyNflRosterOutlook([{ id: '1', projectedPoints: 12.5, projectionsSource: 'x', headshotUrl: 'mine', teamLogoUrl: 'crest', periodOpponent: 'DAL', periodHomeAway: 'home' as const }], new Map([['1', o]]))
    expect(row).toMatchObject({ projectedPoints: 12.5, projectionsSource: 'x', headshotUrl: 'mine', teamLogoUrl: 'crest', periodOpponent: 'DAL', periodHomeAway: 'home' })
  })
  it('a player with no outlook is returned as he was', () => {
    const row = { id: '9', projectedPoints: null }
    expect(applyNflRosterOutlook([row], new Map())[0]).toBe(row)
  })
})

describe('loadNflRosterOutlook', () => {
  const games = [
    // The same fixture from two providers, spelled two ways.
    { homeTeam: 'New York Giants', awayTeam: 'Chicago Bears', startTime: new Date('2026-11-22T18:00:00Z'), seasonType: 'regular', venue: null },
    { homeTeam: 'NYG', awayTeam: 'CHI', startTime: new Date('2026-11-22T18:00:00Z'), seasonType: null, venue: null },
    { homeTeam: 'ARI', awayTeam: 'SEA', startTime: new Date('2026-11-22T21:25:00Z'), seasonType: 'regular', venue: null },
  ]
  const rankRows = [
    ...['NYG', 'MIN', 'ARI', 'SEA'].flatMap((d, i) => [1, 2, 3].map((week) => ({ defense: d, position: 'QB', week, points: 10 + i * 4 }))),
  ]
  const calls = { playerIds: [] as string[][], raw: 0 }
  const db = () => ({
    redraftSeason: { findFirst: vi.fn(async () => ({ currentWeek: 11 })) },
    sportsGame: { findMany: vi.fn(async () => games) },
    sportsPlayerRecord: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => {
        calls.playerIds.push(where.id.in)
        return [{ id: 'NFL:11560', team: 'CHI', position: 'QB' }]
      }),
    },
    $queryRaw: vi.fn(async () => { calls.raw += 1; return rankRows }),
  })
  const league = { id: 'L', sport: 'NFL', season: 2026, platform: 'manual', settings: {} }
  const players = [
    { id: '11560', team: 'CHI', position: 'QB' },
    { id: 'ARI', team: 'ARI', position: 'DEF' },
    { id: '777', team: 'LAR', position: 'RB' },
  ]

  beforeEach(() => {
    clearNflRosterOutlookCache()
    h.projections = new Map([['11560', 20.024]])
    calls.playerIds = []
    calls.raw = 0
  })

  it('🛑 a bare roster id is read against the stored "NFL:<id>" row and gets the whole week', async () => {
    const out = await loadNflRosterOutlook(db() as never, { league, players })
    expect(calls.playerIds[0]).toEqual(['NFL:11560', 'NFL:ARI', 'NFL:777'])
    const qb = out.get('11560')!
    expect(qb).toMatchObject({ projectedPoints: 20.02, opponent: 'NYG', homeAway: 'away', kickoffTimeIso: '2026-11-22T18:00:00.000Z' })
    expect(qb.opponentRank).toMatchObject({ rank: 1, of: 4, position: 'QB', allowedPerGame: 10 })
    expect(qb.headshotUrl).toContain('/11560.jpg')
    expect(qb.teamLogoUrl).toBeTruthy()
    expect(qb.opponentLogoUrl).toBeTruthy()
  })

  it('a team defense plays its own club’s game and has no position rank', async () => {
    const out = await loadNflRosterOutlook(db() as never, { league, players })
    expect(out.get('ARI')).toMatchObject({ opponent: 'SEA', homeAway: 'home', opponentRank: null, projectedPoints: null })
  })

  it('a club with no game in a week that has games is on a bye', async () => {
    const out = await loadNflRosterOutlook(db() as never, { league, players })
    expect(out.get('777')).toMatchObject({ opponent: 'BYE', homeAway: null, kickoffTimeIso: null })
  })

  it('[control] a week with no stored schedule says nothing, not "bye"', async () => {
    const d = db()
    d.sportsGame.findMany = vi.fn(async () => [])
    const out = await loadNflRosterOutlook(d as never, { league, players })
    expect(out.get('777')?.opponent).toBeNull()
    expect(out.get('11560')?.projectedPoints).toBe(20.02)
  })

  it('[control] other sports, other id spaces and an unstarted season get nothing', async () => {
    expect((await loadNflRosterOutlook(db() as never, { league: { ...league, sport: 'NBA' }, players })).size).toBe(0)
    expect((await loadNflRosterOutlook(db() as never, { league: { ...league, platform: 'yahoo' }, players })).size).toBe(0)
    const d = db()
    d.redraftSeason.findFirst = vi.fn(async () => ({ currentWeek: 0 }))
    expect((await loadNflRosterOutlook(d as never, { league, players })).size).toBe(0)
  })

  it('the defense table is read once and reused', async () => {
    const d = db()
    await loadNflRosterOutlook(d as never, { league, players })
    await loadNflRosterOutlook(d as never, { league, players })
    expect(calls.raw).toBe(1)
  })

  it('a failed part leaves the rest standing', async () => {
    const d = db()
    d.$queryRaw = vi.fn(async () => { throw new Error('boom') })
    const out = await loadNflRosterOutlook(d as never, { league, players })
    expect(out.get('11560')).toMatchObject({ opponent: 'NYG', projectedPoints: 20.02, opponentRank: null })
  })
})

describe('the screen’s player record carries the outlook', () => {
  it('kickoff, opponent and the opponent’s rank reach the row', async () => {
    const { displayPlayerFromUnifiedRow } = await import('@/lib/player-data/adapters/redraftDisplayPlayers')
    const rank = { rank: 28, of: 32, position: 'QB', allowedPerGame: 20.1, games: 10 }
    const p = displayPlayerFromUnifiedRow({
      id: '11560', name: 'Caleb Williams', position: 'QB', team: 'CHI', sport: 'NFL', projectedPoints: 20.02, headshotUrl: 'h', teamLogoUrl: 't',
      periodOpponent: 'NYG', periodHomeAway: 'away', periodKickoffIso: '2026-11-22T18:00:00.000Z', opponentRank: rank, opponentLogoUrl: 'o',
    } as never)
    expect(p).toMatchObject({ projectedPoints: 20.02, opponent: 'NYG', homeAway: 'away', kickoffTimeIso: '2026-11-22T18:00:00.000Z', opponentRank: rank, opponentLogoUrl: 'o', headshotUrl: 'h', teamLogoUrl: 't' })
  })
})

/* ── Bye week and weather ─────────────────────────────────────────────────────────────────────── */

describe('byeWeeksFromSchedule', () => {
  // 26 clubs in 13 games a week; clubs A0/A1 sit out week 2 (their game is simply absent).
  const clubs = Array.from({ length: 26 }, (_, i) => `C${i}`)
  const week = (w: number, skip: number[] = []): SeasonFixture[] =>
    Array.from({ length: 13 }, (_, g) => g).filter((g) => !skip.includes(g)).map((g) => ({ week: w, home: clubs[g * 2], away: clubs[g * 2 + 1] }))
  it('the one whole week a club does not play is its bye', () => {
    const byes = byeWeeksFromSchedule([...week(1), ...week(2, [0]), ...week(3)])
    expect(byes.get('C0')).toBe(2)
    expect(byes.get('C1')).toBe(2)
    expect(byes.has('C2')).toBe(false)
  })
  it('the same fixture stored twice is one game', () => {
    const byes = byeWeeksFromSchedule([...week(1), ...week(1), ...week(2, [0]), ...week(2, [0])])
    expect(byes.get('C0')).toBe(2)
  })
  it('[control] a partly stored week is not a week of byes', () => {
    // Week 2 holds four games: 18 clubs "off". Nobody is given a bye from it.
    const byes = byeWeeksFromSchedule([...week(1), ...week(2).slice(0, 4), ...week(3)])
    expect(byes.size).toBe(0)
  })
  it('[control] a club missing from two whole weeks gets no answer, not the first gap', () => {
    const byes = byeWeeksFromSchedule([...week(1), ...week(2, [0]), ...week(3, [0]), ...week(4)])
    expect(byes.has('C0')).toBe(false)
  })
})

describe('loadNflRosterOutlook — bye week and weather', () => {
  const teams = ['ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE', 'DAL', 'DEN', 'DET', 'GB', 'HOU', 'IND', 'JAX', 'KC', 'LV', 'LAC', 'LAR', 'MIA', 'MIN', 'NE', 'NO', 'NYG', 'NYJ', 'PHI', 'PIT', 'SF']
  const slate = (w: number, off: string[]) => {
    const on = teams.filter((t) => !off.includes(t))
    return Array.from({ length: Math.floor(on.length / 2) }, (_, i) => ({ homeTeam: on[i * 2], awayTeam: on[i * 2 + 1], week: w, startTime: new Date('2026-11-22T18:00:00Z'), seasonType: 'regular', venue: null }))
  }
  const db = () => ({
    redraftSeason: { findFirst: vi.fn(async () => ({ currentWeek: 11 })) },
    sportsGame: {
      findMany: vi.fn(async ({ where }: { where: { week: unknown } }) =>
        typeof where.week === 'number' ? slate(11, []) : [...slate(7, ['CHI', 'CIN']), ...slate(10, []), ...slate(11, [])]),
    },
    sportsPlayerRecord: { findMany: vi.fn(async () => []) },
    $queryRaw: vi.fn(async () => []),
  })
  const league = { id: 'L', sport: 'NFL', season: 2026, platform: 'manual', settings: {} }

  beforeEach(() => {
    clearNflRosterOutlookCache()
    h.projections = new Map()
    h.weather = new Map([['11560', { indoors: false, symbol: '☔', conditionLabel: 'Rain', temperatureF: 47, windSpeedMph: 11, precipChancePct: 70 }]])
    h.weatherArgs = null
  })

  it('a player carries his club’s bye week and the forecast at his game', async () => {
    const out = await loadNflRosterOutlook(db() as never, { league, players: [{ id: '11560', team: 'CHI', position: 'QB' }, { id: '9', team: 'DAL', position: 'WR' }] })
    expect(out.get('11560')).toMatchObject({ byeWeek: 7, weather: { symbol: '☔', temperatureF: 47 } })
    expect(out.get('9')).toMatchObject({ byeWeek: null, weather: null })
  })

  it('the forecast is asked for at the HOST club’s stadium', async () => {
    await loadNflRosterOutlook(db() as never, { league, players: [{ id: '11560', team: 'CHI', position: 'QB' }] })
    // CHI is the away side of BUF–CAR… pairing order: slate pairs (CAR, CHI), so CAR hosts.
    const games = (h.weatherArgs as { games: Map<string, { hostTeam: string; kickoff: Date }> }).games
    expect(games.get('11560')).toEqual({ hostTeam: 'CAR', kickoff: new Date('2026-11-22T18:00:00Z') })
  })
})
