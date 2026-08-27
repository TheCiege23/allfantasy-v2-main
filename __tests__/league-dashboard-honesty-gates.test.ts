import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  isScored,
  resolveCurrentWeekFrom,
  type WeekScoreRow,
} from '@/lib/core-app/currentWeek'
import { describeTeamOutlook } from '@/lib/core-app/seasonOutlook'
import { settingsNavBadges } from '@/app/settings/components/settingsNavBadges'
import type { SettingsProfile } from '@/app/settings/components/sections/settings-types'

/**
 * The 38a league dashboard's honesty gates.
 *
 * ⚠ THESE ARE NOT COVERAGE TESTS. Each one pins a rule that, if quietly
 * reverted, produces a screen that looks fine and states something false — the
 * failure mode this whole suite was built to avoid. They are cheap to keep and
 * the thing they protect is not obvious from reading the call site.
 *
 * Deliberately dependency-free: no prisma, no fetch, no fixtures. Every rule
 * below is either a pure function or a text assertion against source, so this
 * file runs anywhere and cannot be broken by database state.
 */

const REPO = process.cwd()
const read = (p: string) => readFileSync(join(REPO, p), 'utf8')

/**
 * Source with comments removed.
 *
 * ⚠ NEEDED BECAUSE THE COMMENTS IN THIS CODEBASE DISCUSS THE VERY THINGS THESE
 * TESTS FORBID. `publicStandings/page.tsx` explains "404, NEVER 403" and
 * `leagueCareer.ts` explains why it does not call `getTradeGrades()` — both
 * assertions failed first time round by matching the prose that documents the
 * rule rather than a violation of it. Asserting on raw source punishes the file
 * for being well commented.
 */
