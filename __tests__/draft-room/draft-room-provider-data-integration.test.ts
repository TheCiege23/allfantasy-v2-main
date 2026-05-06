import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/draft-room/getResolvedDraftPoolForLeague', () => ({
  getResolvedDraftPoolForLeague: vi.fn(),
}))

import { getResolvedDraftPoolForLeague } from '@/lib/draft-room/getResolvedDraftPoolForLeague'
import { getPlayerDataForSurface } from '@/lib/player-data/getPlayerDataForSurface'
import { normalizeDraftPlayer } from '@/lib/draft-sports-models/normalize-draft-player'

describe('DraftRoom provider data integration', () => {
  it('exposes unified meta alongside NormalizedDraftEntry for draft surface', async () => {
    vi.mocked(getResolvedDraftPoolForLeague).mockResolvedValue({
      entries: [
        normalizeDraftPlayer(
          { full_name: 'Board Player', position: 'DST', team: 'DAL', playerId: 'dst-1', yearsExp: 4 },
          'NFL',
        ),
      ],
      sport: 'NFL',
      count: 1,
      rosterConfigurationIncomplete: false,
    })

    const rows = await getPlayerDataForSurface({ surface: 'draft', leagueId: 'lg', limit: 20 })
    expect(rows[0]?.unified.playerId).toBe('dst-1')
    expect(rows[0]?.display.displayName).toBe('Board Player')
  })
})
