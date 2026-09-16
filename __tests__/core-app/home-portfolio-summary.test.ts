// @vitest-environment node
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Dash34LeagueRow, Dash34Result } from '@/lib/core-app/dash34'
import type { DurableCacheTier } from '@/lib/sports-os/layeredCache'
import type { Fresh } from '@/lib/sports-os/freshness'

/**
 * The /core home's per-user portfolio summary (lib/core-app/homePortfolioSummary.ts).
 *
 * What must hold, each asserted below:
 *   - a warm record is served without re-running the cross-league join;
 *   - it is REBUILT when the league list changes in any field the join reads (a sync included),
 *     and when a kickoff it was built around has passed;
 *   - its now-relative text is recomputed on every read, never served frozen;
 *   - both cache tiers hold the same JSON shape;
 *   - a slow durable read is a miss, and a slow durable write never holds the reader;
 *   - a failed build rejects exactly as the direct loader call did.
 */

const listMock = vi.hoisted(() => ({ rows: [] as unknown[] }))
const dash34Mock = vi.hoisted(() => ({ calls: 0 }))

vi.mock('@/lib/core-app/dash34', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/core-app/dash34')>()
  return {
    ...actual,
    getDash34Data: vi.fn(async (_userId: string, rows: Dash34LeagueRow[]) => {
      dash34Mock.calls += 1
      return { ...EMPTY_RESULT, totalLeagues: rows.length }
    }),
  }
})
const panels = vi.hoisted(() => ({ exposureIds: [] as string[][], rivalsIds: [] as string[][], failNext: false }))
vi.mock('@/lib/core-app/dash3aPanels', () => ({
  getCrossLeagueExposure: vi.fn(async (_u: string, ids: string[], _limit: number, options?: { onReadError?: (e: unknown) => void }) => {
    panels.exposureIds.push(ids)
    if (panels.failNext) {
      panels.failNext = false
      options?.onReadError?.(new Error('P2024'))
      return { available: false, reason: 'no claimed teams' }
    }
    return { available: true, data: { rows: [], rostersRead: ids.length, note: null } }
  }),
  getRivalRecords: vi.fn(async (_u: string, ids: string[]) => {
    panels.rivalsIds.push(ids)
    return { available: true, data: { rows: [], leaguesRead: ids.length } }
  }),
}))
vi.mock('@/lib/dashboard/get-dashboard-league-list', () => ({
  getDashboardLeagueListForUser: vi.fn(async () => ({ leagues: listMock.rows, sleeperUserId: null })),
}))
vi.mock('@/lib/sports-os/durableTier', () => ({
  sportsDataCacheTier: () => ({ read: async () => null, write: async () => undefined, remove: async () => undefined }),
}))

const EMPTY_RESULT: Dash34Result = {
  firstLock: null,
  today: null,
  next24: null,
  leagues: [],
  quiet: null,
  totalLeagues: 0,
  brief: null,
  book: null,
  valueBasis: null,
  legacyCount: 0,
  weekLabel: null,
}

const NOW = new Date('2026-09-16T12:00:00.000Z')
const at = (ms: number) => new Date(NOW.getTime() + ms)

function row(id: string, extra: Partial<Dash34LeagueRow> = {}): Dash34LeagueRow {
  return { id, name: `League ${id}`, platform: 'sleeper', sport: 'NFL', hasUnifiedRecord: true, lastSyncedAt: null, ...extra }
}

/** A result with every now-relative field populated, around a kickoff `kickoffIn` ms after NOW. */
function timedResult(kickoffIn: number, reportedAgoMs = 30 * 60_000): Dash34Result {
  const to = at(kickoffIn).toISOString()
  return {
    ...EMPTY_RESULT,
    firstLock: {
      countdown: 'FROZEN',
      countdownTo: to,
      countdownLabel: 'FIRST KICKOFF',
      kickoffLabel: 'Thu 8:00 PM',
      headline: 'DET at BUF',
      slots: [],
      openHref: '/core/players',
      openLabel: 'Open Player Finder',
    },
    next24: kickoffIn <= 24 * 3_600_000 ? [{ text: 'DET at BUF', time: to, tone: 'accent' }] : null,
    chimmyBrief: {
      label: "CHIMMY'S BRIEF",
      headline: 'x',
      lines: [],
      countdown: { initial: 'FROZEN', to, label: 'FIRST KICKOFF' },
      caveat: 'c',
      askLabel: 'Ask',
      moreHref: '#',
      moreLabel: 'More',
    },
    book: [
      {
        initials: 'JA',
        name: 'Josh Allen',
        note: 'QB · BUF',
        reportedAt: at(-reportedAgoMs).toISOString(),
        reportedAgo: 'FROZEN',
      },
    ],
  }
}

