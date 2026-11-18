import { describe, expect, it } from 'vitest'
import {
  CUSTOM_WEEKS_SETTINGS_KEY,
  applyCustomWeeks,
  checkCustomPairs,
  inOrder,
  randomizeChatMessage,
  readCustomWeeks,
  shuffledOrders,
  withCustomWeek,
} from '@/lib/schedule-runtime/customWeeks'
import { divisionSportMatch } from '@/lib/league/divisions/divisionSportMatch'

/** The pure half of the schedule tools (lib/schedule-runtime/customWeeks.ts) and the division sport match. */

const ids = ['a', 'b', 'c', 'd']

describe('custom weeks in League.settings', () => {
  it('round-trips a week, keeps other seasons and keys, and clears back to nothing', () => {
    const start = { other: 1, [CUSTOM_WEEKS_SETTINGS_KEY]: { '2025': { '3': [['a', 'b']] } } }
    const set = withCustomWeek(start, 2026, 8, [{ home: 'a', away: 'd' }, { home: 'b', away: null }])
    expect(set.other).toBe(1)
    expect(readCustomWeeks(set, 2026)).toEqual({ 8: [{ home: 'a', away: 'd' }, { home: 'b', away: null }] })
    expect(readCustomWeeks(set, 2025)).toEqual({ 3: [{ home: 'a', away: 'b' }] })
    const cleared = withCustomWeek(set, 2026, 8, null)
    expect(readCustomWeeks(cleared, 2026)).toEqual({})
    expect(readCustomWeeks(cleared, 2025)).toEqual({ 3: [{ home: 'a', away: 'b' }] })
  })

  it('drops malformed entries instead of throwing', () => {
    expect(readCustomWeeks({ [CUSTOM_WEEKS_SETTINGS_KEY]: { '2026': { x: [], '0': [['a', 'b']], '4': 'nope', '5': [[1, 2]] } } }, 2026)).toEqual({})
    expect(readCustomWeeks(null, 2026)).toEqual({})
  })
})

describe('checking a week', () => {
  it('accepts every team once', () => {
    expect(checkCustomPairs([{ home: 'a', away: 'b' }, { home: 'c', away: 'd' }], ids)).toEqual({ ok: true })
  })
  it.each([
    [[{ home: 'a', away: 'b' }, { home: 'a', away: 'c' }], 'TEAM_TWICE'],
    [[{ home: 'a', away: 'b' }], 'TEAM_MISSING'],
    [[{ home: 'a', away: 'a' }, { home: 'c', away: 'd' }], 'TEAM_TWICE'],
    [[{ home: 'a', away: 'b' }, { home: 'c', away: 'z' }], 'UNKNOWN_TEAM'],
    [[{ home: 'a', away: 'b' }, { home: 'c', away: null }, { home: 'd', away: null }], 'TOO_MANY_BYES'],
  ])('%j → %s', (pairs, code) => {
    expect(checkCustomPairs(pairs, ids)).toMatchObject({ ok: false, code })
  })
  it('an odd league allows exactly one bye', () => {
    const five = [...ids, 'e']
    expect(checkCustomPairs([{ home: 'a', away: 'b' }, { home: 'c', away: 'd' }, { home: 'e', away: null }], five)).toEqual({ ok: true })
  })
})

describe('applying custom weeks', () => {
  const gen = [1, 2, 3].flatMap((week) => [
    { week, homeRosterId: 'a', awayRosterId: 'b' },
    { week, homeRosterId: 'c', awayRosterId: 'd' },
  ])
  it('replaces only valid custom weeks at or after fromWeek, inside the regular season', () => {
    const custom = { 1: [{ home: 'a', away: 'c' }, { home: 'b', away: 'd' }], 2: [{ home: 'a', away: 'd' }, { home: 'b', away: 'c' }], 3: [{ home: 'a', away: 'b' }], 9: [{ home: 'a', away: 'b' }, { home: 'c', away: 'd' }] }
    const out = applyCustomWeeks(gen, custom, { fromWeek: 2, regularSeasonWeeks: 3, rosterIds: ids })
    expect(out.applied).toEqual([2])
    expect(out.stale).toEqual([3])
    expect(out.matchups.filter((m) => m.week === 1).map((m) => m.awayRosterId)).toEqual(['b', 'd'])
    expect(out.matchups.filter((m) => m.week === 2).map((m) => `${m.homeRosterId}${m.awayRosterId}`)).toEqual(['ad', 'bc'])
  })
})

