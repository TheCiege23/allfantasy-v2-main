/**
 * The cached mock pool (`/api/mock-draft/adp`) carries AF ADP on every row, from the board for the
 * mock's own context — the wiring between the pool builder and lib/mock-draft/mockPoolAfAdp.
 */
import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ loadAdpBoard: vi.fn() }))

vi.mock('@/lib/sleeper-client', () => ({ getAllPlayers: vi.fn(async () => ({})) }))
vi.mock('@/lib/adp-data', () => ({
  getLiveADP: vi.fn(async () => [
    { name: 'Atlas Runner', position: 'RB', team: 'NYJ', adp: 14, source: 'ffc' },
    { name: 'Blaze Catcher', position: 'WR', team: 'DAL', adp: 20, source: 'ffc' },
  ]),
  fetchFFCADP: vi.fn(async () => ({ players: [], meta: {} })),
  fetchAllFFCFormats: vi.fn(async () => ({})),
}))
vi.mock('@/lib/injuries/injuryReadPort', () => ({ injuryCoverageFor: () => ({ covered: false }), resolveInjuryFacts: vi.fn() }))
vi.mock('@/lib/multi-platform-adp', () => ({ findMultiADP: () => null }))
vi.mock('@/lib/mock-draft/sport-player-pool', () => ({ loadSportAwareDraftPlayerPool: vi.fn(async () => []) }))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/adp/loadAdpBoard', () => ({ loadAdpBoard: h.loadAdpBoard }))

import { getCachedMockDraftPool } from '@/lib/mock-draft/mock-draft-pool-cache'
import { buildPlayerKey } from '@/lib/adp/computeAllFantasyAdp'

describe('mock-draft pool — AF ADP', () => {
  it('attaches AF ADP from the board for the mock’s settings, leaving market ADP as it was', async () => {
    h.loadAdpBoard.mockResolvedValue({
      corpora: new Map([[buildPlayerKey('Atlas Runner', 'RB'), { own: { adp: 9, sampleSize: 400 }, imported: null }]]),
    })
    const { payload } = await getCachedMockDraftPool({
      sport: 'NFL',
      type: 'redraft',
      teamCount: 10,
      scoring: 'ppr',
      draftType: 'snake',
      forceRefresh: true,
    })
    const rows = payload.entries as Array<{ name: string; adp: number; afAdp: number | null }>
    expect(rows.map((r) => r.adp)).toEqual([14, 20])
    expect(rows[0].afAdp).toBeLessThan(14)
    expect(rows[1].afAdp).toBe(20)
    expect(h.loadAdpBoard).toHaveBeenCalledWith(
      expect.objectContaining({ sport: 'NFL', leagueType: 'redraft', teamCount: 10, scoringFormat: 'ppr' }),
      { draftMode: 'real' },
    )
  })
})
