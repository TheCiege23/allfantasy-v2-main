import { describe, expect, it } from 'vitest'
import { mergeNbaCampusPlayers } from '@/lib/league/collegePro/mergeNbaCampusPlayers'

const victor = { playerId: 'ri-1', playerName: 'Victor Wembanyama', availabilityId: '2577', rosterPlayerId: '06cch', position: 'C', team: 'SAS' }

describe('Fantrax NBA player board identities', () => {
  it('shows one row for the AF player and keeps the older profile IDs available for watchlists', () => {
    const ids = ['2577', 'NBA:2577', 'NBA:victor-wembanyama:SAN ANTONIO SPURS', 'NBA:tsdb_34219796', 'tsdb_34219796']
    const profiles = ids.map((id, i) => ({
      id, name: 'Victor Wembanyama', position: 'C', team: i < 2 ? 'SA' : 'San Antonio Spurs', nba_id: '1641705',
    }))
    const unknown = { id: 'unpriced', name: 'Other player', position: 'G', team: 'SAS' }

    const rows = mergeNbaCampusPlayers([victor], [...profiles, unknown])

    expect(rows).toEqual([
      expect.objectContaining({ id: '2577', team: 'SAS', nba_id: '1641705', alternateIds: ids.slice(1) }),
      unknown,
    ])
  })

  it('leaves distinct or ambiguous same-name profiles alone', () => {
    const profile = { id: 'retired', name: 'Victor Wembanyama', position: 'F', team: 'SEA' }
    expect(mergeNbaCampusPlayers([victor], [profile])).toContain(profile)
    const ambiguous = { ...profile, team: 'SA' }
    expect(mergeNbaCampusPlayers([victor, { ...victor, playerId: 'ri-2', availabilityId: '9999', rosterPlayerId: 'other' }], [ambiguous])).toContain(ambiguous)
  })
})
