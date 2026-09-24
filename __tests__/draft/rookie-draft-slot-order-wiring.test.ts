import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 🛑 A COMMISSIONER COULD PICK "WORST RECORD PICKS FIRST" AND IT DID NOTHING.
 *
 * `computeRookieDraftOrder` / `saveRookieDraftOrderConfig` were real, tested,
 * and reachable from a commissioner UI — but the live draft engine's
 * `buildSlotOrderForLeague` never read `League.settings.rookie_draft_order` at
 * all. It only ever consulted `LeagueSettings.draftOrderSlots` (a manual
 * override) or a weighted lottery result. The setting saved, the preview
 * rendered, and the actual draft used the plain default order regardless.
 *
 * These tests pin the fix at both layers: the new resolver's Team→Roster id
 * mapping (there is no FK between `LeagueTeam` and `Roster`, so each team is
 * resolved to its own roster through `buildRosterIdResolver` — it was once
 * paired by sorted id, which is arbitrary for UUIDs), and `buildSlotOrderForLeague`'s precedence
 * (manual `draftOrderSlots` still wins over the auto rookie order; the rookie
 * order wins over the bare creation-order default).
 */

const { mockGetRookieDraftOrderConfig, mockComputeRookieDraftOrder, mockLeagueFindUnique } = vi.hoisted(() => ({
  mockGetRookieDraftOrderConfig: vi.fn(),
  mockComputeRookieDraftOrder: vi.fn(),
  mockLeagueFindUnique: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: { league: { findUnique: mockLeagueFindUnique } },
}))

vi.mock('@/lib/league/rookieDraftOrder', () => ({
  getRookieDraftOrderConfig: mockGetRookieDraftOrderConfig,
  computeRookieDraftOrder: mockComputeRookieDraftOrder,
}))

import { resolveRookieDraftSlotOrderForLeague } from '@/lib/draft/resolveRookieDraftSlotOrderForLeague'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('resolveRookieDraftSlotOrderForLeague', () => {
  it('returns null when the commissioner has not enabled auto rookie order', async () => {
    mockGetRookieDraftOrderConfig.mockResolvedValueOnce(null)

    const result = await resolveRookieDraftSlotOrderForLeague('league-1')

    expect(result).toBeNull()
    expect(mockComputeRookieDraftOrder).not.toHaveBeenCalled()
  })

  it('returns null when enabled but there is nothing to order', async () => {
    mockGetRookieDraftOrderConfig.mockResolvedValueOnce({ mode: 'worst_to_first', enabled: true })
    mockComputeRookieDraftOrder.mockResolvedValueOnce({ slots: [] })

    const result = await resolveRookieDraftSlotOrderForLeague('league-1')

    expect(result).toBeNull()
  })

  it("maps each LeagueTeam to its OWN roster, preserving the computed pick order", async () => {
    mockGetRookieDraftOrderConfig.mockResolvedValueOnce({ mode: 'worst_to_first', enabled: true })
    // computeRookieDraftOrder's own sort put the worst team (t3) first, even
    // though t3 is neither first alphabetically nor first by id.
    mockComputeRookieDraftOrder.mockResolvedValueOnce({
      slots: [
        { slot: 1, teamId: 't3', teamName: 'Worst Team', ownerName: 'Owner 3' },
        { slot: 2, teamId: 't1', teamName: 'Middle Team', ownerName: 'Owner 1' },
        { slot: 3, teamId: 't2', teamName: '', ownerName: 'Owner 2' },
      ],
    })
    // 🛑 This used to pair the two lists by sorted id — t1↔r1, t2↔r2, t3↔r3 — which for random
    // UUIDs is an arbitrary pairing, so "worst team picks first" handed that pick to whoever's
    // roster id happened to sort alongside. Here the id orders deliberately disagree with
    // ownership: t1 owns r2, t2 owns r3 (through its owner), t3 owns r1.
    mockLeagueFindUnique.mockResolvedValueOnce({
      rosters: [
        { id: 'r1', platformUserId: 'u3' },
        { id: 'r2', platformUserId: 'u1' },
        { id: 'r3', platformUserId: 'u2' },
      ],
      teams: [
        { id: 't1', externalId: 'r2', claimedByUserId: 'u1', platformUserId: null },
        { id: 't2', externalId: 'sleeper-2', claimedByUserId: 'u2', platformUserId: null },
        { id: 't3', externalId: 'r1', claimedByUserId: 'u3', platformUserId: null },
      ],
    })

    const result = await resolveRookieDraftSlotOrderForLeague('league-1')

    expect(result).toEqual([
      { slot: 1, rosterId: 'r1', displayName: 'Worst Team' },
      { slot: 2, rosterId: 'r2', displayName: 'Middle Team' },
      { slot: 3, rosterId: 'r3', displayName: 'Owner 2' },
    ])
  })

  it('declines an order it cannot place completely instead of seating a LeagueTeam id', async () => {
    // A team id in slotOrder is a seat the pick authority never accepts — nobody is on the clock.
    // Returning null keeps the league's default order instead.
    mockGetRookieDraftOrderConfig.mockResolvedValueOnce({ mode: 'worst_to_first', enabled: true })
    mockComputeRookieDraftOrder.mockResolvedValueOnce({
      slots: [{ slot: 1, teamId: 't1', teamName: 'Only Team', ownerName: 'Owner 1' }],
    })
    mockLeagueFindUnique.mockResolvedValueOnce({
      rosters: [],
      teams: [{ id: 't1', externalId: 'x', claimedByUserId: null, platformUserId: null }],
    })

    const result = await resolveRookieDraftSlotOrderForLeague('league-1')

    expect(result).toBeNull()
  })
})

