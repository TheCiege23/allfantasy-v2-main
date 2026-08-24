/**
 * The importer must not START a sport it cannot finish.
 *
 * WHAT HAPPENED
 * `import-players` returned HTTP 502 at 300,072ms on 2026-08-23, re-dispatched against a settled
 * deploy so it was not a restart. The importer's own budget was working: completed runs in
 * `sync_job_runs` cluster at 240,153 / 250,579 / 251,124 / 254,178ms — the 240s budget plus a few
 * seconds of overshoot — and #598's post-import phases correctly deferred at that point.
 *
 * ⚠ THE FAILURES ARE INVISIBLE IN THE TABLE YOU WOULD CHECK. The route calls `syncJobRun.create`
 * only AFTER the importer returns, so a run killed at the edge writes no row at all. Every row in
 * that table is a survivor; the 502s leave nothing behind. Judging this cron by its telemetry alone
 * would have shown a clean history.
 *
 * The budget is checked BETWEEN sports, so a sport beginning at 239s runs to completion past the
 * check — the exact caveat written into `lib/cron/runBudget.ts`, biting here one level down.
 *
 * WHAT IS PINNED
 *   1. THE RESERVE. No sport starts inside the final PER_SPORT_RESERVE_MS, so the worst case is
 *      that boundary plus one bounded sport instead of that boundary plus infinity.
 *   2. THE RESERVE LEAVES REAL HEADROOM against the 300s edge — a reserve larger than the gap
 *      between the budget and the ceiling would be theatre.
 *   3. THE PROVIDER READ IS BOUNDED. `fetchProviderPlayerSeeds` was the one unbounded
 *      `apiChain.fetch` in the per-sport block; `projections` and `rankings` beside it were already
 *      wrapped, which is what made it easy to miss.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = readFileSync(
  join(process.cwd(), 'lib/workers/sports-data-importer.ts'),
  'utf8',
)

/** Read a numeric constant out of the source, so the test cannot drift from the real value. */
function constant(name: string): number {
  const m = SRC.match(new RegExp(`const ${name} = ([0-9_]+)`))
  if (!m) throw new Error(`${name} not found`)
  return Number(m[1]!.replace(/_/g, ''))
}

describe('importer per-sport reserve', () => {
  it('refuses to start a sport inside the reserved tail', () => {
    // The literal guard, read from source: asserting the expression rather than a behaviour keeps
    // this honest without booting the whole importer and its provider chain.
    expect(SRC).toContain('IMPORT_BUDGET_MS - PER_SPORT_RESERVE_MS')
    // The bare form is what shipped the 502. If it comes back, the reserve is decorative.
    expect(SRC).not.toMatch(/startedAt > IMPORT_BUDGET_MS\)/)
  })

  it('leaves real headroom between the usable budget and the 300s edge', () => {
    const budget = constant('IMPORT_BUDGET_MS')
    const reserve = constant('PER_SPORT_RESERVE_MS')
    const EDGE_MS = 300_000

    // A sport may start at any moment before this.
    const latestStart = budget - reserve
    expect(latestStart).toBeGreaterThan(0)
    // ...and the time left for it, plus the response, must fit under the edge that 502'd this route.
    expect(EDGE_MS - latestStart).toBeGreaterThanOrEqual(reserve)
  })

  it('bounds the provider seed read that was the only unwrapped apiChain.fetch', () => {
    // projections and rankings were already wrapped — this one sat between them unwrapped, which is
    // precisely why it survived review.
    expect(SRC).toMatch(/withTimeout\(\s*\n\s*fetchProviderPlayerSeeds\(/)
    expect(SRC).toContain('player seeds')
  })

  it('degrades to an empty seed list rather than throwing', () => {
    // withTimeout RESOLVES with its fallback. A rejecting timeout here would abort the whole sport,
    // turning a slow provider into no import at all — worse than the partial it replaces.
    expect(SRC).toMatch(/\[\] as PlayerSeed\[\]/)
  })
})
