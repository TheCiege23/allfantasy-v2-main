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
