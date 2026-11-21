import { describe, expect, it } from 'vitest'
import { buildFantraxLists, buildSleeperLists, normalizeFantraxSlot } from '@/lib/league/collegePro/buildSides'
import { decideLeadSide, easternDayKey } from '@/lib/league/collegePro/leadSide'
import { collegeProFormatOf } from '@/lib/league/collegePro/format'

describe('buildSleeperLists', () => {
  it('uses the real starters in roster_positions order, not a guess', () => {
    const lists = buildSleeperLists({
      positions: ['QB', 'RB', 'FLEX', 'SUPER_FLEX', 'BN', 'BN', 'TAXI', 'IR'],
      starters: ['hurts', '0', 'kelce', 'young'],
      players: ['hurts', 'kelce', 'young', 'cook', 'giddens', 'cowing', 'injured'],
      taxi: ['cowing'],
      reserve: ['injured'],
    })
    expect(lists.starters).toEqual([
      { slot: 'QB', playerId: 'hurts' },
      { slot: 'RB', playerId: null },
      { slot: 'FLEX', playerId: 'kelce' },
      { slot: 'SUPER_FLEX', playerId: 'young' },
    ])
    expect(lists.bench).toEqual(['cook', 'giddens'])
    expect(lists.taxi).toEqual(['cowing'])
    expect(lists.ir).toEqual(['injured'])
  })

  it('never lists a taxi or IR player on the bench too', () => {
    const lists = buildSleeperLists({ positions: ['QB'], starters: ['a'], players: ['a', 'b', 'c'], taxi: ['b'], reserve: ['c'] })
    expect(lists.bench).toEqual([])
  })
})

describe('buildFantraxLists', () => {
  it('starts ACTIVE rows, benches RESERVE, and never makes a college taxi', () => {
    const lists = buildFantraxLists([
      { id: 'flex1', slot: 'RWT', status: 'ACTIVE' },
      { id: 'qb1', slot: 'QB', status: 'ACTIVE' },
      { id: 'sf1', slot: 'SFX', status: 'ACTIVE' },
      { id: 'b1', slot: 'BN', status: 'RESERVE' },
      { id: 'm1', slot: 'BN', status: 'MINORS' },
      { id: 'ir1', slot: 'IR', status: 'INJURED_RESERVE' },
    ])
    expect(lists.starters).toEqual([
      { slot: 'QB', playerId: 'qb1' },
      { slot: 'FLEX', playerId: 'flex1' },
      { slot: 'SUPER_FLEX', playerId: 'sf1' },
    ])
    expect(lists.bench).toEqual(['b1', 'm1'])
    expect(lists.taxi).toEqual([])
    expect(lists.ir).toEqual(['ir1'])
  })

  it('names Fantrax flex codes the way the app colours them', () => {
    expect(normalizeFantraxSlot('RWT')).toBe('FLEX')
    expect(normalizeFantraxSlot('sfx')).toBe('SUPER_FLEX')
    expect(normalizeFantraxSlot('WR')).toBe('WR')
  })
})

