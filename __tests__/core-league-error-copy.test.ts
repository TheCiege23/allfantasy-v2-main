import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The /core error copy, when the request named ONE league.
 *
 * ⚠ NOT A COVERAGE TEST. It pins a rule that, reverted, produces a screen that
 * looks fine and states something false — the same class as
 * `league-dashboard-honesty-gates`, and the reason that suite exists.
 *
 * THE BUG. `dash34` is loaded only when NO league is selected; `leagueHome` only
 * when one IS. So with `?league=` present `dash34` is null BY DESIGN rather than
 * by failure, and a `getLeagueHomeData` failure fell through to the cross-league
 * fallback — telling a viewer their whole account was unreadable because a single
 * league did not load. Measured on a running server before the fix:
 * `GET /core?league=<unreadable uuid>` returned 200 rendering "Your leagues / We
 * could not read your leagues just now".
 *
 * ⚠ ASSERTED AGAINST SOURCE, WITH COMMENTS STRIPPED, AND THE STRIPPING IS
 * LOAD-BEARING. The branch under test carries a comment that quotes the very
 * account-wide sentence it exists to avoid, so a raw-text assertion would match
 * the prose documenting the rule instead of a violation of it — punishing the
 * file for being well commented. Same helper, same reason, as
 * `league-dashboard-honesty-gates.test.ts`.
 */

const REPO = process.cwd()

function code(path: string): string {
  return readFileSync(join(REPO, path), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const PAGE = 'app/core/[[...screen]]/page.tsx'

/** Collapses the JSX line wrapping so a sentence can be matched as one string. */
function flat(source: string): string {
  return source.replace(/\s+/g, ' ')
}

const LEAGUE_SPECIFIC = 'We could not read this league just now. Your other leagues are unaffected.'
const ACCOUNT_WIDE = 'We could not read your leagues just now.'

/**
 * The league-specific branch, isolated.
 *
 * ⚠ ANCHORED ON THE SENTENCE AND WALKED OUTWARDS, NOT ON THE FIRST
 * `selectedLeagueId ? (` IN THE FILE. The first version searched forwards from
 * index 0 and matched
 * `selectedLeagueId ? (playedLeagues.find((l) => l.id === selectedLeagueId) …)`
 * roughly two thousand lines earlier, so the "window" it checked was most of the
 * page and the assertion failed against unrelated code. Finding the copy first
 * and taking the nearest enclosing branch is the only way to be sure the slice
 * is the branch under test.
 */
function leagueBranch(flattened: string): string {
  const sentence = flattened.indexOf(LEAGUE_SPECIFIC)
  expect(sentence, 'league-specific copy not found in source').toBeGreaterThan(-1)
  const start = flattened.lastIndexOf('selectedLeagueId ? (', sentence)
  expect(start, 'no enclosing selectedLeagueId branch').toBeGreaterThan(-1)
  const end = flattened.indexOf('Your leagues', sentence)
  expect(end, 'account-wide branch does not follow').toBeGreaterThan(sentence)
  return flattened.slice(start, end)
}

describe('/core error copy names the read that actually failed', () => {
  it('renders the league-specific sentence when one league was requested', () => {
    expect(flat(code(PAGE))).toContain(LEAGUE_SPECIFIC)
  })

  it('gates that sentence on selectedLeagueId, not on dash34 being absent', () => {
    /*
     * `dash34` is null whenever a league is selected, so gating on it would show
     * this copy for every league-scoped render rather than only the failed ones.
     * The branch has to be keyed on the league actually having been requested.
     */
    const flattened = flat(code(PAGE))
    const sentence = flattened.indexOf(LEAGUE_SPECIFIC)
    expect(sentence).toBeGreaterThan(-1)
    expect(flattened.lastIndexOf('selectedLeagueId ? (', sentence)).toBeGreaterThan(-1)
  })

  it('keeps the account-wide sentence for the cross-league dashboard', () => {
    // The old copy is not wrong everywhere — it is right when no league was named.
    expect(flat(code(PAGE))).toContain(ACCOUNT_WIDE)
  })

  it('never implies the whole account is unreadable in the league-specific branch', () => {
    /*
     * 🛑 THE ASSERTION THIS FILE EXISTS FOR. Between the `selectedLeagueId ?`
     * branch opening and the `) : (` that ends it, the account-wide sentence must
     * not appear. A future edit that collapses the two branches back together, or
     * pastes the old wording into the new one, fails here.
     */
    const branch = leagueBranch(flat(code(PAGE)))

    expect(branch).toContain(LEAGUE_SPECIFIC)
    expect(branch).not.toContain(ACCOUNT_WIDE)
    expect(branch).not.toMatch(/your leagues/i)
  })

  it('claims nothing about membership, which this code cannot know', () => {
    /*
     * `getLeagueHomeData` is `findUnique({ where: { id: leagueId } })` with no
     * `userId` clause, so a failure here is indistinguishable from "not a member".
     * Copy reassuring the reader they are still in the league would assert
     * something the data does not support — see the branch's own note.
     */
    const branch = leagueBranch(flat(code(PAGE)))

    expect(branch).not.toMatch(/no longer in it/i)
    expect(branch).not.toMatch(/still (a member|in this league)/i)
  })
})

describe('the error-copy change touched nothing that decides access', () => {
  /*
   * ⚠ A COPY FIX MUST NOT BECOME AN AUTHORIZATION CHANGE. `getLeagueHomeData`'s
   * missing membership scope is a known, separately-tracked defect; this batch
   * deliberately did not touch it. These pin the shape of the read so a later
   * edit to the message cannot quietly widen or narrow what is loaded.
   */
  it('still loads league home only when a league is selected, and still catches to null', () => {
    const flattened = flat(code(PAGE))
    expect(flattened).toContain("activeKey === 'home' && selectedLeagueId")
    expect(flattened).toMatch(/getLeagueHomeData\([^)]*\)[\s\S]{0,80}?\.catch\(\(\) => null\)/)
  })

  it('still loads dash34 only when no league is selected', () => {
    expect(flat(code(PAGE))).toContain(
      "(activeKey === 'home' || segment === 'dashboard-v2') && !selectedLeagueId",
    )
  })
})
