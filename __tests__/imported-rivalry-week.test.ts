/**
 * Rivalry week for a league that plays on another platform.
 *
 * Its schedule cannot be rewritten from here, so the commissioner gets the pairings: each team's
 * biggest rival and why, from the results on file and the divisions, to copy and set up over there.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ league: vi.fn(), teams: vi.fn(), rows: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: { league: { findUnique: h.league }, leagueTeam: { findMany: h.teams }, weeklyMatchup: { findMany: h.rows } },
}))
vi.mock('@/server/services/auditService', () => ({ logAction: vi.fn() }))

import { gamesFromStoredRows, importedRivalryPairs, previewImportedRivalryWeek } from '@/lib/schedule-runtime/importedRivalryWeek'

const row = (week: number, rosterId: string, matchupId: number | null, pointsFor: number, pointsAgainst: number, seasonYear = 2026) =>
  ({ seasonYear, week, rosterId, matchupId, pointsFor, pointsAgainst })
const game = (week: number, id: number, a: string, aPts: number, b: string, bPts: number, seasonYear = 2026) =>
  [row(week, a, id, aPts, bPts, seasonYear), row(week, b, id, bPts, aPts, seasonYear)]

beforeEach(() => vi.resetAllMocks())

describe('games from the stored results', () => {
  it('reads each pair of rows as one game, including every game of a multi-game week', () => {
    const games = gamesFromStoredRows([
      ...game(1, 1, 'a', 110, 'b', 108),
      ...game(1, 2, 'a', 90, 'c', 120),
      ...game(1, 3, 'b', 100, 'c', 70),
    ])
    expect(games).toHaveLength(3)
    expect(games[0]).toEqual({ a: 'a', b: 'b', aScore: 110, bScore: 108, playoff: false })
  })

  it('leaves out a bye, a field-format row, an unplayed fixture and a half-written pairing', () => {
    expect(gamesFromStoredRows([
      row(1, 'a', null, 100, 0),
      row(2, 'a', 1, 100, 0),
      ...game(3, 1, 'a', 0, 'b', 0),
      ...game(4, 1, 'a', 10, 'b', 9), row(4, 'c', 1, 8, 0),
    ])).toEqual([])
  })

  it('keeps the same matchup id in different weeks and seasons apart', () => {
    expect(gamesFromStoredRows([...game(1, 1, 'a', 10, 'b', 9), ...game(2, 1, 'a', 10, 'c', 9), ...game(1, 1, 'b', 10, 'c', 9, 2025)])).toHaveLength(3)
  })
})

describe('the pairings', () => {
  const teams = ['a', 'b', 'c', 'd'].map((id) => ({ id, name: `Team ${id.toUpperCase()}` }))

  it('pairs each team with its biggest rival and says why', () => {
    const games = gamesFromStoredRows([
      ...game(1, 1, 'a', 110, 'b', 108), ...game(5, 1, 'a', 99, 'b', 101), ...game(9, 1, 'a', 120, 'b', 119),
      ...game(2, 1, 'c', 100, 'd', 60),
      ...game(3, 1, 'a', 100, 'c', 50),
    ])
    const pairs = importedRivalryPairs({ teams, games })!
    expect(pairs).toHaveLength(2)
    const ab = pairs.find((p) => [p.homeRosterId, p.awayRosterId].sort().join('') === 'ab')!
    expect([ab.homeName, ab.awayName].sort()).toEqual(['Team A', 'Team B'])
    expect(ab.rivalry).toBe(true)
    expect(ab.reasons.join(' ')).toMatch(/3 /)
    expect(pairs.some((p) => [p.homeRosterId, p.awayRosterId].sort().join('') === 'cd')).toBe(true)
  })

  it('uses divisions when no games are on file yet, and has nothing to offer with neither', () => {
    const divisionOf = new Map([['a', 'East'], ['b', 'East'], ['c', 'West'], ['d', 'West']])
    const pairs = importedRivalryPairs({ teams, games: [], divisionOf })!
    expect(pairs.map((p) => [p.homeRosterId, p.awayRosterId].sort().join('')).sort()).toEqual(['ab', 'cd'])
    expect(importedRivalryPairs({ teams, games: [] })).toBeNull()
  })
})

describe('reading a league', () => {
  it('pairs from the league\'s stored weeks and imported divisions, without touching the schedule', async () => {
    h.league.mockResolvedValue({
      platform: 'Fantrax', platformLeagueId: 'snap-1',
      settings: { standings_divisions: { source: 'fantrax', names: { East: 'East', West: 'West' }, teams: { '11': 'East', '22': 'East', '33': 'West', '44': 'West' } } },
    })
    h.teams.mockResolvedValue([
      { externalId: '11', teamName: 'Aces', ownerName: null }, { externalId: '22', teamName: ' Bears ', ownerName: null },
      { externalId: '33', teamName: null, ownerName: 'Cy' }, { externalId: '44', teamName: 'Ducks', ownerName: null },
    ])
    h.rows.mockResolvedValue([...game(1, 1, '11', 100, '33', 99), ...game(2, 1, '11', 90, '33', 91), ...game(3, 1, '11', 80, '33', 81)])
    const out = await previewImportedRivalryWeek('lea')
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.platform).toBe('fantrax')
    // Three close games beat a shared division: Aces draw Cy, and the other two are left to each other.
    expect(out.pairs.map((p) => [p.homeName, p.awayName].sort().join(' v ')).sort()).toEqual(['Aces v Cy', 'Bears v Ducks'])
    expect(h.rows.mock.calls[0][0].where).toEqual({ leagueId: 'snap-1' })
  })

  it('says so when the league has no rivalries, too few teams, or does not exist', async () => {
    h.league.mockResolvedValue({ platform: 'espn', platformLeagueId: 'p', settings: null })
    h.rows.mockResolvedValue([])
    h.teams.mockResolvedValue([{ externalId: '1', teamName: 'A', ownerName: null }, { externalId: '2', teamName: 'B', ownerName: null }])
    expect(await previewImportedRivalryWeek('lea')).toMatchObject({ ok: false, code: 'NO_RIVALRIES', status: 409 })
    h.teams.mockResolvedValue([{ externalId: '1', teamName: 'A', ownerName: null }])
    expect(await previewImportedRivalryWeek('lea')).toMatchObject({ ok: false, code: 'NOT_ENOUGH_TEAMS' })
    h.league.mockResolvedValue(null)
    expect(await previewImportedRivalryWeek('lea')).toMatchObject({ ok: false, code: 'LEAGUE_NOT_FOUND', status: 404 })
  })
})
