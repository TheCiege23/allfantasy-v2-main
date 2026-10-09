/**
 * The daily-sport points grade (trade grade audit, 2026-10-09): NBA, college basketball and NHL deals are
 * graded on points over the best free agent at each position, scored under the league's rules — the
 * college-football redraft rule extended to the sports that had no grade at all.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import {
  MIN_SAMPLE_GAMES,
  boardReadinessReason,
  categoryLeagueReason,
  gradeSportPointsDeal,
  indexBoard,
  meetsSampleBar,
  multiSeasonFormatReason,
  replacementFromLineups,
  replacementFromRosters,
  resolveBoardPlayer,
  sampleGamesFromReasons,
  sportPointsBasis,
  type BoardPlayer,
  type SportPointsContext,
} from '@/lib/decision-os/trade/sportPointsValue'
import { createSportPointsGrader } from '@/lib/decision-os/trade/sportPointsGrader'
import { buildLeagueStatScorer } from '@/lib/redraft/scoringEngine'
import { tradeValueSourceOf } from '@/lib/decision-os/trade/valueSource'

const p = (id: string, name: string, position: string, perGame: number, extra: Partial<BoardPlayer> = {}): BoardPlayer => ({
  id, name, position, perGame, sampleGames: 60, aliases: [], ...extra,
})

const board: BoardPlayer[] = [
  p('pim-jokic', 'Nikola Jokic', 'C', 63, { aliases: ['114'] }),
  p('pim-sga', 'Shai Gilgeous-Alexander', 'PG', 50, { aliases: ['200'] }),
  p('pim-c2', 'Second Center', 'C', 30),
  p('pim-pg2', 'Second Guard', 'PG', 28),
  p('pim-c3', 'Waiver Center', 'C', 20),
  p('pim-pg3', 'Waiver Guard', 'PG', 18),
]

const ctx = (over: Partial<SportPointsContext> = {}): SportPointsContext => ({
  sport: 'NBA',
  board,
  replacementByPosition: new Map([['C', { name: 'Waiver Center', perGame: 20 }], ['PG', { name: 'Waiver Guard', perGame: 18 }]]),
  window: { season: 2026, seasonLabel: '2026-27', gamesRemaining: 79 },
  scoringBasis: 'league',
  teams: 12,
  ...over,
})

const player = (playerId: string | undefined, name: string) => ({ kind: 'player' as const, playerId, name })

describe('projection sample size', () => {
  it('reads the games behind a projection from its own reasons', () => {
    expect(sampleGamesFromReasons(['no depth-chart role', '65 games in the season sample'])).toBe(65)
    expect(sampleGamesFromReasons(['2 games in the season sample'])).toBe(2)
    expect(sampleGamesFromReasons(['baseline is from a prior season'])).toBeNull()
    expect(sampleGamesFromReasons(null)).toBeNull()
  })

  it('refuses a player whose projection rests on a handful of games (hockey this week)', () => {
    const thin = [...board, p('pim-stanley', 'Hoyt Stanley', 'C', 94, { sampleGames: 2 })]
    const view = gradeSportPointsDeal({ give: [player('pim-stanley', 'Hoyt Stanley')], get: [player('pim-jokic', 'Nikola Jokic')], ctx: ctx({ board: thin }) })
    expect(view.graded).toBe(false)
    if (!view.graded) expect(view.reason).toContain(`rests on 2 games, too few to price — grades start at ${MIN_SAMPLE_GAMES} games`)
  })

  it('says a baseball sample in at-bats, and holds it to that bar even past ten games', () => {
    const callUp = p('pim-callup', 'Hot Call-Up', 'C', 94, { sampleGames: 11, sampleBar: { ok: false, has: '31 at-bats', needs: '100 at-bats or 30 innings' } })
    const view = gradeSportPointsDeal({ give: [player('pim-callup', 'Hot Call-Up')], get: [player('pim-jokic', 'Nikola Jokic')], ctx: ctx({ board: [...board, callUp] }) })
    expect(view).toMatchObject({ graded: false, reason: expect.stringContaining('rests on 31 at-bats, too few to price — grades start at 100 at-bats or 30 innings') })
    // Nor does he set a replacement level: a thin line is never "the best free agent".
    expect(replacementFromRosters([...board, callUp], new Set()).get('C')!.name).toBe('Nikola Jokic')
    expect(meetsSampleBar(callUp)).toBe(false)
  })
})

describe('resolving the traded player', () => {
  const index = indexBoard(board)
  it('finds him by a sport-prefixed Rolling Insights id, the open analyzer search id', () => {
    const r = resolveBoardPlayer({ playerId: 'NBA:114', name: 'whatever' }, board, index)
    expect(r.ok && r.player.id).toBe('pim-jokic')
  })
  it('finds him by the projection id', () => {
    const r = resolveBoardPlayer({ playerId: 'pim-sga' }, board, index)
    expect(r.ok && r.player.name).toBe('Shai Gilgeous-Alexander')
  })
  it('falls back to a name exactly one player carries', () => {
    const r = resolveBoardPlayer({ playerId: 'NBA:tsdb_34153733', name: 'Nikola Jokic' }, board, index)
    expect(r.ok && r.player.id).toBe('pim-jokic')
  })
  it('refuses a name two players carry rather than pick one', () => {
    const twins = [...board, p('pim-other', 'Nikola Jokic', 'C', 5)]
    const r = resolveBoardPlayer({ name: 'Nikola Jokic' }, twins, indexBoard(twins))
    expect(r.ok).toBe(false)
  })
})

describe('replacement level', () => {
  it('from rosters: the best unrostered player at the position', () => {
    const repl = replacementFromRosters(board, new Set(['pim-jokic', 'pim-sga', 'pim-c2', 'pim-pg2']))
    expect(repl.get('C')).toEqual({ name: 'Waiver Center', perGame: 20 })
    expect(repl.get('PG')).toEqual({ name: 'Waiver Guard', perGame: 18 })
  })

  it('from standard lineups: fills starters, then bench, and the rest is the wire', () => {
    // One team, a C slot and a PG slot, one bench spot: Jokic and SGA start, Second Center sits on the bench.
    const repl = replacementFromLineups(board, { teams: 1, slots: [{ slot: 'C', eligible: ['C'], count: 1 }, { slot: 'PG', eligible: ['PG'], count: 1 }], benchPerTeam: 1 })
    expect(repl.get('C')).toEqual({ name: 'Waiver Center', perGame: 20 })
    expect(repl.get('PG')).toEqual({ name: 'Second Guard', perGame: 28 })
  })

  it('never lets a thin projection set the replacement level', () => {
    const thin = [...board, p('pim-fringe', 'Fringe Center', 'C', 90, { sampleGames: 3 })]
    expect(replacementFromRosters(thin, new Set(['pim-jokic', 'pim-sga', 'pim-c2', 'pim-pg2'])).get('C')?.name).toBe('Waiver Center')
  })
})

describe('the grade', () => {
  it('grades a star for depth on points over replacement, both sides', () => {
    // Jokic: (63-20)*79 = 3397. Second Center (30-20)*79 = 790 + Second Guard (28-18)*79 = 790 → 1580.
    const view = gradeSportPointsDeal({ give: [player('pim-jokic', 'Nikola Jokic')], get: [player('pim-c2', 'Second Center'), player('pim-pg2', 'Second Guard')], ctx: ctx() })
    expect(view.graded).toBe(true)
    if (!view.graded) return
    expect(view.giveValue).toBe(3397)
    expect(view.getValue).toBe(1580)
    expect(view.letter).toBe('F')
    expect(view.partnerLetter).toBe('A')
    expect(view.lines.every((l) => l.valueSource === 'sport_projection')).toBe(true)
  })

  it('refuses a pick and FAAB rather than price them on this scale', () => {
    const pick = gradeSportPointsDeal({ give: [player('pim-jokic', 'Nikola Jokic')], get: [{ kind: 'pick', year: 2027, round: 1 }], ctx: ctx() })
    expect(pick.graded).toBe(false)
    if (!pick.graded) expect(pick.reason).toBe('Draft picks have no NBA price yet, so a deal carrying one is not graded.')
    const faab = gradeSportPointsDeal({ give: [player('pim-jokic', 'Nikola Jokic')], get: [{ kind: 'faab', amount: 20 }], ctx: ctx() })
    expect(faab.graded).toBe(false)
  })

  it('says so when everyone in the deal is replaceable from the wire', () => {
    const view = gradeSportPointsDeal({ give: [player('pim-c3', 'Waiver Center')], get: [player('pim-pg3', 'Waiver Guard')], ctx: ctx() })
    expect(view.graded).toBe(false)
    if (!view.graded) expect(view.reason).toMatch(/replaced from the wire/)
  })

  it('withholds when the regular season is over', () => {
    const view = gradeSportPointsDeal({ give: [player('pim-jokic', 'Nikola Jokic')], get: [player('pim-sga', 'Shai Gilgeous-Alexander')], ctx: ctx({ window: { season: 2026, seasonLabel: '2026-27', gamesRemaining: 0 } }) })
    expect(view.graded).toBe(false)
  })

  it('names its basis: games left, whose scoring, and the bonuses it does not project', () => {
    expect(sportPointsBasis(ctx())).toBe('Points over the best free agent at each position for the rest of the 2026-27 NBA regular season (about 79 games), scored under this league’s rules. Double-double and triple-double bonuses are not projected.')
    expect(sportPointsBasis(ctx({ sport: 'NHL', scoringBasis: 'default' }))).toContain('AllFantasy’s default NHL points for a 12-team league')
  })

  it('records where each value came from on saved grades', () => {
    expect(tradeValueSourceOf({ source: 'unknown' }, { dataSource: 'nba-points-vorp' })).toBe('sport_projection')
    expect(tradeValueSourceOf({ source: 'unknown' }, { dataSource: 'nhl-points-vorp' })).toBe('sport_projection')
    expect(tradeValueSourceOf({ source: 'unknown' }, { dataSource: 'nba-category-vorp' })).toBe('sport_projection')
  })
})

describe('a board that is not ready to grade on', () => {
  const many = (n: number, sampleGames: number | null, sourceSeason: number | null) =>
    Array.from({ length: n }, (_, i) => p(`id${sampleGames}-${i}`, `P${sampleGames}-${i}`, 'C', 10, { sampleGames, sourceSeason }))

  it('pauses a board mid-switch to the new season (hockey on 2–4 games)', () => {
    const board = [...many(30, 60, 2025), ...many(70, 3, 2026)]
    expect(boardReadinessReason({ sport: 'NHL', board, season: 2026, seasonLabel: '2026-27' })).toMatch(/^NHL projections are switching to the 2026-27 season/)
  })

  it('grades a board built from last season when nearly all of it clears the bar (the NBA today)', () => {
    const board = [...many(88, 60, 2025), ...many(12, 4, 2025)]
    expect(boardReadinessReason({ sport: 'NBA', board, season: 2026, seasonLabel: '2026-27' })).toBeNull()
  })

  it('refuses college basketball on last season’s board, whose players have turned over', () => {
    const board = many(100, 30, 2025)
    expect(boardReadinessReason({ sport: 'NCAAB', board, season: 2026, seasonLabel: '2026-27' })).toMatch(/College rosters turn over every year/)
    expect(boardReadinessReason({ sport: 'NCAAB', board: many(100, 20, 2026), season: 2026, seasonLabel: '2026-27' })).toBeNull()
  })

  it('explains a category grade by the categories it was valued on', () => {
    const nine = sportPointsBasis(ctx({ valueKind: 'categories', categoryList: 'PTS, REB, AST, STL, BLK, TO, FG%, FT% and 3PM', scoringBasis: 'default' }))
    expect(nine).toMatch(/^Category value over the best free agent/)
    expect(nine).toContain('a standard 12-team head-to-head category league')
    expect(nine).toContain('Percentages are weighted by shot volume and turnovers count against.')
    expect(nine).toContain('Punting a category is not modelled.')
    // The 8-category standard has no turnovers, so the basis must not claim they count.
    const eight = sportPointsBasis(ctx({ valueKind: 'categories', categoryList: 'PTS, REB, AST, STL, BLK, FG%, FT% and 3PM' }))
    expect(eight).toContain('this league’s categories')
    expect(eight).not.toMatch(/turnovers/)
    expect(eight).toContain('Percentages are weighted by shot volume.')
  })

  it('explains an MLB grade: the team-game scale, the unposted schedule, and no basketball bonuses', () => {
    const offseason = { season: 2027, seasonLabel: '2027', gamesRemaining: 162, scheduleKnown: false, baselineSeasonLabel: '2026' }
    const points = sportPointsBasis(ctx({ sport: 'MLB', scoringBasis: 'default', window: offseason }))
    expect(points).toContain('the 2027 MLB regular season (162 games — the schedule is not posted yet)')
    expect(points).toContain('Pitchers count for the share of team games they pitched in that season — a starter about one in five.')
    expect(points).toContain('Quality starts are not projected.')
    expect(points).not.toMatch(/double-double/i)

    const cats = sportPointsBasis(ctx({ sport: 'MLB', valueKind: 'categories', categoryList: 'R, HR, RBI, SB, AVG, W, SV, K, ERA and WHIP', window: offseason }))
    expect(cats).toContain('per team game')
    expect(cats).toContain('AVG is weighted by at-bats; ERA and WHIP by innings; hitters are measured against hitters and pitchers against pitchers.')
    expect(cats).not.toMatch(/shot volume|turnovers/)
    // A counted schedule reads as before.
    expect(sportPointsBasis(ctx({ sport: 'MLB', window: { season: 2027, seasonLabel: '2027', gamesRemaining: 90 } }))).toContain('the rest of the 2027 MLB regular season (about 90 games)')
    // Basketball keeps its bonus disclaimer; hockey never had one.
    expect(sportPointsBasis(ctx({ sport: 'NBA' }))).toMatch(/double-double/i)
    expect(sportPointsBasis(ctx({ sport: 'NHL' }))).not.toMatch(/double-double/i)
  })

  it('names the season the projections come from in the basis', () => {
    expect(sportPointsBasis(ctx({ window: { season: 2026, seasonLabel: '2026-27', gamesRemaining: 80, baselineSeasonLabel: '2025-26' } })))
      .toMatch(/Projections are built from the 2025-26 season until this one has enough games\.$/)
  })
})

describe('leagues this grade must not answer for', () => {
  it('refuses a category league instead of grading it on points', () => {
    expect(categoryLeagueReason({ scoring_mode: 'h2h_category', category_preset_id: 'nba_9cat' }, 'NBA')).toMatch(/by categories/)
    expect(categoryLeagueReason({ scoring_mode: 'roto' }, 'NBA')).toMatch(/by categories/)
    expect(categoryLeagueReason({ scoring_type: 'head' }, 'NBA')).toMatch(/by categories/)
    expect(categoryLeagueReason({ scoring_mode: 'points' }, 'NBA')).toBeNull()
    expect(categoryLeagueReason({ scoring_type: 'headpoint' }, 'NBA')).toBeNull()
    // Each sport names what it does cover, never another sport's setups.
    expect(categoryLeagueReason({ scoring_mode: 'roto' }, 'MLB')).toMatch(/standard 5x5 and 6x6 setups/)
    expect(categoryLeagueReason({ scoring_mode: 'h2h_category' }, 'NHL')).toMatch(/no NHL category grades yet/)
  })

  it('refuses a dynasty or keeper league, which this-season points would misprice', () => {
    expect(multiSeasonFormatReason('dynasty', 'NBA')).toMatch(/count this season only/)
    expect(multiSeasonFormatReason('keeper', 'NHL')).toMatch(/count this season only/)
    expect(multiSeasonFormatReason('redraft', 'NBA')).toBeNull()
    expect(multiSeasonFormatReason(null, 'NBA')).toBeNull()
  })
})

describe('the grader', () => {
  it('is null for the sports it does not cover, and covers MLB', () => {
    expect(createSportPointsGrader({ sport: 'NFL', league: null })).toBeNull()
    expect(createSportPointsGrader({ sport: 'SOCCER', league: null })).toBeNull()
    expect(createSportPointsGrader({ sport: 'mlb', league: null })).not.toBeNull()
  })

  it('loads once per grader and returns the loader refusal as the grade', async () => {
    const loadBase = vi.fn(async () => ({ ok: false as const, reason: 'This league scores NBA by categories.' }))
    const grader = createSportPointsGrader({ sport: 'NBA', league: null }, { loadBase })!
    const a = await grader.grade([player('x', 'A')], [player('y', 'B')])
    await grader.grade([player('x', 'A')], [player('y', 'B')])
    expect(a).toMatchObject({ graded: false, reason: 'This league scores NBA by categories.' })
    expect(loadBase).toHaveBeenCalledTimes(1)
  })

  it('grades through a loaded context', async () => {
    const grader = createSportPointsGrader({ sport: 'nba', league: null }, { loadBase: async () => ({ ok: true, ctx: ctx() }) })!
    const view = await grader.grade([player('NBA:114', 'Nikola Jokic')], [player('NBA:200', 'Shai Gilgeous-Alexander')])
    expect(view.graded).toBe(true)
  })
})

describe('league scoring is the weekly scoring', () => {
  const line = { pts: 27.7, reb: 12.9, ast: 10.7, stl: 1.4, blk: 0.8, to: 3.7, threes: 1.9 }

  it('scores a stat line on the sport defaults with no league', () => {
    const scorer = buildLeagueStatScorer({ sport: 'NBA', settings: null })!
    // 27.7 + 12.9*1.2 + 10.7*1.5 + 1.4*3 + 0.8*3 - 3.7 + 1.9*0.5
    expect(scorer(line)).toBeCloseTo(27.7 + 15.48 + 16.05 + 4.2 + 2.4 - 3.7 + 0.95, 5)
  })

  it('scores it under a league that weights points differently', () => {
    const defaults = buildLeagueStatScorer({ sport: 'NBA', settings: null })!(line)
    const halfPoints = buildLeagueStatScorer({ sport: 'NBA', settings: { sportConfig: { categoryPoints: { pts: 0.5 } } } })!(line)
    expect(halfPoints).toBeCloseTo(defaults - 27.7 * 0.5, 5)
  })

  it('scores hockey on hockey defaults, goalies included', () => {
    const scorer = buildLeagueStatScorer({ sport: 'NHL', settings: null })!
    expect(scorer({ g: 1, a: 1, sog: 4 })).toBeCloseTo(3 + 2 + 4 * 0.3, 5)
    expect(scorer({ g_win: 1, g_sv: 30, g_ga: 2 })).toBeCloseTo(5 + 30 * 0.2 - 2, 5)
  })
})

describe('wired into both grading surfaces', () => {
  it('the shared league grader returns its view before the NFL chart', () => {
    const src = readFileSync('lib/decision-os/trade/leagueTradeGrader.ts', 'utf8')
    expect(src).toMatch(/^\s*const sportPoints = createSportPointsGrader\(/m)
    expect(src).toMatch(/^\s*if \(sportPoints\) return await sportPoints\.grade\(give, get\)/m)
  })

  it('the Trade Center console grades with it in a league and in the open analyzer', () => {
    const src = readFileSync('lib/trade-value-console/runTradeConsoleAnalysis.ts', 'utf8')
    expect(src).toMatch(/^\s*: createSportPointsGrader\(\{/m)
    expect(src).toMatch(/^\s*if \(sportView\) applyCollegeGrade\(leagueGrade, sportView\)/m)
    expect(src).toMatch(/^\s*: sportView \?\? graded\.grade/m)
  })
})
