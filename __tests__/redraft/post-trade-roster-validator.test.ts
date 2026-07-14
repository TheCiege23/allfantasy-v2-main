import { describe, expect, it } from 'vitest'
import { validateProjectedRedraftRoster } from '@/lib/league-trade-engine/postTradeRosterValidator'

const player = (playerId: string, position = 'WR', slotType = 'BENCH') => ({ playerId, position, sport: 'NFL', slotType, injuryStatus: null })

describe('projected redraft roster validation', () => {
  it('allows an incomplete weekly lineup when roster construction remains legal', () => {
    const result = validateProjectedRedraftRoster({ franchiseId: 'r1', sport: 'NFL', leagueSettings: { starter_slots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, BN: 4 } }, currentPlayers: [player('p1')], outgoingPlayerIds: [], incomingPlayers: [player('p2')] })
    expect(result.legal).toBe(true)
  })

  it('returns structured size, duplicate, identity, and IR violations', () => {
    const result = validateProjectedRedraftRoster({ franchiseId: 'r1', sport: 'NFL', leagueSettings: { starter_slots: { QB: 1, BN: 1 } }, currentPlayers: [player('p1'), player('p1'), player('', '', 'IR')], outgoingPlayerIds: [], incomingPlayers: [] })
    expect(result.legal).toBe(false)
    expect(result.violations.map((row) => row.code)).toEqual(expect.arrayContaining(['ROSTER_SIZE_EXCEEDED', 'DUPLICATE_PLAYER', 'UNRESOLVED_PLAYER_IDENTITY']))
    expect(result.violations.every((row) => row.franchiseId === 'r1')).toBe(true)
  })

  it('enforces NCAAF FCS and configured school restrictions without NFL assumptions', () => {
    const restricted = { ...player('c1'), sport: 'NCAAF', division: 'FCS', schoolId: 'school-2' } as any
    const result = validateProjectedRedraftRoster({ franchiseId: 'r1', sport: 'NCAAF', leagueSettings: { playerPool: { includeFcs: false, schoolIds: ['school-1'] } }, currentPlayers: [], outgoingPlayerIds: [], incomingPlayers: [restricted] })
    expect(result.violations.filter((row) => row.code === 'PLAYER_POOL_RESTRICTED')).toHaveLength(2)
  })
})
