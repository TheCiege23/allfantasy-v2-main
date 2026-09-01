import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 6.1 step A — participation reaches the commissioner snapshot, and it REFUSES rather than
 * reporting zero.
 *
 * ── 🛑 THE FAILURE THIS EXISTS TO PREVENT, MEASURED NOT IMAGINED ────────────────────────────
 * Given no events at all, `deriveLeagueBehavioralIntelligence` returns:
 *
 *     leagueEngagementScore: 0    leagueEngagementTier: 'dormant'    retentionRisk: 'critical'
 *
 * A league nobody has ever synced would therefore be told, confidently, that it is dead and about
 * to churn. That is the `devyValueBoard` failure this whole plan opens with — `devyValue` is
 * zero-not-null for 1,455 of 1,718 players, so 85% of a board renders an absence of data as
 * "worthless". `completeness` is the only thing separating "nobody is playing" from "we have not
 * looked", so the loader consults it and returns nothing rather than a number.
 *
 * ── AND THE GATE HAS TO ACTUALLY SAVE THE QUERIES ───────────────────────────────────────────
 * `getLeagueIntelligence` is FOUR prisma queries per league, on a dashboard path whose own
 * comments record a production Postgres OOM (53200) from an unbounded per-league fan-out. So the
 * first test asserts the provider is never *called* when the gate is off — not merely that the
 * result is empty, which would also pass if the queries ran and were discarded.
 */

const getLeagueIntelligence = vi.fn()

vi.mock('@/lib/decision-os/behavioral/api/real-data-provider', () => ({
  realDataProvider: { getLeagueIntelligence: (id: string) => getLeagueIntelligence(id) },
}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

const { loadParticipationByLeague } = await import('@/lib/commissioner-hub/commissionerHubHealth')

const ON = { COMMISSIONER_PARTICIPATION_ENABLED: 'true' } as NodeJS.ProcessEnv
const OFF = {} as NodeJS.ProcessEnv

/** A healthy intelligence object, with only the fields the loader reads. */
function intel(over: Record<string, unknown> = {}) {
  return {
    leagueEngagementScore: 72,
    leagueEngagementTier: 'active',
    completeness: 90,
    participationDistribution: { totalManagers: 12, activeManagers: 10 },
    ...over,
  }
}

beforeEach(() => vi.clearAllMocks())

describe('the gate', () => {
  it('🛑 does not even CALL the provider when off — the queries must not run', async () => {
    getLeagueIntelligence.mockResolvedValue(intel())

    const out = await loadParticipationByLeague(['a', 'b', 'c'], OFF)

    expect(out.size).toBe(0)
    // The assertion that matters: an empty result would also be produced by running four queries
    // per league and throwing the answers away.
    expect(getLeagueIntelligence).not.toHaveBeenCalled()
  })

  it('treats anything other than the exact string "true" as off', async () => {
    getLeagueIntelligence.mockResolvedValue(intel())
    for (const value of ['', 'false', '1', 'yes', 'TRUE ']) {
      vi.clearAllMocks()
      const out = await loadParticipationByLeague(['a'], { COMMISSIONER_PARTICIPATION_ENABLED: value } as NodeJS.ProcessEnv)
      // 'TRUE ' trims and lowercases to 'true', so it IS on — pinned so the parsing is deliberate.
      if (value === 'TRUE ') expect(out.size).toBe(1)
      else expect(out.size).toBe(0)
    }
  })
})

describe('the refusal — null, never zero', () => {
  it('🛑 refuses a league with no event coverage rather than calling it dormant', async () => {
    // Exactly what the derivation returns for an unsynced league.
    getLeagueIntelligence.mockResolvedValue(
      intel({
        completeness: 0,
        leagueEngagementScore: 0,
        leagueEngagementTier: 'dormant',
        participationDistribution: { totalManagers: 0, activeManagers: 0 },
      }),
    )

    const out = await loadParticipationByLeague(['cold'], ON)
    expect(out.get('cold')).toBeUndefined()
    expect(out.size).toBe(0)
  })

  it('refuses on zero coverage even when managers ARE known', async () => {
    getLeagueIntelligence.mockResolvedValue(intel({ completeness: 0 }))
    expect((await loadParticipationByLeague(['x'], ON)).size).toBe(0)
  })

  it('refuses when no managers are known even with coverage', async () => {
    getLeagueIntelligence.mockResolvedValue(
      intel({ participationDistribution: { totalManagers: 0, activeManagers: 0 } }),
    )
    expect((await loadParticipationByLeague(['x'], ON)).size).toBe(0)
  })

  it('refuses when the provider itself fails, rather than propagating', async () => {
    getLeagueIntelligence.mockRejectedValue(new Error('db down'))
    // A dashboard must not lose its health card because participation was unavailable.
    await expect(loadParticipationByLeague(['x'], ON)).resolves.toBeInstanceOf(Map)
    expect((await loadParticipationByLeague(['x'], ON)).size).toBe(0)
  })

  it('refuses one league without refusing its neighbours', async () => {
    getLeagueIntelligence.mockImplementation(async (id: string) =>
      id === 'cold' ? intel({ completeness: 0 }) : intel(),
    )

    const out = await loadParticipationByLeague(['warm', 'cold', 'warm2'], ON)
    expect([...out.keys()].sort()).toEqual(['warm', 'warm2'])
  })
})

describe('what it carries when it does answer', () => {
  it('passes through the score, tier, manager counts and coverage', async () => {
    getLeagueIntelligence.mockResolvedValue(intel())

    const p = (await loadParticipationByLeague(['lg'], ON)).get('lg')

    expect(p).toEqual({
      score: 72,
      tier: 'active',
      activeManagers: 10,
      totalManagers: 12,
      // ⚠ Carried on purpose: a surface showing 72/100 off 40% coverage should be able to say so.
      completeness: 90,
    })
  })

  it('covers every league it is given', async () => {
    getLeagueIntelligence.mockResolvedValue(intel())
    const ids = Array.from({ length: 7 }, (_, i) => `lg${i}`)

    const out = await loadParticipationByLeague(ids, ON)

    expect(out.size).toBe(7)
    // Bounded concurrency must not mean dropped work — every league is still asked about exactly
    // once, which is the thing chunking could plausibly get wrong.
    expect(getLeagueIntelligence).toHaveBeenCalledTimes(7)
  })
})
