// @vitest-environment node
/**
 * Milestone 32: a manager characterisation label must not steer what a user sees — including
 * through Chimmy. `ImportHistoryContextProvider` copied `insights.archetype` ("Builder" |
 * "Trader" | "Sniper" | "Hoarder" | "Balanced", written by the legacy AI report) into the
 * `importedHistory` slice, and `lib/decision-os/grounding/serialize.ts` renders every scalar of
 * that object into Chimmy's grounding prompt as `archetype: <label>`.
 *
 * The slice keeps its FACTS — career record, win %, titles, seasons — and those are the positive
 * control here, so an empty result cannot pass.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  userProfile: { findUnique: vi.fn() },
  legacyUser: { findUnique: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

import { ImportHistoryContextProvider } from '@/lib/chimmy-context/providers/ImportHistoryContextProvider'

beforeEach(() => {
  prismaMock.userProfile.findUnique.mockReset()
  prismaMock.legacyUser.findUnique.mockReset()
  prismaMock.userProfile.findUnique.mockReturnValue(Promise.resolve({ sleeperUsername: 'Viewer' }))
  prismaMock.legacyUser.findUnique.mockResolvedValue({
    leagues: [
      { name: 'Dynasty A', season: 2025, rosters: [{ wins: 9, losses: 5, isChampion: true }] },
      { name: 'Dynasty A', season: 2024, rosters: [{ wins: 6, losses: 8, isChampion: false }] },
    ],
    aiReports: [{ insights: { archetype: 'Sniper' } }],
  })
})

describe('importedHistory slice — no manager archetype', () => {
  it('carries the facts and no archetype label', async () => {
    const res = await new ImportHistoryContextProvider().load({ userId: 'u1' } as never)
    expect(res.ok).toBe(true)
    const data = res.data as unknown as Record<string, unknown>

    // Facts survive (positive control).
    expect(data.careerRecord).toBe('15-13')
    expect(data.championships).toBe(1)
    expect(data.totalSeasons).toBe(2)

    // The label does not — not as a field, and not anywhere in the value.
    expect(Object.keys(data)).not.toContain('archetype')
    expect(JSON.stringify(data)).not.toMatch(/Sniper/)
  })
})
