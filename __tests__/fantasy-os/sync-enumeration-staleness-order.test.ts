/**
 * The bounded sync batch must be chosen by STALENESS, not by league id.
 *
 * 🛑 THE BUG THIS PINS. `enumerateConnectedLeagues` used to apply `take: limit` inside the
 * Prisma query, under a fixed `[season desc, platform asc, platformLeagueId asc]` sort. The cron
 * defaults to `limit = 25` per provider, so every tick pulled the SAME first 25 rows forever.
 * Measured against production 2026-09-03:
 *
 *     first 25 by that order    25 leagues   25 synced in 24h  (100%)
 *     rank 26+                 170 leagues    2 synced in 24h  (1.2%, both manual refreshes)
 *
 * 87% of the portfolio had never been enumerated once, while the heartbeat reported a healthy
 * 25/25 every tick. The old comment on that `orderBy` named this exact failure and asserted the
 * per-league cadence check prevented it — it could not, because `take` runs in the database and
 * the cadence check only ever saw the already-truncated 25.
 *
 * The fix costs no extra provider load: the same `limit` leagues are fetched per tick, chosen by
 * how long it has been since each was last ATTEMPTED.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  prisma: {
    league: { groupBy: vi.fn() },
    leagueSyncState: { findMany: vi.fn() },
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: h.prisma }))

import { enumerateConnectedLeagues } from '@/lib/import-os/collector/enumerate'

/** `n` sleeper leagues whose ids sort ascending: L000, L001, … — the old selection order. */
function groupsInIdOrder(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    platform: 'sleeper',
    platformLeagueId: `L${String(i).padStart(3, '0')}`,
    season: 2026,
    sport: 'NFL',
  }))
}

const AT = (iso: string) => new Date(iso)

beforeEach(() => {
  vi.clearAllMocks()
  h.prisma.leagueSyncState.findMany.mockResolvedValue([])
})