function memoryTier() {
  const store = new Map<string, Fresh<unknown>>()
  const tier: DurableCacheTier & { store: typeof store } = {
    store,
    read: vi.fn(async (key: string) => store.get(key) ?? null),
    write: vi.fn(async (key: string, entry: Fresh<unknown>) => {
      store.set(key, JSON.parse(JSON.stringify(entry)))
    }),
    remove: vi.fn(async (key: string) => {
      store.delete(key)
    }),
  }
  return tier
}

let mod: typeof import('@/lib/core-app/homePortfolioSummary')
let cache: typeof import('@/lib/sports-os/layeredCache')

// The first import compiles the real dash34 module (for its formatters); under a parallel run that
// can take longer than the default hook timeout, and a timeout there says nothing about the code.
beforeAll(async () => {
  mod = await import('@/lib/core-app/homePortfolioSummary')
  cache = await import('@/lib/sports-os/layeredCache')
}, 60_000)

beforeEach(() => {
  cache.__resetLayeredCacheForTests()
  dash34Mock.calls = 0
  listMock.rows = []
  panels.exposureIds = []
  panels.rivalsIds = []
  panels.failNext = false
})

describe('portfolioFingerprint', () => {
  it('ignores row order and how the sync instant is spelled', () => {
    const when = new Date('2026-09-16T11:00:00.000Z')
    const a = mod.portfolioFingerprint([row('A', { lastSyncedAt: when }), row('B')])
    const b = mod.portfolioFingerprint([row('B'), row('A', { lastSyncedAt: when.toISOString() })])
    expect(a).toBe(b)
  })

  it('changes when a league syncs, is renamed, is added, or leaves', () => {
    const base = mod.portfolioFingerprint([row('A'), row('B')])
    expect(mod.portfolioFingerprint([row('A', { lastSyncedAt: NOW }), row('B')])).not.toBe(base)
    expect(mod.portfolioFingerprint([row('A', { name: 'Renamed' }), row('B')])).not.toBe(base)
    expect(mod.portfolioFingerprint([row('A'), row('B'), row('C')])).not.toBe(base)
    expect(mod.portfolioFingerprint([row('A')])).not.toBe(base)
  })
})

describe('crossedBoundary / refreshRelative', () => {
  it('reports a passed kickoff, and nothing before it', () => {
    expect(mod.crossedBoundary(timedResult(60_000), NOW)).toBe(false)
    expect(mod.crossedBoundary(timedResult(60_000), at(60_000))).toBe(true)
    expect(mod.crossedBoundary(EMPTY_RESULT, NOW)).toBe(false)
  })

  it('recomputes every now-relative string from its instant, without touching the input', () => {
    const stored = timedResult(3_600_000 + 4 * 60_000 + 12_000, 30 * 60_000)
    const out = mod.refreshRelative(stored, NOW)
    expect(out.firstLock?.countdown).toBe('1:04:12')
    expect(out.chimmyBrief?.countdown?.initial).toBe('1:04:12')
    expect(out.book?.[0].reportedAgo).toBe('30 min ago')
    expect(stored.firstLock?.countdown).toBe('FROZEN')
    expect(stored.book?.[0].reportedAgo).toBe('FROZEN')
  })
})

