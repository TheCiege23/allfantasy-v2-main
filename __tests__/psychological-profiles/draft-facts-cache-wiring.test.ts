/**
 * Both league-wide profile loops hand ONE draft-facts cache to every manager of the league, and a
 * fresh one to each new refresh — so the saving applies, and nothing is held between refreshes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ engine: vi.fn(), league: vi.fn() }))

vi.mock('@/lib/prisma', () => ({ prisma: { league: { findUnique: h.league } } }))
vi.mock('@/lib/psychological-profiles/PsychologicalProfileEngine', () => ({ runPsychologicalProfileEngine: h.engine }))

import { refreshLeagueProfiles } from '@/lib/psychological-profiles/ProfileRefreshService'
import { runRelationshipInsightOrchestrator } from '@/lib/relationship-insights/RelationshipInsightOrchestrator'

beforeEach(() => {
  vi.clearAllMocks()
  h.engine.mockResolvedValue({ profileId: 'p', created: true, labels: [] })
  h.league.mockResolvedValue({
    id: 'L1', sport: 'NFL', season: 2026, isDynasty: false, settings: {},
    teams: [1, 2, 3].map((n) => ({ id: `t${n}`, externalId: String(n), ownerName: `o${n}` })),
  })
})

function cachesPassed() {
  return h.engine.mock.calls.map((c) => (c[0] as { draftFactsCache?: unknown }).draftFactsCache)
}

describe('draft-facts cache wiring', () => {
  it('refreshLeagueProfiles shares one cache across the league, and a new one per refresh', async () => {
    await refreshLeagueProfiles({ leagueId: 'L1' })
    const first = cachesPassed()
    expect(first).toHaveLength(3)
    expect(first[0]).toBeDefined()
    expect(new Set(first).size).toBe(1)
    h.engine.mockClear()
    await refreshLeagueProfiles({ leagueId: 'L1' })
    expect(cachesPassed()[0]).not.toBe(first[0])
  })

  it('the relationship-insight orchestrator does the same', async () => {
    await runRelationshipInsightOrchestrator({ leagueId: 'L1', runProfiles: true } as Parameters<typeof runRelationshipInsightOrchestrator>[0])
    const caches = cachesPassed()
    expect(caches).toHaveLength(3)
    expect(caches[0]).toBeDefined()
    expect(new Set(caches).size).toBe(1)
  })
})
