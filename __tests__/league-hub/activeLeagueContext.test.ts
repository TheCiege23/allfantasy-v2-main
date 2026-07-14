/**
 * Universal League Hub — Parts 2, 5, 8 Active League Context resolver.
 *
 * The load-bearing safety property under test: `resolveActiveLeagueContext`
 * must return `null` for anyone who is not the league owner, not a redraft
 * member, and has no claimed team — callers (the `/api/league-hub/context/[leagueId]`
 * route) treat `null` as 404, never assume access. This mirrors the same
 * fail-closed discipline the Import Security Closure phase established for
 * commissioner verification.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { leagueFindUnique, rosterFindFirst } = vi.hoisted(() => ({
  leagueFindUnique: vi.fn(),
  rosterFindFirst: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: leagueFindUnique },
    roster: { findFirst: rosterFindFirst },
  },
}))

function baseLeague(overrides: Record<string, unknown> = {}) {
  return {
    id: 'league-1',
    userId: 'owner-1',
    platform: 'sleeper',
    sport: 'NFL',
    season: 2026,
    scoring: 'PPR',
    syncStatus: 'success',
    lastSyncedAt: new Date('2026-07-11T00:00:00Z'),
    settings: null,
    redraftMembers: [],
    teams: [],
    ...overrides,
  }
}

describe('resolveActiveLeagueContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rosterFindFirst.mockResolvedValue(null)
  })

  it('returns null when the league does not exist', async () => {
    leagueFindUnique.mockResolvedValue(null)
    const { resolveActiveLeagueContext } = await import('@/lib/shared-services/league-hub/activeLeagueContext')
    const result = await resolveActiveLeagueContext({ leagueId: 'missing', userId: 'user-1' })
    expect(result).toBeNull()
  })

  it('returns null (fails closed) for a user with no ownership, membership, or claimed team', async () => {
    leagueFindUnique.mockResolvedValue(baseLeague())
    const { resolveActiveLeagueContext } = await import('@/lib/shared-services/league-hub/activeLeagueContext')
    const result = await resolveActiveLeagueContext({ leagueId: 'league-1', userId: 'stranger' })
    expect(result).toBeNull()
  })

  it('resolves a real context for the league owner', async () => {
    leagueFindUnique.mockResolvedValue(baseLeague({ platform: 'allfantasy', userId: 'owner-1' }))
    const { resolveActiveLeagueContext } = await import('@/lib/shared-services/league-hub/activeLeagueContext')
    const result = await resolveActiveLeagueContext({ leagueId: 'league-1', userId: 'owner-1' })
    expect(result).not.toBeNull()
    expect(result?.provider).toBe('allfantasy')
    expect(result?.isCommissioner).toBe(true)
  })

  it('resolves a real context for a claimed-team member and reports commissioner flag from the team row', async () => {
    leagueFindUnique.mockResolvedValue(
      baseLeague({
        userId: 'owner-1',
        teams: [{ id: 'team-9', isCommissioner: false, isCoCommissioner: true }],
      })
    )
    rosterFindFirst.mockResolvedValue({ id: 'roster-9' })
    const { resolveActiveLeagueContext } = await import('@/lib/shared-services/league-hub/activeLeagueContext')
    const result = await resolveActiveLeagueContext({ leagueId: 'league-1', userId: 'member-1' })
    expect(result).not.toBeNull()
    expect(result?.teamId).toBe('team-9')
    expect(result?.rosterId).toBe('roster-9')
    expect(result?.isCommissioner).toBe(true)
  })

  it('resolves a real context for a redraft member with no claimed team, teamId/rosterId null', async () => {
    leagueFindUnique.mockResolvedValue(
      baseLeague({ userId: 'owner-1', redraftMembers: [{ role: 'member' }] })
    )
    const { resolveActiveLeagueContext } = await import('@/lib/shared-services/league-hub/activeLeagueContext')
    const result = await resolveActiveLeagueContext({ leagueId: 'league-1', userId: 'member-2' })
    expect(result).not.toBeNull()
    expect(result?.teamId).toBeNull()
    expect(result?.isCommissioner).toBe(false)
  })

  it('surfaces the real commissionerVerification.method from League.settings, never fabricated', async () => {
    leagueFindUnique.mockResolvedValue(
      baseLeague({
        platform: 'mfl',
        userId: 'owner-1',
        teams: [{ id: 'team-1', isCommissioner: false, isCoCommissioner: false }],
        settings: { commissionerVerification: { method: 'attestation' } },
      })
    )
    const { resolveActiveLeagueContext } = await import('@/lib/shared-services/league-hub/activeLeagueContext')
    const result = await resolveActiveLeagueContext({ leagueId: 'league-1', userId: 'member-1' })
    expect(result?.commissionerVerificationMethod).toBe('attestation')
  })

  it('getChimmyLeagueContext is a real alias for resolveActiveLeagueContext, not a separate implementation', async () => {
    const mod = await import('@/lib/shared-services/league-hub/activeLeagueContext')
    expect(mod.getChimmyLeagueContext).toBe(mod.resolveActiveLeagueContext)
  })
})
