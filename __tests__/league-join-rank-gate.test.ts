import { describe, expect, it, vi } from 'vitest'
import { resolveJoinRankGate } from '@/lib/league-join/resolveJoinRankGate'
import { CLASS_EXCEPTIONS_KEY, skillClassFor } from '@/lib/league-join/managerClass'
import type { SkillBoard } from '@/lib/rank/skillRating/skillRatingStore'

type Listing = { minRankLevel: number | null; maxRankLevel: number | null; creatorRankLevel: number | null }

function createMockPrisma(overrides?: {
  listing?: Listing | null
  profile?: { xpLevel?: number | null; legacyCareerLevel?: number | null } | null
  settings?: Record<string, unknown> | null
  leagueOwner?: string
  members?: string[]
}) {
  return {
    findLeagueListing: {
      findFirst: vi.fn(async () => overrides?.listing ?? null),
    },
    userProfile: {
      findUnique: async () => overrides?.profile ?? null,
    },
    league: {
      findUnique: vi.fn(async () => ({
        userId: overrides?.leagueOwner ?? 'commish',
        sport: 'NFL',
        settings: overrides?.settings === undefined ? {} : overrides.settings,
      })),
    },
    redraftLeagueMember: {
      findMany: vi.fn(async () => (overrides?.members ?? []).map((userId) => ({ userId }))),
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
      skillBoard: null,
      prismaLike: createMockPrisma({ listing: null, profile: { xpLevel: 5, legacyCareerLevel: 2 } }) as any,
    })

    expect(result.allowed).toBe(true)
    expect(result.reason).toBe('LISTING_MISSING')
    expect(result.userRankLevel).toBe(5)
  })

  it('reads only listings that carry a level, oldest first', async () => {
    const prismaLike = createMockPrisma({ listing: null })
    await resolveJoinRankGate({ leagueId: 'league-x', userId: 'u', skillBoard: null, prismaLike: prismaLike as any })

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
      skillBoard: null,
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
        skillBoard: null,
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
      skillBoard: null,
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
      skillBoard: null,
      prismaLike: createMockPrisma({ listing, profile: { xpLevel: 1 }, settings }) as any,
    })
    expect(named.allowed).toBe(true)
    expect(named.bypassed).toBe(true)
    expect(named.reason).toBe('COMMISSIONER_EXCEPTION')

    const other = await resolveJoinRankGate({
      leagueId: 'league-4',
      userId: 'user-other',
      skillBoard: null,
      prismaLike: createMockPrisma({ listing, profile: { xpLevel: 1 }, settings }) as any,
    })
    expect(other.allowed).toBe(false)
    expect(other.reason).toBe('OUTSIDE_RANK_RANGE')
  })

  it('no longer honours an invite token — the shared-code bypass is retired', async () => {
    const result = await resolveJoinRankGate({
      leagueId: 'league-6',
      userId: 'user-6',
      inviteTokenOrCode: 'SPECIAL',
      skillBoard: null,
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
      skillBoard: null,
      prismaLike: createMockPrisma({
        listing: { minRankLevel: 2, maxRankLevel: 6, creatorRankLevel: 4 },
        profile: null,
      }) as any,
    })

    expect(result.userRankLevel).toBe(1)
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('OUTSIDE_RANK_RANGE')
  })

  describe('skill basis (2026-10-01)', () => {
    function board(rows: Array<{ u: string; r: number; g: number }>): SkillBoard {
      return {
        date: '2026-10-01',
        computedAt: '2026-10-01T00:00:00Z',
        sources: { facts: 0, weeks: 0, native: 0 },
        sports: {
          NFL: {
            games: 0, periods: 0, latestPeriod: 0, rated: rows.length, percentiles: [],
            rows: rows.map((x) => ({ u: x.u, r: x.r, rd: 60, v: 0.06, g: x.g, w: 0, l: 0, t: 0, lp: 0 })),
          },
        },
      }
    }
    const listing = { minRankLevel: 5, maxRankLevel: 9, creatorRankLevel: 7 }

    it('measures on skill when the joiner and the league are both rated in its sport', async () => {
      // League members rated 1500, 1550, 1600 -> classes 13, 14, 15 -> median 14 -> band 12–16.
      const sb = board([
        { u: 'commish', r: 1500, g: 30 }, { u: 'm1', r: 1550, g: 30 }, { u: 'm2', r: 1600, g: 30 },
        { u: 'strong', r: 1800, g: 40 }, { u: 'peer', r: 1650, g: 12 },
      ])
      const gate = (userId: string) =>
        resolveJoinRankGate({ leagueId: 'L', userId, skillBoard: sb, prismaLike: createMockPrisma({ listing, profile: { xpLevel: 7 }, members: ['m1', 'm2'] }) as any })

      const strong = await gate('strong')
      expect(strong).toMatchObject({ basis: 'skill', sport: 'NFL', allowed: false, userClass: skillClassFor(1800), minRankLevel: 12, maxRankLevel: 16 })
      // Same ladder level as the league's band — skill, not level, is what keeps them out.
      expect(strong.userRankLevel).toBe(7)

      const peer = await gate('peer')
      expect(peer).toMatchObject({ basis: 'skill', allowed: true, reason: 'RANGE_OK', userClass: 16 })
    })

    it('falls back to the level band when the joiner is not yet rated (fewer than 10 games)', async () => {
      const sb = board([{ u: 'commish', r: 1500, g: 30 }, { u: 'newbie', r: 1900, g: 4 }])
      const r = await resolveJoinRankGate({ leagueId: 'L', userId: 'newbie', skillBoard: sb, prismaLike: createMockPrisma({ listing, profile: { xpLevel: 6 } }) as any })
      expect(r).toMatchObject({ basis: 'level', allowed: true, minRankLevel: 5, maxRankLevel: 9, userClass: 6 })
    })

    it('falls back to the level band when no league member is rated', async () => {
      const sb = board([{ u: 'joiner', r: 1500, g: 30 }])
      const r = await resolveJoinRankGate({ leagueId: 'L', userId: 'joiner', skillBoard: sb, prismaLike: createMockPrisma({ listing, profile: { xpLevel: 20 } }) as any })
      expect(r).toMatchObject({ basis: 'level', allowed: false, userClass: 20 })
    })

    it('a commissioner exception still lets a named manager in on the skill basis', async () => {
      const sb = board([{ u: 'commish', r: 1500, g: 30 }, { u: 'shark', r: 2000, g: 50 }])
      const r = await resolveJoinRankGate({
        leagueId: 'L', userId: 'shark', skillBoard: sb,
        prismaLike: createMockPrisma({ listing, profile: { xpLevel: 7 }, settings: exceptionFor('shark') }) as any,
      })
      expect(r).toMatchObject({ basis: 'skill', allowed: true, bypassed: true, reason: 'COMMISSIONER_EXCEPTION' })
    })
  })
})
