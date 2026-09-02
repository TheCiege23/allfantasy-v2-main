import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Import OS items 0–2: a failure must be explainable, work must survive the response,
 * and a partial import must say so.
 *
 * ⚠ THESE ARE NOT COVERAGE TESTS. Each one pins a rule that, reverted, produces a
 * product that looks fine and is wrong in a way nobody notices — which is exactly how
 * every defect here shipped in the first place:
 *
 *   - a bulk import that reports "1 failed" and cannot say why, because the reason was
 *     `console.error`'d and the response carried an integer;
 *   - a throttled league reported as "League not found. Please check your League ID.";
 *   - a history backfill started as a floating promise and killed with the response,
 *     leaving the league reading `pending` forever;
 *   - an eleven-bucket coverage report computed on every import and shown to nobody.
 *
 * Source assertions rather than behavioural ones where the rule lives in a route or a
 * component: no prisma, no fetch, no fixtures, so this file runs anywhere. The pure
 * derivation is tested properly in `import-coverage-summary.test.ts`.
 */

const REPO = process.cwd()
const read = (p: string) => readFileSync(join(REPO, p), 'utf8')

/**
 * Source with comments removed.
 *
 * ⚠ NEEDED BECAUSE THE COMMENTS IN THIS CODEBASE DESCRIBE THE VERY DEFECTS THESE TESTS
 * FORBID — the file that fixes the `void` backfill explains at length what `void` did.
 * Asserting on raw source would punish a file for documenting its own bug.
 */
