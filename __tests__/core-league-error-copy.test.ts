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

const LEAGUE_SPECIFIC =
  'We could not load this league just now. Return to your leagues or try again.'
const ACCOUNT_WIDE = 'We could not read your leagues just now.'

/**
 * The league-specific branch, isolated.
 *
 * ⚠ ANCHORED ON THE SENTENCE AND WALKED OUTWARDS, NOT ON THE FIRST MATCHING
 * BRANCH IN THE FILE. The first version searched forwards from index 0 for
 * `selectedLeagueId ? (` — which this page also uses about two thousand lines
 * earlier, in `playedLeagues.find(…)` — so the "window" it checked was most of
 * the page and the assertion failed against unrelated code. Finding the copy
 * first and taking the nearest enclosing branch is the only way to be sure the
 * slice is the branch under test, whatever that branch is currently keyed on.
 */
function leagueBranch(flattened: string): string {
  const sentence = flattened.indexOf(LEAGUE_SPECIFIC)
  expect(sentence, 'league-specific copy not found in source').toBeGreaterThan(-1)
  const start = flattened.lastIndexOf('leagueHomeUnavailable ? (', sentence)
  expect(start, 'no enclosing leagueHomeUnavailable branch').toBeGreaterThan(-1)
  const end = flattened.indexOf('Your leagues', sentence)
  expect(end, 'account-wide branch does not follow').toBeGreaterThan(sentence)
  return flattened.slice(start, end)
}

describe('/core error copy names the read that actually failed', () => {
  it('renders the league-specific sentence when one league was requested', () => {
    expect(flat(code(PAGE))).toContain(LEAGUE_SPECIFIC)
  })

  it('gates that sentence on an AUTHORIZED read failure, not merely on a league being selected', () => {
    /*
     * `dash34` is null whenever a league is selected, so gating on it would show
     * this copy for every league-scoped render rather than only the failed ones.
     *
     * ⚠ THE GATE MOVED, AND THAT IS THE POINT. It was `selectedLeagueId`,
     * which was the same condition only while every outcome collapsed into
     * `null`. Now a refusal returns `unauthorized` and leaves through
     * `notFound()` further up, so only an AUTHORIZED read that failed can reach
     * this copy. Gating on `selectedLeagueId` again would put "try again" back in
     * front of people who were refused.
     */
    const flattened = flat(code(PAGE))
    const sentence = flattened.indexOf(LEAGUE_SPECIFIC)
    expect(sentence).toBeGreaterThan(-1)
    expect(flattened.lastIndexOf('leagueHomeUnavailable ? (', sentence)).toBeGreaterThan(-1)
    expect(flattened).toContain("leagueHomeResult?.status === 'unavailable'")
  })

  it('keeps the account-wide sentence for the cross-league dashboard', () => {
    // The old copy is not wrong everywhere — it is right when no league was named.
    expect(flat(code(PAGE))).toContain(ACCOUNT_WIDE)
  })

  it('never implies the whole account is unreadable in the league-specific branch', () => {
    /*
     * 🛑 THE ASSERTION THIS FILE EXISTS FOR. Inside the league-specific branch
     * the account-wide sentence must not appear. A future edit that collapses the
     * two branches back together, or pastes the old wording into the new one,
     * fails here.
     *
     * ⚠ THE CLAIM IS FORBIDDEN, NOT THE PHRASE. An earlier version asserted
     * `not.toMatch(/your leagues/i)` and had to be relaxed when the copy became
     * "Return to your leagues or try again" — which mentions them in order to
     * offer a way out, and asserts nothing about their state. Matching the words
     * rather than the claim would have blocked a correct sentence, so the pattern
     * targets the shape "could not read/load YOUR leagues" instead.
     */
    const branch = leagueBranch(flat(code(PAGE)))

    expect(branch).toContain(LEAGUE_SPECIFIC)
    expect(branch).not.toContain(ACCOUNT_WIDE)
    expect(branch).not.toMatch(/could not (read|load|reach) your leagues/i)
    expect(branch).not.toMatch(/you have none/i)
  })

  it('claims nothing about membership, which this code cannot know', () => {
    /*
     * ⚠ THIS COMMENT USED TO SAY THE CODE COULD NOT KNOW, AND THAT IS NO LONGER
     * WHY. `getLeagueHomeData` now gates on `resolveLeagueMembership` before
     * reading anything, so a non-member never reaches this screen at all — they
     * leave through `notFound()`. The copy still must not discuss membership, but
     * for the opposite reason: by the time this renders, membership is not in
     * question, and raising it would introduce a doubt the situation does not
     * contain. See `core-league-home-authorization.test.ts` for the gate itself.
     */
    const branch = leagueBranch(flat(code(PAGE)))

    expect(branch).not.toMatch(/no longer in it/i)
    expect(branch).not.toMatch(/still (a member|in this league)/i)
  })

  it('claims nothing about the OTHER leagues, whose state it has not read', () => {
    /*
     * 🛑 THE SECOND RETRACTED REASSURANCE. "Your other leagues are unaffected"
     * shipped briefly and was withdrawn: nothing on this path has read the other
     * leagues. `dash34` — the read that would have — is null BY DESIGN whenever a
     * league is selected, so under a systemic database or provider outage every
     * league is failing and that sentence is confidently false at exactly the
     * moment it matters most.
     *
     * The branch may offer a way OUT ("return to your leagues") but may not
     * describe their STATE.
     */
    const branch = leagueBranch(flat(code(PAGE)))

    expect(branch).not.toMatch(/unaffected/i)
    expect(branch).not.toMatch(/other leagues are/i)
    expect(branch).not.toMatch(/only this league/i)
  })
})

describe('the error-copy change touched nothing that decides access', () => {
  /*
   * ⚠ A COPY FIX MUST NOT BECOME AN AUTHORIZATION CHANGE — AND THE CONVERSE.
   * These pin the shape of the read so an edit to the MESSAGE cannot quietly
   * widen or narrow what is loaded. The membership gate itself is now in place
   * and is asserted separately, in `core-league-home-authorization.test.ts`;
   * these assertions are about the call site, not the predicate.
   */
  it('still loads league home only when a league is selected, and no longer swallows failures', () => {
    /*
     * 🛑 THE `.catch(() => null)` IS GONE AND MUST STAY GONE. It collapsed
     * every outcome into one "no data" value, so an authorization refusal and a
     * database timeout were the same thing to this page — which is exactly how a
     * refusal came to be rendered as "we could not load this league, try again".
     * `getLeagueHomeData` now returns a discriminated result and catches its own
     * read failures AFTER the gate.
     */
    const flattened = flat(code(PAGE))
    expect(flattened).toContain("activeKey === 'home' && selectedLeagueId")
    expect(flattened).not.toMatch(/getLeagueHomeData\([^)]*\)[\s\S]{0,80}?\.catch\(/)
    expect(flattened).toContain("leagueHomeResult?.status === 'unauthorized'")
    expect(flattened).toContain('notFound()')
  })

  it('still loads dash34 only when no league is selected', () => {
    expect(flat(code(PAGE))).toContain(
      "(activeKey === 'home' || segment === 'dashboard-v2') && !selectedLeagueId",
    )
  })
})