describe('buildSlotOrderForLeague — rookie order precedence', () => {
  it('applies the auto rookie order when enabled and no manual slot order is set', async () => {
    vi.resetModules()
    vi.doMock('@/lib/prisma', () => ({
      prisma: {
        league: {
          findUnique: vi.fn().mockResolvedValue({
            leagueSize: 2,
            rosters: [{ id: 'r-a' }, { id: 'r-b' }],
            teams: [{ id: 't-a', ownerName: 'A' }, { id: 't-b', ownerName: 'B' }],
            leagueSettings: null,
          }),
        },
      },
    }))
    vi.doMock('@/lib/draft/resolve-draft-context', () => ({
      resolveWeightedLotterySlotOrderForLeague: vi.fn().mockResolvedValue(null),
    }))
    vi.doMock('@/lib/draft/resolveRookieDraftSlotOrderForLeague', () => ({
      resolveRookieDraftSlotOrderForLeague: vi.fn().mockResolvedValue([
        { slot: 1, rosterId: 'r-b', displayName: 'B' },
        { slot: 2, rosterId: 'r-a', displayName: 'A' },
      ]),
    }))

    const { buildSlotOrderForLeague } = await import('@/lib/live-draft-engine/DraftSessionService')
    const slotOrder = await buildSlotOrderForLeague('league-1')

    expect(slotOrder).toEqual([
      { slot: 1, rosterId: 'r-b', displayName: 'B' },
      { slot: 2, rosterId: 'r-a', displayName: 'A' },
    ])
  })

  it('lets a manual draftOrderSlots override win over the auto rookie order', async () => {
    vi.resetModules()
    vi.doMock('@/lib/prisma', () => ({
      prisma: {
        league: {
          findUnique: vi.fn().mockResolvedValue({
            leagueSize: 2,
            rosters: [{ id: 'r-a' }, { id: 'r-b' }],
            teams: [{ id: 't-a', ownerName: 'A' }, { id: 't-b', ownerName: 'B' }],
            leagueSettings: {
              draftOrderSlots: [
                { slot: 1, ownerId: 'r-a', ownerName: 'A' },
                { slot: 2, ownerId: 'r-b', ownerName: 'B' },
              ],
            },
          }),
        },
      },
    }))
    vi.doMock('@/lib/draft/resolve-draft-context', () => ({
      resolveWeightedLotterySlotOrderForLeague: vi.fn().mockResolvedValue(null),
    }))
    const rookieResolver = vi.fn().mockResolvedValue([
      { slot: 1, rosterId: 'r-b', displayName: 'B' },
      { slot: 2, rosterId: 'r-a', displayName: 'A' },
    ])
    vi.doMock('@/lib/draft/resolveRookieDraftSlotOrderForLeague', () => ({
      resolveRookieDraftSlotOrderForLeague: rookieResolver,
    }))

    const { buildSlotOrderForLeague } = await import('@/lib/live-draft-engine/DraftSessionService')
    const slotOrder = await buildSlotOrderForLeague('league-1')

    // Manual order (A first) wins, not the rookie order (B first).
    expect(slotOrder[0]).toEqual({ slot: 1, rosterId: 'r-a', displayName: 'A' })
    expect(rookieResolver).not.toHaveBeenCalled()
  })
})
