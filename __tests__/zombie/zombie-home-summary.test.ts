// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  buildZombieWeeklyBoard,
  pickMyMatchup,
  resolveSummaryWeek,
  zombieRosterDisplayNames,
  zombieThemeForLeague,
} from '@/lib/zombie/zombieHomeSummary'
import { ZOMBIE_THEME_LIST } from '@/lib/zombie/zombieBackgroundThemes'

const result = (home: string, away: string, hs: number, as: number, final = true) => ({
  matchupId: `${home}-${away}`,
  homeRosterId: home,
  awayRosterId: away,
  homeScore: hs,
  awayScore: as,
  final,
})

describe('resolveSummaryWeek', () => {
  it("defaults to the league's current week, and to week 1 before activation", () => {
    expect(resolveSummaryWeek(null, 7, 24)).toBe(7)
    expect(resolveSummaryWeek(null, 0, 24)).toBe(1)
  })
  it('honours an asked-for week, clamped to the season', () => {
    expect(resolveSummaryWeek('12', 7, 24)).toBe(12)
    expect(resolveSummaryWeek('30', 7, 24)).toBe(24)
    expect(resolveSummaryWeek('0', 7, 24)).toBe(1)
    expect(resolveSummaryWeek('abc', 7, 24)).toBe(7)
  })
})

describe('zombieThemeForLeague', () => {
  it("keeps the league's chosen theme", () => {
    expect(zombieThemeForLeague('tomb-chamber', 'any')).toBe('tomb-chamber')
  })
  it('derives a real, stable theme when none (or an unknown one) is stored', () => {
    const ids = ZOMBIE_THEME_LIST.map((t) => t.id)
    const a = zombieThemeForLeague(null, 'league-abc')
    expect(ids).toContain(a)
    expect(zombieThemeForLeague('not-a-theme', 'league-abc')).toBe(a)
    expect(zombieThemeForLeague(null, 'league-abc')).toBe(a)
  })
})

describe('pickMyMatchup', () => {
  const week = [result('a', 'b', 900, 850, true), result('c', 'me', 1000, 1100, false)]
  it("returns the viewer's game from their side", () => {
    expect(pickMyMatchup(week, 'me')).toEqual({ opponentRosterId: 'c', myScore: 1100, opponentScore: 1000, final: false })
    expect(pickMyMatchup(week, 'a')).toMatchObject({ opponentRosterId: 'b', myScore: 900 })
  })
  it('is null on a bye, with no schedule, or with no roster', () => {
    expect(pickMyMatchup(week, 'z')).toBeNull()
    expect(pickMyMatchup(null, 'me')).toBeNull()
    expect(pickMyMatchup(week, null)).toBeNull()
  })
})

describe('buildZombieWeeklyBoard', () => {
  const base = { week: 4, bashingMargin: 128, maulingMargin: 211, hiddenInfector: () => false }

  it('lists the week’s infections, then maulings and bashings on the engine margins, largest first', () => {
    const board = buildZombieWeeklyBoard({
      ...base,
      results: [
        result('w1', 'l1', 1000, 860, true), // 140: bashing
        result('w2', 'l2', 1100, 880, true), // 220: mauling
        result('w3', 'l3', 1000, 900, true), // 100: nothing
        result('w4', 'v1', 1000, 600, true), // 400, but v1 was infected: the infection tells it
        result('w5', 'l5', 1300, 1000, false), // not final
        result('w6', 'l6', 1000, 1000, true), // tie
      ],
      teams: [
        { rosterId: 'v1', weekBecameZombie: 4, killedByRosterId: 'w4' },
        { rosterId: 'old', weekBecameZombie: 2, killedByRosterId: 'w9' },
      ],
    })
    expect(board).toEqual([
      { kind: 'infection', victimRosterId: 'v1', infectorRosterId: 'w4' },
      { kind: 'mauling', winnerRosterId: 'w2', loserRosterId: 'l2', margin: 220 },
      { kind: 'bashing', winnerRosterId: 'w1', loserRosterId: 'l1', margin: 140 },
    ])
  })

  it('drops an infector the viewer may not know', () => {
    const board = buildZombieWeeklyBoard({
      ...base,
      results: [],
      teams: [{ rosterId: 'v1', weekBecameZombie: 4, killedByRosterId: 'whisperer' }],
      hiddenInfector: (id) => id === 'whisperer',
    })
    expect(board).toEqual([{ kind: 'infection', victimRosterId: 'v1', infectorRosterId: null }])
  })
})

describe('zombieRosterDisplayNames', () => {
  it('names by roster↔team identity, then season roster, then a placeholder — never an id', () => {
    const names = zombieRosterDisplayNames(
      [
        { id: 'r-b', platformUserId: 'u-b', playerData: null },
        { id: 'r-a', platformUserId: 'u-a', playerData: null },
        { id: 'r-c', platformUserId: 'u-c', playerData: null, redraftRoster: { teamName: 'Season Name', ownerName: null } },
        { id: 'r-d', platformUserId: 'u-d', playerData: null },
      ],
      [
        { id: 't-a', externalId: 'ea', platformUserId: 'u-a', teamName: 'Alpha', ownerName: null },
        { id: 't-b', externalId: 'eb', platformUserId: 'u-b', teamName: 'Bravo', ownerName: null },
      ],
    )
    expect(names).toEqual({ 'r-b': 'Bravo', 'r-a': 'Alpha', 'r-c': 'Season Name', 'r-d': 'Team 4' })
  })
})
