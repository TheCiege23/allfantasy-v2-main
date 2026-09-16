import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const getPortfolio = vi.fn()

vi.mock('@/lib/core-app/portfolio', () => ({
  getPortfolio: (...a: unknown[]) => getPortfolio(...a),
}))
vi.mock('@/lib/sports-os/durableTier', () => ({ sportsDataCacheTier: () => null }))

const { readPortfolioSummary, PORTFOLIO_SCREEN } = await import('@/lib/core-app/portfolioSummary')
const { __resetLayeredCacheForTests } = await import('@/lib/sports-os/layeredCache')
const { getScreenSummaryDefinition, screensInvalidatedBy, scopeKey } = await import(
  '@/lib/sports-os/summaries'
)

const INVENTORY = {
  leagues: { available: true, data: [{ leagueId: 'L1', leagueName: 'A' }] },
  commissionedCount: 1,
}

/** Two league lists that differ only in `lastSyncedAt` — i.e. exactly what a finished sync does. */
const ROWS_BEFORE = [
  { id: 'L1', name: 'A', platform: 'sleeper', lastSyncedAt: new Date('2026-09-16T10:00:00Z') },
] as never
const ROWS_AFTER = [
  { id: 'L1', name: 'A', platform: 'sleeper', lastSyncedAt: new Date('2026-09-16T11:00:00Z') },
] as never
/** A league the account did not have before — an import, rather than a sync of what it had. */
const ROWS_PLUS_ONE = [
  { id: 'L1', name: 'A', platform: 'sleeper', lastSyncedAt: new Date('2026-09-16T10:00:00Z') },
  { id: 'L2', name: 'B', platform: 'espn', lastSyncedAt: new Date('2026-09-16T10:00:00Z') },
] as never

describe('portfolioSummary', () => {
  beforeEach(() => {
    __resetLayeredCacheForTests()
    getPortfolio.mockReset()
    getPortfolio.mockResolvedValue(INVENTORY)
  })

  it('registers itself on import, with a stale window longer than its TTL', () => {
    const d = getScreenSummaryDefinition(PORTFOLIO_SCREEN)
    expect(d).not.toBeNull()
    expect(d!.staleWhileRevalidateMs).toBeGreaterThan(d!.ttlMs)
  })

  it('declares NO invalidating events, because a user-scoped key cannot be swept by league', () => {
    expect(getScreenSummaryDefinition(PORTFOLIO_SCREEN)!.invalidatedBy).toEqual([])
    expect(screensInvalidatedBy('ingest.league.completed')).not.toContain(PORTFOLIO_SCREEN)
  })

  it('🛑 is cacheable at all ONLY because portfolio.ts has no clock in it', () => {
    // The entry criterion, asserted against the source rather than trusted. An inventory changes
    // when an import runs, not when time passes — the same property that made `career` cacheable.
    const src = readFileSync(resolve(process.cwd(), 'lib/core-app/portfolio.ts'), 'utf8')
    expect(src).not.toMatch(/\bnew Date\(\)/)
    expect(src).not.toMatch(/\bDate\.now\(\)/)
  })

  it('builds on a miss and serves the second read from cache', async () => {
    const first = await readPortfolioSummary('u1', ROWS_BEFORE)
    expect(first).toMatchObject({ data: INVENTORY, source: 'live' })
    expect((await readPortfolioSummary('u1', ROWS_BEFORE))!.source).toBe('cache')
    expect(getPortfolio).toHaveBeenCalledTimes(1)
  })

  it('🛑 a sync that only moves lastSyncedAt forces a rebuild, with no event plumbed', async () => {
    await readPortfolioSummary('u1', ROWS_BEFORE)
    expect(getPortfolio).toHaveBeenCalledTimes(1)
    await readPortfolioSummary('u1', ROWS_BEFORE)
    expect(getPortfolio).toHaveBeenCalledTimes(1) // unchanged list -> hit
    await readPortfolioSummary('u1', ROWS_AFTER)
    expect(getPortfolio).toHaveBeenCalledTimes(2) // moved lastSyncedAt -> miss
  })

  it('🛑 an IMPORTED league rebuilds it too — the case the TTL used to be carrying', async () => {
    /*
     * The sync case above and this one are different events reaching the same mechanism, and this
     * is the one that mattered: an import is precisely when someone opens this screen, and a
     * user-scoped key has no league id for the sweep to match. A longer list is a different digest.
     */
    await readPortfolioSummary('u1', ROWS_BEFORE)
    await readPortfolioSummary('u1', ROWS_PLUS_ONE)
    expect(getPortfolio).toHaveBeenCalledTimes(2)
  })

  it('🛑 the TTL is NOT waivers-short — the digest covers this board rather than proxying it', () => {
    /*
     * Waivers keeps two minutes because a claim changes with nothing about the league list moving,
     * so its digest cannot see the change. Nothing on this screen has that property: every field is
     * derived from rows a sync writes, and a sync moves `lastSyncedAt`. Copying waivers' number
     * here would be paying for a guarantee the fingerprint already gives — this fails if someone
     * "harmonises" it down.
     */
    expect(getScreenSummaryDefinition(PORTFOLIO_SCREEN)!.ttlMs).toBeGreaterThan(5 * 60_000)
  })

  it('does not share an inventory between two users', async () => {
    await readPortfolioSummary('u1', ROWS_BEFORE)
    await readPortfolioSummary('u2', ROWS_BEFORE)
    expect(getPortfolio).toHaveBeenCalledTimes(2)
    expect(getPortfolio.mock.calls.map((c) => c[0])).toEqual(['u1', 'u2'])
  })

  it('🛑 the BUILDER takes the user off the scope, so the key and the payload agree', async () => {
    // The module header explains why the two side panels are NOT summarised here: their inputs
    // cannot live in a scope, and a builder that re-resolved them could file one portfolio's data
    // under another's key. The half that IS summarised must not do that either.
    await readPortfolioSummary('u7', ROWS_BEFORE)
    expect(getPortfolio.mock.calls[0]![0]).toBe('u7')
  })

  it('🛑 the fingerprint is the LAST key segment, so no-fingerprint keys are unchanged', () => {
    // Pins the property that let `fingerprint` be added to the shared scope without dropping every
    // live summary's cache on deploy: a scope that sets none emits a byte-identical key.
    expect(scopeKey({ userId: 'u1' })).toBe('u=u1&')
    expect(scopeKey({ userId: 'u1', fingerprint: 'abc' })).toBe('u=u1&fp=abc&')
  })

  it('is a no-op without a user, and never calls the loader', async () => {
    expect(await readPortfolioSummary('', ROWS_BEFORE)).toBeNull()
    expect(getPortfolio).not.toHaveBeenCalled()
  })
})