describe('readHomePortfolio', () => {
  it('builds once, then serves the warm record without re-joining', async () => {
    const compute = vi.fn(async () => EMPTY_RESULT)
    const rows = [row('A')]
    const first = await mod.readHomePortfolio('u-warm', rows, NOW, { durable: null, compute })
    const second = await mod.readHomePortfolio('u-warm', rows, NOW, { durable: null, compute })
    expect(compute).toHaveBeenCalledTimes(1)
    expect(first.summary.source).toBe('live')
    expect(second.summary.source).toBe('cache')
  })

  it('rebuilds when the league list changed — a finished sync needs no hook', async () => {
    const compute = vi.fn(async (r: Dash34LeagueRow[]) => ({ ...EMPTY_RESULT, totalLeagues: r.length }))
    await mod.readHomePortfolio('u-sync', [row('A')], NOW, { durable: null, compute })
    const synced = [row('A', { lastSyncedAt: NOW })]
    const after = await mod.readHomePortfolio('u-sync', synced, NOW, { durable: null, compute })
    expect(compute).toHaveBeenCalledTimes(2)
    expect(after.summary.source).toBe('live')
    // And the rebuilt record is the one now cached — not rebuilt again on every read after a sync.
    const again = await mod.readHomePortfolio('u-sync', synced, NOW, { durable: null, compute })
    expect(compute).toHaveBeenCalledTimes(2)
    expect(again.summary.source).toBe('cache')
  })

  it('rebuilds once the kickoff it was built around has started', async () => {
    const compute = vi
      .fn<(r: Dash34LeagueRow[]) => Promise<Dash34Result>>()
      .mockResolvedValueOnce(timedResult(30_000))
      .mockResolvedValueOnce(timedResult(3_600_000))
    const rows = [row('A')]
    await mod.readHomePortfolio('u-kick', rows, NOW, { durable: null, compute })
    const later = await mod.readHomePortfolio('u-kick', rows, at(31_000), { durable: null, compute })
    expect(compute).toHaveBeenCalledTimes(2)
    expect(later.firstLock?.countdownTo).toBe(at(3_600_000).toISOString())
  })

  it('never serves text frozen at build time from a warm record', async () => {
    const compute = vi.fn(async () => timedResult(2 * 3_600_000, 5 * 60_000))
    const rows = [row('A')]
    await mod.readHomePortfolio('u-text', rows, NOW, { durable: null, compute })
    const later = await mod.readHomePortfolio('u-text', rows, at(60_000), { durable: null, compute })
    expect(compute).toHaveBeenCalledTimes(1)
    expect(later.firstLock?.countdown).toBe('1:59:00')
    expect(later.book?.[0].reportedAgo).toBe('6 min ago')
  })

  it('stores JSON — the memory tier and Postgres hold the same shape', async () => {
    const tier = memoryTier()
    const compute = vi.fn(async () => ({ ...EMPTY_RESULT, weekLabel: new Date(0) as unknown as string }))
    const out = await mod.readHomePortfolio('u-json', [row('A')], NOW, { durable: tier, compute })
    expect(typeof out.weekLabel).toBe('string')
    const stored = tier.store.get(mod.homePortfolioKey('u-json')) as Fresh<{ data: Dash34Result }>
    expect(typeof stored.data.data.weekLabel).toBe('string')
  })

  it('promotes a durable record written by another replica instead of rebuilding', async () => {
    const tier = memoryTier()
    const rows = [row('A')]
    // The cache judges staleness by the real clock, so the other replica's write is a minute old in real time.
    const builtAt = Date.now() - 60_000
    tier.store.set(mod.homePortfolioKey('u-durable'), {
      data: { fingerprint: mod.portfolioFingerprint(rows), data: { ...EMPTY_RESULT, totalLeagues: 42 } },
      fetchedAt: builtAt,
      source: 'live',
      staleAfterMs: mod.HOME_PORTFOLIO_TTL_MS,
    })
    const compute = vi.fn(async () => EMPTY_RESULT)
    const out = await mod.readHomePortfolio('u-durable', rows, new Date(), { durable: tier, compute })
    expect(compute).not.toHaveBeenCalled()
    expect(out.totalLeagues).toBe(42)
    expect(out.summary).toEqual({ builtAt: new Date(builtAt).toISOString(), source: 'cache' })
  })

  it('ignores a durable record built for a different league list', async () => {
    const tier = memoryTier()
    tier.store.set(mod.homePortfolioKey('u-foreign'), {
      data: { fingerprint: 'someone-elses-list', data: { ...EMPTY_RESULT, totalLeagues: 99 } },
      fetchedAt: Date.now(),
      source: 'live',
      staleAfterMs: mod.HOME_PORTFOLIO_TTL_MS,
    })
    const compute = vi.fn(async () => ({ ...EMPTY_RESULT, totalLeagues: 1 }))
    const out = await mod.readHomePortfolio('u-foreign', [row('A')], NOW, { durable: tier, compute })
    expect(compute).toHaveBeenCalledTimes(1)
    expect(out.totalLeagues).toBe(1)
  })

  /*
   * The race the last guard exists for: a forced rebuild JOINS whatever build is already in flight
   * for the key (single-flight is per key), and that build can be for another league list.
   */
  it('never serves a concurrent build made for a different league list', async () => {
    const marker = (n: number) => ({ ...EMPTY_RESULT, totalLeagues: n })
    // 1. The cache holds a record for list Z.
    await mod.readHomePortfolio('u-race', [row('Z')], NOW, { durable: null, compute: async () => marker(0) })
    // 2. A request for list X finds Z, and starts a slow forced rebuild for X.
    const slowX = mod.readHomePortfolio('u-race', [row('X')], NOW, {
      durable: null,
      compute: () => new Promise((resolve) => setTimeout(() => resolve(marker(1)), 80)),
    })
    await new Promise((resolve) => setTimeout(resolve, 10))
    // 3. A request for list Y also finds Z, forces a rebuild — and joins X's build in flight.
    const computeY = vi.fn(async () => marker(2))
    const y = await mod.readHomePortfolio('u-race', [row('Y')], NOW, { durable: null, compute: computeY })
    expect(y.totalLeagues, 'list Y was served list X’s portfolio').toBe(2)
    expect(y.summary.source).toBe('live')
    expect((await slowX).totalLeagues).toBe(1)
  })

  /*
   * 🛑 The joins degrade instead of throwing, so a failed read yields a plausible, emptier result.
   * Served once, that is today's behaviour; stored, it would repeat the outage for the whole TTL.
   */
  it('serves a build that saw a failed read, but never stores it — in either tier', async () => {
    const tier = memoryTier()
    const rows = [row('A')]
    const failing: import('@/lib/core-app/homePortfolioSummary').SummaryCompute<Dash34Result> = async (_r, onReadError) => {
      onReadError()
      return { ...EMPTY_RESULT, totalLeagues: 0 }
    }
    const first = await mod.readHomePortfolio('u-degraded', rows, NOW, { durable: tier, compute: failing })
    expect(first.totalLeagues).toBe(0)
    expect(first.summary.source).toBe('live')
    expect(tier.write).not.toHaveBeenCalled()

    const healthy = vi.fn(async () => ({ ...EMPTY_RESULT, totalLeagues: 1 }))
    const second = await mod.readHomePortfolio('u-degraded', rows, NOW, { durable: tier, compute: healthy })
    expect(healthy, 'the degraded build was cached and served instead of rebuilding').toHaveBeenCalledTimes(1)
    expect(second.totalLeagues).toBe(1)
    expect(tier.write).toHaveBeenCalledTimes(1)
  })

  it('the default builds report their failed reads (the loader is told to)', async () => {
    const { getDash34Data } = await import('@/lib/core-app/dash34')
    vi.mocked(getDash34Data).mockImplementationOnce(async (_u, _rows, _now, options) => {
      options?.onReadError?.('rosters', new Error('P2024'))
      return EMPTY_RESULT
    })
    const rows = [row('A')]
    await mod.readHomePortfolio('u-default', rows, NOW, { durable: null })
    await mod.readHomePortfolio('u-default', rows, NOW, { durable: null })
    // The second read rebuilt: the degraded first build was not kept.
    expect(vi.mocked(getDash34Data).mock.calls.filter((c) => c[0] === 'u-default')).toHaveLength(2)
  })

  it('rejects when the build rejects, like the direct loader call', async () => {
    const compute = vi.fn(async () => {
      throw new Error('db down')
    })
    await expect(mod.readHomePortfolio('u-fail', [row('A')], NOW, { durable: null, compute })).rejects.toThrow('db down')
  })

  it('drops a record on invalidation, so the next read rebuilds', async () => {
    const compute = vi.fn(async () => EMPTY_RESULT)
    const rows = [row('A')]
    await mod.readHomePortfolio('u-inv', rows, NOW, { durable: null, compute })
    await mod.invalidateHomePortfolio('u-inv')
    await mod.readHomePortfolio('u-inv', rows, NOW, { durable: null, compute })
    expect(compute).toHaveBeenCalledTimes(2)
  })
})

