import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/season-forecast/SeasonForecastEngine', () => ({ runSeasonForecast: vi.fn() }))

import {
  runForecastSweep,
  FORECAST_SWEEP_FLAG,
} from '@/lib/season-forecast/forecastSweep'
import { runSeasonForecast } from '@/lib/season-forecast/SeasonForecastEngine'

const engine = vi.mocked(runSeasonForecast)

/** A budget that never runs out unless a test says so. */
function budget(exhausted = false, remainingMs = 240_000) {
  return { startedAt: 0, exhausted: () => exhausted, remainingMs: () => remainingMs }
}

/**
 * Minimal prisma double.
 * `ranked` mirrors `rankings_snapshots` (season is a STRING there);
 * `forecast` mirrors `season_forecast_snapshots` (season is an INT there).
 */
function fakePrisma(
  ranked: Array<{ leagueId: string; season: string; week: number }>,
  forecast: Array<{ leagueId: string; season: number; week: number }> = [],
) {
  const rankedFindMany = vi.fn(async () => ranked)
  const forecastFindMany = vi.fn(async () => forecast)
  return {
    prisma: {
      rankingsSnapshot: { findMany: rankedFindMany },
      seasonForecastSnapshot: { findMany: forecastFindMany },
    },
    rankedFindMany,
    forecastFindMany,
  }
}

const ok = { snapshotId: 's1', teamForecasts: [] }

const ORIGINAL = process.env[FORECAST_SWEEP_FLAG]
beforeEach(() => {
  engine.mockReset()
  process.env[FORECAST_SWEEP_FLAG] = 'true'
})
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env[FORECAST_SWEEP_FLAG]
  else process.env[FORECAST_SWEEP_FLAG] = ORIGINAL
})

describe('the flag is read at the boundary', () => {
  /*
   * ⚠ THIS ASSERTS A COST, NOT A RESULT. "Returns zeroes when disabled" would pass even if the
   * sweep read both tables first. The claim is that flag-off costs NOTHING, so the test has to be
   * that the deps were never touched.
   */
  it('queries nothing and calls nothing when disabled', async () => {
    process.env[FORECAST_SWEEP_FLAG] = 'false'
    const f = fakePrisma([{ leagueId: 'L1', season: '2026', week: 1 }])
    const out = await runForecastSweep({ prisma: f.prisma as never, budget: budget() })
    expect(f.rankedFindMany).not.toHaveBeenCalled()
    expect(f.forecastFindMany).not.toHaveBeenCalled()
    expect(engine).not.toHaveBeenCalled()
    expect(out.considered).toBe(0)
  })

  it('an unset flag is disabled, not enabled', async () => {
    delete process.env[FORECAST_SWEEP_FLAG]
    const f = fakePrisma([{ leagueId: 'L1', season: '2026', week: 1 }])
    await runForecastSweep({ prisma: f.prisma as never, budget: budget() })
    expect(f.rankedFindMany).not.toHaveBeenCalled()
  })
})

describe('due-ness is a set difference', () => {
  it('a league-week with rankings and no forecast is due', async () => {
    const f = fakePrisma([{ leagueId: 'L1', season: '2026', week: 1 }], [])
    engine.mockResolvedValue(ok as never)
    const out = await runForecastSweep({ prisma: f.prisma as never, budget: budget() })
    expect(out.considered).toBe(1)
    expect(out.due).toBe(1)
    expect(out.written).toBe(1)
  })

  /*
   * 🛑 THE TYPE MISMATCH THIS PINS, AND IT IS THE EXPENSIVE ONE.
   *
   * `rankings_snapshots.season` is a String; `season_forecast_snapshots.season` is an Int. If the
   * two are compared without converting, EVERY key misses — so every league-week looks due on
   * every fire, forever, and the sweep spends its whole budget rewriting forecasts that already
   * exist. Nothing throws and no row is wrong; it just never stops working.
   */
  it("matches a String season against an Int season — '2026' is not due when 2026 exists", async () => {
    const f = fakePrisma(
      [{ leagueId: 'L1', season: '2026', week: 1 }],
      [{ leagueId: 'L1', season: 2026, week: 1 }],
    )
    const out = await runForecastSweep({ prisma: f.prisma as never, budget: budget() })
    expect(out.considered).toBe(1)
    expect(out.due).toBe(0)
    expect(engine).not.toHaveBeenCalled()
  })

  it('a different WEEK of the same league is still due', async () => {
    const f = fakePrisma(
      [
        { leagueId: 'L1', season: '2026', week: 1 },
        { leagueId: 'L1', season: '2026', week: 2 },
      ],
      [{ leagueId: 'L1', season: 2026, week: 1 }],
    )
    engine.mockResolvedValue(ok as never)
    const out = await runForecastSweep({ prisma: f.prisma as never, budget: budget() })
    expect(out.due).toBe(1)
    expect(engine).toHaveBeenCalledOnce()
    expect(engine).toHaveBeenCalledWith({ leagueId: 'L1', season: 2026, week: 2 })
  })

  it('drops a season that will not parse rather than coercing it to NaN', async () => {
    const f = fakePrisma([{ leagueId: 'L1', season: 'not-a-year', week: 1 }])
    const out = await runForecastSweep({ prisma: f.prisma as never, budget: budget() })
    expect(out.considered).toBe(0)
    expect(engine).not.toHaveBeenCalled()
  })
})

