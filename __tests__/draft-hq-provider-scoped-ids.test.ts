/**
 * A draft board that named a basketball player.
 *
 * The first ESPN league ever imported rendered its picks like this:
 *
 *   13.04  Liutauras Lelevicius            <- rolling_insights 15013, NCAAB
 *    4.15  Carnell Tate                    <- also present under cfbd/NCAAF
 *    5.04  Player 2577417 (not yet mapped)
 *
 * Twelve honest blanks and two confident lies. The lookup matched
 * `providerPlayerId` with no provider filter, so an ESPN athlete id was compared
 * against every provider's id space at once — and 16,710 ids in that table appear
 * under two or more sports, so collisions are the norm, not an edge case.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const FILE = readFileSync(resolve(process.cwd(), 'lib/core-app/draftHq.ts'), 'utf8').replace(
  /\r\n/g,
  '\n',
)

describe('⚠ an id is only meaningful alongside its provider', () => {
  it('scopes the identity lookup to the league platform', () => {
    expect(FILE).toContain('where: { provider: scoped, providerPlayerId: { in: playerIds } }')
  })

  it('reads the platform from the league rather than assuming one', () => {
    expect(FILE).toContain('select: { platform: true }')
    expect(FILE).toContain("const scoped = String(platform ?? '').trim().toLowerCase()")
  })

  it('runs the Sleeper lookup ONLY for a Sleeper league', () => {
    /*
     * The hole that is easy to miss: `sleeperId` reads like a filter but holds
     * numeric strings, so an ESPN id matches one just as readily. Scoping the
     * first query achieves nothing while a second unscoped one runs beside it.
     */
    expect(FILE).toContain("scoped === 'sleeper'")
  })

  it('asks nothing at all when the platform is unknown', () => {
    // Querying with an empty provider would match no rows on a good day and is
    // meaningless on a bad one; not asking is the honest form of not knowing.
    expect(FILE).toContain('Promise.resolve([])')
  })
})

describe('⚠ ONE resolver, because two drifted apart within a day', () => {
  it('leaves no unscoped lookup anywhere in the file', () => {
    /*
     * This is the assertion that would have caught it. A refactor extracted a
     * shared `resolvePlayerNames` for the full draft board and dropped the
     * provider filter, while the personal pick list kept its own scoped copy —
     * so the two surfaces reading the SAME DraftFact rows could name a pick
     * differently, and the new helper's comment claimed they could not.
     *
     * Asserted on the exact query text, which appears in no comment.
     */
    expect(FILE).not.toContain('where: { providerPlayerId: { in: playerIds } }')
  })

  it('has exactly one Sleeper lookup, and it is behind the gate', () => {
    /*
     * Counted rather than asserted absent: the scoped query legitimately contains
     * this text, so `not.toContain` would fail on the correct code — which is how
     * the first version of this test failed. One gate, one query.
     */
    const gates = FILE.split("scoped === 'sleeper'").length - 1
    const queries = FILE.split('sleeperId: { in: playerIds }').length - 1
    expect(gates).toBe(1)
    expect(queries).toBe(1)
  })

  it('defines the resolver exactly once', () => {
    const defs = FILE.split('\n').filter((l) => l.includes('async function resolvePlayerNames'))
    expect(defs).toHaveLength(1)
  })

  it('has both surfaces pass a platform into it', () => {
    // The board and the personal list. Neither may call it bare.
    expect(FILE).toContain("boardLeague?.platform ?? ''")
    expect(FILE).toContain("league?.platform ?? ''")
    expect(FILE).toContain('THE SHARED RESOLVER, NOT A SECOND COPY')
  })
})

describe('⚠ a wrong name is worse than no name', () => {
  it('still says so, in the code, next to the decision', () => {
    expect(FILE).toContain('AN ID MEANS NOTHING WITHOUT THE PROVIDER THAT ISSUED IT')
    expect(FILE).toContain('THE SLEEPER LOOKUP HAD THE SAME HOLE')
  })

  it('keeps the unresolved label rather than inventing one', () => {
    /*
     * An unmapped pick prints its raw provider id. That is a poor label and a
     * true one; a stranger's name is neither, and the reader cannot tell the two
     * apart on screen.
     */
    expect(FILE).toContain('(not yet mapped)')
  })

  it('records the measurement, so nobody re-widens this to "fix" the blanks', () => {
    // The blanks are correct: there are zero espn rows in that table, so an ESPN
    // league resolves nothing until an ESPN identity source is ingested.
    expect(FILE).toContain('12,074')
    expect(FILE).toContain('16,710')
  })
})
