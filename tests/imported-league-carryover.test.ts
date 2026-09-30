import { describe, expect, it } from 'vitest'
import { matchImportedRoster, translateImportedRosterData } from '@/lib/league-creation/canonical/carryOverImportedLeague'

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
})
