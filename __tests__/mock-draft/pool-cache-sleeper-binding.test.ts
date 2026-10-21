/**
 * The `/api/mock-draft/adp` pool sets `sleeperId`/`playerId` from `resolveSleeperIdsBatch`, and the
 * board renders that id's Sleeper CDN headshot. Pins the wiring: position is passed, ids are
 * aligned by row, and a devy row's COLLEGE team is not passed (it folds onto an NFL club —
 * "Tennessee" -> TEN — and would "verify" an NFL namesake).
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/sleeper-client', () => ({
  getAllPlayers: vi.fn(async () => ({
    '2212': { full_name: 'Josh Allen', position: 'G', team: null },
    '4984': { full_name: 'Josh Allen', position: 'QB', team: 'BUF' },
    '9001': { full_name: 'Mike Williams', position: 'WR', team: 'TEN' },
    '9002': { full_name: 'Mike Williams', position: 'WR', team: 'LAC' },
  })),
}))

vi.mock('@/lib/adp-data', () => ({
  getLiveADP: vi.fn(async () => [
    { name: 'Josh Allen', position: 'QB', team: 'BUF', adp: 1.2, source: 'ffc' },
    { name: 'Mike Williams', position: 'WR', team: 'Tennessee', adp: 140, source: 'devy' },
  ]),
  fetchFFCADP: vi.fn(async () => ({ players: [], meta: {} })),
  fetchAllFFCFormats: vi.fn(async () => ({})),
}))
vi.mock('@/lib/injuries/injuryReadPort', () => ({
  injuryCoverageFor: () => ({ covered: false }),
  resolveInjuryFacts: vi.fn(),
}))
vi.mock('@/lib/multi-platform-adp', () => ({ findMultiADP: () => null }))
vi.mock('@/lib/mock-draft/sport-player-pool', () => ({ loadSportAwareDraftPlayerPool: vi.fn(async () => []) }))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { getCachedMockDraftPool, buildMockDraftPoolCacheKey } from '@/lib/mock-draft/mock-draft-pool-cache'

describe('mock-draft pool — Sleeper id binding', () => {
  it("gives QB Josh Allen the QB's id, and refuses the devy namesake rather than verify him by college team", async () => {
    const { payload } = await getCachedMockDraftPool({ sport: 'NFL', type: 'redraft', forceRefresh: true })
    const rows = payload.entries as Array<{ name: string; sleeperId: string | null; playerId: string | null }>
    expect(rows.map((r) => [r.name, r.sleeperId, r.playerId])).toEqual([
      ['Josh Allen', '4984', '4984'],
      ['Mike Williams', null, null],
    ])
  })
})


describe('NBA verified roster cache namespace', () => {
  it('separates old alphabetical payloads and keeps the complete NBA roster budget', () => {
    expect(buildMockDraftPoolCacheKey({ sport: 'NBA', limit: 1000 })).toMatch(/limit:1000:verified-roster-v2$/)
    expect(buildMockDraftPoolCacheKey({ sport: 'NBA', limit: 5000 })).toMatch(/limit:1000:verified-roster-v2$/)
    expect(buildMockDraftPoolCacheKey({ sport: 'NFL', limit: 1000 })).toMatch(/limit:500$/)
  })
})
