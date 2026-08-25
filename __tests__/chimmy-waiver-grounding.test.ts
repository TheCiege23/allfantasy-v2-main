import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  waiverFindUnique: vi.fn(),
  seasonFindFirst: vi.fn(),
  rosterFindFirst: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueWaiverSettings: { findUnique: mocks.waiverFindUnique },
    redraftSeason: { findFirst: mocks.seasonFindFirst },
    redraftRoster: { findFirst: mocks.rosterFindFirst },
  },
}))

import { buildWaiverContext } from '@/lib/chimmy/waiverGrounding'

function settings(overrides: Record<string, unknown> = {}) {
  return {
    waiverType: 'faab',
    processingDayOfWeek: 3,
    processingTimeUtc: '07:00',
    claimLimitPerPeriod: null,
    claimLimitPerWeek: 4,
    faabBudget: 100,
    tiebreakRule: 'waiver_order',
    lockType: 'game_time',
    instantFaAfterClear: true,
    waiverOrderResetPolicy: 'weekly',
    postGameWaiverBehavior: 'locked',
    ...overrides,
  }
}

describe('buildWaiverContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.waiverFindUnique.mockResolvedValue(settings())
    mocks.seasonFindFirst.mockResolvedValue({ id: 'season-1' })
    mocks.rosterFindFirst.mockResolvedValue({ faabBalance: 73, waiverPriority: 4, teamName: 'My Team' })
  })

  it('states the rules that are on file', async () => {
    const out = await buildWaiverContext('lg1', 'user-1')

    expect(out).toContain('WAIVER RULES')
    expect(out).toContain('Runs Wednesday at 07:00 UTC')
    expect(out).toContain('FAAB budget: 100')
    expect(out).toContain('Claim limit: 4')
  })

  it("includes this user's own budget and priority", async () => {
    const out = await buildWaiverContext('lg1', 'user-1')
    expect(out).toContain('FAAB remaining 73')
    expect(out).toContain('waiver priority 4')
  })

  /*
   * The whole point of the block. Rules without this line invite "you were
   * outbid on him" — fluent, specific, and entirely invented.
   */
  it('states outright that no waiver activity is visible', async () => {
    const out = await buildWaiverContext('lg1', 'user-1')

    expect(out).toContain('NO WAIVER ACTIVITY IS AVAILABLE')
    expect(out).toMatch(/do NOT say who claimed, dropped or was outbid/i)
    expect(out).toMatch(/do NOT report what a player went for/i)
  })

  it('refuses to state a schedule that is not on file', async () => {
    mocks.waiverFindUnique.mockResolvedValue(settings({ processingDayOfWeek: null }))
    const out = await buildWaiverContext('lg1', 'user-1')

    expect(out).toMatch(/do not state when waivers run/i)
    expect(out).not.toContain('Runs ')
  })

  it('still returns the rules when the user has no roster on file', async () => {
    mocks.rosterFindFirst.mockResolvedValue(null)
    const out = await buildWaiverContext('lg1', 'user-1')

    expect(out).toContain('WAIVER RULES')
    expect(out).not.toContain('FAAB remaining')
  })

  it('survives a failing roster lookup without losing the rules', async () => {
    mocks.seasonFindFirst.mockRejectedValue(new Error('connection lost'))
    const out = await buildWaiverContext('lg1', 'user-1')

    expect(out).toContain('WAIVER RULES')
    expect(out).toContain('NO WAIVER ACTIVITY IS AVAILABLE')
  })

  it('returns null when the league has no waiver settings', async () => {
    mocks.waiverFindUnique.mockResolvedValue(null)
    expect(await buildWaiverContext('lg1', 'user-1')).toBeNull()
  })
})
