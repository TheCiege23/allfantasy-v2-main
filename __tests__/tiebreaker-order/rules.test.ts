import { describe, expect, it } from 'vitest'

import {
  allPlayShares,
  coinFlipDraw,
  moveTiebreaker,
  parseTiebreakerOrder,
  readTiebreakerOrder,
} from '@/lib/standings/tiebreakerOrder'
import { buildNflRedraftPlayoffRuntimeState, type NflRedraftPlayoffRulesInput } from '@/lib/playoff-runtime/canonicalNflRedraftPlayoffRuntime'
import { advanceWeek, buildStandingsBoard, readStandingsRules, type StandingsRules, type WeekRow, type WeekSnapshot } from '@/lib/core-app/standingsModel'

describe('the stored order', () => {
  it('accepts known keys once each; null and [] mean the default', () => {
    expect(parseTiebreakerOrder(['points_for', 'HEAD_TO_HEAD'])).toEqual({ ok: true, value: ['points_for', 'head_to_head'] })
    expect(parseTiebreakerOrder(null)).toEqual({ ok: true, value: null })
    expect(parseTiebreakerOrder([])).toEqual({ ok: true, value: null })
  })

  it('refuses unknown keys, duplicates and non-lists rather than dropping them', () => {
    expect(parseTiebreakerOrder(['points_for', 'vibes']).ok).toBe(false)
    expect(parseTiebreakerOrder(['points_for', 'points_for']).ok).toBe(false)
    expect(parseTiebreakerOrder('points_for').ok).toBe(false)
    expect(readTiebreakerOrder({ tiebreaker_order: ['nope'] })).toBeNull()
    expect(readTiebreakerOrder({ tiebreaker_order: ['all_play'] })).toEqual(['all_play'])
  })

  it('moves a key up or down, and not past either end', () => {
    expect(moveTiebreaker(['head_to_head', 'points_for', 'coin_flip'], 'points_for', -1)).toEqual(['points_for', 'head_to_head', 'coin_flip'])
    expect(moveTiebreaker(['head_to_head', 'points_for'], 'head_to_head', -1)).toEqual(['head_to_head', 'points_for'])
    expect(moveTiebreaker(['head_to_head', 'points_for'], 'points_for', 1)).toEqual(['head_to_head', 'points_for'])
  })
})

describe('coin flip and all-play', () => {
  it('the coin flip is fixed for a season and changes with it', () => {
    expect(coinFlipDraw('L:2026', 'a')).toBe(coinFlipDraw('L:2026', 'a'))
    expect(coinFlipDraw('L:2026', 'a')).not.toBe(coinFlipDraw('L:2027', 'a'))
    const draws = ['a', 'b', 'c', 'd', 'e'].map((id) => coinFlipDraw('L:2026', id))
    expect(new Set(draws).size).toBe(5)
    for (const d of draws) expect(d >= 0 && d < 1).toBe(true)
  })

  it('all-play measures each week against every other team', () => {
    const weeks = new Map([
      [1, new Map([['a', 100], ['b', 110], ['c', 90], ['d', 80]])],
      [2, new Map([['a', 150], ['b', 60], ['c', 120], ['d', 50]])],
    ])
    const share = allPlayShares(weeks)
    expect(share.get('a')).toBe(0.833)
    expect(share.get('b')).toBe(0.667)
    expect(share.get('c')).toBe(0.5)
    expect(share.get('d')).toBe(0)
  })
})

/*
 * One league, two weeks. y and b both finish 1-1; y scored more, b won their meeting, y has the better
 * all-play and fewer points against. y sorts AFTER b, so a key that does nothing cannot pass by luck. c is 2-0, d 0-2.
 *   week 1  y 100 – b 110   c 90 – d 80
 *   week 2  y 150 – d 50    b 60 – c 120
 */
const GAMES = [
  [1, 'y', 'b', 100, 110],
  [1, 'c', 'd', 90, 80],
  [2, 'y', 'd', 150, 50],
  [2, 'b', 'c', 60, 120],
] as const

function seeds(customTiebreakers: string[] | null, seedingRules = 'standard_standings') {
  const rules: NflRedraftPlayoffRulesInput = {
    playoffs: { teamCount: 4, seedingRules, standingsTiebreakers: ['points_for', 'head_to_head'], customTiebreakers },
    schedule: { regularSeasonLength: 2 },
  }
  const record = (id: string) => ({ y: [1, 1], b: [1, 1], c: [2, 0], d: [0, 2] })[id]!
  const pf = (id: string) => GAMES.reduce((s, [, h, a, hs, as]) => s + (h === id ? hs : a === id ? as : 0), 0)
  const pa = (id: string) => GAMES.reduce((s, [, h, a, hs, as]) => s + (h === id ? as : a === id ? hs : 0), 0)
  return buildNflRedraftPlayoffRuntimeState({
    leagueId: 'L', seasonId: 'S', season: 2026, week: 3, rules,
    teams: ['y', 'b', 'c', 'd'].map((id) => ({ rosterId: id, wins: record(id)[0], losses: record(id)[1], pointsFor: pf(id), pointsAgainst: pa(id) })),
    regularSeasonMatchups: GAMES.map(([week, homeRosterId, awayRosterId, homeScore, awayScore]) => ({ week, homeRosterId, awayRosterId, homeScore, awayScore, status: 'final', type: 'regular' })),
  }).seeds.map((s) => s.rosterId)
}

