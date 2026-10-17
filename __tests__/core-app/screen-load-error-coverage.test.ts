/**
 * A league-scoped /core screen whose read FAILS must not render the league picker.
 *
 * 🛑 THE BUG THIS GUARDS, IN ITS OWN WORDS (components/core-app/ScreenLoadError.tsx): every
 * league-scoped loader wrapped its read in `.catch(() => null)`, and the render branch treats null
 * as "no league in context" — so any transient failure silently landed a manager who HAD selected a
 * league on the cross-league picker, with no error and nothing logged. "Picking the same league
 * again usually fixed it, which is exactly the kind of bug that never gets reported." Measured on
 * /core/matchup: three runs of one commit against one seeded league rendered the box score twice
 * and the picker once.
 *
 * My Team, Matchup and Trade Center were fixed when that component was written. Waivers, Draft HQ
 * and the War Room still had the bare `.catch(() => null)` and are fixed here.
 *
 * ── ⚠ WHY THIS IS A SHAPE GUARD AND NOT A RENDER TEST ───────────────────────────────────────
 *
 * The page is a 4,600-line async server component that awaits ~40 loaders, a session, a paywall
 * resolver and a league context before it renders anything. Driving it to the "read failed" branch
 * from a test means standing all of that up to make exactly one of those reads reject — which
 * would pin the mock wiring far harder than it pins the behaviour. This asserts the three parts
 * that must exist together instead, and says so rather than implying coverage it does not have.
 *
 * 🛑 AND IT FORBIDS A SHAPE, NOT A WORD, because a source guard that matches one spelling is
 * satisfied by prose about the thing it wants. Each screen must have: a failure FLAG, a log on the
 * `[core/<screen>] ... failed` convention, and a `ScreenLoadError` in its render branch.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const PAGE = readFileSync(join(process.cwd(), 'app/core/(shell)/[[...screen]]/page.tsx'), 'utf8')

/** Comment blocks stripped: this file's own header names the strings it checks for. */
const CODE = PAGE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/**
 * Screens that (a) read per-league data and (b) fall through to `PickALeague` or a cross-league
 * board when that read returns null — i.e. the ones where a failure is indistinguishable from
 * "no league chosen".
 */
const GUARDED = [
  { key: 'my-team', flag: 'myTeamLoadFailed', log: '[core/my-team]' },
  { key: 'matchup', flag: 'matchupLoadFailed', log: '[core/matchup]' },
  { key: 'trades', flag: 'tradesLoadFailed', log: '[core/trades]' },
  { key: 'waivers', flag: 'waiversLoadFailed', log: '[core/waivers]' },
  { key: 'draft-hq', flag: 'draftHqLoadFailed', log: '[core/draft-hq]' },
  { key: 'war-room', flag: 'scoutLoadFailed', log: '[core/war-room]' },
] as const

describe('every league-scoped /core screen distinguishes a failed read from no league', () => {
  it('imports the error surface at all', () => {
    expect(CODE).toMatch(/ScreenLoadError/)
  })

  for (const { key, flag, log } of GUARDED) {
    it(`${key}: declares a failure flag, logs the failure, and renders ScreenLoadError`, () => {
      // 1. the flag exists and is a mutable `let` — a `const false` could never be set
      expect(CODE).toMatch(new RegExp(`let\\s+${flag}\\s*=\\s*false`))

      // 2. the catch both records the failure and says so in the log, on the shared convention
      expect(CODE).toContain(`${flag} = true`)
      expect(CODE).toContain(log)

      // 3. the flag actually reaches a render branch. Without this the flag is set and ignored,
      //    which looks exactly like the fix while behaving exactly like the bug.
      const branch = new RegExp(`${flag}\\s*\\?\\s*\\(?\\s*<ScreenLoadError`)
      expect(CODE).toMatch(branch)
    })
  }

  it('leaves no league-scoped read swallowing to a bare null on those screens', () => {
    /*
     * The shape that caused it: `getXData(selectedLeagueId, …).catch(() => null)`. Any of the six
     * loaders above reverting to that form drops its flag with no other visible change.
     */
    for (const loader of [
      'getMyTeamData',
      'getMatchupData',
      'getWaiversData',
      'getDraftHqData',
      'getScoutData',
    ]) {
      const bare = new RegExp(`${loader}\\([^)]*\\)\\.catch\\(\\(\\)\\s*=>\\s*null\\)`)
      expect(CODE).not.toMatch(bare)
    }
  })
})
