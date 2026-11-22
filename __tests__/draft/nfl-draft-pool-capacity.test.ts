import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ pool: vi.fn(), assignments: vi.fn(), aggregate: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { sportsPlayer: { aggregate: mocks.aggregate } } }))
vi.mock('@/lib/league/player-pools/load', () => ({ loadPlayerPools: mocks.assignments }))
vi.mock('@/lib/draft-room/ensureDraftPoolReady', () => ({ getWarmDraftPoolSnapshotFast: mocks.pool }))

import { getNflDraftPoolCapacity } from '@/lib/draft-room/nflDraftPoolCapacity'

const league = { sport: 'NFL', leagueType: 'redraft', platform: 'manual', settings: {} }
const slotOrder = Array.from({ length: 250 }, (_, i) => ({ rosterId: String(i) }))
const session = { rounds: 15, teamCount: 250, draftModeLabel: null, slotOrder }
const reducedFeed = [{ playerId: '1' }, { playerId: '1' }, { playerId: null }]

describe('native NFL draft capacity', () => {
  it('counts distinct draft IDs instead of trusting the feed row count', async () => {
    mocks.pool.mockResolvedValue({ warm: true, entryCount: 4000, payload: { entries: reducedFeed } })
    mocks.assignments.mockResolvedValue(null)
    mocks.aggregate.mockResolvedValue({ _max: { fetchedAt: new Date('2026-11-21T16:00:00Z') } })
    const capacity = await getNflDraftPoolCapacity('league', { league, session }, true)
    expect(capacity).toMatchObject({ eligiblePlayers: 1, requiredPlayers: 3750, rosterFeedRefreshedAt: '2026-11-21T16:00:00.000Z' })
    expect(capacity?.error).toContain('3750 different players')
  })

  it('uses the largest pool for a 250-team draft and excludes rookie drafts', async () => {
    mocks.pool.mockResolvedValue({ warm: true, payload: { entries: Array.from({ length: 450 }, (_, i) => ({ playerId: String(i) })) } })
    mocks.assignments.mockResolvedValue(Object.fromEntries(slotOrder.map(({ rosterId }, i) => [rosterId, String(i < 30 ? 0 : 1 + (i % 10))])))
    await expect(getNflDraftPoolCapacity('league', { league, session })).resolves.toMatchObject({ eligiblePlayers: 450, requiredPlayers: 450, error: null })
    await expect(getNflDraftPoolCapacity('league', { league, session: { ...session, draftModeLabel: 'rookie' } })).resolves.toBeNull()
  })
})