describe('the exposure and rivalry records', () => {
  it('read the played leagues only — legacy board rows out, in the page’s name order', async () => {
    const rows = [row('B', { name: 'Zeta' }), row('LEG', { hasUnifiedRecord: false }), row('A', { name: 'Alpha' })]
    await mod.readHomeExposure('u-panels', rows, NOW, { durable: null })
    await mod.readHomeRivals('u-panels', rows, NOW, { durable: null })
    expect(panels.exposureIds).toEqual([['A', 'B']])
    expect(panels.rivalsIds).toEqual([['A', 'B']])
  })

  it('are cached, and rebuilt when the league list changes', async () => {
    const rows = [row('A')]
    await mod.readHomeRivals('u-rivals', rows, NOW, { durable: null })
    await mod.readHomeRivals('u-rivals', rows, NOW, { durable: null })
    expect(panels.rivalsIds).toHaveLength(1)
    await mod.readHomeRivals('u-rivals', [row('A', { lastSyncedAt: NOW })], NOW, { durable: null })
    expect(panels.rivalsIds).toHaveLength(2)
  })

  it('never keep a panel built from a failed read', async () => {
    const rows = [row('A')]
    panels.failNext = true
    const degraded = await mod.readHomeExposure('u-exp-fail', rows, NOW, { durable: null })
    expect(degraded.available).toBe(false)
    const recovered = await mod.readHomeExposure('u-exp-fail', rows, NOW, { durable: null })
    expect(recovered.available).toBe(true)
    expect(panels.exposureIds).toHaveLength(2)
  })

  it('are dropped with the portfolio on invalidation', async () => {
    const rows = [row('A')]
    await mod.readHomeExposure('u-inv2', rows, NOW, { durable: null })
    await mod.invalidateHomePortfolio('u-inv2')
    await mod.readHomeExposure('u-inv2', rows, NOW, { durable: null })
    expect(panels.exposureIds).toHaveLength(2)
  })
})