describe('decideLeadSide', () => {
  // 2026-11-21 is a Saturday; 2026-11-22 a Sunday. Times are UTC; Eastern is UTC-5.
  const sat = (h: number) => new Date(Date.UTC(2026, 10, 21, h + 5))
  const sun = (h: number) => new Date(Date.UTC(2026, 10, 22, h + 5))
  const base = { proSport: 'NFL', collegeSport: 'NCAAF' }

  it('puts college on top while a college game is live', () => {
    const r = decideLeadSide({ ...base, now: sat(15), games: [{ sport: 'NCAAF', startTime: sat(12), status: 'in_progress' }] })
    expect(r).toEqual({ lead: 'college', reason: 'live' })
  })

  it('puts the NFL on top on an NFL Sunday', () => {
    const r = decideLeadSide({ ...base, now: sun(10), games: [{ sport: 'NFL', startTime: sun(13), status: 'scheduled' }] })
    expect(r).toEqual({ lead: 'pro', reason: 'today' })
  })

  it('reads the Eastern date, so a late Saturday game is still Saturday', () => {
    // 10:30pm Saturday Eastern is already Sunday in UTC.
    expect(easternDayKey(sat(22.5))).toBe('2026-11-21')
    const r = decideLeadSide({ ...base, now: sat(23), games: [{ sport: 'NCAAF', startTime: sat(22.5), status: 'live' }] })
    expect(r.lead).toBe('college')
  })

  it('a finished college game does not hold the top once NFL games are live', () => {
    const r = decideLeadSide({
      ...base,
      now: sat(21),
      games: [
        { sport: 'NCAAF', startTime: sat(12), status: 'final' },
        { sport: 'NFL', startTime: sat(20), status: 'live' },
      ],
    })
    expect(r).toEqual({ lead: 'pro', reason: 'live' })
  })

  it('with no fixtures on file, Saturday falls back to college and other days to pro', () => {
    expect(decideLeadSide({ ...base, now: sat(12), games: [] })).toEqual({ lead: 'college', reason: 'weekday' })
    expect(decideLeadSide({ ...base, now: sun(12), games: [] })).toEqual({ lead: 'pro', reason: 'weekday' })
  })
})

describe('collegeProFormatOf', () => {
  it('tells C2C and Devy apart', () => {
    expect(collegeProFormatOf({ leagueType: 'c2c' })).toBe('c2c')
    expect(collegeProFormatOf({ leagueVariant: 'merged_devy_c2c' })).toBe('c2c')
    expect(collegeProFormatOf({ leagueType: 'devy' })).toBe('devy')
    expect(collegeProFormatOf({ leagueVariant: 'devy_dynasty' })).toBe('devy')
    expect(collegeProFormatOf({ leagueType: 'dynasty' })).toBeNull()
  })
})

describe('scores', () => {
  it('sums only starters that have a number, and says null when none do', async () => {
    const { sumStarterPoints } = await import('@/lib/league/collegePro/buildSides')
    const starters = [
      { slot: 'QB', playerId: 'a' },
      { slot: 'RB', playerId: 'b' },
      { slot: 'FLEX', playerId: null },
    ]
    expect(sumStarterPoints(starters, { a: 10.125, b: 5, bench: 99 })).toBe(15.13)
    expect(sumStarterPoints(starters, {})).toBeNull()
  })

  it('pairs a Sleeper matchup by matchup_id, and a bye has no opponent', async () => {
    const { pairSleeperMatchup } = await import('@/lib/league/collegePro/buildSides')
    const rows = [
      { roster_id: 1, matchup_id: 3 },
      { roster_id: 2, matchup_id: 4 },
      { roster_id: 5, matchup_id: 3 },
      { roster_id: 7, matchup_id: null },
    ]
    expect(pairSleeperMatchup(rows, 1).opponent?.roster_id).toBe(5)
    expect(pairSleeperMatchup(rows, 7).opponent).toBeNull()
    expect(pairSleeperMatchup(rows, 9)).toEqual({ mine: null, opponent: null })
  })

  it('names a Sleeper team by its team name, else its manager', async () => {
    const { sleeperTeamName } = await import('@/lib/league/collegePro/buildSides')
    const users = [
      { user_id: 'u1', display_name: 'Connor0488', metadata: { team_name: '' } },
      { user_id: 'u2', display_name: 'guap', metadata: { team_name: '(F) SF TEP' } },
    ]
    expect(sleeperTeamName(users, 'u1')).toBe('Connor0488')
    expect(sleeperTeamName(users, 'u2')).toBe('(F) SF TEP')
    expect(sleeperTeamName(users, 'nobody')).toBeNull()
  })
})

describe('normalizeCollegeSport', () => {
  it("reads Fantrax's CFB / CBB as our NCAAF / NCAAB", async () => {
    const { normalizeCollegeSport } = await import('@/lib/league/collegePro/format')
    expect(normalizeCollegeSport('CFB')).toBe('NCAAF')
    expect(normalizeCollegeSport('cbb')).toBe('NCAAB')
    expect(normalizeCollegeSport('NCAAF')).toBe('NCAAF')
    expect(normalizeCollegeSport(null)).toBeNull()
  })
})
