import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const getCareerData = vi.fn()

vi.mock('@/lib/core-app/career', () => ({ getCareerData: (...a: unknown[]) => getCareerData(...a) }))
vi.mock('@/lib/sports-os/durableTier', () => ({ sportsDataCacheTier: () => null }))

const { readCareerSummary, CAREER_SCREEN } = await import('@/lib/core-app/careerSummary')
const { __resetLayeredCacheForTests } = await import('@/lib/sports-os/layeredCache')
const { getScreenSummaryDefinition, screensInvalidatedBy, scopeKey } = await import(
  '@/lib/sports-os/summaries'
)

const BOARD = { seasons: [{ year: 2024 }], prestige: 71 }

/** Two league lists that differ only in `lastSyncedAt` — i.e. exactly what a finished sync does. */
const ROWS_BEFORE = [{ id: 'L1', name: 'A', platform: 'sleeper', lastSyncedAt: new Date('2026-09-16T10:00:00Z') }] as never
const ROWS_AFTER = [{ id: 'L1', name: 'A', platform: 'sleeper', lastSyncedAt: new Date('2026-09-16T11:00:00Z') }] as never


describe('careerSummary', () => {
  beforeEach(() => {
    __resetLayeredCacheForTests()
    getCareerData.mockReset()
    getCareerData.mockResolvedValue(BOARD)
  })

  it('registers itself on import, with a stale window longer than its TTL', () => {
    const d = getScreenSummaryDefinition(CAREER_SCREEN)
    expect(d).not.toBeNull()
    expect(d!.staleWhileRevalidateMs).toBeGreaterThan(d!.ttlMs)
  })

  it('declares NO invalidating events, because a user-scoped key cannot be swept by league', () => {
    expect(getScreenSummaryDefinition(CAREER_SCREEN)!.invalidatedBy).toEqual([])
    expect(screensInvalidatedBy('ingest.league.completed')).not.toContain(CAREER_SCREEN)
  })

  it('🛑 the fingerprint REPLACED the short ttl — and the ttl must not be short any more', async () => {
    /*
     * This test used to pin the TTL at or below five minutes, because the TTL was the only thing
     * that would surface a newly imported league on a user-scoped key. The fingerprint now does
     * that precisely, so a short TTL here is no longer protection — it is just extra rebuilds.
     * Inverting the assertion is the point: if someone "restores" the five-minute TTL without
     * removing the fingerprint, they have reintroduced the cost without the reason.
     */
    const d = getScreenSummaryDefinition(CAREER_SCREEN)!
    expect(d.ttlMs).toBeGreaterThan(5 * 60_000)

    // And the mechanism that justifies it: a changed league list is a different key, so a rebuild.
    await readCareerSummary('u1', null, ROWS_BEFORE)
    await readCareerSummary('u1', null, ROWS_AFTER)
    expect(getCareerData).toHaveBeenCalledTimes(2)
  })

  it('🛑 a sync that only moves lastSyncedAt still forces a rebuild', async () => {
    // The whole point: no writer invalidates anything, and no event is plumbed. The digest changes
    // because the row changed, so the key changes, so the read misses.
    await readCareerSummary('u1', null, ROWS_BEFORE)
    expect(getCareerData).toHaveBeenCalledTimes(1)
    await readCareerSummary('u1', null, ROWS_BEFORE)
    expect(getCareerData).toHaveBeenCalledTimes(1) // unchanged list -> hit
    await readCareerSummary('u1', null, ROWS_AFTER)
    expect(getCareerData).toHaveBeenCalledTimes(2) // moved lastSyncedAt -> miss
  })

  it('🛑 is cacheable at all ONLY because career.ts has no clock in it', () => {
    // The rule that disqualified home/dash34: cache a payload derived from rows, never one with a
    // clock rendered into it. getCareerData(userId, platformFilter) takes no `now`.
    const src = readFileSync(resolve(process.cwd(), 'lib/core-app/career.ts'), 'utf8')
    expect(src).not.toMatch(/\bnew Date\(\)/)
    expect(src).not.toMatch(/\bDate\.now\(\)/)
  })

  it('builds on a miss and serves the second read from cache', async () => {
    const first = await readCareerSummary('u1', null, ROWS_BEFORE)
    expect(first).toMatchObject({ data: BOARD, source: 'live' })
    expect((await readCareerSummary('u1', null, ROWS_BEFORE))!.source).toBe('cache')
    expect(getCareerData).toHaveBeenCalledTimes(1)
  })

  it('🛑 keys on the PLATFORM FILTER — two filters are two different boards', async () => {
    await readCareerSummary('u1', null, ROWS_BEFORE)
    await readCareerSummary('u1', 'sleeper', ROWS_BEFORE)
    await readCareerSummary('u1', 'espn', ROWS_BEFORE)
    expect(getCareerData).toHaveBeenCalledTimes(3)
    expect(getCareerData.mock.calls.map((c) => c[1])).toEqual([null, 'sleeper', 'espn'])

    // ...and a repeat of one already built is a hit.
    await readCareerSummary('u1', 'sleeper', ROWS_BEFORE)
    expect(getCareerData).toHaveBeenCalledTimes(3)
  })

  it('🛑 folds case identically in the KEY and in the BUILDER, so they cannot drift apart', async () => {
    /*
     * This is the failure with no symptom until someone switches the dropdown. `getCareerData` folds
     * with `.trim().toLowerCase() || null`. If the key folded and the builder did not (or vice
     * versa), `?platform=Sleeper` and `?platform=sleeper` would share one entry while being computed
     * as two different reads — a key and its payload disagreeing.
     *
     * Asserted from BOTH ends: one build for the two spellings, and the builder receiving the folded
     * value rather than the raw one.
     */
    await readCareerSummary('u1', 'Sleeper', ROWS_BEFORE)
    await readCareerSummary('u1', '  sleeper  ', ROWS_BEFORE)
    expect(getCareerData).toHaveBeenCalledTimes(1)
    expect(getCareerData.mock.calls[0]![1]).toBe('sleeper')

    // And the key itself folds, independently of the reader.
    expect(scopeKey({ userId: 'u1', platform: 'Sleeper' })).toBe(
      scopeKey({ userId: 'u1', platform: 'sleeper' }),
    )
  })

  it('🛑 adding `platform` to the scope did not disturb the keys of the four live screens', () => {
    /*
     * `push` skips a null/undefined value entirely, so a screen that never sets `platform` must emit
     * the byte-identical key it emitted before the field existed. If this breaks, every summary
     * already on main silently loses its cache on deploy.
     */
    expect(scopeKey({ leagueId: 'L1', userId: 'u1' })).toBe('l=L1&u=u1&')
    expect(scopeKey({ userId: 'u1' })).toBe('u=u1&')
    expect(scopeKey({ userId: 'u1', platform: null })).toBe('u=u1&')
    expect(scopeKey({ userId: 'u1', platform: undefined })).toBe('u=u1&')
  })

  it('does not share a board between two users', async () => {
    await readCareerSummary('u1', null, ROWS_BEFORE)
    await readCareerSummary('u2', null, ROWS_BEFORE)
    expect(getCareerData).toHaveBeenCalledTimes(2)
  })

  it('is a no-op without a user, and never calls the loader', async () => {
    expect(await readCareerSummary('', null, ROWS_BEFORE)).toBeNull()
    expect(getCareerData).not.toHaveBeenCalled()
  })
})