function code(path: string): string {
  return read(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('item 0 — a failed import can say why', () => {
  const route = code('app/api/import-sleeper/route.ts')

  it('returns a per-league result array, not just a count', () => {
    expect(route).toMatch(/results:\s*results\.map/)
    expect(route).toContain('sourceLeagueId')
    expect(route).toContain('reason')
  })

  /*
   * The original defect: `catch { console.error(...); return null }`. The reason existed
   * only in a server log the user cannot reach, and `failed` was `results.length - imported`.
   */
  it('never resolves a failure to a bare null', () => {
    expect(route).not.toMatch(/console\.error\([\s\S]{0,200}?\);\s*return null;/)
    expect(route).toMatch(/status:\s*"failed"/)
  })

  /* The branch that failed with no log line at all — `if (!row) return null`. */
  it('gives the no-league-id branch a real reason', () => {
    expect(route).not.toMatch(/if \(!row\) return null;/)
    expect(route).toMatch(/without an ID/i)
  })

  it('carries the reason into the UI that renders it', () => {
    const form = code('components/LegacyImportForm.tsx')
    expect(form).toContain('data.results')
    expect(form).toMatch(/failures/)
    // Rendered, not merely parsed.
    expect(form).toMatch(/r\.failures/)
  })
})

describe('item 0 — a throttled provider is not reported as a missing league', () => {
  const fetchService = code('lib/league-import/sleeper/SleeperLeagueFetchService.ts')

  it('distinguishes an exhausted retry from a 404', () => {
    expect(fetchService).toContain('SleeperImportUnavailableError')
    // The discriminator: only a non-404 failure records one of these.
    expect(fetchService).toMatch(/failures\.find\(/)
  })

  /*
   * 🛑 THE WHOLE BUG IN ONE LINE. `if (!league?.league_id) return null` answered the same
   * way for "Sleeper says there is no such league" and "we never got an answer", and the
   * pipeline turned that single null into a confident, wrong diagnosis.
   */
  it('no longer returns a bare null for an unreachable league', () => {
    expect(fetchService).not.toMatch(/if \(!league\?\.league_id\) return null\s*$/m)
    expect(fetchService).toMatch(/throw new SleeperImportUnavailableError/)
  })

  it('says what to do about a rate limit', () => {
    expect(fetchService).toMatch(/429/)
    expect(fetchService).toMatch(/rate-limiting/i)
  })

  it('maps the new condition to a retryable status, not 404 or 500', () => {
    const pipeline = code('lib/league-import/ImportedLeagueNormalizationPipeline.ts')
    expect(pipeline).toContain('PROVIDER_UNAVAILABLE')
    for (const routePath of [
      'app/api/leagues/import/commit/route.ts',
      'app/api/leagues/import/preview/route.ts',
    ]) {
      expect(code(routePath)).toMatch(/PROVIDER_UNAVAILABLE'\) return 503/)
    }
  })
})

describe('item 2 — background work survives the response', () => {
  /*
   * On Vercel a promise that is started but never registered is killed when the response
   * returns. This repo already knew it — `app/api/leagues/import/route.ts` says so — and
   * the modern commit path did it anyway, for the one job the OS depends on.
   */
  it('registers the historical backfill with waitUntil', () => {
    const commit = code('lib/league-import/ImportedLeagueCommitService.ts')
    expect(commit).toContain("from '@vercel/functions'")
    expect(commit).toMatch(/waitUntil\(historicalBackfillTask\)/)
    expect(commit).not.toMatch(/void runHistoricalBackfill\(/)
  })

  /*
   * ⚠ THE PROMISE MUST BE STARTED ONCE. `try { waitUntil(run()) } catch { void run() }`
   * runs the work TWICE outside a request context, because the argument is evaluated
   * before waitUntil is entered. Both call sites hand over an already-started promise.
   */
  it('hands waitUntil an already-started promise rather than re-invoking the work', () => {
    for (const path of [
      'lib/league-import/ImportedLeagueCommitService.ts',
      'app/api/leagues/[leagueId]/backfill/retry/route.ts',
    ]) {
      const src = code(path)
      expect(src).toMatch(/waitUntil\([A-Za-z]+Task\)/)
      expect(src).not.toMatch(/waitUntil\([A-Za-z]+\([^)]*\)\)/)
    }
  })

  it('registers the manual backfill retry too', () => {
    const retry = code('app/api/leagues/[leagueId]/backfill/retry/route.ts')
    expect(retry).toContain("from '@vercel/functions'")
    expect(retry).not.toMatch(/void \(async \(\) => \{/)
  })
})

describe('item 2 — a lost backfill is recoverable', () => {
  const sweeper = code('app/api/cron/import-backfill-sweeper/route.ts')

  it('is authenticated like every other cron', () => {
    expect(sweeper).toContain('requireCronAuth')
  })

  /*
   * 🛑 THE SAFETY ARGUMENT. A league genuinely mid-backfill also reads `pending`, and the
   * fact tables are delete-then-insert with no unique constraint — so re-running one
   * concurrently can interleave a delete with the other run's insert and leave a season
   * half-written. The staleness threshold is what makes that impossible, and it must stay
   * far outside any plausible run.
   */
  it('only sweeps leagues whose pending stamp is far older than any real run', () => {
    expect(sweeper).toContain('STALE_AFTER_MS')
    const declared = /STALE_AFTER_MS\s*=\s*(\d+)\s*\*\s*60\s*\*\s*1000/.exec(sweeper)
    expect(declared).not.toBeNull()
    expect(Number(declared![1])).toBeGreaterThanOrEqual(30)
  })

  /* Without re-stamping, the next fire sees the same original timestamp and sweeps again. */
  it('re-stamps the start time before running so two sweeps cannot overlap', () => {
    expect(sweeper).toMatch(/historicalBackfillStartedAt: new Date\(\)\.toISOString\(\)/)
  })

  it('is bounded per fire and rotates so the tail is not starved', () => {
    expect(sweeper).toContain('MAX_LEAGUES_PER_RUN')
    expect(sweeper).toContain('rotateForFairness')
  })

  it('only attempts providers that have a backfill service', () => {
    expect(sweeper).toMatch(/BACKFILLABLE/)
    // fleaflicker has none — runHistoricalBackfill returns null for it.
    expect(sweeper).not.toMatch(/BACKFILLABLE[\s\S]{0,120}fleaflicker/)
  })
})

describe('item 1 — a partial import says so', () => {
  it('persists the coverage block the adapters already compute', () => {
    const commit = code('lib/league-import/ImportedLeagueCommitService.ts')
    expect(commit).toContain('IMPORT_COVERAGE_SETTINGS_KEY')
    expect(commit).toMatch(/normalized\.coverage/)
  })

  it('shows the sentence at the top of the league dashboard', () => {
    const screen = code('components/core-app/screens/LeagueHome.tsx')
    expect(screen).toMatch(/data\.importCoverage\.sentence/)
    expect(screen).toContain('af-lh-coverage')
  })

  /*
   * 🛑 THE REGRESSION THAT WOULD HURT MOST. Every league imported before coverage was
   * persisted has no block. Reading `undefined` as "hide it" strips Trades off every one
   * of them. Only an explicit `false` may hide a tab.
   */
  it('hides a tab only on an explicit false, never on undefined', () => {
    const shell = code('components/core-app/AfCoreShell.tsx')
    expect(shell).toMatch(/ifImported/)
    expect(shell).toMatch(/flag === false \? \[\] : \[item\]/)
    // The truthiness spelling is the bug; make sure it is not what is there.
    expect(shell).not.toMatch(/const ifImported[\s\S]{0,120}flag \? \[item\] : \[\]/)
  })

  it('degrades to showing everything when the league cannot be read', () => {
    const page = code('app/core/[[...screen]]/page.tsx')
    expect(page).toContain('UNKNOWN_IMPORT_COVERAGE')
    expect(page).toMatch(/catch\(\(\) => UNKNOWN_IMPORT_COVERAGE\)/)
    expect(page).toMatch(/importCapabilities=\{importCoverageSummary\.capabilities\}/)
  })
})
