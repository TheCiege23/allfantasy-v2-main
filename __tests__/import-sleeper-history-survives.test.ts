/**
 * The Sleeper league-history walk must outlive the import response.
 *
 * 🛑 THE BUG THIS GUARDS. `syncLeagueHistory` walks Sleeper's `previous_league_id` chain and
 * writes one `LeagueSeason` row per season. It was launched as a floating promise inside
 * another floating promise (`void (async () => …)()`), and a floating promise in a serverless
 * function dies the moment the response is returned. So the walk only ever completed its FIRST
 * iteration — the current season — before the invocation was torn down.
 *
 * Measured on production 2026-08-29: `LeagueSeason` held 73 rows across 73 distinct leagues,
 * every single one a lone 2026 row. Not one chain had been walked past its first step in any
 * league. The walker was correct; it was never given time to run.
 *
 * The consequence reached the UI: nothing in the codebase could tell that six Sleeper leagues
 * named "AFC Dreaming!" (2021-2026, six different Sleeper ids) are one league series, so
 * `collapseLeagueSeasons` collapsed 557 entries to 557 and the power-rankings picker had to
 * fall back to a blunt current-season filter.
 *
 * ⚠ THESE ARE STRUCTURAL ASSERTIONS ON PURPOSE. The failure is "a promise nobody awaited",
 * which leaves no trace in a unit test that mocks the route — the mocked call resolves either
 * way. The shape of the call site IS the behaviour here, so the shape is what is pinned.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROUTE = resolve(__dirname, '..', 'app/api/import-sleeper/route.ts')
const src = readFileSync(ROUTE, 'utf8')

/** The exact shape that shipped the bug, so the guards below are known to be capable of firing. */
const OLD_BROKEN_SHAPE = `
    void (async () => {
      void syncLeagueHistory(row.leagueId, platformLeagueId, afUserId).catch((err) => {});
    })();
`

describe('import-sleeper — the history walk survives the response', () => {
  it('keeps the invocation alive with waitUntil', () => {
    expect(src).toMatch(/waitUntil\(\(async \(\) => \{/)
    expect(src).toMatch(/from "@vercel\/functions"/)
  })

  it('awaits the per-league walks instead of floating them', () => {
    expect(src).toMatch(/await Promise\.allSettled\(historyJobs\)/)
    // The specific regression: `void syncLeagueHistory(...)` must not come back.
    expect(src).not.toMatch(/void\s+syncLeagueHistory\s*\(/)
  })

  it('POSITIVE CONTROL — the guards above do fire on the shape that shipped the bug', () => {
    /*
     * Without this, both assertions could pass against a file that no longer calls
     * syncLeagueHistory at all, and the test would be green and meaningless.
     */
    expect(OLD_BROKEN_SHAPE).toMatch(/void\s+syncLeagueHistory\s*\(/)
    expect(OLD_BROKEN_SHAPE).not.toMatch(/await Promise\.allSettled\(historyJobs\)/)
    expect(OLD_BROKEN_SHAPE).not.toMatch(/waitUntil\(\(async \(\) => \{/)
  })

  it('still calls the walker at all, so the guards are not vacuous', () => {
    expect(src).toMatch(/syncLeagueHistory\(row\.leagueId, platformLeagueId, afUserId\)/)
    expect(src).toMatch(/import \{ syncLeagueHistory \} from "@\/lib\/league\/syncLeagueHistory"/)
  })

  it('paces the walk rather than bursting it at one provider', () => {
    /*
     * Four Sleeper calls plus a 500ms pause per season, up to ten seasons deep, times every
     * league in the import. Unbounded concurrency here is a burst for no benefit.
     */
    expect(src).toMatch(/historySyncLimit\s*=\s*pLimit\(\d+\)/)
    expect(src).toMatch(/historySyncLimit\(\(\) =>/)
  })
})
