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
    ])
  })

  it('consolidates an old synthetic club key after a trade', () => {
    const lebron = { ...victor, playerName: 'LeBron James', availabilityId: '1362', position: 'PF', team: 'PHI' }
    const oldId = 'NBA:lebron-james:LOS ANGELES LAKERS'
    const oldProfile = { id: oldId, name: 'LeBron James', team: 'LAL', position: 'SF' }
    expect(mergeNbaCampusPlayers([lebron], [oldProfile])).toEqual([
      expect.objectContaining({ id: '1362', team: 'PHI', alternateIds: [oldId] }),
    ])
  })

  it('leaves unrelated and ambiguous profiles out of the AF rows and watchlist aliases', () => {
    const profile = { id: 'retired', name: 'Victor Wembanyama', position: 'F', team: 'SEA' }
    expect(mergeNbaCampusPlayers([victor], [profile])).toEqual([expect.objectContaining({ id: '2577', alternateIds: [] })])
    const ambiguous = { ...profile, team: 'SA' }
    expect(mergeNbaCampusPlayers([victor, { ...victor, playerId: 'ri-2', availabilityId: '9999', rosterPlayerId: 'other' }], [ambiguous])).toEqual([
      expect.objectContaining({ id: '2577', alternateIds: [] }),
      expect.objectContaining({ id: '9999', alternateIds: [] }),
    ])
  })
})
