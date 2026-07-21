/**
 * Enforces the Phase 1 invariant from docs/DECISION_OS_CORE_UNIFICATION_PLAN.md §18
 * step 1: `lib/decision-os-core/` must be additive and (with one sanctioned
 * exception, see below) currently unimported by any live route or existing
 * engine. This scans the two surfaces that matter — `app/` (routes) and
 * `lib/decision-os/` (the frozen, shadow-live core it sits beside) — for any
 * reference to the new module, and fails if an *unsanctioned* one is found.
 *
 * This test intentionally does NOT scan `lib/decision-os-core/` itself (internal
 * cross-references between its own files, e.g. `../primitives/types`, are expected
 * and fine).
 *
 * SANCTIONED EXCEPTION: `lib/decision-os/commissioner-health/dco.ts` is the first
 * real consumer (docs/DECISION_OS_CORE_UNIFICATION_PLAN.md §18 step 3) — it
 * resolves a `SportAdapter` via `resolveSportAdapter()` instead of an inline
 * `sport === 'NFL'` string comparison. Any other file referencing
 * `decision-os-core` under these two trees should still fail this test until
 * it's deliberately reviewed and added to the allowlist below.
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import path from 'path'

const REPO_ROOT = process.cwd()
const REFERENCE_PATTERN = /decision-os-core/

const ALLOWED_REFERENCES = new Set([
  path.join(REPO_ROOT, 'lib', 'decision-os', 'commissioner-health', 'dco.ts'),
])

/**
 * Minimum source files each scanned tree must contain for a clean result to mean
 * anything. `app/` and `lib/decision-os/` are both large; a scan that sees fewer than
 * this broke rather than found a clean tree.
 */
const MIN_SCANNED = 50

/**
 * Walks `dir`, recording files that reference the module, and returns how many files
 * it actually read.
 *
 * The count is load-bearing. `readdirSync` failing used to `return` silently, so a
 * renamed or unreadable directory left `matches` empty and this guard PASSED while
 * scanning nothing — the failure mode is indistinguishable from success. Callers
 * assert on the count so the guard fails closed instead.
 */
function walk(dir: string, matches: string[]): number {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return 0
  }
  let scanned = 0
  for (const entry of entries) {
    if (entry === 'node_modules' || entry.startsWith('.next')) continue
    const full = path.join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      scanned += walk(full, matches)
    } else if (/\.(ts|tsx|js|jsx)$/.test(entry)) {
      scanned += 1
      if (ALLOWED_REFERENCES.has(full)) continue
      const content = readFileSync(full, 'utf8')
      if (REFERENCE_PATTERN.test(content)) matches.push(full)
    }
  }
  return scanned
}

describe('lib/decision-os-core Phase 1 isolation', () => {
  it(
    'is not imported anywhere under app/',
    () => {
      const matches: string[] = []
      const scanned = walk(path.join(REPO_ROOT, 'app'), matches)
      expect(scanned, `only scanned ${scanned} files under app/ (<${MIN_SCANNED}) — the walk is broken, so a clean result proves nothing`)
        .toBeGreaterThan(MIN_SCANNED)
      expect(matches, `unsanctioned decision-os-core references under app/:\n${matches.join('\n')}`).toEqual([])
    },
    90000,
  )

  it('is not imported anywhere under lib/decision-os/ except the one sanctioned dco.ts exception', () => {
    const matches: string[] = []
    const scanned = walk(path.join(REPO_ROOT, 'lib', 'decision-os'), matches)
    expect(scanned, `only scanned ${scanned} files under lib/decision-os/ (<${MIN_SCANNED}) — the walk is broken, so a clean result proves nothing`)
      .toBeGreaterThan(MIN_SCANNED)
    expect(matches, `unsanctioned decision-os-core references under lib/decision-os/:\n${matches.join('\n')}`).toEqual([])
  })

  it('dco.ts really does reference decision-os-core (the allowlist entry is not stale)', () => {
    const dcoPath = path.join(REPO_ROOT, 'lib', 'decision-os', 'commissioner-health', 'dco.ts')
    const content = readFileSync(dcoPath, 'utf8')
    expect(REFERENCE_PATTERN.test(content)).toBe(true)
  })
})
