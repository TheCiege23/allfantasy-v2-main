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

  it('🛑 keeps a SHORT ttl, because the TTL is the only thing that surfaces a new import', () => {
    /*
     * The data itself would tolerate hours — career.ts has no clock and a season is settled history.
     * The bound is the invalidation gap, not the volatility: with no league sweep available for a
     * user-scoped key, a freshly connected league appears only when the TTL lapses, and an import is
     * exactly when someone opens this screen. If someone later "optimises" this to hours, this fails.
     */
    const d = getScreenSummaryDefinition(CAREER_SCREEN)!
    expect(d.ttlMs).toBeLessThanOrEqual(5 * 60_000)
  })

  it('🛑 is cacheable at all ONLY because career.ts has no clock in it', () => {
    // The rule that disqualified home/dash34: cache a payload derived from rows, never one with a
    // clock rendered into it. getCareerData(userId, platformFilter) takes no `now`.
    const src = readFileSync(resolve(process.cwd(), 'lib/core-app/career.ts'), 'utf8')
    expect(src).not.toMatch(/\bnew Date\(\)/)
    expect(src).not.toMatch(/\bDate\.now\(\)/)
  })

  it('builds on a miss and serves the second read from cache', async () => {
    const first = await readCareerSummary('u1', null)
    expect(first).toMatchObject({ data: BOARD, source: 'live' })
    expect((await readCareerSummary('u1', null))!.source).toBe('cache')
    expect(getCareerData).toHaveBeenCalledTimes(1)
  })

  it('🛑 keys on the PLATFORM FILTER — two filters are two different boards', async () => {
    await readCareerSummary('u1', null)
    await readCareerSummary('u1', 'sleeper')
    await readCareerSummary('u1', 'espn')
    expect(getCareerData).toHaveBeenCalledTimes(3)
    expect(getCareerData.mock.calls.map((c) => c[1])).toEqual([null, 'sleeper', 'espn'])

    // ...and a repeat of one already built is a hit.
    await readCareerSummary('u1', 'sleeper')
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
    await readCareerSummary('u1', 'Sleeper')
    await readCareerSummary('u1', '  sleeper  ')
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
    await readCareerSummary('u1', null)
    await readCareerSummary('u2', null)
    expect(getCareerData).toHaveBeenCalledTimes(2)
  })

  it('is a no-op without a user, and never calls the loader', async () => {
    expect(await readCareerSummary('', null)).toBeNull()
    expect(getCareerData).not.toHaveBeenCalled()
  })
})
