import { describe, expect, it, vi } from 'vitest'
import { resolveJoinRankGate } from '@/lib/league-join/resolveJoinRankGate'
import { CLASS_EXCEPTIONS_KEY } from '@/lib/league-join/managerClass'

type Listing = { minRankLevel: number | null; maxRankLevel: number | null; creatorRankLevel: number | null }

function createMockPrisma(overrides?: {
  listing?: Listing | null
  profile?: { xpLevel?: number | null; legacyCareerLevel?: number | null } | null
  settings?: Record<string, unknown> | null
}) {
  return {
    findLeagueListing: {
      findFirst: vi.fn(async () => overrides?.listing ?? null),
    },
    userProfile: {
      findUnique: async () => overrides?.profile ?? null,
    },
    league: {
      findUnique: vi.fn(async () => (overrides?.settings === undefined ? { settings: {} } : { settings: overrides.settings })),
    },
  }
}

function exceptionFor(userId: string) {
  return { [CLASS_EXCEPTIONS_KEY]: [{ userId, grantedBy: 'comm', grantedAt: '2026-10-01T00:00:00.000Z', via: 'direct', levelAtGrant: 1 }] }
}

describe('resolveJoinRankGate', () => {
  it('allows join when the league has no class (no listing — e.g. an imported league)', async () => {
    const result = await resolveJoinRankGate({
      leagueId: 'league-1',
      userId: 'user-1',
      prismaLike: createMockPrisma({ listing: null, profile: { xpLevel: 5, legacyCareerLevel: 2 } }) as any,
    })

    expect(result.allowed).toBe(true)
    expect(result.reason).toBe('LISTING_MISSING')
    expect(result.userRankLevel).toBe(5)
  })

  it('reads only listings that carry a level, oldest first', async () => {
    const prismaLike = createMockPrisma({ listing: null })
    await resolveJoinRankGate({ leagueId: 'league-x', userId: 'u', prismaLike: prismaLike as any })

    expect(prismaLike.findLeagueListing.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          leagueId: 'league-x',
          OR: [{ creatorRankLevel: { not: null } }, { minRankLevel: { not: null } }],
        },
        orderBy: { createdAt: 'asc' },
      }),
    )
  })

  it('applies ±2 around the creator level, overriding a legacy ±3 range stored on the listing', async () => {
    // Stored as 3–9 (creator 6 ±3). Level 9 was allowed before; ±2 makes the top 8.
    const listing = { minRankLevel: 3, maxRankLevel: 9, creatorRankLevel: 6 }
    const blocked = await resolveJoinRankGate({
      leagueId: 'league-2',
      userId: 'user-2',
      prismaLike: createMockPrisma({ listing, profile: { xpLevel: 9 } }) as any,
    })
    expect(blocked.allowed).toBe(false)
    expect(blocked.reason).toBe('OUTSIDE_RANK_RANGE')
    expect(blocked.minRankLevel).toBe(4)
    expect(blocked.maxRankLevel).toBe(8)

    for (const level of [4, 5, 6, 7, 8]) {
      const ok = await resolveJoinRankGate({
        leagueId: 'league-2',
        userId: 'user-2',
        prismaLike: createMockPrisma({ listing, profile: { xpLevel: level } }) as any,
      })
      expect(ok.allowed, `level ${level}`).toBe(true)
      expect(ok.reason).toBe('RANGE_OK')
    }
  })

  it('falls back to the stored range when the listing has no centre', async () => {
    const result = await resolveJoinRankGate({
      leagueId: 'league-3',
      userId: 'user-3',
      prismaLike: createMockPrisma({
        listing: { minRankLevel: 2, maxRankLevel: 4, creatorRankLevel: null },
        profile: { xpLevel: 5 },
      }) as any,
    })
    expect(result.allowed).toBe(false)
    expect(result.minRankLevel).toBe(2)
    expect(result.maxRankLevel).toBe(4)
  })

  it('lets in the ONE manager the commissioner named, and only that manager', async () => {
    const listing = { minRankLevel: null, maxRankLevel: null, creatorRankLevel: 10 }
    const settings = exceptionFor('user-named')

    const named = await resolveJoinRankGate({
      leagueId: 'league-4',
      userId: 'user-named',
      prismaLike: createMockPrisma({ listing, profile: { xpLevel: 1 }, settings }) as any,
    })
    expect(named.allowed).toBe(true)
    expect(named.bypassed).toBe(true)
    expect(named.reason).toBe('COMMISSIONER_EXCEPTION')

    const other = await resolveJoinRankGate({
      leagueId: 'league-4',
      userId: 'user-other',
      prismaLike: createMockPrisma({ listing, profile: { xpLevel: 1 }, settings }) as any,
    })
    expect(other.allowed).toBe(false)
    expect(other.reason).toBe('OUTSIDE_RANK_RANGE')
  })

  it('does not read league settings when the manager is already inside the band', async () => {
    const prismaLike = createMockPrisma({
      listing: { minRankLevel: null, maxRankLevel: null, creatorRankLevel: 5 },
      profile: { xpLevel: 5 },
    })
    const result = await resolveJoinRankGate({ leagueId: 'league-5', userId: 'u', prismaLike: prismaLike as any })
    expect(result.reason).toBe('RANGE_OK')
    expect(prismaLike.league.findUnique).not.toHaveBeenCalled()
  })

  it('no longer honours an invite token — the shared-code bypass is retired', async () => {
    const result = await resolveJoinRankGate({
      leagueId: 'league-6',
      userId: 'user-6',
      inviteTokenOrCode: 'SPECIAL',
      prismaLike: createMockPrisma({
        listing: { minRankLevel: 5, maxRankLevel: 7, creatorRankLevel: 6 },
        profile: { xpLevel: 2 },
      }) as any,
    })
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('OUTSIDE_RANK_RANGE')
  })

  it('defaults user rank to 1 when no user profile exists', async () => {
    const result = await resolveJoinRankGate({
      leagueId: 'league-7',
      userId: 'user-7',
      prismaLike: createMockPrisma({
        listing: { minRankLevel: 2, maxRankLevel: 6, creatorRankLevel: 4 },
        profile: null,
      }) as any,
    })

    expect(result.userRankLevel).toBe(1)
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('OUTSIDE_RANK_RANGE')
  })
})
