import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * G.1 — DB-side name canonicalization in `loadRollingInsightsSeasonByDraftPoolKey`.
 *
 * Before the fix, the loader queried `PlayerIdentityMap` with `WHERE normalizedName IN (nkSet)`
 * and then keyed `namePosToRi` with `m.normalizedName.trim().toLowerCase()`. The pool side
 * canonicalizes via `canonicalName` (strips Jr/Sr/III, apostrophes, dots, etc.), but the DB
 * stores the raw form ("brian thomas jr."). Result: every suffix-bearing player fell through
 * to `snapshot_projection` (PPG-only, no per-stat splits) — Brian Thomas Jr., Patrick Mahomes II,
 * Marvin Harrison Jr., etc.
 *
 * The fix is read-only: drop the by-name WHERE filter (NFL identity table is small enough
 * to scan once), and apply `canonicalName` to `m.normalizedName` when keying the in-memory
 * lookup so it agrees with the pool side. No data migration.
 *
 * This file asserts the source code shape — runtime verification lives in
 * `scripts/check-resolver-projections.ts` (proves Brian Thomas Jr. resolves to `source: 'mixed'`
 * with non-null receiving/rushing splits when run against the real DB).
 */

const root = resolve(__dirname, '..', '..')
function read(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8')
}

describe('G.1 — RI loader canonicalizes DB-side normalizedName', () => {
  const src = read('lib/draft/analytics/nfl-rolling-insights-draft-analytics.ts')

  it('imports `canonicalName` from the shared identity helper', () => {
    expect(src).toMatch(
      /import \{ canonicalName \} from '@\/lib\/draft-room\/player-canonical-identity'/,
    )
  })

  it('namePosToRi keys are built with canonicalName(m.normalizedName)', () => {
    expect(src).toMatch(/const nk = canonicalName\(m\.normalizedName \?\? ''\)/)
  })

  it('drops the `normalizedName: { in: nkSet }` WHERE filter that broke suffix-bearing names', () => {
    // Before the fix the by-name query had `where: { ..., normalizedName: { in: nkSet }, ... }`.
    // After the fix the WHERE only filters by sport + rollingInsightsId — the canonicalization
    // happens in memory.
    expect(src).not.toMatch(/normalizedName:\s*\{\s*in:\s*nkSet\s*\}/)
  })

  it('comment references G.1 and links the asymmetric-normalization root cause', () => {
    expect(src).toMatch(/G\.1/)
    expect(src).toMatch(/canonicalName/)
  })

  it('preserves the E.2 pk-case-mismatch fix (position still lowercased to match pool side)', () => {
    expect(src).toMatch(/E\.2 bug fix/)
    expect(src).toMatch(/const pk = \(m\.position \?\? ''\)\.trim\(\)\.toLowerCase\(\)/)
  })
})