describe('enumerateConnectedLeagues — the batch is chosen by staleness', () => {
  it('🛑 a STALE league at the tail of the id order is selected over a FRESH league at the head', async () => {
    h.prisma.league.groupBy.mockResolvedValue(groupsInIdOrder(30))
    /*
     * Every league has been attempted — deliberately, so this test isolates the STALENESS
     * comparison. Leaving some without a sync-state row would make them rank first as
     * never-attempted and the test would pass for the wrong reason.
     */
    h.prisma.leagueSyncState.findMany.mockResolvedValue(
      Array.from({ length: 30 }, (_, i) => ({
        runKey: `sleeper:L${String(i).padStart(3, '0')}:2026`,
        // L029 — dead last by id — is the only stale one.
        lastAttemptedSyncAt:
          i === 29 ? AT('2026-09-01T20:00:00Z') : AT('2026-09-03T20:00:00Z'),
      })),
    )

    /*
     * limit 1 states the bug at its sharpest: with one slot, it goes to the stalest league in
     * the portfolio. Under the old `take: limit` behaviour the single pick was always L000 —
     * the lowest id — and L029 could never be reached at any limit below 30.
     */
    const conns = await enumerateConnectedLeagues(['sleeper'], 1)
    expect(conns.map((c) => c.runKey)).toEqual(['sleeper:L029:2026'])
  })

  it('never-attempted leagues come first — they have never synced at all', async () => {
    h.prisma.league.groupBy.mockResolvedValue(groupsInIdOrder(5))
    // Only L000 and L001 have ever been attempted; the rest have no row at all.
    h.prisma.leagueSyncState.findMany.mockResolvedValue([
      { runKey: 'sleeper:L000:2026', lastAttemptedSyncAt: AT('2026-01-01T00:00:00Z') },
      { runKey: 'sleeper:L001:2026', lastAttemptedSyncAt: AT('2026-01-01T00:00:00Z') },
    ])

    const conns = await enumerateConnectedLeagues(['sleeper'], 3)
    expect(conns.map((c) => c.runKey)).toEqual([
      'sleeper:L002:2026',
      'sleeper:L003:2026',
      'sleeper:L004:2026',
    ])
  })

  it('a null lastAttemptedSyncAt counts as never attempted, not as epoch-old', async () => {
    h.prisma.league.groupBy.mockResolvedValue(groupsInIdOrder(3))
    h.prisma.leagueSyncState.findMany.mockResolvedValue([
      { runKey: 'sleeper:L000:2026', lastAttemptedSyncAt: AT('2026-09-03T00:00:00Z') },
      { runKey: 'sleeper:L001:2026', lastAttemptedSyncAt: null },
      { runKey: 'sleeper:L002:2026', lastAttemptedSyncAt: AT('2026-09-02T00:00:00Z') },
    ])

    const conns = await enumerateConnectedLeagues(['sleeper'], 1)
    expect(conns.map((c) => c.runKey)).toEqual(['sleeper:L001:2026'])
  })

  it('orders oldest-attempted first among leagues that have all been attempted', async () => {
    h.prisma.league.groupBy.mockResolvedValue(groupsInIdOrder(4))
    h.prisma.leagueSyncState.findMany.mockResolvedValue([
      { runKey: 'sleeper:L000:2026', lastAttemptedSyncAt: AT('2026-09-03T00:00:00Z') },
      { runKey: 'sleeper:L001:2026', lastAttemptedSyncAt: AT('2026-09-01T00:00:00Z') },
      { runKey: 'sleeper:L002:2026', lastAttemptedSyncAt: AT('2026-09-02T00:00:00Z') },
      { runKey: 'sleeper:L003:2026', lastAttemptedSyncAt: AT('2026-08-31T00:00:00Z') },
    ])

    // limit MUST be below the count, or the whole set is returned and no ordering is applied.
    const conns = await enumerateConnectedLeagues(['sleeper'], 3)
    expect(conns.map((c) => c.runKey)).toEqual([
      'sleeper:L003:2026',
      'sleeper:L001:2026',
      'sleeper:L002:2026',
    ])
  })

  it('equal timestamps fall back to the stable base order, so the result is deterministic', async () => {
    h.prisma.league.groupBy.mockResolvedValue(groupsInIdOrder(4))
    const same = AT('2026-09-02T00:00:00Z')
    h.prisma.leagueSyncState.findMany.mockResolvedValue(
      ['L000', 'L001', 'L002', 'L003'].map((id) => ({
        runKey: `sleeper:${id}:2026`,
        lastAttemptedSyncAt: same,
      })),
    )

    const first = await enumerateConnectedLeagues(['sleeper'], 2)
    const second = await enumerateConnectedLeagues(['sleeper'], 2)
    expect(first.map((c) => c.runKey)).toEqual(['sleeper:L000:2026', 'sleeper:L001:2026'])
    expect(second.map((c) => c.runKey)).toEqual(first.map((c) => c.runKey))
  })

  /**
   * ⚠ The whole point is that this is a REORDER, not a bigger batch. If it ever starts returning
   * more than `limit`, provider load rises silently and Sleeper's rate limit is the thing that
   * notices.
   */
  it('never returns more than the limit', async () => {
    h.prisma.league.groupBy.mockResolvedValue(groupsInIdOrder(200))
    const conns = await enumerateConnectedLeagues(['sleeper'], 25)
    expect(conns).toHaveLength(25)
  })

  it('the whole portfolio is reachable across successive ticks', async () => {
    h.prisma.league.groupBy.mockResolvedValue(groupsInIdOrder(10))
    // Simulate: every league attempted, staggered so each tick's picks become the freshest.
    const attempts = new Map<string, Date>(
      Array.from({ length: 10 }, (_, i) => [
        `sleeper:L${String(i).padStart(3, '0')}:2026`,
        AT(new Date(Date.parse('2026-09-01T00:00:00Z') + i * 60_000).toISOString()),
      ]),
    )
    const seen = new Set<string>()
    for (let tick = 0; tick < 5; tick++) {
      h.prisma.leagueSyncState.findMany.mockResolvedValue(
        [...attempts].map(([runKey, lastAttemptedSyncAt]) => ({ runKey, lastAttemptedSyncAt })),
      )
      const conns = await enumerateConnectedLeagues(['sleeper'], 2)
      for (const c of conns) {
        seen.add(c.runKey)
        // Attempting a league advances its timestamp, so it yields its slot next tick.
        attempts.set(c.runKey, AT(new Date(Date.parse('2026-09-02T00:00:00Z') + tick * 60_000).toISOString()))
      }
    }
    expect(seen.size).toBe(10)
  })
})

describe('enumerateConnectedLeagues — the unbounded path is untouched', () => {
  it('with no limit it returns every connection and never queries sync state', async () => {
    h.prisma.league.groupBy.mockResolvedValue(groupsInIdOrder(40))
    const conns = await enumerateConnectedLeagues(['sleeper'])
    expect(conns).toHaveLength(40)
    expect(h.prisma.leagueSyncState.findMany).not.toHaveBeenCalled()
  })

  it('when the portfolio already fits inside the limit it skips the extra query', async () => {
    h.prisma.league.groupBy.mockResolvedValue(groupsInIdOrder(5))
    const conns = await enumerateConnectedLeagues(['sleeper'], 25)
    expect(conns).toHaveLength(5)
    expect(h.prisma.leagueSyncState.findMany).not.toHaveBeenCalled()
  })

  it('still dedupes mirror rows and skips empty ids before any ordering', async () => {
    h.prisma.league.groupBy.mockResolvedValue([
      { platform: 'sleeper', platformLeagueId: 'a', season: 2026, sport: 'NFL' },
      { platform: 'sleeper', platformLeagueId: 'a', season: 2026, sport: 'NFL' },
      { platform: 'sleeper', platformLeagueId: '', season: 2026, sport: 'NFL' },
    ])
    const conns = await enumerateConnectedLeagues(['sleeper'])
    expect(conns.map((c) => c.runKey)).toEqual(['sleeper:a:2026'])
  })
})
