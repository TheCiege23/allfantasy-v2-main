/**
 * Weekly side contests (lib/side-contests/sideContests.ts): who wins each week, how a tie splits the
 * prize, which weeks and games count, and the season money per team.
 */
import { describe, expect, it } from 'vitest'
import {
  parsePrize,
  parseSideContestsInput,
  prizeTotals,
  readSideContests,
  SIDE_CONTESTS_KEY,
  weeklyResults,
  type ContestMatchup,
  type SideContestsConfig,
} from '@/lib/side-contests/sideContests'
import { scopeForSettingsKey } from '@/lib/league/coCommissionerScopes'

const game = (week: number, home: string, away: string | null, hs: number, as: number, extra: Partial<ContestMatchup> = {}): ContestMatchup => ({
  id: `${week}:${home}:${away}`, week, type: 'regular', status: 'final', homeRosterId: home, awayRosterId: away, homeScore: hs, awayScore: as, isMedianMatchup: false, ...extra,
})
const both = (high = 2000, close = 1000): SideContestsConfig => ({ high_score: { enabled: true, prizeCents: high }, closest_loss: { enabled: true, prizeCents: close } })

describe('weeklyResults', () => {
  it('high score is the most points anywhere in the league; closest loss the smallest losing margin', () => {
    const [w] = weeklyResults([game(1, 'A', 'B', 140.2, 99.1), game(1, 'C', 'D', 120, 118.5)], both())
    expect(w.week).toBe(1)
    expect(w.contests.high_score).toEqual([{ rosterId: 'A', value: 140.2, prizeCents: 2000 }])
    expect(w.contests.closest_loss).toEqual([{ rosterId: 'D', opponentRosterId: 'C', value: 1.5, prizeCents: 1000 }])
  })

  it('a tie names every tied team and splits the prize', () => {
    const [w] = weeklyResults([game(1, 'A', 'B', 130, 100), game(1, 'C', 'D', 130, 128), game(1, 'E', 'F', 90, 88)], both(3000, 1000))
    expect(w.contests.high_score!.map((x) => x.rosterId)).toEqual(['A', 'C'])
    expect(w.contests.high_score!.every((x) => x.prizeCents === 1500)).toBe(true)
    expect(w.contests.closest_loss!.map((x) => x.rosterId).sort()).toEqual(['D', 'F'])
    expect(w.contests.closest_loss!.every((x) => x.prizeCents === 500)).toBe(true)
  })

  it('a tied game has no loser, so neither team is in the closest-loss running', () => {
    const [w] = weeklyResults([game(1, 'A', 'B', 100, 100), game(1, 'C', 'D', 120, 110)], both())
    expect(w.contests.closest_loss).toEqual([{ rosterId: 'D', opponentRosterId: 'C', value: 10, prizeCents: 1000 }])
  })

  it('waits until every real game in the week is final; a bye never holds it up', () => {
    const live = [game(1, 'A', 'B', 140, 99), game(1, 'C', 'D', 150, 1, { status: 'live' })]
    expect(weeklyResults(live, both())).toEqual([])
    const withBye = [game(1, 'A', 'B', 140, 99), game(1, 'E', null, 0, 0, { status: 'scheduled' })]
    expect(weeklyResults(withBye, both()).map((w) => w.week)).toEqual([1])
  })

  it('a bye or a median-only row never wins, even with the bigger stored number', () => {
    const rows = [game(1, 'A', 'B', 100, 90), game(1, 'E', null, 200, 0), game(1, 'A', null, 300, 0, { isMedianMatchup: true })]
    expect(weeklyResults(rows, both())[0].contests.high_score!.map((x) => x.rosterId)).toEqual(['A'])
    expect(weeklyResults(rows, both())[0].contests.high_score![0].value).toBe(100)
  })

  it('counts regular-season weeks only', () => {
    const rows = [game(1, 'A', 'B', 100, 90), game(15, 'A', 'B', 180, 179, { type: 'playoff' }), game(15, 'C', 'D', 50, 49, { type: 'consolation' })]
    expect(weeklyResults(rows, both()).map((w) => w.week)).toEqual([1])
  })

  it('only contests switched on appear, and a week with none on is left out', () => {
    const rows = [game(1, 'A', 'B', 100, 90)]
    const highOnly: SideContestsConfig = { ...both(), closest_loss: { enabled: false, prizeCents: 1000 } }
    expect(Object.keys(weeklyResults(rows, highOnly)[0].contests)).toEqual(['high_score'])
    expect(weeklyResults(rows, readSideContests({}))).toEqual([])
  })

  it('reads the stored score, so an adjustment or applied correction moves the winner', () => {
    expect(weeklyResults([game(1, 'A', 'B', 120, 119.5)], both())[0].contests.high_score![0].rosterId).toBe('A')
    expect(weeklyResults([game(1, 'A', 'B', 117, 119.5)], both())[0].contests.high_score![0].rosterId).toBe('B')
  })

  it('weeks come back oldest first', () => {
    const rows = [game(3, 'A', 'B', 1, 2), game(1, 'A', 'B', 3, 4), game(2, 'A', 'B', 5, 6)]
    expect(weeklyResults(rows, both()).map((w) => w.week)).toEqual([1, 2, 3])
  })
})

