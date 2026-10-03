import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const getTradesBoard = vi.fn()

vi.mock('@/lib/core-app/tradesBoard', () => ({
  getTradesBoard: (...a: unknown[]) => getTradesBoard(...a),
}))
vi.mock('@/lib/sports-os/durableTier', () => ({ sportsDataCacheTier: () => null }))

/** The input digest query. Each test sets what the board's rows look like; a rejection is a failed read. */
const queryRaw = vi.fn()
vi.mock('@/lib/prisma', () => ({ prisma: { $queryRaw: (...a: unknown[]) => queryRaw(...a) } }))
const digestRow = (trades: string) => [{ claimed: '95:abc', trades, pending: '0:' }]

const { readTradesBoardSummary, TRADES_BOARD_SCREEN, tradesBoardFingerprint } = await import(
  '@/lib/core-app/tradesBoardSummary'
)
const { __resetLayeredCacheForTests } = await import('@/lib/sports-os/layeredCache')
const { getScreenSummaryDefinition, screensInvalidatedBy } = await import('@/lib/sports-os/summaries')

const BOARD = { trades: [{ id: 't1' }], leaguesCounted: 4 }

/** Two league lists that differ only in `lastSyncedAt` — i.e. exactly what a finished sync does. */
const ROWS_BEFORE = [{ id: 'L1', name: 'A', platform: 'sleeper', lastSyncedAt: new Date('2026-09-16T10:00:00Z') }] as never
const ROWS_AFTER = [{ id: 'L1', name: 'A', platform: 'sleeper', lastSyncedAt: new Date('2026-09-16T11:00:00Z') }] as never
/** A newly imported league — the case the fingerprint was introduced for. */
const ROWS_IMPORTED = [
  { id: 'L1', name: 'A', platform: 'sleeper', lastSyncedAt: new Date('2026-09-16T11:00:00Z') },
  { id: 'L2', name: 'B', platform: 'sleeper', lastSyncedAt: new Date('2026-09-16T11:00:00Z') },
] as never


