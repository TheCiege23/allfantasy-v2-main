import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

/**
 * The bug this pins: the intel sweep was never broken, it was STARVED.
 *
 * It runs last in `/api/cron/import-players`, behind `runSportsDataImporter`
 * plus the devy pool and stats phases, and it refuses to start a phase with
 * less than MIN_RUNWAY_MS (150s) left of a 240s budget. That guard is correct —
 * its slowest feed measured 137s and a phase killed mid-write is worse than one
 * deferred — but the arithmetic never left 150s, so it was skipped BEFORE
 * running on every tick since it shipped.
 *
 * Measured on production 2026-08-28: `devy_pool_refresh:2025`,
 * `devy_pool_refresh:2026` and `devy_stats_refresh:2025` markers all present and
 * fresh; `devy_intel_refresh:*` — none, ever. The columns it owns were empty
 * across all 1,718 rows.
 *
 * A skip is silent by design (it is the normal cadence outcome), so nothing in
 * the response distinguished "inside its cadence" from "never got the runway".
 * These tests make the distinction explicit.
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

const ingest = vi.fn(async () => ({ updated: 7, errors: [] as string[] }))
vi.mock('@/lib/devy-classification', () => ({
  ingestCFBDTransferPortal: (...a: unknown[]) => ingest(...a),
  ingestCFBDUsageAndPPA: (...a: unknown[]) => ingest(...a),
  ingestCFBDTeamContext: (...a: unknown[]) => ingest(...a),
  ingestCFBDRecruitingData: (...a: unknown[]) => ingest(...a),
}))

/** A budget with a known amount of runway left. */
function budgetWith(remainingMs: number) {
  return {
    exhausted: () => remainingMs <= 0,
    remainingMs: () => remainingMs,
    elapsedMs: () => Math.max(0, 240_000 - remainingMs),
  }
}

describe('devy intel sweep — runway starvation', () => {
  beforeEach(() => {
    vi.resetModules()
    findUnique.mockReset().mockResolvedValue(null) // no marker: every phase is due
    upsert.mockReset().mockResolvedValue({})
    ingest.mockClear()
  })

  it('runs a phase when it has a full tick to itself', async () => {
    const { refreshDevyIntelSources } = await import('@/lib/devy/devyIntelRefresh')
    const summary = await refreshDevyIntelSources(budgetWith(240_000) as never)

    expect(ingest, 'a full budget still ran nothing').toHaveBeenCalled()
    expect(summary.ran).toBeGreaterThan(0)
  })

  it('runs NOTHING on the leftovers of a shared tick — the production bug', async () => {
    // 90s is roughly what was actually left after the three phases ahead of it.
    const { refreshDevyIntelSources } = await import('@/lib/devy/devyIntelRefresh')
    const summary = await refreshDevyIntelSources(budgetWith(90_000) as never)

    expect(ingest, 'started a phase it could not finish').not.toHaveBeenCalled()
    expect(summary.ran).toBe(0)
    // The tell that separates starvation from a cadence skip: nothing ran AND
    // no marker was written, so the next tick is in exactly the same position.
    expect(upsert).not.toHaveBeenCalled()
  })

  it('caps at one phase per tick so a sweep cannot overrun its budget', async () => {
    const { refreshDevyIntelSources } = await import('@/lib/devy/devyIntelRefresh')
    await refreshDevyIntelSources(budgetWith(240_000) as never)
    expect(ingest).toHaveBeenCalledTimes(1)
  })

  it('records a marker after a phase runs, so the next tick moves on', async () => {
    const { refreshDevyIntelSources } = await import('@/lib/devy/devyIntelRefresh')
    await refreshDevyIntelSources(budgetWith(240_000) as never)
    expect(upsert, 'ran a phase but wrote no marker — it would repeat forever').toHaveBeenCalled()
  })
})