describe('randomizing', () => {
  it('draws N permutations of the same teams, clamped to 1–25', () => {
    const orders = shuffledOrders(ids, 5)
    expect(orders).toHaveLength(5)
    for (const o of orders) expect([...o].sort()).toEqual(ids)
    expect(shuffledOrders(ids, 0)).toHaveLength(1)
    expect(shuffledOrders(ids, 99)).toHaveLength(25)
  })
  it('is deterministic for a given random source', () => {
    const r = () => 0.5
    expect(shuffledOrders(ids, 2, r)).toEqual(shuffledOrders(ids, 2, r))
  })
  it('orders items by an id order', () => {
    expect(inOrder([{ id: 'a' }, { id: 'b' }, { id: 'c' }], (x) => x.id, ['c', 'a']).map((x) => x.id)).toEqual(['c', 'a', 'b'])
  })
  it('writes the chat post', () => {
    expect(randomizeChatMessage({ draw: 2, times: 5, week: 3, pairs: [{ home: 'Bills', away: 'Jets' }, { home: 'Pats', away: null }] }))
      .toBe('🎲 Schedule randomization 2 of 5\nWeek 3:\nBills vs Jets\nPats: bye')
    expect(randomizeChatMessage({ draw: 5, times: 5, week: 3, pairs: [] })).toMatch(/^🎲 Schedule randomization 5 of 5: this is the schedule\./)
  })
})

describe('division count vs the real sport', () => {
  it('NFL 4, NBA 3, NHL 2, MLB 3 divisions match; other counts and sports do not', () => {
    expect(divisionSportMatch('NFL', 4)?.key).toBe('division.sportMatch.nfl')
    expect(divisionSportMatch('nba', 3)?.realMeetings).toBe('4')
    expect(divisionSportMatch('NHL', 2)?.key).toBe('division.sportMatch.nhl')
    expect(divisionSportMatch('MLB', 3)?.realMeetings).toBe('13')
    expect(divisionSportMatch('NFL', 2)).toBeNull()
    expect(divisionSportMatch('SOCCER', 4)).toBeNull()
    expect(divisionSportMatch(null, 4)).toBeNull()
  })
})

describe('custom weeks in a league that plays several games a week', () => {
  const ids = ['a', 'b', 'c', 'd']
  const threeGames = [
    { home: 'a', away: 'b' }, { home: 'c', away: 'd' },
    { home: 'a', away: 'c' }, { home: 'b', away: 'd' },
    { home: 'a', away: 'd' }, { home: 'b', away: 'c' },
  ]

  it('a full week of three games each is valid there, and refused as a one-game week', () => {
    expect(checkCustomPairs(threeGames, ids, 3)).toEqual({ ok: true })
    expect(checkCustomPairs(threeGames, ids)).toMatchObject({ ok: false, code: 'TEAM_TWICE' })
  })

  it('refuses the same two teams meeting twice, a team short of games, and a bye row', () => {
    expect(checkCustomPairs([...threeGames.slice(0, 4), { home: 'a', away: 'b' }, { home: 'c', away: 'd' }], ids, 3)).toMatchObject({ ok: false, code: 'TEAM_TWICE' })
    expect(checkCustomPairs(threeGames.slice(0, 2), ids, 3)).toMatchObject({ ok: false, code: 'TEAM_MISSING' })
    expect(checkCustomPairs([...threeGames, { home: 'a', away: null }], ids, 3)).toMatchObject({ ok: false, code: 'TOO_MANY_BYES' })
  })

  it('with an odd number of teams a team may play one fewer', () => {
    // Five teams, two games a week: one team sits out each round.
    const week = [{ home: 'a', away: 'b' }, { home: 'c', away: 'd' }, { home: 'e', away: 'a' }, { home: 'b', away: 'c' }]
    expect(checkCustomPairs(week, [...ids, 'e'], 2)).toEqual({ ok: true })
  })

  it('a kept multi-game week survives a rebuild instead of being reported stale', () => {
    const generated = [{ week: 3, homeRosterId: 'a', awayRosterId: 'd' }, { week: 4, homeRosterId: 'a', awayRosterId: 'b' }]
    const out = applyCustomWeeks(generated, { 3: threeGames }, { fromWeek: 1, regularSeasonWeeks: 10, rosterIds: ids, gamesPerWeek: 3 })
    expect(out.applied).toEqual([3])
    expect(out.stale).toEqual([])
    expect(out.matchups.filter((m) => m.week === 3)).toHaveLength(6)
    // Positive control: read as a one-game league, the same week is stale and the generator's week stands.
    expect(applyCustomWeeks(generated, { 3: threeGames }, { fromWeek: 1, regularSeasonWeeks: 10, rosterIds: ids }).stale).toEqual([3])
  })
})

