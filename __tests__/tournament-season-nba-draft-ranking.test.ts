import { describe, expect, it } from 'vitest'
import { rankNbaDraftPoolFromPriorSeason } from '@/lib/tournament/seasonNbaDraftRanking'
import type { SeasonDraftPlayer } from '@/lib/tournament/seasonDraftPolicy'

const player = (id: string, namespace: 'rolling_insights' | 'unknown' = 'rolling_insights'): SeasonDraftPlayer => ({
  playerId: id, playerName: `Player ${id}`, position: 'PG', team: 'TEST', adp: null,
  draftIdProvenance: { namespace, sourceRecordId: 'row-' + id },
})
describe('NBA opening-draft prior-season rank evidence', () => {
  it('ranks only measured previous-season PPG tied to verified Rolling Insights IDs', () => {
    const pool = [player('10'), player('20'), player('30', 'unknown'), player('40')]
    const rows = [
      { player_id: 10, regular_season: { games_played: 10, points: 200 } },
      { player_id: 20, regular_season: { games_played: 20, points: 600 } },
      { player_id: 30, regular_season: { games_played: 10, points: 500 } },
      { player_id: 40, regular_season: { games_played: 0, points: 100 } },
    ]
    const ranked = rankNbaDraftPoolFromPriorSeason(pool, rows)
    expect(ranked.rankedPlayers).toBe(2)
    expect(ranked.players.map(row => row.rank)).toEqual([2, 1, null, null])
    expect(ranked.players.every(row => row.adp === null)).toBe(true)
  })
  it('refuses ambiguous or malformed vendor rows without inventing a rank', () => {
    const ranked = rankNbaDraftPoolFromPriorSeason([player('10'), player('20')], [
      { player_id: 10, regular_season: { games_played: 10, points: 200 } },
      { player_id: 10, regular_season: { games_played: 10, points: 300 } },
      { player_id: 20, regular_season: { games_played: 10, points: 'bad' } },
    ])
    expect(ranked.rankedPlayers).toBe(0)
    expect(ranked.players.map(row => row.rank)).toEqual([null, null])
  })
})
