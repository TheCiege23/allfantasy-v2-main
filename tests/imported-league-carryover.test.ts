import { describe, expect, it } from 'vitest'
import { importedOwnedPlayerIds, matchImportedRoster, translateImportedRosterData } from '@/lib/league-creation/canonical/carryOverImportedLeague'

const team = {
  id: 'team-1', externalId: 'source-seat-1', platformUserId: 'source-manager-1', claimedByUserId: null,
  teamName: 'Blue Team', ownerName: 'Manager', avatarUrl: null, isCommissioner: false,
}

describe('standalone imported league carryover', () => {
  it('matches by source seat when an imported manager has changed', () => {
    const stale = { id: 'stale', platformUserId: 'source-manager-1', playerData: { source_team_id: 'old-seat' }, faabRemaining: null, waiverPriority: null }
    const current = { id: 'current', platformUserId: 'new-manager', playerData: { source_team_id: 'source-seat-1' }, faabRemaining: 73, waiverPriority: 2 }
    expect(matchImportedRoster(team, [stale, current])).toBe(current)
  })

  it('refuses ambiguous or missing source rosters instead of copying the wrong team', () => {
    const copy = { id: 'one', platformUserId: 'manager', playerData: { source_team_id: 'source-seat-1' }, faabRemaining: null, waiverPriority: null }
    expect(() => matchImportedRoster(team, [copy, { ...copy, id: 'two' }])).toThrow(/one current roster/)
    expect(() => matchImportedRoster(team, [])).toThrow(/one current roster/)
  })

  it('never uses an owner match when that roster is marked for another team', () => {
    const wrong = { id: 'wrong', platformUserId: team.platformUserId!, playerData: { source_team_id: 'another-seat' }, faabRemaining: null, waiverPriority: null }
    expect(() => matchImportedRoster(team, [wrong])).toThrow(/one current roster/)
  })

  it('uses the owner fallback only for a legacy roster without a source team marker', () => {
    const legacy = { id: 'legacy', platformUserId: team.platformUserId!, playerData: { players: ['one'] }, faabRemaining: null, waiverPriority: null }
    expect(matchImportedRoster(team, [legacy])).toBe(legacy)
  })

  it('translates every active lineup section and removes provider sync metadata', () => {
    const result = translateImportedRosterData({
      players: ['espn-1', 'espn-2'], starters: ['espn-1'], reserve: ['espn-2'], taxi: [],
      lineup_sections: { starters: ['espn-1'], bench: [], ir: [{ id: 'espn-2' }], taxi: [], devy: [] },
      source_provider: 'espn', source_team_id: 'source-seat-1', import: { provider: 'espn' },
    }, new Map([['espn-1', 'sleeper-1'], ['espn-2', 'sleeper-2']]), 'source-league')
    expect(result.players).toEqual(['sleeper-1', 'sleeper-2'])
    expect(result.starters).toEqual(['sleeper-1'])
    expect(result.reserve).toEqual(['sleeper-2'])
    expect((result.lineup_sections as Record<string, unknown>).ir).toEqual([{ id: 'sleeper-2' }])
    expect(result).not.toHaveProperty('source_provider')
    expect(result).not.toHaveProperty('import')
    expect(result.foundation).toEqual({ openTeam: false, carriedOverFromLeagueId: 'source-league' })
  })

  it('uses lineup players when the legacy import has no flat players list', () => {
    const data = { starters: ['one'], lineup_sections: { bench: ['two'] } }
    expect(importedOwnedPlayerIds(data)).toEqual(['one', 'two'])
    expect(translateImportedRosterData(data, new Map([['one', 'native-1'], ['two', 'native-2']]), 'source').players)
      .toEqual(['native-1', 'native-2'])
  })

  it('translates numeric player ids from provider roster arrays', () => {
    const result = translateImportedRosterData({ players: [123], starters: [123] }, new Map([['123', 'native-123']]), 'source')
    expect(result.players).toEqual(['native-123'])
    expect(result.starters).toEqual(['native-123'])
  })

  it('rejects lineups that name players outside the team roster', () => {
    expect(() => importedOwnedPlayerIds({ players: ['one'], starters: ['two'] })).toThrow(/missing from its team roster/)
  })

  it('checks numeric lineup IDs against ownership and recovers legacy numeric-only lineups', () => {
    expect(() => importedOwnedPlayerIds({ players: [123], lineup_sections: { starters: [456] } })).toThrow(/missing from its team roster/)
    const data = { starters: [123], lineup_sections: { bench: [456] } }
    expect(importedOwnedPlayerIds(data)).toEqual(['123', '456'])
    const carried = translateImportedRosterData(data, new Map([['123', 'native-123'], ['456', 'native-456']]), 'source')
    expect(carried.players).toEqual(['native-123', 'native-456'])
    expect(carried.lineup_sections).toEqual({ bench: ['native-456'] })
  })
})
