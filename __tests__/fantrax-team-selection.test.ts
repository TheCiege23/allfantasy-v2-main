import { describe, expect, it } from 'vitest'
import {
  fantraxTeamSourceId,
  listFantraxOwnedTeams,
  ownedFantraxTeamName,
  parseFantraxTeamSourceId,
  selectFantraxRoster,
} from '@/lib/league-import/fantrax/fantraxTeamSelection'

const league = {
  leagueId: 'leagueA',
  leagueName: 'Big League',
  teamIds: ['team-1', 'team-2'],
  teamNames: ['Same Name', 'Same Name'],
}

describe('Fantrax team selection', () => {
  it('shows every team owned by one account, even when names match', () => {
    const teams = listFantraxOwnedTeams(league)
    expect(teams).toHaveLength(2)
    expect(teams.map((team) => team.sourceId)).toEqual([
      fantraxTeamSourceId('leagueA', 'team-1'),
      fantraxTeamSourceId('leagueA', 'team-2'),
    ])
  })

  it('authorizes the selected ID and rejects another team in the same league', () => {
    expect(ownedFantraxTeamName([league], { leagueId: 'leagueA', teamId: 'team-2' })).toBe('Same Name')
    expect(ownedFantraxTeamName([league], { leagueId: 'leagueA', teamId: 'team-3' })).toBeNull()
  })

  it('selects the right roster when two teams share a name', () => {
    const rosters = [
      { teamId: 'team-1', teamName: 'Same Name' },
      { teamId: 'team-2', teamName: 'Same Name' },
    ]
    expect(selectFantraxRoster(rosters, { teamId: 'team-2' })?.teamId).toBe('team-2')
  })

  it('round-trips encoded IDs and keeps old name-based links readable', () => {
    const sourceId = fantraxTeamSourceId('leagueA', 't|2/next')
    expect(parseFantraxTeamSourceId(sourceId)).toEqual({ leagueId: 'leagueA', teamId: 't|2/next' })
    expect(parseFantraxTeamSourceId('fantrax-league:leagueA|Old Team')).toEqual({
      leagueId: 'leagueA',
      teamName: 'Old Team',
    })
  })

  it('keeps selection stable after a rename in a league with over 100 teams', () => {
    const largeLeague = {
      ...league,
      teamIds: Array.from({ length: 128 }, (_, index) => `team-${index}`),
      teamNames: Array.from({ length: 128 }, (_, index) => `Name ${index}`),
    }
    expect(listFantraxOwnedTeams(largeLeague)).toHaveLength(128)
    largeLeague.teamNames[97] = 'New Name'
    expect(ownedFantraxTeamName([largeLeague], { leagueId: 'leagueA', teamId: 'team-97' })).toBe('New Name')
  })
})
