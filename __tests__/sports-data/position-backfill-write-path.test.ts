import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { providerPositionCode, isLongFormPosition } from '@/lib/sports-data/providerPositionCode'

/**
 * 🛑 THE TEST THAT DID NOT EXIST, WHICH IS WHY 2,063 PRODUCTION ROWS WERE CORRUPTED.
 *
 * On 2026-09-06 `scripts/backfill-provider-position-codes.mjs` wrote single characters into
 * `SportsPlayer.position` — "Quarterback" -> "u", "Wide Receiver" -> "i" — and reported
 * `written: 2063` while doing it. Restored in full from a pre-write snapshot.
 *
 * ⚠ FIFTEEN TESTS WERE GREEN AT THE TIME. Every one exercised the pure mapper, which was
 * correct. NONE exercised the grouping-and-write loop, which was not. The mapper is the part
 * that is easy to test; the write path is the part that touches production.
 *
 * ⚠ AND THE DRY RUN COULD NOT CATCH IT EITHER: it printed from the `changes` array while the
 * apply path re-derived the target from a string key it had joined and split. Two paths, one
 * rehearsed, and the unrehearsed one was the one that wrote.
 *
 * So this suite reproduces the grouping the script performs and asserts on what would be
 * WRITTEN, not on what would be displayed.
 */

type Row = { id: string; sport: string; position: string }

/**
 * The grouping the script performs, kept in step with it deliberately.
 *
 * ⚠ THIS IS A REIMPLEMENTATION AND THAT IS A KNOWN WEAKNESS — a `.mjs` script that reads
 * `.env` and constructs a PrismaClient at import time cannot be imported into vitest, so the
 * shape is mirrored here and the source is asserted separately below. The source assertions
 * are what stop the two drifting: they pin the absence of the exact construct that failed.
 */
function planUpdates(rows: Row[]): Array<{ to: string; froms: string[]; ids: string[] }> {
  const byTarget = new Map<string, { to: string; froms: Set<string>; ids: string[] }>()
  for (const r of rows) {
    if (!isLongFormPosition(r.position, r.sport)) continue
    const to = providerPositionCode(r.position, r.sport)
    if (!to || to === r.position) continue
    if (!byTarget.has(to)) byTarget.set(to, { to, froms: new Set(), ids: [] })
    const e = byTarget.get(to)!
    e.froms.add(r.position)
    e.ids.push(r.id)
  }
  return [...byTarget.values()].map((e) => ({ to: e.to, froms: [...e.froms], ids: e.ids }))
}

const ROWS: Row[] = [
  { id: 'a', sport: 'NFL', position: 'Quarterback' },
  { id: 'b', sport: 'NFL', position: 'Wide Receiver' },
  { id: 'c', sport: 'NFL', position: 'Wide Receiver' },
  { id: 'd', sport: 'NFL', position: 'Kicker' },
  { id: 'e', sport: 'NFL', position: 'Place Kicker' },
  { id: 'f', sport: 'NFL', position: 'WR' },
  { id: 'g', sport: 'MLB', position: 'Center' },
  { id: 'h', sport: 'NHL', position: 'Center' },
]

describe('🛑 what the backfill would WRITE, not what it would print', () => {
  it('🛑 every written value is a real position code, never a single character', () => {
    /*
     * THE REGRESSION, STATED DIRECTLY. The corrupting run wrote "u", "i", "f" — each a
     * single character sliced out of a joined key. Any write of length 1 that is not a
     * genuine one-letter code is the bug returning.
     */
    const written = planUpdates(ROWS).map((g) => g.to)
    expect(written.length).toBeGreaterThan(0)
    for (const value of written) {
      expect(value).toMatch(/^[A-Z]{1,3}$/)
      expect(['u', 'i', 'f', 'a', 'e', 'n', 'o', 'l']).not.toContain(value)
    }
  })

  it('🛑 writes the TARGET code to the ids that asked for it', () => {
    const plan = planUpdates(ROWS)
    const wr = plan.find((g) => g.to === 'WR')
    expect(wr).toBeDefined()
    expect(wr!.ids.sort()).toEqual(['b', 'c'])
    const qb = plan.find((g) => g.to === 'QB')
    expect(qb!.ids).toEqual(['a'])
  })

  it('collapses two source spellings that share a target into ONE update', () => {
    // Kicker and Place Kicker both -> K. Grouping by target is what makes this one call.
    const k = planUpdates(ROWS).find((g) => g.to === 'K')
    expect(k!.ids.sort()).toEqual(['d', 'e'])
    expect(k!.froms.sort()).toEqual(['Kicker', 'Place Kicker'])
  })

  it('never touches a row that is already a code, or a non-football sport', () => {
    const touched = planUpdates(ROWS).flatMap((g) => g.ids)
    expect(touched).not.toContain('f') // already 'WR'
    expect(touched).not.toContain('g') // MLB Center — C means CATCHER there
    expect(touched).not.toContain('h') // NHL Center — left alone by design
  })

  it('[control] the plan is non-empty and would really write — this is not vacuously green', () => {
    /*
     * Without this, every assertion above would also hold for a planner that returned
     * nothing at all, which is the failure mode a "no bad values were written" test invites.
     */
    const plan = planUpdates(ROWS)
    expect(plan.flatMap((g) => g.ids)).toHaveLength(5)
  })
})

describe('🛑 the script itself no longer contains the construct that failed', () => {
  const RAW = readFileSync(resolve(process.cwd(), 'scripts/backfill-provider-position-codes.mjs'), 'utf8')

  /*
   * ⚠ COMMENTS STRIPPED, AND THE FIRST VERSION OF THIS SUITE FAILED FOR EXACTLY THAT REASON.
   * The script's header DOCUMENTS the broken construct as a warning — quoting
   * `const [from, to] = k.split('')` so the next reader knows what went wrong. A source-text
   * assertion matched that documentation and reported the bug as still present.
   *
   * Which is the general trap with grepping source: it cannot tell code from prose about
   * code, and the better-documented a fix is, the more likely its own explanation trips the
   * test guarding it. Asserting on executable lines only keeps the warning in the file.
   */
  const SRC = RAW.split(/\r?\n/)
    .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
    .join('\n')

  it('[control] the scan is reading the right file', () => {
    expect(RAW).toContain('sportsPlayer.updateMany')
    expect(RAW).toContain('--endpoint=')
  })

  it('🛑 does not rebuild values by splitting a joined string key', () => {
    /*
     * The precise shape that corrupted production: join two values into a key, then split it
     * back apart. A stray byte in the delimiter turns that into character-slicing, and the
     * result is written. There is no delimiter here any more — grouping is by the target
     * value itself.
     */
    expect(SRC).not.toMatch(/const \[from, to\] = .*\.split\(/)
    expect(SRC).not.toMatch(/\.split\(''\)/)
    expect(SRC).toContain('byTarget.set(c.to,')
  })

  it('🛑 verifies against the INTENDED targets, not against the absence of the old values', () => {
    /*
     * The old check counted "long-form rows remaining" and read 0 while every one held a
     * single letter — it passed BECAUSE the data was destroyed. The replacement reads the
     * rows back and compares each against the code the plan intended.
     */
    expect(RAW).toContain('hold the intended code')
    expect(SRC).not.toContain('long-form rows remaining')
  })

  it('⚠ still refuses to write without an explicitly named endpoint', () => {
    expect(RAW).toContain('REFUSING — --apply requires --endpoint=')
    expect(RAW).toContain('APPLY (writes)')
  })
})