describe('boundedDurableTier', () => {
  it('treats a read slower than its deadline as a miss', async () => {
    const slow: DurableCacheTier = {
      read: () => new Promise((resolve) => setTimeout(() => resolve({ data: 1, fetchedAt: 1, source: 'live', staleAfterMs: 1 }), 500)),
      write: async () => undefined,
    }
    const started = Date.now()
    await expect(mod.boundedDurableTier(slow, 20).read('k')).resolves.toBeNull()
    expect(Date.now() - started).toBeLessThan(400)
  })

  it('treats a failed read as a miss, and passes a fast one through', async () => {
    const entry = { data: 1, fetchedAt: 1, source: 'live' as const, staleAfterMs: 1 }
    const failing: DurableCacheTier = { read: async () => Promise.reject(new Error('P2024')), write: async () => undefined }
    const fast: DurableCacheTier = { read: async () => entry, write: async () => undefined }
    await expect(mod.boundedDurableTier(failing, 50).read('k')).resolves.toBeNull()
    await expect(mod.boundedDurableTier(fast, 50).read('k')).resolves.toEqual(entry)
  })

  it('never holds the reader on a write, and swallows a failed one', async () => {
    const hanging: DurableCacheTier = { read: async () => null, write: () => new Promise(() => undefined) }
    const compute = vi.fn(async () => EMPTY_RESULT)
    const read = mod.readHomePortfolio('u-hang', [row('A')], NOW, { durable: mod.boundedDurableTier(hanging), compute })
    const outcome = await Promise.race([read.then(() => 'resolved'), new Promise((r) => setTimeout(() => r('held'), 500))])
    expect(outcome).toBe('resolved')

    const failing: DurableCacheTier = { read: async () => null, write: async () => Promise.reject(new Error('x')) }
    await expect(mod.boundedDurableTier(failing).write('k', { data: 1, fetchedAt: 1, source: 'live', staleAfterMs: 1 })).resolves.toBeUndefined()
  })
})

describe('registration', () => {
  it('registers a build that reads the league list itself, under the key the home reads', async () => {
    const { getScreenSummaryDefinition, summaryCacheKey } = await import('@/lib/sports-os/summaries')
    const def = getScreenSummaryDefinition(mod.HOME_PORTFOLIO_SCREEN)
    expect(def).toBeTruthy()
    listMock.rows = [row('A'), row('B')]
    const stored = (await def!.build({ userId: 'u-reg' })) as { fingerprint: string; data: Dash34Result }
    expect(stored.fingerprint).toBe(mod.portfolioFingerprint(listMock.rows as Dash34LeagueRow[]))
    expect(stored.data.totalLeagues).toBe(2)
    expect(getScreenSummaryDefinition(mod.HOME_EXPOSURE_SCREEN)).toBeTruthy()
    expect(getScreenSummaryDefinition(mod.HOME_RIVALS_SCREEN)).toBeTruthy()
    expect(summaryCacheKey(mod.HOME_PORTFOLIO_SCREEN, def!.version, { userId: 'u-reg' })).toBe(mod.homePortfolioKey('u-reg'))
  })
})