describe('playoff seeds follow the commissioner\'s order', () => {
  it('without one, the existing rule: head-to-head moves ahead of points for', () => {
    expect(seeds(null)).toEqual(['c', 'b', 'y', 'd'])
  })

  it('points for first is honoured exactly — not reordered behind head-to-head', () => {
    expect(seeds(['points_for', 'head_to_head'])).toEqual(['c', 'y', 'b', 'd'])
  })

  it('each new key decides', () => {
    expect(seeds(['all_play'])).toEqual(['c', 'y', 'b', 'd'])
    expect(seeds(['points_against'])).toEqual(['c', 'y', 'b', 'd'])
    const coinFirst = coinFlipDraw('L:2026', 'y') > coinFlipDraw('L:2026', 'b') ? ['c', 'y', 'b', 'd'] : ['c', 'b', 'y', 'd']
    expect(seeds(['coin_flip', 'points_for'])).toEqual(coinFirst)
  })

  it('record still comes first, and points-only seeding ignores the order', () => {
    expect(seeds(['coin_flip'])[0]).toBe('c')
    expect(seeds(['head_to_head'], 'points_only')).toEqual(['y', 'c', 'b', 'd'])
  })
})

function boardRows(): WeekRow[][] {
  const byWeek = new Map<number, WeekRow[]>()
  GAMES.forEach(([week, h, a, hs, as], i) => {
    const rows = byWeek.get(week) ?? []
    rows.push({ week, rosterId: h, matchupId: i, pointsFor: hs, pointsAgainst: as }, { week, rosterId: a, matchupId: i, pointsFor: as, pointsAgainst: hs })
    byWeek.set(week, rows)
  })
  return [...byWeek.values()]
}

function board(rules: StandingsRules) {
  const ids = ['y', 'b', 'c', 'd']
  const snaps: WeekSnapshot[] = []
  boardRows().forEach((rows, i) => snaps.push(advanceWeek(snaps[i - 1] ?? null, 2026, i + 1, rows, ids, `s${i + 1}`)))
  const meta = (id: string) => ({ rosterId: id, name: `Team ${id.toUpperCase()}`, avatarUrl: null, isYou: false, division: null, reported: null })
  return buildStandingsBoard({ season: 2026, snapshots: snaps, unplayed: [], teams: ids.map(meta), rules })
}

describe('the standings board reads the same order', () => {
  it('only for an AllFantasy-run league; an imported league keeps its platform rule', () => {
    const settings = { tiebreaker_order: ['head_to_head', 'points_for'] }
    expect(readStandingsRules(settings, 4, 'native', 'L:2026')).toMatchObject({ tiebreakers: ['head_to_head', 'points_for'], tiebreakerSource: 'league' })
    expect(readStandingsRules(settings, 4, 'sleeper', 'L:2026')).toMatchObject({ tiebreakers: ['points_for', 'head_to_head'], tiebreakerSource: 'platform' })
    expect(readStandingsRules({}, 4, 'native').tiebreakerSource).toBe('assumed')
  })

  it('orders the table by it, and says so', () => {
    const def = board(readStandingsRules({}, 4, 'native', 'L:2026'))
    expect(def.teams.map((t) => t.rosterId)).toEqual(['c', 'y', 'b', 'd'])
    const h2hFirst = board(readStandingsRules({ tiebreaker_order: ['head_to_head', 'points_for'] }, 4, 'native', 'L:2026'))
    expect(h2hFirst.teams.map((t) => t.rosterId)).toEqual(['c', 'b', 'y', 'd'])
    expect(h2hFirst.teams.find((t) => t.rosterId === 'y')!.tiebreak).toMatch(/ahead on head-to-head \(1-0\), the commissioner's tiebreaker order/)
    expect(h2hFirst.orderBasis).toMatch(/commissioner's tiebreakers: head-to-head, points for/)
  })

  it('all-play, points against and the coin flip agree with the playoff seeds', () => {
    for (const order of [['all_play'], ['points_against'], ['coin_flip'], ['points_for', 'head_to_head']]) {
      const b = board(readStandingsRules({ tiebreaker_order: order }, 4, 'native', 'L:2026'))
      expect(b.teams.map((t) => t.rosterId)).toEqual(seeds(order))
    }
  })
})
