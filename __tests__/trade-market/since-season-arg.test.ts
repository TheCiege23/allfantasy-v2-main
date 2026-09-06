import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { CENTRING_TOLERANCE, isCentred, parseSinceSeason } from '@/lib/trade-market/sinceSeasonArg'

/**
 * Guards the fix for a probe that silently answered a different question than the writer.
 *
 * `probe-af-market-values.ts` parsed `Number(process.argv[2]) || 2024`. Handed `--since 2025`
 * it read the FLAG as the value, coerced to NaN, and fell through to 2024 — reporting
 * `PASS median +0.2%` while the writer reported `FAIL median +1.8%` for the season requested.
 */

// Matches the convention in __tests__/sports-data/position-backfill-write-path.test.ts.
const raw = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8')

/**
 * ⚠ NEGATIVES MUST BE ASSERTED AGAINST COMMENT-STRIPPED SOURCE. Both scripts now DOCUMENT the
 * broken expression in their headers as a warning, so a raw-source scan matches the prose and
 * reports the bug as still present. Grepping source cannot tell code from writing about code —
 * the better-documented the fix, the more likely its own explanation trips the test guarding it.
 */
const stripComments = (src: string) =>
  src
    .split(/\r?\n/)
    .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
    .join('\n')

const WRITER = 'scripts/recalculate-af-market-values-from-trades.ts'
const PROBE = 'scripts/probe-af-market-values.ts'

describe('parseSinceSeason', () => {
  it('reads the flag form the writer documents', () => {
    expect(parseSinceSeason(['--since', '2025'])).toBe(2025)
    expect(parseSinceSeason(['--since', '2024', '--write'])).toBe(2024)
    expect(parseSinceSeason(['--write', '--since', '2026'])).toBe(2026)
  })

  it('reads the joined form, because this repo uses --key=value elsewhere', () => {
    // scripts/backfill-provider-position-codes.mjs takes --endpoint=<id>, so operators type both.
    expect(parseSinceSeason(['--since=2025'])).toBe(2025)
    expect(parseSinceSeason(['--since=2024', '--write'])).toBe(2024)
  })

  it('reads a bare positional year, which is how the probe was always invoked', () => {
    expect(parseSinceSeason(['2024'])).toBe(2024)
    expect(parseSinceSeason(['2026'])).toBe(2026)
  })

  it('🛑 REPRODUCES THE ORIGINAL BUG — the old expression returns the wrong season', () => {
    /*
     * The exact code that shipped, run against the exact argv that broke it. Without this the
     * suite proves the new parser works but never shows what it fixed.
     */
    const argv = ['--since', '2025']
    const old = Number(argv[0]) || 2024
    expect(old).toBe(2024) // <- the silent wrong answer
    expect(parseSinceSeason(argv, 2024)).toBe(2025) // <- what the caller asked for
  })

  it('⚠ falls back rather than inventing a season from a non-value', () => {
    // `--since` with nothing after it, or followed by another flag, is operator error.
    expect(parseSinceSeason(['--since'], 2024)).toBe(2024)
    expect(parseSinceSeason(['--since', '--write'], 2024)).toBe(2024)
    expect(parseSinceSeason(['--since', 'lastyear'], 2024)).toBe(2024)
    expect(parseSinceSeason(['--since=oops'], 2024)).toBe(2024)
    // Implausible values are not seasons either.
    expect(parseSinceSeason(['--since', '1999'], 2024)).toBe(2024)
    expect(parseSinceSeason(['--since', '2025.5'], 2024)).toBe(2024)
  })

  it('🛑 [control] THE WRITER KEEPS ITS EXACT BEHAVIOUR — this is why sharing is safe', () => {
    /*
     * The writer previously parsed the flag form ONLY, defaulting to undefined. Adding bare-year
     * support could in principle capture one of its positionals. It cannot: `--write` is its only
     * one and it is not a plausible season. If someone adds a positional that IS numeric, this
     * assertion is what tells them they changed the writer's meaning.
     */
    expect(parseSinceSeason(['--write'])).toBeUndefined()
    expect(parseSinceSeason([])).toBeUndefined()
  })
})

describe('isCentred', () => {
  it('accepts a median inside the tolerance and rejects one outside it', () => {
    expect(CENTRING_TOLERANCE).toBe(1.5)
    expect(isCentred(0.2)).toBe(true) // the --since 2024 population, 2026-09-06
    expect(isCentred(-1.5)).toBe(true) // boundary is inclusive, as the writer's `<=` was
    expect(isCentred(1.8)).toBe(false) // the --since 2025 population the writer refused
    expect(isCentred(-2.0)).toBe(false) // the --since 2026 population
  })

  it('⚠ a MISSING median is not a centred one — an empty run must not read as a pass', () => {
    /*
     * `medianAdjustment` is null when nothing published. Treating that as centred would let a
     * run against an empty chart publish on the strength of having measured nothing.
     */
    expect(isCentred(null)).toBe(false)
    expect(isCentred(undefined)).toBe(false)
    expect(isCentred(Number.NaN)).toBe(false)
  })
})

describe('both callers actually use the shared module', () => {
  it('🛑 neither script carries its own parser any more', () => {
    for (const p of [WRITER, PROBE]) {
      const code = stripComments(raw(p))
      expect(code).toContain("from '../lib/trade-market/sinceSeasonArg'")
      expect(code).toMatch(/parseSinceSeason\(process\.argv\.slice\(2\)/)
      // The two shapes that diverged. Neither may survive in executable code.
      expect(code).not.toMatch(/Number\(process\.argv\[2\]\)/)
      expect(code).not.toMatch(/indexOf\('--since'\)/)
    }
  })

  it('🛑 neither script hard-codes the centring tolerance', () => {
    for (const p of [WRITER, PROBE]) {
      const code = stripComments(raw(p))
      expect(code).toContain('isCentred(')
      expect(code).not.toMatch(/<=\s*1\.5/)
      expect(code).not.toMatch(/CENTRING_TOLERANCE\s*=\s*1\.5/)
    }
  })

  it('[control] the scan is reading the right files and they are non-trivial', () => {
    /*
     * A path typo makes readFileSync throw, but a stripped-to-nothing source would make every
     * `not.toMatch` above pass vacuously. Assert there is real code left after stripping.
     */
    for (const p of [WRITER, PROBE]) {
      const code = stripComments(raw(p))
      expect(code.length).toBeGreaterThan(400)
      // Present in both; the two differ in which entry point they call.
      expect(code).toContain("from '@prisma/client'")
    }
    expect(stripComments(raw(WRITER))).toContain('recalculateFromCompletedTrades')
    expect(stripComments(raw(PROBE))).toContain('gatherCompletedTradeObservations')
  })
})
