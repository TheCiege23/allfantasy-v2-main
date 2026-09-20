/**
 * What the run budget is allowed to bound, and what it must not.
 *
 * 🛑 THE BUG THIS FILE PINS COST 54 RUNS A WEEK AND WAS MISDIAGNOSED ONCE BEFORE IT WAS MEASURED.
 * `runSync` charged its work budget from a clock started BEFORE the lock was acquired, so a run
 * that spent its allowance queueing arrived already dead: it checked the budget before its first
 * scope, found it blown, and dropped every scope without attempting one.
 *
 * Measured on production 2026-09-20, `sync_job_runs` over seven days:
 *
 *   50 runs  active lane (2 scopes, 20s budget)   121-200s wall clock   completedScopes: []
 *    4 runs  main lane   (4 scopes, 240s budget)  ~294s wall clock      completedScopes: []
 *
 * `completedScopes: []` on every one is the whole finding — nothing overran, because nothing ran.
 * A SUCCESSFUL run of the same active lane finishes at p50 1.9s and p95 7.3s across 5,585 runs, so
 * the budget was never close to binding on real work.
 *
 * ⚠ AND THE FIX MUST NOT BECOME "REMOVE THE BUDGET". The last test here is the one that stops that:
 * a scope that genuinely overruns must still cost the scopes queued behind it.
 */
import { describe, expect, it, vi } from 'vitest'

import { runSync, type RunResult, type SyncScope } from '@/lib/import-os/runner'

/** A clock the test drives by hand; nothing here reads the wall clock. */
function fakeClock(startMs = 1_700_000_000_000) {
  let t = startMs
  return { now: () => new Date(t), advance: (ms: number) => { t += ms } }
}

function harness(over: {
  scopes?: SyncScope[]
  runTimeoutMs?: number
  /** Milliseconds the lock takes to come back. */
  lockWait?: number
  /** Milliseconds each named scope burns while fetching. */
  scopeCost?: Partial<Record<string, number>>
} = {}) {
  const clock = fakeClock()
  const scopes = (over.scopes ?? (['transactions', 'teams_rosters'] as unknown as SyncScope[]))
  const attempted: SyncScope[] = []

  const opts = {
    runKey: 'league:test',
    seasonState: 'regular_season' as never,
    scopes,
    lock: {
      acquire: async () => {
        clock.advance(over.lockWait ?? 0)
        return { acquired: true, token: 'tok' }
      },
      release: async () => {},
    },
    store: {
      getCheckpoint: async () => null,
      saveCheckpoint: async () => {},
      persistScope: async () => ({ imported: 1, unchanged: 0, rejected: 0 }),
      recordRun: async () => {},
      setLastSuccessfulSyncAt: async () => {},
    },
    clock: { now: clock.now },
    rng: { next: () => 0 },
    sleep: async () => {},
    fetchScope: vi.fn(async (scope: SyncScope) => {
      attempted.push(scope)
      clock.advance(over.scopeCost?.[String(scope)] ?? 0)
      return { records: [{ id: `${String(scope)}-1` }], nextCheckpoint: 'c1', attempts: 1, logical: 1, notFound: 0, cacheHits: 0 }
    }),
    runTimeoutMs: over.runTimeoutMs ?? 20_000,
  }

  return { opts, attempted, clock }
}

describe('runSync — the budget bounds work, not queueing', () => {
  /*
   * 🛑 THE REGRESSION. 140s of lock wait against a 20s budget is the exact production shape; before
   * the fix this returned `completedScopes: []` and a "run timeout before scope" warning without
   * ever calling the fetcher.
   */
  it('still does its work when the lock took longer than the whole budget', async () => {
    const { opts, attempted } = harness({ lockWait: 140_000, runTimeoutMs: 20_000 })
    const r: RunResult = await runSync(opts as never)

    expect(attempted).toEqual(['transactions', 'teams_rosters'])
    expect(r.completedScopes).toEqual(['transactions', 'teams_rosters'])
    expect(r.incompleteScopes).toEqual([])
    expect(r.warnings.join(' ')).not.toMatch(/run timeout before scope/)
  })

  /*
   * ⚠ THE WALL CLOCK MUST SURVIVE, because it is the only reason this was diagnosable. `startedAt`
   * still marks when the run really began, so `durationMs` keeps reporting the 140s.
   */
  it('keeps reporting true wall clock, queueing included', async () => {
    const { opts } = harness({ lockWait: 140_000 })
    const r: RunResult = await runSync(opts as never)
    const elapsed = Date.parse(r.finishedAt) - Date.parse(r.startedAt)
    expect(elapsed).toBeGreaterThanOrEqual(140_000)
  })

  /* The field that separates lock contention from event-loop starvation in `sync_job_runs`. */
  it('records how long the lock was waited on', async () => {
    const { opts } = harness({ lockWait: 140_000 })
    expect((await runSync(opts as never)).lockWaitMs).toBe(140_000)

    const quick = harness({ lockWait: 0 })
    expect((await runSync(quick.opts as never)).lockWaitMs).toBe(0)
  })

  /*
   * 🛑 THE CONTROL, AND THE REASON THIS IS A FIX RATHER THAN A DELETION. A scope that genuinely
   * overruns must still cost the ones behind it — otherwise "start the clock later" has quietly
   * become "there is no budget", and one slow league stalls every league behind it on a worker
   * with a single JS thread.
   */
  it('still drops a scope queued behind one that overran', async () => {
    const { opts, attempted } = harness({
      lockWait: 0,
      runTimeoutMs: 20_000,
      scopeCost: { transactions: 25_000 },
    })
    const r: RunResult = await runSync(opts as never)

    expect(attempted).toEqual(['transactions'])
    expect(r.completedScopes).toEqual(['transactions'])
    expect(r.incompleteScopes).toEqual(['teams_rosters'])
    expect(r.warnings.join(' ')).toMatch(/run timeout before scope "teams_rosters"/)
  })

  /* A scope that STARTS always finishes — the property the scope-order docblock rests on. */
  it('never aborts a scope mid-flight, however far it overruns', async () => {
    const { opts } = harness({ runTimeoutMs: 1_000, scopeCost: { transactions: 300_000 } })
    const r: RunResult = await runSync(opts as never)
    expect(r.completedScopes).toContain('transactions')
  })
})