describe('prizeTotals', () => {
  it('sums wins and money per team, most money first, rounding each team once at the end', () => {
    const weeks = Array.from({ length: 13 }, (_, i) => [game(i + 1, 'A', 'B', 100, 90), game(i + 1, 'C', 'D', 100, 80), game(i + 1, 'E', 'F', 100, 70)]).flat()
    const totals = prizeTotals(weeklyResults(weeks, both(1000, 0)))
    // $10 split three ways for 13 weeks: $43.33 each, not 13 × $3.33 = $43.29.
    expect(totals.map((t) => [t.rosterId, t.prizeCents, t.wins.high_score])).toEqual([['A', 4333, 13], ['C', 4333, 13], ['E', 4333, 13], ['B', 0, 0]])
    expect(totals.find((t) => t.rosterId === 'B')!.wins.closest_loss).toBe(13)
  })
})

describe('settings', () => {
  it('reads garbage as off, and never trusts an out-of-range prize', () => {
    expect(readSideContests(null)).toEqual({ high_score: { enabled: false, prizeCents: 0 }, closest_loss: { enabled: false, prizeCents: 0 } })
    expect(readSideContests({ [SIDE_CONTESTS_KEY]: { high_score: { enabled: true, prizeCents: -5 }, closest_loss: 'yes' } })).toEqual({
      high_score: { enabled: true, prizeCents: 0 },
      closest_loss: { enabled: false, prizeCents: 0 },
    })
  })

  it('parses a save: dollars to cents, empty prize is $0, a missing contest is off', () => {
    expect(parseSideContestsInput({ high_score: { enabled: true, prize: '12.50' } })).toEqual({
      ok: true,
      value: { high_score: { enabled: true, prizeCents: 1250 }, closest_loss: { enabled: false, prizeCents: 0 } },
    })
    expect(parseSideContestsInput({ closest_loss: { enabled: true, prize: '' } })).toMatchObject({ ok: true, value: { closest_loss: { enabled: true, prizeCents: 0 } } })
  })

  it('refuses an unknown contest, a missing switch and a bad amount', () => {
    expect(parseSideContestsInput({ lowest_score: { enabled: true } }).ok).toBe(false)
    expect(parseSideContestsInput({ high_score: { prize: 5 } }).ok).toBe(false)
    expect(parseSideContestsInput({ high_score: { enabled: true, prize: '1.234' } }).ok).toBe(false)
    expect(parseSideContestsInput(null).ok).toBe(false)
  })

  it('parsePrize', () => {
    expect([parsePrize('$25'), parsePrize(25), parsePrize('0.5'), parsePrize(undefined)]).toEqual([2500, 2500, 50, 0])
    expect([parsePrize('-1'), parsePrize('abc'), parsePrize('10000.01'), parsePrize(true)]).toEqual([null, null, null, null])
  })

  it('is a MONEY setting for co-commissioners, with dues and payouts', () => {
    expect(scopeForSettingsKey(SIDE_CONTESTS_KEY)).toBe('money')
  })
})