describe('tradesBoardSummary', () => {
  beforeEach(() => {
    __resetLayeredCacheForTests()
    getTradesBoard.mockReset()
    getTradesBoard.mockResolvedValue(BOARD)
    queryRaw.mockReset()
    queryRaw.mockResolvedValue(digestRow('733:t1'))
  })

  it('registers itself on import, with a stale window longer than its TTL', () => {
    const d = getScreenSummaryDefinition(TRADES_BOARD_SCREEN)
    expect(d).not.toBeNull()
    expect(d!.staleWhileRevalidateMs).toBeGreaterThan(d!.ttlMs)
  })

  it('declares NO invalidating events, because a user-scoped key cannot be swept by league', () => {
    expect(getScreenSummaryDefinition(TRADES_BOARD_SCREEN)!.invalidatedBy).toEqual([])
    expect(screensInvalidatedBy('ingest.league.completed')).not.toContain(TRADES_BOARD_SCREEN)
  })

  it('🛑 is cacheable at all ONLY because tradesBoard.ts has no clock in it', () => {
    // The entry criterion: cache a payload derived from rows, never one with a clock rendered in.
    // getTradesBoard(userId, currentWeek) takes a NUMBER, not a `now`.
    //
    // 🛑 COMMENTS ARE STRIPPED FIRST, AND THAT IS NOT A LOOSENING. This asserts on SOURCE, so
    // it cannot tell a clock call from prose ABOUT one — and the moment that file explains why
    // it has no clock, it names the very tokens matched here and the guard fails the fix for
    // documenting itself. CLAUDE.md records the same trap in `push-queue.mjs`, where a test
    // for a removed statement matched the comment that explained the removal.
    const raw = readFileSync(resolve(process.cwd(), 'lib/core-app/tradesBoard.ts'), 'utf8')
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

    // The stripper must not have eaten the file: a guard over an empty string cannot fail.
    expect(code).toMatch(/export async function getTradesBoard/)
    // ...and it must still catch a real clock, or it is only asserting that stripping worked.
    expect(`${code}\nconst injected = new Date()`).toMatch(/\bnew Date\(\)/)

    expect(code).not.toMatch(/\bnew Date\(\)/)
    expect(code).not.toMatch(/\bDate\.now\(\)/)
  })

  it('builds on a miss and serves the second read from cache', async () => {
    const first = await readTradesBoardSummary('u1', 3, ROWS_BEFORE)
    expect(first).toMatchObject({ data: BOARD, source: 'live' })
    expect((await readTradesBoardSummary('u1', 3, ROWS_BEFORE))!.source).toBe('cache')
    expect(getTradesBoard).toHaveBeenCalledTimes(1)
  })

  it('🛑 keys on the WEEK — week 3 and week 4 are not the same board', async () => {
    await readTradesBoardSummary('u1', 3, ROWS_BEFORE)
    await readTradesBoardSummary('u1', 4, ROWS_BEFORE)
    expect(getTradesBoard).toHaveBeenCalledTimes(2)
    expect(getTradesBoard.mock.calls.map((c) => c[1])).toEqual([3, 4])

    await readTradesBoardSummary('u1', 3, ROWS_BEFORE)
    expect(getTradesBoard).toHaveBeenCalledTimes(2) // week 3 is a hit
  })

  it('🛑 treats "no week context" as its own scope, not as week 0 or as any week', async () => {
    /*
     * `resolveCurrentWeek` returns null when no league has a WeeklyMatchup row to resolve one from.
     * getTradesBoard handles that as "no week context" rather than erroring, so it is a real board —
     * and a different one from any numbered week. Folding null into a numbered key would serve a
     * no-context board to a week that has one.
     */
    await readTradesBoardSummary('u1', null, ROWS_BEFORE)
    await readTradesBoardSummary('u1', 3, ROWS_BEFORE)
    expect(getTradesBoard).toHaveBeenCalledTimes(2)
    expect(getTradesBoard.mock.calls[0]![1]).toBeNull()

    await readTradesBoardSummary('u1', null, ROWS_BEFORE)
    expect(getTradesBoard).toHaveBeenCalledTimes(2) // the null scope is a hit too
  })

  it('🛑 the BUILDER takes the week off the scope, so the key and the payload agree', async () => {
    // Re-resolving inside build() could return a different week than the key was built from, filing
    // one week's board under another week's key. The builder must receive exactly the keyed value.
    await readTradesBoardSummary('u1', 7, ROWS_BEFORE)
    expect(getTradesBoard.mock.calls[0]![1]).toBe(7)
  })

  it('🛑 a sync that only moves lastSyncedAt does NOT evict the board (2026-10-03)', async () => {
    // Production held 29 boards for one user and one week, one per sync-moved fingerprint, each a
    // ~30s cold build. A sync that imported nothing must leave the cached board where it is.
    await readTradesBoardSummary('u1', 3, ROWS_BEFORE)
    await readTradesBoardSummary('u1', 3, ROWS_AFTER)
    expect(getTradesBoard).toHaveBeenCalledTimes(1)
  })

  it('🛑 a sync that imports OR REWRITES a trade still forces a cold rebuild', async () => {
    await readTradesBoardSummary('u1', 3, ROWS_BEFORE)
    expect(getTradesBoard).toHaveBeenCalledTimes(1)
    // Same row count, different content — an upsert onto an existing trade row.
    queryRaw.mockResolvedValue(digestRow('733:t2'))
    await readTradesBoardSummary('u1', 3, ROWS_AFTER)
    expect(getTradesBoard).toHaveBeenCalledTimes(2)
  })

  it('🛑 a newly imported league still forces a cold rebuild, with no trade change', async () => {
    await readTradesBoardSummary('u1', 3, ROWS_BEFORE)
    await readTradesBoardSummary('u1', 3, ROWS_IMPORTED)
    expect(getTradesBoard).toHaveBeenCalledTimes(2)
  })

  it('🛑 a failed digest falls back to the full fingerprint, which rebuilds on lastSyncedAt', async () => {
    queryRaw.mockRejectedValue(new Error('db down'))
    await readTradesBoardSummary('u1', 3, ROWS_BEFORE)
    await readTradesBoardSummary('u1', 3, ROWS_BEFORE)
    expect(getTradesBoard).toHaveBeenCalledTimes(1)
    await readTradesBoardSummary('u1', 3, ROWS_AFTER)
    expect(getTradesBoard).toHaveBeenCalledTimes(2)
  })

  it('the fingerprint ignores lastSyncedAt only when a digest is present', () => {
    expect(tradesBoardFingerprint(ROWS_BEFORE, 'd')).toBe(tradesBoardFingerprint(ROWS_AFTER, 'd'))
    expect(tradesBoardFingerprint(ROWS_BEFORE, 'd')).not.toBe(tradesBoardFingerprint(ROWS_BEFORE, 'e'))
    expect(tradesBoardFingerprint(ROWS_BEFORE, null)).not.toBe(tradesBoardFingerprint(ROWS_AFTER, null))
  })

  it('🛑 the fingerprint replaced the short ttl, so the ttl is no longer short', () => {
    expect(getScreenSummaryDefinition(TRADES_BOARD_SCREEN)!.ttlMs).toBeGreaterThan(5 * 60_000)
  })

  it('does not share a board between two users', async () => {
    await readTradesBoardSummary('u1', 3, ROWS_BEFORE)
    await readTradesBoardSummary('u2', 3, ROWS_BEFORE)
    expect(getTradesBoard).toHaveBeenCalledTimes(2)
  })

  it('is a no-op without a user, and never calls the loader', async () => {
    expect(await readTradesBoardSummary('', 3, ROWS_BEFORE)).toBeNull()
    expect(getTradesBoard).not.toHaveBeenCalled()
  })
})
