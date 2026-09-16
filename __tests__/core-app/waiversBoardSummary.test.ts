import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const getWaiversBoard = vi.fn()

vi.mock('@/lib/core-app/waiversBoard', () => ({
  getWaiversBoard: (...a: unknown[]) => getWaiversBoard(...a),
}))
vi.mock('@/lib/sports-os/durableTier', () => ({ sportsDataCacheTier: () => null }))

const { readWaiversBoardSummary, WAIVERS_BOARD_SCREEN } = await import(
  '@/lib/core-app/waiversBoardSummary'
)
const { __resetLayeredCacheForTests } = await import('@/lib/sports-os/layeredCache')
const { getScreenSummaryDefinition, screensInvalidatedBy } = await import('@/lib/sports-os/summaries')

const BOARD = { leagues: [{ id: 'L1', claims: 2 }] }

describe('waiversBoardSummary', () => {
  beforeEach(() => {
    __resetLayeredCacheForTests()
    getWaiversBoard.mockReset()
    getWaiversBoard.mockResolvedValue(BOARD)
  })

  it('registers itself on import, with a stale window longer than its TTL', () => {
    const d = getScreenSummaryDefinition(WAIVERS_BOARD_SCREEN)
    expect(d).not.toBeNull()
    expect(d!.staleWhileRevalidateMs).toBeGreaterThan(d!.ttlMs)
  })

  it('declares NO invalidating events, because a user-scoped key cannot be swept by league', () => {
    expect(getScreenSummaryDefinition(WAIVERS_BOARD_SCREEN)!.invalidatedBy).toEqual([])
    expect(screensInvalidatedBy('ingest.league.completed')).not.toContain(WAIVERS_BOARD_SCREEN)
  })

  it('🛑 is cacheable at all ONLY because waiversBoard.ts has no clock in it', () => {
    // The entry criterion. Waivers are the most clock-ADJACENT screen to pass it: the deadline is a
    // stored instant on league settings, not something this function renders against `now`.
    const src = readFileSync(resolve(process.cwd(), 'lib/core-app/waiversBoard.ts'), 'utf8')
    expect(src).not.toMatch(/\bnew Date\(\)/)
    expect(src).not.toMatch(/\bDate\.now\(\)/)
  })

  it('🛑 keeps the SHORTEST ttl of the user-scoped boards — staleness here changes what a user DOES', () => {
    /*
     * The other user-scoped boards sit at five minutes: a trade or import landing late costs
     * nothing. A reader here is usually checking against a waiver deadline and deciding whether to
     * bid, so a five-minute-old claim list could change their action, not just their reading. If
     * someone later "harmonises" this to match the others, this fails.
     */
    const d = getScreenSummaryDefinition(WAIVERS_BOARD_SCREEN)!
    expect(d.ttlMs).toBeLessThanOrEqual(2 * 60_000)
  })

  it('builds on a miss and serves the second read from cache', async () => {
    const first = await readWaiversBoardSummary('u1')
    expect(first).toMatchObject({ data: BOARD, source: 'live' })
    expect((await readWaiversBoardSummary('u1'))!.source).toBe('cache')
    expect(getWaiversBoard).toHaveBeenCalledTimes(1)
  })

  it('does not share a board between two users', async () => {
    await readWaiversBoardSummary('u1')
    await readWaiversBoardSummary('u2')
    expect(getWaiversBoard).toHaveBeenCalledTimes(2)
    expect(getWaiversBoard.mock.calls.map((c) => c[0])).toEqual(['u1', 'u2'])
  })

  it('is a no-op without a user, and never calls the loader', async () => {
    expect(await readWaiversBoardSummary('')).toBeNull()
    expect(getWaiversBoard).not.toHaveBeenCalled()
  })
})
