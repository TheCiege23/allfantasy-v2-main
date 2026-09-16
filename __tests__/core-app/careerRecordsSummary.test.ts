import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const getCareerRecords = vi.fn()

vi.mock('@/lib/core-app/careerRecords', () => ({
  getCareerRecords: (...a: unknown[]) => getCareerRecords(...a),
}))
vi.mock('@/lib/sports-os/durableTier', () => ({ sportsDataCacheTier: () => null }))

const { readCareerRecordsSummary, CAREER_RECORDS_SCREEN } = await import(
  '@/lib/core-app/careerRecordsSummary'
)
const { __resetLayeredCacheForTests } = await import('@/lib/sports-os/layeredCache')
const { getScreenSummaryDefinition, screensInvalidatedBy } = await import('@/lib/sports-os/summaries')

const BOARD = { records: [{ key: 'best-week', value: '182.4' }], weeksCounted: 310, leaguesCounted: 7 }

describe('careerRecordsSummary', () => {
  beforeEach(() => {
    __resetLayeredCacheForTests()
    getCareerRecords.mockReset()
    getCareerRecords.mockResolvedValue(BOARD)
  })

  it('registers itself on import, with a stale window longer than its TTL', () => {
    const definition = getScreenSummaryDefinition(CAREER_RECORDS_SCREEN)
    expect(definition).not.toBeNull()
    expect(definition!.staleWhileRevalidateMs).toBeGreaterThan(definition!.ttlMs)
  })

  it('declares NO invalidating events, because a user-scoped key cannot be swept by league', () => {
    /*
     * 🛑 THE EMPTY LIST IS THE ASSERTION — weekAllSummary's reason, not seasonOutlookSummary's.
     * Career records span every league the account has ever played, so the key carries a userId and
     * no league id, while the sweep is a prefix match on `l=<leagueId>&`. Listing finalization
     * events would look like event-driven invalidation and be a silent no-op.
     */
    expect(getScreenSummaryDefinition(CAREER_RECORDS_SCREEN)!.invalidatedBy).toEqual([])
    expect(screensInvalidatedBy('competition.matchup.finalized')).not.toContain(CAREER_RECORDS_SCREEN)
    expect(screensInvalidatedBy('ingest.league.completed')).not.toContain(CAREER_RECORDS_SCREEN)
  })

  it('🛑 tolerates a LONG ttl only because the source has no clock in it', () => {
    /*
     * This is the assertion that stops the next session copying this TTL onto a surface that cannot
     * bear it. `careerRecords.ts` contains no `new Date()` and no `Date.now()`, so its output is a
     * pure function of completed rows — a career record changes when a week FINALIZES, never with
     * the passage of time.
     *
     * Contrast `dash34.ts`, which FOUNDATION.md had named as the next candidate: it takes a `now`
     * and renders it into the payload (`countdown`, `next24`, `reportedAgo`), so caching the
     * assembled result would serve a countdown that is wrong by however long the entry has sat.
     * That is why home is not on this layer and this screen is.
     */
    const src = readFileSync(resolve(process.cwd(), 'lib/core-app/careerRecords.ts'), 'utf8')
    expect(src).not.toMatch(/\bnew Date\(\)/)
    expect(src).not.toMatch(/\bDate\.now\(\)/)

    const definition = getScreenSummaryDefinition(CAREER_RECORDS_SCREEN)!
    expect(definition.ttlMs).toBeGreaterThanOrEqual(30 * 60_000)
  })

  it('builds on a miss and serves the second read from cache', async () => {
    const first = await readCareerRecordsSummary('u1')
    expect(first).toMatchObject({ data: BOARD, source: 'live' })

    const second = await readCareerRecordsSummary('u1')
    expect(second!.source).toBe('cache')
    expect(getCareerRecords).toHaveBeenCalledTimes(1)
  })

  it('does not share a board between two users', async () => {
    await readCareerRecordsSummary('u1')
    await readCareerRecordsSummary('u2')
    expect(getCareerRecords).toHaveBeenCalledTimes(2)
    expect(getCareerRecords.mock.calls.map((c) => c[0])).toEqual(['u1', 'u2'])
  })

  it('is a no-op without a user, and never calls the loader', async () => {
    expect(await readCareerRecordsSummary('')).toBeNull()
    expect(getCareerRecords).not.toHaveBeenCalled()
  })
})
