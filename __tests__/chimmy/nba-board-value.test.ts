/**
 * NBA values in Chimmy (2026-11-16, re-score item 12): the league's own value board — the pricing the
 * trade grade uses — never a second model, and never the NFL 0–10000 scale.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { buildSportBoardValueContext, BOARD_VALUE_SPORTS } from '@/lib/chimmy/sportBoardValue'
import { gradeSportPointsDeal, priceBoardPlayer, type BoardPlayer, type SportPointsContext } from '@/lib/decision-os/trade/sportPointsValue'

const P = (id: string, name: string, position: string, perGame: number, sampleGames: number | null = 30): BoardPlayer => ({ id, name, position, perGame, sampleGames, aliases: [] })

const BOARD = [
  P('1', 'Nikola Jokic', 'C', 62),
  P('2', 'Tyrese Haliburton', 'PG', 44),
  P('3', 'Bench Center', 'C', 30),
  P('4', 'Fresh Rookie', 'SF', 38, 4),
  P('5', 'Wire Guard', 'PG', 28),
]

function ctx(over: Partial<SportPointsContext> = {}): SportPointsContext {
  return {
    sport: 'NBA',
    board: BOARD,
    replacementByPosition: new Map([['C', { name: 'Bench Center', perGame: 30 }], ['PG', { name: 'Wire Guard', perGame: 28 }]]),
    window: { season: 2026, seasonLabel: '2026-27', gamesRemaining: 60 },
    scoringBasis: 'league',
    teams: 12,
    ...over,
  }
}

const LEAGUE = { id: 'L1', sport: 'NBA', platform: 'sleeper', platformLeagueId: 's1', settings: {}, leagueType: 'redraft', leagueSize: 12, season: 2026, status: 'in_season' }
const deps = (c: SportPointsContext | { ok: false; reason: string }, league = LEAGUE) => ({
  league: async () => league,
  base: async () => ('ok' in c ? c : { ok: true as const, ctx: c }),
})

describe('priceBoardPlayer — the one price the value and the trade grade share', () => {
  it('rest of season = max(0, per game − best free agent at his position) × games left', () => {
    const r = priceBoardPlayer({ name: 'Nikola Jokic' }, ctx())
    expect(r).toMatchObject({ ok: true, replacementPerGame: 30, replacementName: 'Bench Center', value: (62 - 30) * 60 })
  })

  it('🛑 and the trade grade prices the same player at exactly that number', () => {
    const grade = gradeSportPointsDeal({
      give: [{ kind: 'player', name: 'Nikola Jokic' } as never],
      get: [{ kind: 'player', name: 'Tyrese Haliburton' } as never],
      ctx: ctx(),
    })
    if (!('lines' in grade) || !grade.lines) throw new Error('not graded')
    const jokic = grade.lines.find((l) => l.name === 'Nikola Jokic')!
    expect(jokic.leagueValue).toBe((62 - 30) * 60)
  })

  it('too few games is a refusal, in the grade’s own words', () => {
    const r = priceBoardPlayer({ name: 'Fresh Rookie' }, ctx())
    expect(r).toEqual({ ok: false, reason: 'Fresh Rookie’s projection rests on 4 games, too few to price — values start at 10 games.' })
    const grade = gradeSportPointsDeal({ give: [{ kind: 'player', name: 'Fresh Rookie' } as never], get: [{ kind: 'player', name: 'Wire Guard' } as never], ctx: ctx() })
    expect(grade.graded).toBe(false)
    if (!grade.graded) expect(grade.reason).toBe('Fresh Rookie’s projection rests on 4 games, too few to price — grades start at 10 games. This deal is not graded.')
  })
})

describe('get_player_value in an NBA league', () => {
  it('answers from the league’s own board, with the unit named and the NFL scale ruled out', async () => {
    const out = (await buildSportBoardValueContext({ leagueId: 'L1', playerName: 'nikola jokic' }, deps(ctx())))!
    expect(out).toContain("NBA VALUE for Nikola Jokic (C) in this league — this league's own scoring, 2026-27, 60 games left:")
    expect(out).toContain('62 fantasy points per game against 30 for the best free agent at C (Bench Center): 32 over replacement per game.')
    expect(out).toContain('Rest of season: 1,920 fantasy points over replacement')
    expect(out).toContain('It is NOT the AllFantasy 0–10000 NFL value scale')
    expect(out).not.toMatch(/Dynasty/)
  })

  it('a category league says category score and names the categories', async () => {
    const out = (await buildSportBoardValueContext(
      { leagueId: 'L1', playerName: 'Tyrese Haliburton' },
      deps(ctx({ valueKind: 'categories', categoryList: 'PTS, REB, AST, STL, BLK, 3PM, FG%, FT% and TO' })),
    ))!
    expect(out).toContain("this league's categories (PTS, REB, AST, STL, BLK, 3PM, FG%, FT% and TO)")
    expect(out).toContain('category score per game')
  })

  it('a dynasty league adds the aged multi-season value, labelled a model estimate', async () => {
    const dyn = ctx({ dynasty: { ages: new Map([['2', 26]]), nextDraftYear: 2027 } })
    const out = (await buildSportBoardValueContext({ leagueId: 'L1', playerName: 'Tyrese Haliburton' }, deps(dyn)))!
    expect(out).toMatch(/Dynasty \(5 seasons, age 26 on the NBA age curve, later seasons discounted\): [\d,.]+ fantasy points over replacement\. A model estimate, not a market price\./)
    const noAge = (await buildSportBoardValueContext({ leagueId: 'L1', playerName: 'Nikola Jokic' }, deps(dyn)))!
    expect(noAge).toContain('his age is not on file, so no age curve is applied')
  })

  it('every refusal forbids a number from general knowledge', async () => {
    const rookie = (await buildSportBoardValueContext({ leagueId: 'L1', playerName: 'Fresh Rookie' }, deps(ctx())))!
    expect(rookie).toContain('too few to price')
    expect(rookie).toContain('Do NOT estimate one')
    const unknown = (await buildSportBoardValueContext({ leagueId: 'L1', playerName: 'Nobody Atall' }, deps(ctx())))!
    expect(unknown).toContain('has no projection on file for this season')
    const board = (await buildSportBoardValueContext({ leagueId: 'L1', playerName: 'Nikola Jokic' }, deps({ ok: false, reason: 'Only 40% of the board clears the sample bar.' })))!
    expect(board).toBe('NBA VALUE: not available in this league — Only 40% of the board clears the sample bar. Do NOT give a value from general knowledge.')
  })

  it('another sport returns null, so the NFL market values answer as before', async () => {
    expect(await buildSportBoardValueContext({ leagueId: 'L1', playerName: 'Josh Allen' }, deps(ctx(), { ...LEAGUE, sport: 'NFL' }))).toBeNull()
    expect([...BOARD_VALUE_SPORTS]).toEqual(['NBA', 'MLB', 'NHL', 'NCAAB', 'SOCCER'])
    expect(await buildSportBoardValueContext({ leagueId: 'L1', playerName: 'Cooper Flagg' }, deps(ctx(), { ...LEAGUE, sport: 'NCAAB' })))
      .toMatch(/NCAAB VALUE: not available/)
  })
})

describe('MLB values in Chimmy (2026-11-16, second sport)', () => {
  const JUDGE: BoardPlayer = {
    id: 'm1', name: 'Aaron Judge', position: 'OF', perGame: 4.1, sampleGames: 152, aliases: [],
    sampleBar: { ok: true, has: '541 at-bats', needs: '100 at-bats or 30 innings', unit: 'at_bats', count: 541 },
  }
  const CALLUP: BoardPlayer = {
    id: 'm2', name: 'Call Up', position: 'SP', perGame: 1.4, sampleGames: 9, aliases: [],
    sampleBar: { ok: true, has: '41.2 innings', needs: '100 at-bats or 30 innings', unit: 'innings', count: 41.2 },
  }
  const mlb = (): SportPointsContext => ({
    sport: 'MLB',
    board: [JUDGE, CALLUP],
    replacementByPosition: new Map([['OF', { name: 'Wire Bat', perGame: 2.6 }], ['SP', { name: 'Wire Arm', perGame: 1.0 }]]),
    window: { season: 2027, seasonLabel: '2027', gamesRemaining: 162, scheduleKnown: false },
    scoringBasis: 'league',
    teams: 12,
  })

  it('values a hitter on the league board, says the sample in at-bats, and that 162 games is a full season not yet scheduled', async () => {
    const out = (await buildSportBoardValueContext({ leagueId: 'L1', playerName: 'Aaron Judge' }, deps(mlb(), { ...LEAGUE, sport: 'MLB' })))!
    expect(out).toContain('MLB VALUE for Aaron Judge (OF)')
    expect(out).toContain('a full 162-game season, schedule not posted yet')
    expect(out).toContain('- The projection rests on 541 at-bats.')
    expect(out).not.toMatch(/rests on \d+ games/)
    expect(out).toContain('a full season — the schedule is not posted yet')
  })

  it('a pitcher’s sample is innings, and under 60 is called thin', async () => {
    const out = (await buildSportBoardValueContext({ leagueId: 'L1', playerName: 'Call Up' }, deps(mlb(), { ...LEAGUE, sport: 'MLB' })))!
    expect(out).toContain('- The projection rests on 41.2 innings — a thin sample, so say the value is less certain.')
  })
})

