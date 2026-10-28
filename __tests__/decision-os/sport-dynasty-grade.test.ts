/**
 * The multi-season (dynasty) grade for NBA, NHL and MLB (owner's decision, 2026-10-27): five seasons of
 * points over replacement, aged on each sport's curve, and draft picks priced from the young players
 * they turn into. See lib/decision-os/trade/sportDynastyValue.ts.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import {
  DYNASTY_SEASONS,
  FULL_SEASON_GAMES,
  FUTURE_DISCOUNT,
  PROSPECT_WAIT_SEASONS,
  gradeSportDynastyDeal,
  isDynastyLeagueType,
  pickDynastyValue,
  pickSlotInRound,
  playerDynastyValue,
  youngPlayerPool,
  type DynastyGradedSport,
  type SportDynastyContext,
} from '@/lib/decision-os/trade/sportDynastyValue'
import type { BoardPlayer, SportPointsContext } from '@/lib/decision-os/trade/sportPointsValue'
import { createSportPointsGrader } from '@/lib/decision-os/trade/sportPointsGrader'
import { nextRookieDraftYear, pickBoardAges, type SportPointsBaseResult } from '@/lib/decision-os/trade/sportPointsContext'
import { ageMultiplier, ageMultiplierAtAge } from '@/lib/dynasty-engine/AgingCurveService'

const p = (id: string, name: string, position: string, perGame: number): BoardPlayer => ({ id, name, position, perGame, sampleGames: 60, aliases: [] })

// Two guards of the same output, a decade apart in age.
const board: BoardPlayer[] = [
  p('young', 'Young Guard', 'PG', 40),
  p('vet', 'Veteran Guard', 'PG', 40),
  p('star', 'Young Star', 'PG', 50),
  p('mid', 'Prime Guard', 'PG', 30),
  p('kid', 'Rookie Guard', 'PG', 26),
  p('noage', 'Ageless Guard', 'PG', 35),
  p('wire', 'Waiver Guard', 'PG', 18),
]
const ages = new Map<string, number>([['young', 21], ['vet', 33], ['star', 20], ['mid', 27], ['kid', 19], ['wire', 25]])

type Ctx = SportPointsContext & { sport: DynastyGradedSport }
const ctx = (over: Partial<Ctx> = {}): Ctx => ({
  sport: 'NBA',
  board,
  replacementByPosition: new Map([['PG', { name: 'Waiver Guard', perGame: 18 }]]),
  window: { season: 2026, seasonLabel: '2026-27', gamesRemaining: 79 },
  scoringBasis: 'league',
  teams: 12,
  ...over,
})
const dynasty = (over: Partial<SportDynastyContext> = {}): SportDynastyContext => ({ ages, nextDraftYear: 2027, ...over })
const player = (playerId: string) => ({ kind: 'player' as const, playerId, name: board.find((b) => b.id === playerId)?.name })
const pick = (year: number, round: number, tier?: 'early' | 'mid' | 'late') => ({ kind: 'pick' as const, year, round, ...(tier ? { tier } : {}) })

describe('the aging curve, a season at a time', () => {
  it('is the same curve the horizon multiplier reads', () => {
    for (const age of [19, 24, 29, 33, 37]) {
      expect(ageMultiplierAtAge('NBA', 'PG', age)).toBe(ageMultiplier('NBA', 'PG', age, 'next'))
      expect(ageMultiplierAtAge('NHL', 'D', age + 2)).toBe(ageMultiplier('NHL', 'D', age, 'three'))
      expect(ageMultiplierAtAge('MLB', 'SP', age + 4)).toBe(ageMultiplier('MLB', 'SP', age, 'five'))
    }
  })
})

describe('a player over five seasons', () => {
  it('this season alone is the one-season grade, and later seasons add to it', () => {
    const args = { sport: 'NBA' as const, player: board[0]!, age: 27, replacementPerGame: 18, gamesRemaining: 79 }
    const thisSeason = (40 - 18) * 79
    const total = playerDynastyValue(args)
    // A prime-age player (27–31 on the NBA guard curve) holds his line, so each later season is a full one, discounted.
    let expected = thisSeason
    for (let y = 1; y < DYNASTY_SEASONS; y++) expected += (40 - 18) * FULL_SEASON_GAMES.NBA * FUTURE_DISCOUNT ** y
    expect(total).toBeCloseTo(expected, 6)
  })

  it('values the younger of two equal players above the older one', () => {
    const young = playerDynastyValue({ sport: 'NBA', player: board[0]!, age: 21, replacementPerGame: 18, gamesRemaining: 79 })
    const vet = playerDynastyValue({ sport: 'NBA', player: board[1]!, age: 33, replacementPerGame: 18, gamesRemaining: 79 })
    expect(young).toBeGreaterThan(vet * 1.2)
  })

  it('never counts a season below the free agent as worth less than nothing', () => {
    const fading = playerDynastyValue({ sport: 'NHL', player: p('x', 'Old Winger', 'LW', 20), age: 36, replacementPerGame: 19, gamesRemaining: 70 })
    expect(fading).toBeGreaterThanOrEqual((20 - 19) * 70)
  })
})

describe('draft picks', () => {
  it('lands early, mid and late in a 12-team round', () => {
    expect([pickSlotInRound('early', 12), pickSlotInRound('mid', 12), pickSlotInRound('late', 12), pickSlotInRound(undefined, 12)]).toEqual([2, 6, 9, 6])
  })

  it('is the young player at that spot, waiting a season per year away (and NHL / MLB draftees longer)', () => {
    const pool = [100, 90, 80, 70, 60, 50, 40, 30, 20, 10]
    expect(pickDynastyValue({ sport: 'NBA', pick: pick(2027, 1, 'early'), pool, teams: 4, nextDraftYear: 2027 })).toEqual({ ok: true, value: 100 })
    expect(pickDynastyValue({ sport: 'NBA', pick: pick(2027, 2, 'late'), pool, teams: 4, nextDraftYear: 2027 })).toEqual({ ok: true, value: 30 })
    const later = pickDynastyValue({ sport: 'NBA', pick: pick(2029, 1, 'early'), pool, teams: 4, nextDraftYear: 2027 })
    expect(later.ok && later.value).toBeCloseTo(100 * FUTURE_DISCOUNT ** 2, 6)
    const nhl = pickDynastyValue({ sport: 'NHL', pick: pick(2027, 1, 'early'), pool, teams: 4, nextDraftYear: 2027 })
    expect(nhl.ok && nhl.value).toBeCloseTo(100 * FUTURE_DISCOUNT ** PROSPECT_WAIT_SEASONS.NHL, 6)
  })

  it('refuses a pick for a draft already held, and one deeper than the young players on file', () => {
    expect(pickDynastyValue({ sport: 'MLB', pick: pick(2026, 1), pool: [50], teams: 12, nextDraftYear: 2027 })).toMatchObject({ ok: false, reason: expect.stringContaining('The 2026 draft has already been held') })
    expect(pickDynastyValue({ sport: 'NBA', pick: pick(2027, 3), pool: [50, 40], teams: 12, nextDraftYear: 2027 })).toMatchObject({ ok: false, reason: expect.stringContaining('deeper than the 2 young NBA players') })
  })

  it('prices from players at or under the young age only, best first', () => {
    const pool = youngPlayerPool(ctx(), dynasty())
    // star (20), young (21), kid (19); not mid (27), vet (33), the ageless or the 25-year-old waiver guard.
    expect(pool).toHaveLength(3)
    expect(pool[0]).toBeGreaterThan(pool[1]!)
    expect(pool[1]).toBeGreaterThan(pool[2]!)
  })
})

describe('the grade', () => {
  it('grades a deal of players and picks, with a pick priced on the pick curve', () => {
    const view = gradeSportDynastyDeal({ give: [player('mid')], get: [player('kid'), pick(2027, 1, 'early')], ctx: ctx({ teams: 3 }), dynasty: dynasty() })
    expect(view.graded).toBe(true)
    if (view.graded) {
      expect(view.lines.find((l) => l.name === '2027 1st-round pick')).toMatchObject({ valueSource: 'pick_curve', source: 'nba-points-dynasty' })
      expect(view.lines.find((l) => l.name === 'Rookie Guard')).toMatchObject({ valueSource: 'sport_projection' })
      expect(view.basis).toMatch(/^Dynasty value: points over the best free agent/)
      expect(view.basis).toMatch(/next 4 full seasons/)
    }
  })

  it('swapping two equal producers favours the side that gets the younger one', () => {
    const view = gradeSportDynastyDeal({ give: [player('vet')], get: [player('young')], ctx: ctx(), dynasty: dynasty() })
    expect(view.graded && view.percentDiff).toBeGreaterThan(0)
  })

  it('withholds when a player has no age on file, or the deal carries FAAB', () => {
    expect(gradeSportDynastyDeal({ give: [player('noage')], get: [player('young')], ctx: ctx(), dynasty: dynasty() })).toMatchObject({
      graded: false,
      reason: expect.stringContaining('Ageless Guard has no age on file'),
    })
    expect(gradeSportDynastyDeal({ give: [{ kind: 'faab', amount: 10 }], get: [player('young')], ctx: ctx(), dynasty: dynasty() })).toMatchObject({ graded: false })
  })
})

describe('the grader routes a dynasty league to the five-season grade', () => {
  const loaded = (withDynasty: boolean): SportPointsBaseResult => ({ ok: true, ctx: { ...ctx({ teams: 3 }), ...(withDynasty ? { dynasty: dynasty() } : {}) } })

  it('prices a pick in a dynasty league, and refuses it in a one-season league', async () => {
    const league = { id: 'L', settings: {}, leagueType: 'dynasty', leagueSize: 3 }
    const dyn = createSportPointsGrader({ sport: 'NBA', league }, { loadBase: async () => loaded(true) })!
    expect(await dyn.grade([player('mid')], [pick(2027, 1)])).toMatchObject({ graded: true })
    const redraft = createSportPointsGrader({ sport: 'NBA', league: { ...league, leagueType: 'redraft' } }, { loadBase: async () => loaded(false) })!
    expect(await redraft.grade([player('mid')], [pick(2027, 1)])).toMatchObject({ graded: false, reason: expect.stringContaining('Draft picks have no NBA price') })
  })
})

describe('reading ages and the next draft', () => {
  it('takes one age per player, Sleeper first, and drops sources more than a year apart', () => {
    const ids = [
      { id: 'a', rollingInsightsId: 'ri-a', sleeperId: 's-a' },
      { id: 'b', rollingInsightsId: 'ri-b', sleeperId: null },
      { id: 'c', rollingInsightsId: 'ri-c', sleeperId: 's-c' },
      { id: 'd', rollingInsightsId: null, sleeperId: null },
    ]
    const rows = [
      { source: 'rolling_insights', externalId: 'ri-a', sleeperId: null, age: 24 },
      { source: 'sleeper', externalId: 's-a', sleeperId: 's-a', age: 25 },
      { source: 'rolling_insights', externalId: 'ri-b', sleeperId: null, age: 31 },
      { source: 'rolling_insights', externalId: 'ri-c', sleeperId: null, age: 22 },
      { source: 'sleeper', externalId: 's-c', sleeperId: 's-c', age: 29 },
      { source: 'rolling_insights', externalId: 'ri-x', sleeperId: null, age: 291996 },
    ]
    expect(pickBoardAges(ids, rows)).toEqual(new Map([['a', 25], ['b', 31]]))
  })

  it('names the next rookie draft from the league season, else from the priced season', () => {
    expect(nextRookieDraftYear({ season: 2026, status: 'in_season' }, 2026, 70, 82)).toBe(2027)
    expect(nextRookieDraftYear({ season: 2027, status: 'pre_draft' }, 2026, 82, 82)).toBe(2027)
    expect(nextRookieDraftYear({ season: null, status: null }, 2026, 70, 82)).toBe(2027)
    expect(nextRookieDraftYear({}, 2027, 162, 162)).toBe(2027)
  })

  it('covers dynasty league types only', () => {
    expect(isDynastyLeagueType('dynasty')).toBe(true)
    expect(isDynastyLeagueType('Dynasty_BestBall')).toBe(true)
    expect(isDynastyLeagueType('keeper')).toBe(false)
    expect(isDynastyLeagueType(null)).toBe(false)
  })
})
