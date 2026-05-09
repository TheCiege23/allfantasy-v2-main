/**
 * getViewerAutopickPreference — read helper (mocked Prisma + EntitlementResolver).
 *
 * Contract:
 * - No row → defaults { enabled: false, mode: 'standard', updatedAt: null } + isProEligible from entitlement.
 * - Row present → row's enabled/mode/updatedAt + isProEligible from entitlement.
 * - Row says ai_queue but entitlement says false → mode downgraded to 'standard' (DB row untouched).
 * - Prisma error → defaults, never throws.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const ctx = vi.hoisted(() => {
  const findUnique = vi.fn(async (_args: unknown) => null as null | { enabled: boolean; mode: string; updatedAt: Date })
  return {
    prisma: {
      liveDraftAutopickPreference: { findUnique },
      draftSession: { findUnique: vi.fn(async () => ({ id: 'session-1' })) },
    },
    findUnique,
  }
})

const entitlement = vi.hoisted(() => ({
  resolveForUser: vi.fn(async () => ({ hasAccess: false })),
}))

vi.mock('@/lib/prisma', () => ({ prisma: ctx.prisma }))

vi.mock('@/lib/subscription/EntitlementResolver', () => ({
  EntitlementResolver: class {
    resolveForUser(...args: [string, string]) {
      return entitlement.resolveForUser(...args)
    }
  },
}))

const { getViewerAutopickPreference, getViewerAutopickPreferenceForLeague } = await import(
  '@/lib/live-draft-engine/LiveDraftAutopickPreferenceService'
)

describe('getViewerAutopickPreference', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ctx.findUnique.mockResolvedValue(null)
    entitlement.resolveForUser.mockResolvedValue({ hasAccess: false } as { hasAccess: boolean })
  })

  describe('no row exists', () => {
    it('returns defaults when no row + no Pro entitlement', async () => {
      const result = await getViewerAutopickPreference('session-1', 'user-1')
      expect(result).toEqual({
        enabled: false,
        mode: 'standard',
        isProEligible: false,
        updatedAt: null,
      })
    })

    it('reflects isProEligible=true when entitlement grants pro_draft_ai', async () => {
      entitlement.resolveForUser.mockResolvedValue({ hasAccess: true } as { hasAccess: boolean })
      const result = await getViewerAutopickPreference('session-1', 'user-1')
      expect(result.isProEligible).toBe(true)
      expect(result.enabled).toBe(false)
      expect(result.mode).toBe('standard')
    })

    it('queries the EntitlementResolver with the pro_draft_ai feature id', async () => {
      await getViewerAutopickPreference('session-1', 'user-1')
      expect(entitlement.resolveForUser).toHaveBeenCalledWith('user-1', 'pro_draft_ai')
    })
  })

  describe('row exists', () => {
    it('returns the row values when Pro is eligible', async () => {
      const updatedAt = new Date('2026-05-09T01:00:00.000Z')
      ctx.findUnique.mockResolvedValue({ enabled: true, mode: 'ai_queue', updatedAt })
      entitlement.resolveForUser.mockResolvedValue({ hasAccess: true } as { hasAccess: boolean })

      const result = await getViewerAutopickPreference('session-1', 'user-1')
      expect(result).toEqual({
        enabled: true,
        mode: 'ai_queue',
        isProEligible: true,
        updatedAt: '2026-05-09T01:00:00.000Z',
      })
    })

    it('returns standard mode unchanged regardless of entitlement', async () => {
      ctx.findUnique.mockResolvedValue({
        enabled: true,
        mode: 'standard',
        updatedAt: new Date('2026-05-09T02:00:00.000Z'),
      })
      const result = await getViewerAutopickPreference('session-1', 'user-1')
      expect(result.mode).toBe('standard')
      expect(result.enabled).toBe(true)
    })

    it('downgrades ai_queue → standard at read time when entitlement no longer grants Pro', async () => {
      ctx.findUnique.mockResolvedValue({
        enabled: true,
        mode: 'ai_queue',
        updatedAt: new Date('2026-05-09T01:00:00.000Z'),
      })
      entitlement.resolveForUser.mockResolvedValue({ hasAccess: false } as { hasAccess: boolean })

      const result = await getViewerAutopickPreference('session-1', 'user-1')
      expect(result.mode).toBe('standard')
      expect(result.isProEligible).toBe(false)
      // enabled flag is preserved — downgrade only affects mode
      expect(result.enabled).toBe(true)
    })

    it('queries with the correct unique key shape', async () => {
      await getViewerAutopickPreference('session-xyz', 'user-abc')
      expect(ctx.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { draft_session_user_unique: { draftSessionId: 'session-xyz', userId: 'user-abc' } },
        }),
      )
    })
  })

  describe('error handling', () => {
    it('returns defaults when Prisma throws (never propagates)', async () => {
      ctx.findUnique.mockRejectedValue(new Error('connection lost'))
      const result = await getViewerAutopickPreference('session-1', 'user-1')
      expect(result).toEqual({
        enabled: false,
        mode: 'standard',
        isProEligible: false,
        updatedAt: null,
      })
    })

    it('returns defaults when EntitlementResolver throws', async () => {
      entitlement.resolveForUser.mockRejectedValue(new Error('entitlement service down'))
      const result = await getViewerAutopickPreference('session-1', 'user-1')
      expect(result.isProEligible).toBe(false)
      expect(result.enabled).toBe(false)
    })
  })
})

describe('getViewerAutopickPreferenceForLeague', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ctx.findUnique.mockResolvedValue(null)
    entitlement.resolveForUser.mockResolvedValue({ hasAccess: false } as { hasAccess: boolean })
    ctx.prisma.draftSession.findUnique.mockResolvedValue({ id: 'session-1' })
  })

  it('returns defaults when there is no draft session for the league', async () => {
    ctx.prisma.draftSession.findUnique.mockResolvedValue(null as unknown as { id: string })
    const result = await getViewerAutopickPreferenceForLeague('league-empty', 'user-1')
    expect(result.enabled).toBe(false)
    expect(result.mode).toBe('standard')
    expect(result.updatedAt).toBeNull()
  })

  it('resolves draft session id then delegates to per-session lookup', async () => {
    ctx.prisma.draftSession.findUnique.mockResolvedValue({ id: 'session-from-league' })
    ctx.findUnique.mockResolvedValue({
      enabled: true,
      mode: 'standard',
      updatedAt: new Date('2026-05-09T03:00:00.000Z'),
    })
    const result = await getViewerAutopickPreferenceForLeague('league-1', 'user-1')
    expect(result.enabled).toBe(true)
    expect(ctx.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { draft_session_user_unique: { draftSessionId: 'session-from-league', userId: 'user-1' } },
      }),
    )
  })
})
