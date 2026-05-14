/**
 * Tests for lib/league/bracketPoolGuard.ts
 *
 * Verifies that /league/[id] correctly redirects bracket pool IDs to
 * /brackets/leagues/[id] and leaves normal fantasy league IDs alone.
 *
 * Also covers canonicalizeProductRoute behaviour for bracket paths
 * (ensures the source of the routing mismatch cannot regress).
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { canonicalizeProductRoute } from '@/lib/routing/canonicalizeProductRoute'

// ---------------------------------------------------------------------------
// Prisma mock
// ---------------------------------------------------------------------------
const hm = vi.hoisted(() => ({
  bracketLeagueFindUnique: vi.fn(),
  playoffBracketChallengeFindUnique: vi.fn(),
  worldCupBracketChallengeFindUnique: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    bracketLeague: { findUnique: hm.bracketLeagueFindUnique },
    playoffBracketChallenge: { findUnique: hm.playoffBracketChallengeFindUnique },
    worldCupBracketChallenge: { findUnique: hm.worldCupBracketChallengeFindUnique },
  },
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function resolveGuard(leagueId: string) {
  const { resolveBracketPoolRedirectUrl } = await import('@/lib/league/bracketPoolGuard')
  return resolveBracketPoolRedirectUrl(leagueId)
}

// ---------------------------------------------------------------------------
// resolveBracketPoolRedirectUrl
// ---------------------------------------------------------------------------

describe('resolveBracketPoolRedirectUrl — BracketLeague (UUID pools)', () => {
  beforeEach(() => {
    vi.resetModules()
    hm.bracketLeagueFindUnique.mockReset()
    hm.playoffBracketChallengeFindUnique.mockReset()
    hm.worldCupBracketChallengeFindUnique.mockReset()
  })

  it('returns redirect URL when ID is found in BracketLeague', async () => {
    hm.bracketLeagueFindUnique.mockResolvedValue({ id: '3647f901-bed1-4508-b408-f265502ff492' })
    const result = await resolveGuard('3647f901-bed1-4508-b408-f265502ff492')
    expect(result).toBe('/brackets/leagues/3647f901-bed1-4508-b408-f265502ff492')
    // Short-circuits — other tables not queried
    expect(hm.playoffBracketChallengeFindUnique).not.toHaveBeenCalled()
    expect(hm.worldCupBracketChallengeFindUnique).not.toHaveBeenCalled()
  })

  it('falls through to PlayoffBracketChallenge when BracketLeague returns null', async () => {
    hm.bracketLeagueFindUnique.mockResolvedValue(null)
    hm.playoffBracketChallengeFindUnique.mockResolvedValue({ id: 'cmp4sakbp0002tzse3a97gof6' })
    const result = await resolveGuard('cmp4sakbp0002tzse3a97gof6')
    expect(result).toBe('/brackets/leagues/cmp4sakbp0002tzse3a97gof6')
    expect(hm.worldCupBracketChallengeFindUnique).not.toHaveBeenCalled()
  })

  it('falls through to WorldCupBracketChallenge when first two return null', async () => {
    hm.bracketLeagueFindUnique.mockResolvedValue(null)
    hm.playoffBracketChallengeFindUnique.mockResolvedValue(null)
    hm.worldCupBracketChallengeFindUnique.mockResolvedValue({ id: 'cmp_wc_001' })
    const result = await resolveGuard('cmp_wc_001')
    expect(result).toBe('/brackets/leagues/cmp_wc_001')
  })

  it('returns null when ID is not found in any bracket table (normal fantasy league ID)', async () => {
    hm.bracketLeagueFindUnique.mockResolvedValue(null)
    hm.playoffBracketChallengeFindUnique.mockResolvedValue(null)
    hm.worldCupBracketChallengeFindUnique.mockResolvedValue(null)
    const result = await resolveGuard('some-normal-league-id')
    expect(result).toBeNull()
  })
})

describe('resolveBracketPoolRedirectUrl — error handling', () => {
  beforeEach(() => {
    vi.resetModules()
    hm.bracketLeagueFindUnique.mockReset()
    hm.playoffBracketChallengeFindUnique.mockReset()
    hm.worldCupBracketChallengeFindUnique.mockReset()
  })

  it('suppresses P2021 missing-table error on BracketLeague and continues', async () => {
    const p2021 = Object.assign(new Error('Table not found'), { code: 'P2021' })
    hm.bracketLeagueFindUnique.mockRejectedValue(p2021)
    hm.playoffBracketChallengeFindUnique.mockResolvedValue({ id: 'cmp4sakbp0002tzse3a97gof6' })
    const result = await resolveGuard('cmp4sakbp0002tzse3a97gof6')
    expect(result).toBe('/brackets/leagues/cmp4sakbp0002tzse3a97gof6')
  })

  it('suppresses "does not exist in the current database" message and continues', async () => {
    const missingErr = new Error('Table does not exist in the current database')
    hm.bracketLeagueFindUnique.mockRejectedValue(missingErr)
    hm.playoffBracketChallengeFindUnique.mockRejectedValue(missingErr)
    hm.worldCupBracketChallengeFindUnique.mockRejectedValue(missingErr)
    const result = await resolveGuard('any-id')
    expect(result).toBeNull()
  })

  it('re-throws unexpected Prisma errors (e.g. connection failure)', async () => {
    const connErr = new Error('Connection refused')
    hm.bracketLeagueFindUnique.mockRejectedValue(connErr)
    await expect(resolveGuard('any-id')).rejects.toThrow('Connection refused')
  })
})

// ---------------------------------------------------------------------------
// isBracketPoolTableMissingError
// ---------------------------------------------------------------------------

describe('isBracketPoolTableMissingError', () => {
  it('detects P2021', async () => {
    const { isBracketPoolTableMissingError } = await import('@/lib/league/bracketPoolGuard')
    expect(isBracketPoolTableMissingError({ code: 'P2021' })).toBe(true)
  })

  it('detects "does not exist in the current database" string', async () => {
    const { isBracketPoolTableMissingError } = await import('@/lib/league/bracketPoolGuard')
    expect(
      isBracketPoolTableMissingError(
        new Error('relation "bracket_leagues" does not exist in the current database'),
      ),
    ).toBe(true)
  })

  it('does not classify connection errors as missing-table', async () => {
    const { isBracketPoolTableMissingError } = await import('@/lib/league/bracketPoolGuard')
    expect(isBracketPoolTableMissingError(new Error('ECONNREFUSED'))).toBe(false)
    expect(isBracketPoolTableMissingError(null)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// canonicalizeProductRoute — bracket paths must never map to /league/:id
// (regression guard for the root cause of the routing mismatch)
// ---------------------------------------------------------------------------

describe('canonicalizeProductRoute — bracket pool paths preserved', () => {
  it('preserves /brackets/leagues/:id — must not produce /league/:id', () => {
    expect(canonicalizeProductRoute('/brackets/leagues/3647f901-bed1-4508-b408-f265502ff492')).toBe(
      '/brackets/leagues/3647f901-bed1-4508-b408-f265502ff492',
    )
  })

  it('preserves /brackets/leagues/:cuid', () => {
    expect(canonicalizeProductRoute('/brackets/leagues/cmp4sakbp0002tzse3a97gof6')).toBe(
      '/brackets/leagues/cmp4sakbp0002tzse3a97gof6',
    )
  })

  it('normalises /bracket/leagues/:id (singular) to /brackets/leagues/:id — not /league/:id', () => {
    expect(canonicalizeProductRoute('/bracket/leagues/3647f901-bed1-4508-b408-f265502ff492')).toBe(
      '/brackets/leagues/3647f901-bed1-4508-b408-f265502ff492',
    )
  })

  it('keeps /brackets path as-is', () => {
    expect(canonicalizeProductRoute('/brackets')).toBe('/brackets')
  })

  it('still maps /leagues/:id (plural, no brackets) to /league/:id', () => {
    expect(canonicalizeProductRoute('/leagues/season-9')).toBe('/league/season-9')
  })

  it('maps external URLs and /api paths to /dashboard', () => {
    expect(canonicalizeProductRoute('https://evil.example/x')).toBe('/dashboard')
    expect(canonicalizeProductRoute('/api/auth/session')).toBe('/dashboard')
  })
})