describe('the keys come from the rankings rows, never from a clock', () => {
  it('passes the season and week it read, as numbers', async () => {
    const f = fakePrisma([{ leagueId: 'L9', season: '2026', week: 7 }])
    engine.mockResolvedValue(ok as never)
    await runForecastSweep({ prisma: f.prisma as never, budget: budget() })
    expect(engine).toHaveBeenCalledWith({ leagueId: 'L9', season: 2026, week: 7 })
    const arg = engine.mock.calls[0]?.[0] as { season: unknown; week: unknown }
    expect(typeof arg.season).toBe('number')
    expect(typeof arg.week).toBe('number')
  })

  /*
   * ⚠ `totalWeeks` IS NOT PASSED. The engine defaults it to 14 and forecasts change if we override
   * it. We read that default only to predict a decline, never to send one.
   */
  it('does not send totalWeeks, simulations or any other override', async () => {
    const f = fakePrisma([{ leagueId: 'L1', season: '2026', week: 1 }])
    engine.mockResolvedValue(ok as never)
    await runForecastSweep({ prisma: f.prisma as never, budget: budget() })
    const arg = engine.mock.calls[0]?.[0] as Record<string, unknown>
    expect(Object.keys(arg).sort()).toEqual(['leagueId', 'season', 'week'])
  })
})

describe('outcomes are classified, not lumped', () => {
  /*
   * 🛑 THE ENGINE COLLAPSES TWO CAUSES INTO ONE BARE `null` — no rankings, or no remaining
   * schedule. Week >= totalWeeks is arithmetic we can do for free, so it is refused WITHOUT
   * calling the engine and counted apart. Otherwise late season, when every league is past week
   * 14, is indistinguishable from a broken engine.
   */
  it('refuses a week at or past the season end without calling the engine', async () => {
    const f = fakePrisma([
      { leagueId: 'L1', season: '2026', week: 14 },
      { leagueId: 'L2', season: '2026', week: 15 },
    ])
    const out = await runForecastSweep({ prisma: f.prisma as never, budget: budget() })
    expect(engine).not.toHaveBeenCalled()
    expect(out.pastSeasonEnd).toBe(2)
    expect(out.declined).toBe(0)
    expect(out.written).toBe(0)
  })

  it('an unexplained null is DECLINED, never counted as written', async () => {
    const f = fakePrisma([{ leagueId: 'L1', season: '2026', week: 1 }])
    engine.mockResolvedValue(null as never)
    const out = await runForecastSweep({ prisma: f.prisma as never, budget: budget() })
    expect(out.declined).toBe(1)
    expect(out.written).toBe(0)
    expect(out.failed).toBe(0)
  })

  it('a throw is FAILED, and does not end the walk', async () => {
    const f = fakePrisma([
      { leagueId: 'L1', season: '2026', week: 1 },
      { leagueId: 'L2', season: '2026', week: 1 },
    ])
    engine.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(ok as never)
    const out = await runForecastSweep({ prisma: f.prisma as never, budget: budget() })
    expect(out.failed).toBe(1)
    expect(out.written).toBe(1)
    expect(out.errors[0]).toContain('boom')
  })
})

describe('bounds', () => {
  it('attempts no more than the per-fire cap', async () => {
    const ranked = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((leagueId) => ({ leagueId, season: '2026', week: 1 }))
    const f = fakePrisma(ranked)
    engine.mockResolvedValue(ok as never)
    const out = await runForecastSweep({ prisma: f.prisma as never, budget: budget(), leagueCap: 3 })
    expect(engine).toHaveBeenCalledTimes(3)
    expect(out.written).toBe(3)
    expect(out.considered).toBe(7)
    expect(out.due).toBe(7)
  })

  it('an exhausted budget stops the walk and REPORTS the remainder', async () => {
    const ranked = ['a', 'b', 'c'].map((leagueId) => ({ leagueId, season: '2026', week: 1 }))
    const f = fakePrisma(ranked)
    const out = await runForecastSweep({ prisma: f.prisma as never, budget: budget(true) })
    expect(engine).not.toHaveBeenCalled()
    expect(out.skippedForTime).toBe(3)
  })

  it('refuses to START a unit that cannot finish in the time left', async () => {
    const ranked = ['a', 'b'].map((leagueId) => ({ leagueId, season: '2026', week: 1 }))
    const f = fakePrisma(ranked)
    // Under remainingFor's floor: not exhausted, but nothing can usefully run.
    const out = await runForecastSweep({ prisma: f.prisma as never, budget: budget(false, 500) })
    expect(engine).not.toHaveBeenCalled()
    expect(out.skippedForTime).toBe(2)
  })

  it('a due query that throws is reported, not swallowed', async () => {
    const prisma = {
      rankingsSnapshot: { findMany: vi.fn(async () => { throw new Error('db down') }) },
      seasonForecastSnapshot: { findMany: vi.fn(async () => []) },
    }
    const out = await runForecastSweep({ prisma: prisma as never, budget: budget() })
    expect(out.failed).toBe(1)
    expect(out.errors[0]).toContain('db down')
    expect(engine).not.toHaveBeenCalled()
  })
})