function code(path: string): string {
  return read(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function row(seasonYear: number, week: number, pf: number, pa = 0): WeekScoreRow {
  return { seasonYear, week, pointsFor: pf, pointsAgainst: pa }
}

describe('current week — the max(week) trap', () => {
  /*
   * The shape that caused it: the Sleeper sync bootstraps all 18 weeks as 0-0
   * rows before a single game. Production 2026-08-23 measured season 2026 at
   * 9,354 rows with none scored, out to week 18.
   */
  it('picks the earliest UNSCORED week, not the newest week on file', () => {
    const rows: WeekScoreRow[] = [
      row(2026, 1, 120, 98),
      row(2026, 2, 0, 0),
      row(2026, 3, 0, 0),
      row(2026, 18, 0, 0),
    ]
    const resolved = resolveCurrentWeekFrom(rows)
    expect(resolved?.week).toBe(2)
    // The bug this replaces would have answered 18.
    expect(resolved?.week).not.toBe(18)
  })

  it('a fully bootstrapped season reports zero scored weeks', () => {
    const rows = [1, 2, 3, 18].map((w) => row(2026, w, 0, 0))
    const resolved = resolveCurrentWeekFrom(rows)
    expect(resolved?.scoredWeeks).toBe(0)
    expect(resolved?.week).toBe(1)
  })

  it('falls back to the last week only once every week is scored', () => {
    const rows = [row(2025, 1, 110, 90), row(2025, 2, 105, 120)]
    const resolved = resolveCurrentWeekFrom(rows)
    expect(resolved?.seasonComplete).toBe(true)
    expect(resolved?.week).toBe(2)
  })

  it('prefers the latest season on file over an older complete one', () => {
    const rows = [row(2025, 17, 130, 120), row(2026, 1, 0, 0)]
    expect(resolveCurrentWeekFrom(rows)?.season).toBe(2026)
  })

  it('a 0-0 row is unscored; any point on either side makes it scored', () => {
    expect(isScored({ pointsFor: 0, pointsAgainst: 0 })).toBe(false)
    expect(isScored({ pointsFor: 0.1, pointsAgainst: 0 })).toBe(true)
    expect(isScored({ pointsFor: 0, pointsAgainst: 0.1 })).toBe(true)
  })
})

describe('standings refuse to rank an unplayed season', () => {
  /*
   * The loader returns an unavailable result when scoredWeeks is 0. Ranking a
   * freshly synced league would otherwise order twelve teams tied on 0.0 by
   * whatever the sort happened to leave, presented as a result — and on the
   * public page that is what a search engine would index.
   */
  it('the private board gates on scoredWeeks === 0', () => {
    const src = read('lib/core-app/leagueStandings.ts')
    expect(src).toContain('resolved.scoredWeeks === 0')
  })

  it('the public page gates on it too', () => {
    const src = read('lib/core-app/publicStandings.ts')
    expect(src).toMatch(/resolved\.scoredWeeks === 0/)
  })
})

describe('public standings — privacy gates', () => {
  const src = read('lib/core-app/publicStandings.ts')

  it('never selects ownerName: publishing standings is not publishing people', () => {
    expect(src).not.toMatch(/ownerName:\s*true/)
  })

  it('requires an explicit opt-in and never a truthy coercion', () => {
    expect(src).toContain("publicStandings === true")
  })

  it('returns null — not a reason — so 404 cannot be told from 403', () => {
    // Every failure path returns the same null; a discriminated reason here
    // would let someone enumerate which league ids exist.
    expect(src).not.toMatch(/return\s*\{\s*available:\s*false/)
  })

  it('the page renders notFound() rather than a forbidden state', () => {
    const page = code('app/standings/[leagueId]/page.tsx')
    expect(page).toContain('notFound()')
    // No forbidden/unauthorized response anywhere in the executable path.
    expect(page).not.toMatch(/403/)
    expect(page).not.toMatch(/forbidden/i)
  })

  it('is the only screen in the suite that asks to be indexed', () => {
    const page = read('app/standings/[leagueId]/page.tsx')
    expect(page).toMatch(/index:\s*true/)
    // …and an unpublished league still gets noindex, so a 404 cannot leak a
    // real league name through its title.
    expect(page).toMatch(/index:\s*false/)
  })

  it('/core stays noindex', () => {
    const core = read('app/core/[[...screen]]/page.tsx')
    expect(core).toMatch(/robots:\s*\{\s*index:\s*false/)
  })
})

describe('notification badge — the resolver drops a saved globalEnabled', () => {
  const base = {
    userId: 'u1',
    sleeperUserId: null,
    discordUserId: null,
    spotifyConnectedAt: null,
  } as unknown as NonNullable<SettingsProfile>

  /*
   * resolveNotificationPreferences returns defaults early when `categories` is
   * absent, discarding `globalEnabled: false` on the way past. A badge trusting
   * only the resolved value would tell a user notifications were ON while
   * nothing could reach them.
   */
  it('reports OFF for globalEnabled:false even with no categories saved', () => {
    const badges = settingsNavBadges({
      ...base,
      notificationPreferences: { globalEnabled: false },
    })
    expect(badges.notifications?.text).toBe('OFF')
  })

  it('reports OFF when every category has all channels off', () => {
    const categories = Object.fromEntries(
      ['lineup_reminders', 'matchup_results'].map((id) => [
        id,
        { enabled: true, inApp: false, email: false, sms: false },
      ]),
    )
    const badges = settingsNavBadges({
      ...base,
      notificationPreferences: { globalEnabled: true, categories },
    })
    // Defaults fill the remaining categories as on, so this specific pair is
    // not enough to silence the account — the badge must NOT fire.
    expect(badges.notifications).toBeUndefined()
  })

  it('shows no badge when notifications are reachable', () => {
    const badges = settingsNavBadges({ ...base, notificationPreferences: null })
    expect(badges.notifications).toBeUndefined()
  })
})

describe('connected accounts badge', () => {
  const base = {
    userId: 'u1',
    notificationPreferences: null,
  } as unknown as NonNullable<SettingsProfile>

  it('counts only profile-level links', () => {
    const badges = settingsNavBadges({
      ...base,
      sleeperUserId: 'sleeper-1',
      discordUserId: 'discord-1',
      spotifyConnectedAt: null,
    } as unknown as NonNullable<SettingsProfile>)
    expect(badges.connected?.text).toBe('2')
  })

  it('renders nothing at zero rather than a "0"', () => {
    const badges = settingsNavBadges({
      ...base,
      sleeperUserId: null,
      discordUserId: null,
      spotifyConnectedAt: null,
    } as unknown as NonNullable<SettingsProfile>)
    expect(badges.connected).toBeUndefined()
  })
})

describe('per-team outlook is a condition, never a status word', () => {
  const team = (playoffPct: number, modelled = true) =>
    ({ playoffPct, modelled }) as Parameters<typeof describeTeamOutlook>[0]

  it('says so plainly when a team is not modelled', () => {
    expect(describeTeamOutlook(team(0, false), 4, 6)).toMatch(/too few/i)
  })

  it('never returns a bare status like "In contention"', () => {
    for (const pct of [0, 3, 20, 45, 70, 90, 99.9]) {
      const s = describeTeamOutlook(team(pct), 4, 6)
      expect(s.length).toBeGreaterThan(0)
      expect(s).not.toBe('In contention')
      expect(s).not.toBe('Out')
    }
  })
})

describe('league career withholds what the warehouse cannot support', () => {
  const src = read('lib/core-app/leagueCareer.ts')

  it('excludes incomplete fixtures from every summary (ADR F2.10 policy 3)', () => {
    expect(src).toContain('isCompleted')
    expect(src).toMatch(/winnerTeamId == null/)
  })

  it('never derives a playoff or title count', () => {
    // isPlayoff is not stored; inferring it from week numbers fabricates the one
    // number a manager would repeat out loud.
    expect(src).not.toMatch(/isPlayoff/)
    expect(src).not.toMatch(/championships/i)
  })

  it('reads trade grades from cache rather than calling the provider builder', () => {
    expect(src).toContain('sportsDataCache')
    /*
     * The real guarantee is that the provider-touching module is never imported
     * — which is also what keeps this file clean under
     * scripts/check-db-first-api-boundary.mjs. Checking the import is stronger
     * than checking for a call, and it does not trip on the comment explaining
     * why the call is avoided.
     */
    expect(code('lib/core-app/leagueCareer.ts')).not.toMatch(
      /from '@\/lib\/trade-intel\/sleeperTradeGradeService'/,
    )
    expect(code('lib/core-app/leagueCareer.ts')).not.toMatch(/getTradeGrades\s*\(/)
  })
})

describe('accessibility of the new screens', () => {
  const SCREENS = [
    'LiveScores',
    'Standings',
    'SeasonOutlookLeague',
    'YourWeekLeague',
    'LeagueCareer',
    'LeagueSync',
    'CommissionerHub',
  ]

  /*
   * `role="tab"` without `aria-controls` announces "tab 3 of 7" and then offers
   * the user nothing to move into. If a screen declares tabs, they must point at
   * a real tabpanel.
   */
  it('every role="tab" points at a tabpanel that exists', () => {
    for (const name of SCREENS) {
      const src = code(`components/core-app/screens/${name}.tsx`)
      if (!src.includes('role="tab"')) continue

      const controls = [...src.matchAll(/aria-controls="([^"]+)"/g)].map((m) => m[1])
      expect(controls.length, `${name} declares tabs without aria-controls`).toBeGreaterThan(0)
      expect(src, `${name} has no tabpanel for its tabs`).toContain('role="tabpanel"')

      for (const id of new Set(controls)) {
        expect(src, `${name}: nothing carries id="${id}"`).toContain(`id="${id}"`)
      }
    }
  })

  /*
   * Section titles were `<p className="af-label">` — styled like headings,
   * navigated like body text, so a screen-reader user moving by heading skipped
   * every section on the page.
   */
  it('screens with sections expose them as headings', () => {
    for (const name of SCREENS) {
      const src = code(`components/core-app/screens/${name}.tsx`)
      const sections = (src.match(/<section/g) ?? []).length
      if (sections < 2) continue
      const headings = (src.match(/<h[23]/g) ?? []).length
      expect(headings, `${name} has ${sections} sections but ${headings} headings`).toBeGreaterThan(0)
    }
  })

  it('af-label headings carry no margin, so flex gap is the only spacing', () => {
    // `<h2>` brings the UA's margin with it and af-core.css has no reset; every
    // one of these sits in a flex column with its own gap, where margin
    // double-counts.
    const core = read('components/core-app/af-core.css')
    expect(core).toMatch(/h2\.af-label/)
  })
})

describe('every nav item resolves to a real screen', () => {
  /*
   * The "this screen has not been built yet" panel shipped in a primary nav slot
   * for every user until this suite. This is the check that keeps it
   * unreachable.
   */
  it('has no nav key without a render branch', () => {
    const shell = code('components/core-app/AfCoreShell.tsx')
    const route = code('app/core/[[...screen]]/page.tsx')
    /*
     * code(), not read(): the comments here name paths like
     * `lib/core-app/career.ts`, and 'lib/core-app' contains the substring
     * '/core'. Matching prose made an external exit look like a /core screen.
     */

    /*
     * ⚠ NOT EVERY NAV KEY IS A /core SCREEN. The shell deliberately lists exits
     * to full pages that live OUTSIDE /core — My Leagues, League Sync and
     * Settings — so the /core cutover does not orphan them. Those have no
     * `activeKey ===` branch by design, and demanding one would be wrong.
     *
     * The gate that matters is narrower and still exact: every nav item that
     * points INTO /core must have a branch, or it lands on the "has not been
     * built yet" panel this whole suite exists to remove.
     */
    /*
     * Each entry's window stops at the NEXT key, not at a fixed byte count. A
     * one-line entry like `league-sync` otherwise spills into its neighbour and
     * inherits a /core href it does not have — which read as an orphan.
     */
    const keyMatches = [...shell.matchAll(/key: '([a-z-]+)'/g)]
    const entries = keyMatches.map((m, i) => {
      const start = m.index ?? 0
      const next = keyMatches[i + 1]?.index ?? shell.length
      return { key: m[1], window: shell.slice(start, Math.min(next, start + 400)) }
    })
    const branchKeys = new Set(
      [...route.matchAll(/activeKey === '([a-z-]+)'/g)].map((m) => m[1]),
    )

    const intoCore = entries.filter((e) => e.window.includes('/core'))
    const orphans = intoCore.map((e) => e.key).filter((k) => !branchKeys.has(k))
    expect(orphans).toEqual([])

    /*
     * The exemption must not become a hiding place. Anything it excuses has to
     * genuinely be an external link, and there have to BE some — if this list
     * ever empties, the filter above has stopped selecting and the gate is
     * quietly passing everything.
     */
    const exits = entries.filter((e) => !e.window.includes('/core')).map((e) => e.key)
    expect(exits.length).toBeGreaterThan(0)
    for (const k of exits) expect(branchKeys.has(k)).toBe(false)

    // Floor: an empty nav must not read as a pass.
    expect(entries.length).toBeGreaterThan(15)
  })
})
