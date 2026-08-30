/**
 * There must be exactly ONE derivation of the ADP context tuple in production code.
 *
 * ð THIS BUG HAS APPEARED THREE TIMES, IN THREE FILES, AND WAS INVISIBLE EVERY TIME.
 * `contextHash` is a sha256 over seven fields, so a single differing field returns ZERO rows â
 * and `AllFantasyAdpSnapshot` readers never fall back to market ADP by design, so an empty result
 * renders as em-dashes, which is exactly what the product shows when there genuinely are no
 * samples. A mismatched hash and a cold table are indistinguishable on screen.
 *
 * The three copies, and what each got wrong:
 *
 *   lib/adp/recomputeAllFantasyAdp.ts       the writer â session-derived (correct by definition)
 *   lib/adp/readSnapshotForLeague.ts        read settings.draft.type and League.leagueSize
 *   lib/draft-room/getResolvedDraftPoolForLeague.ts
 *                                           same two mistakes, on the screen a manager stares at
 *                                           mid-draft
 *
 * A unit test of any one of them passes in isolation. Only agreement matters, and agreement is
 * only guaranteed if there is one derivation. So this test does not check behaviour â it checks
 * that nobody has written a fourth copy.
 *
 * Sibling test `context-hash-agreement.test.ts` proves the writer and reader actually land on the
 * same string end to end. This one stops the next copy from being added.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { globSync } from 'node:fs'

const root = resolve(__dirname, '..', '..')

/**
 * Files allowed to call `buildContextHash`, and why.
 *
 * Adding an entry here is a deliberate decision that needs a reason, exactly like the
 * db-first allowlist. A new caller that builds its own tuple literal is the bug this test exists
 * to catch â route it through `buildDraftContext` instead.
 */
const ALLOWED: Record<string, string> = {
  'lib/adp/computeAllFantasyAdp.ts': 'defines buildContextHash',
  'lib/adp/loadAdpBoard.ts':
    'THE board loader - hashes the output of buildDraftContext; both readers go through it',
  'scripts/audit-allfantasy-adp-readiness.ts':
    'readiness audit - hashes the output of buildDraftContext',
  'scripts/seed-test-adp-drafts.ts': 'test-data seeder, not a production read path',
}

/*
 * ⚠ A FILE CAN VANISH BETWEEN THE GLOB AND THE READ. This checkout is shared by several
 * concurrent sessions, and a peer's throwaway script (`scripts/_tmp-join.ts`, observed) can be
 * created and deleted inside this test's own runtime. Only ENOENT is swallowed - any other read
 * error still throws, because "I could not read this file" must not quietly become "this file is
 * clean".
 */
function readIfPresent(abs: string): string | null {
  try {
    return readFileSync(abs, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return null
    throw err
  }
}

/*
 * The tell of a hand-built tuple: the rosterFormat literal sitting next to a buildContextHash
 * call. buildDraftContext is the only place it belongs.
 *
 * Deliberately a substring test rather than a regex. The first version of this was
 * /rosterFormat:\s*'standard'/, the escape was lost in transit, and it shipped as
 * /rosterFormat:s*'standard'/ -- zero-or-more literal 's', which never matches the way
 * prettier actually formats this. A detector that cannot fire is worse than no detector,
 * so `detectorFiresOnKnownPositive` below proves this one does.
 */
function hasRosterFormatLiteral(src: string): boolean {
  return (
    src.includes("rosterFormat: 'standard'") ||
    src.includes("rosterFormat:'standard'")
  )
}

function sourceFiles(): string[] {
  const patterns = ['lib/**/*.ts', 'lib/**/*.tsx', 'app/**/*.ts', 'app/**/*.tsx', 'components/**/*.tsx', 'scripts/**/*.ts']
  const out = new Set<string>()
  for (const p of patterns) {
    for (const f of globSync(p, { cwd: root })) out.add(f.split('\\').join('/'))
  }
  return [...out]
}

describe('one derivation of the ADP context tuple', () => {
  const callers = sourceFiles().filter((rel) => {
    const src = readIfPresent(resolve(root, rel))
    return src != null && src.includes('buildContextHash(')
  })

  it('finds the known callers - a positive control, so an empty list cannot pass', () => {
    // If the scan is broken, this fails rather than silently reporting "no violations".
    expect(callers.length).toBeGreaterThanOrEqual(2)
    expect(callers).toContain('lib/adp/computeAllFantasyAdp.ts')
    expect(callers).toContain('lib/adp/loadAdpBoard.ts')
  })

  /*
   * The WRITER is deliberately absent from that list. `recomputeAllFantasyAdp` never calls
   * buildContextHash itself - `aggregateAdp` hashes `pick.context` internally, and that context
   * comes from `deriveContext`, which delegates to buildDraftContext. So the writer is covered by
   * the agreement test rather than by this scan, and asserting it here would fail for correct
   * code. Worth stating, because "the writer is missing" reads like a hole and is not one.
   */
  it('the writer reaches the hash through aggregateAdp, still via buildDraftContext', () => {
    const src = readIfPresent(resolve(root, 'lib/adp/recomputeAllFantasyAdp.ts'))
    expect(src).not.toBeNull()
    expect(src!).toContain('buildDraftContext')
    expect(src!.includes('buildContextHash(')).toBe(false)
  })

  it('has no caller outside the allowlist', () => {
    const unexpected = callers.filter((rel) => !(rel in ALLOWED))
    expect(unexpected).toEqual([])
  })

  it('every allowlisted production caller derives through buildDraftContext', () => {
    const offenders: string[] = []
    for (const rel of callers) {
      if (rel === 'lib/adp/computeAllFantasyAdp.ts') continue // the definition site
      if (rel === 'scripts/seed-test-adp-drafts.ts') continue // seeder, not a read path
      const src = readIfPresent(resolve(root, rel))
      if (src != null && !src.includes('buildDraftContext')) offenders.push(rel)
    }
    expect(offenders).toEqual([])
  })

  it('the rosterFormat detector actually matches something', () => {
    /*
     * lib/adp/draftContextKey.ts is the ONE file that legitimately contains this literal - it
     * is where the tuple is built. If the detector cannot find it there, the "no offenders"
     * result below is meaningless. This is the positive control for that check.
     */
    const src = readIfPresent(resolve(root, 'lib/adp/draftContextKey.ts'))
    expect(src).not.toBeNull()
    expect(hasRosterFormatLiteral(src!)).toBe(true)
  })

  it('no production caller hand-builds the tuple with a rosterFormat literal', () => {
    /*
     * The tell of an inline copy: `rosterFormat: 'standard'` next to a buildContextHash call.
     * buildDraftContext is the only place that literal belongs.
     */
    const offenders: string[] = []
    for (const rel of callers) {
      if (rel === 'lib/adp/computeAllFantasyAdp.ts') continue
      if (rel === 'scripts/seed-test-adp-drafts.ts') continue
      const src = readIfPresent(resolve(root, rel))
      if (src != null && hasRosterFormatLiteral(src)) offenders.push(rel)
    }
    expect(offenders).toEqual([])
  })
})
