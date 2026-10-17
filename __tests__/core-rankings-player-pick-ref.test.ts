// @vitest-environment node
/**
 * The compare hub's player pickers hand refs to the Player Finder. An externalId is only
 * unique per (sport, source) — SOCCER `1100` is api_football's Haaland AND rolling_insights'
 * James Daly (production, 2026-10-12) — so the ref must name the matched row's feed.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/core-app/playerFinder', () => ({ searchPlayers: vi.fn() }))

import { getPlayerPickData } from '@/lib/core-app/rankings'
import { searchPlayers } from '@/lib/core-app/playerFinder'

describe('getPlayerPickData', () => {
  it("builds each pick's ref with the row's source", async () => {
    vi.mocked(searchPlayers).mockResolvedValue([
      { externalId: '1100', source: 'api_football', sport: 'SOCCER', sleeperId: null, name: 'E. Haaland', position: 'FWD', team: 'MCI', imageUrl: null, number: null, rosteredIn: null, platforms: [] },
    ])
    const data = await getPlayerPickData({ qa: 'Haaland' })
    expect(data.matchesA.map((m) => m.ref)).toEqual(['SOCCER~api_football:1100'])
  })
})
