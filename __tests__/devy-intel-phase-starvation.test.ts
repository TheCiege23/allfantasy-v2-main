import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

/**
 * The intel sweep runs ONE phase per tick, and it used to try them in a fixed
 * order. That is the starvation shape `lib/cron/runBudget.ts` warns about in its
 * own header, and the arithmetic here had already gone bad:
 *
 *   supply  4 ticks/day  (`10 STAR/6` on /api/cron/import-players?intel=1)
 *   demand  12h + 24h + 24h + 168h  =  4.14 slots/day
 *
 * `transferPortal` leads and is due twice daily, so it took half of every day's
 * supply forever and `recruiting` — last in the list — had never run at all.
 * Adding the `passingProfile` phase on 2026-08-30 pushed demand to 5.14 and
 * would have starved `teamContext` to zero as well.
 *
 * The fix is `rotateForFairness`, so each phase leads one tick in five. These
 * tests simulate real ticks against the real module rather than asserting on the
 * rotation helper in isolation: the bug was never in the helper, it was in not
 * using it.
 */

const findUnique = vi.fn()
const upsert = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsDataCache: {
      findUnique: (...a: unknown[]) => findUnique(...a),
      upsert: (...a: unknown[]) => upsert(...a),
    },
  },
}))
vi.mock('@/lib/prisma-json', () => ({ toPrismaJsonInput: (v: unknown) => v }))
vi.mock('@/lib/cfbd-env', () => ({ hasCfbdApiKey: () => true, CFBD_ENV_VARS: ['CFBD_API_KEY'] }))
vi.mock('@/lib/cfb-player-data', () => ({ CfbdUnavailableError: class extends Error {} }))
vi.mock('@/lib/devy/devyStatsRefresh', () => ({ defaultStatSeason: () => 2026 }))

/** Which phase ran, per call. */
const ran: string[] = []
function record(key: string) {
  return async () => {
    ran.push(key)
    return { updated: 1, errors: [] as string[] }
  }
}

vi.mock('@/lib/devy-classification', () => ({
  ingestCFBDTransferPortal: record('transferPortal'),
  ingestCFBDUsageAndPPA: record('usageAndPpa'),
  ingestCFBDTeamContext: record('teamContext'),
  ingestCFBDRecruitingData: record('recruiting'),
  ingestCFBDPassingProfile: record('passingProfile'),
}))

/** A full-runway budget — these tests are about ORDER, not about time. */
const fullBudget = {
  exhausted: () => false,
  remainingMs: () => 240_000,
  elapsedMs: () => 0,
} as never

/**
 * Stand in for `sportsDataCache` so cadence gating behaves as it does in
 * production: a marker written at tick N is visible at tick N+1.
 */
function installMarkerStore() {
  const markers = new Map<string, { at: string }>()
  findUnique.mockImplementation(async ({ where }: any) => {
    const data = markers.get(where.cacheKey)
    return data ? { data } : null
  })
  upsert.mockImplementation(async ({ where, create, update }: any) => {
    markers.set(where.cacheKey, (update?.data ?? create?.data) as { at: string })
    return {}
  })
  return markers
}

const SIX_HOURS = 6 * 60 * 60 * 1000

/** Fire `days * 4` real ticks six hours apart and tally what actually ran. */
async function runTicks(days: number): Promise<Record<string, number>> {
  installMarkerStore()
  ran.length = 0

  const { refreshDevyIntelSources } = await import('@/lib/devy/devyIntelRefresh')

  // Start on a fixed instant so the rotation offset is deterministic.
  let now = Date.UTC(2026, 8, 1, 0, 10, 0)
  for (let t = 0; t < days * 4; t++) {
    vi.setSystemTime(new Date(now))
    await refreshDevyIntelSources(fullBudget)
    now += SIX_HOURS
  }

  const tally: Record<string, number> = {}
  for (const key of ran) tally[key] = (tally[key] ?? 0) + 1
  return tally
}

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  findUnique.mockReset()
  upsert.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('no intel phase is starved to zero', () => {
  it('runs every phase at least once across four weeks of ticks', async () => {
    // Four weeks so the 168h `recruiting` cadence has room to come due more than
    // once — a one-week window could pass by luck on its very first tick.
    const tally = await runTicks(28)

    for (const phase of [
      'transferPortal',
      'usageAndPpa',
      'passingProfile',
      'teamContext',
      'recruiting',
    ]) {
      expect(tally[phase] ?? 0, `${phase} never ran in 28 days — starved`).toBeGreaterThan(0)
    }
  })

  it('serves recruiting at its weekly cadence rather than never', async () => {
    // The phase that was already at zero BEFORE the passing feed was added. Its
    // cadence is 168h, so four weeks should yield roughly four runs.
    const tally = await runTicks(28)
    expect(tally.recruiting ?? 0).toBeGreaterThanOrEqual(3)
  })

  it('still gives the shortest-cadence phase the most slots', async () => {
    /*
     * Rotation must not flatten everything to an equal share: transferPortal is
     * due twice as often as the rest and should still lead the tally. If it did
     * not, the cadences would have stopped meaning anything.
     */
    const tally = await runTicks(28)
    const others = ['usageAndPpa', 'passingProfile', 'teamContext', 'recruiting']
    for (const phase of others) {
      expect(tally.transferPortal).toBeGreaterThanOrEqual(tally[phase] ?? 0)
    }
  })

  it('keeps running exactly one phase per tick', async () => {
    // Rotation changes the ORDER, never the cap. Two feeds in one tick would
    // overrun the 240s budget the MIN_RUNWAY_MS guard exists to protect.
    const tally = await runTicks(7)
    const total = Object.values(tally).reduce((a, b) => a + b, 0)
    expect(total).toBeLessThanOrEqual(7 * 4)
  })
})
