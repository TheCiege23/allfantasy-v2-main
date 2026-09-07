import React from 'react'
import { describe, expect, it } from 'vitest'
import { render, within } from '@testing-library/react'

import { MyTeamBoard } from '@/components/core-app/MyTeamBoard'
import { isAtRisk, isHealthyDesignation, isRuledOut } from '@/lib/core-app/injuryStatus'
import { formatLockLabel } from '@/lib/core-app/lockLabel'
import type { MyTeamPulse, MyTeamRow } from '@/lib/core-app/myTeamPulse'

/*
 * The clock is passed in rather than read from the wall, so nothing in this
 * suite rots with the calendar — the failure mode the my-team screen suite
 * already hit once, where a fixture "three days out" stopped being three days
 * out on a specific date and the assertion went red with no code change.
 */
const NOW = Date.parse('2026-09-10T12:00:00Z')

const ALL_HREF = '/core/my-team?all=1'

function row(over: Partial<MyTeamRow> = {}): MyTeamRow {
  return {
    leagueId: 'l1',
    leagueName: 'Dynasty Warriors',
    platform: 'sleeper',
    logoUrl: null,
    leagueBadge: 'DW',
    teamName: 'Ghosts of Gridiron',
    starters: 9,
    empty: 0,
    out: 0,
    bye: 0,
    questionable: 0,
    unresolved: 0,
    lockAt: '2026-09-13T17:00:00Z',
    locked: false,
    season: 2026,
    week: 2,
    severity: 0,
    href: '/core/my-team?league=l1',
    platformLeagueId: '9990001',
    leagueSeason: 2026,
    teamId: '4',
    ...over,
  }
}

function pulse(over: Partial<MyTeamPulse> = {}): MyTeamPulse {
  return {
    needs: [],
    set: [],
    needsTotal: 0,
    setTotal: 0,
    considered: 1,
    checked: 1,
    byeChecked: true,
    notChecked: { noRoster: 0, noLineup: 0 },
    ...over,
  }
}

/*
 * ⚠ THIS BLOCK EXISTS BECAUSE THE FIRST DRAFT SHIPPED THE BUG IT ASSERTS
 * AGAINST. Treating "any non-empty status" as a designation flagged NINE
 * STARTERS OUT OF TEN as questionable on a real production account, because
 * "Active" is the second most common value in `sportsInjury` — 1,646 rows.
 */
describe('injury designations', () => {
  it('does not treat a healthy or absent designation as a risk', () => {
    for (const s of ['Active', 'active', 'Healthy', 'NA', 'Unrevealed', null, '']) {
      expect(isHealthyDesignation(s)).toBe(true)
      expect(isAtRisk(s)).toBe(false)
    }
  })

  it('treats a bare body part as a risk — he is on the report', () => {
    for (const s of ['Questionable', 'Doubtful', 'Day-To-Day', 'Elbow', 'Hamstring']) {
      expect(isAtRisk(s)).toBe(true)
      expect(isRuledOut(s)).toBe(false)
    }
  })

  it('keeps a ruled-out designation out of the risk bucket', () => {
    for (const s of [
      'Out',
      'IR',
      'PUP',
      'Suspension',
      'Injured Reserve',
      'Did Not Play',
      /* The IL spellings. Baseball and hockey vocabulary, 435 rows, and none of
         them was recognised before this suite existed. */
      '60-day IL',
      '15-day IL',
      '10-day IL',
      'I.L.',
    ]) {
      expect(isRuledOut(s), s).toBe(true)
      expect(isAtRisk(s), s).toBe(false)
    }
  })

  /* The token scan must not rule somebody out for a letter pair inside a word. */
  it('does not rule out a status that merely contains those letters', () => {
    for (const s of ['Air quality', 'Illness', 'Shoulder', 'Questionable']) {
      expect(isRuledOut(s), s).toBe(false)
    }
  })
})

describe('formatLockLabel', () => {
  it('leads with days, so a lock days away is not a four-digit hour count', () => {
    const at = NOW + 3 * 86_400_000 + 4 * 3_600_000
    expect(formatLockLabel(at, NOW).text).toBe('3d 4h')
  })

  it('falls back to a date once a countdown stops being a deadline', () => {
    const label = formatLockLabel(NOW + 40 * 86_400_000, NOW)
    expect(label.text).not.toMatch(/d \d+h$/)
    expect(label.locked).toBe(false)
  })

  it('marks the last hour urgent and a passed lock locked', () => {
    expect(formatLockLabel(NOW + 30 * 60_000, NOW).urgent).toBe(true)
    expect(formatLockLabel(NOW + 5 * 3_600_000, NOW).urgent).toBe(false)
    expect(formatLockLabel(NOW - 1, NOW)).toMatchObject({ locked: true, text: 'Locked' })
  })
})

describe('MyTeamBoard', () => {
  it('names every certain hole in the lineup', () => {
    const { container } = render(
      <MyTeamBoard
        allHref={ALL_HREF}
        now={NOW}
        pulse={pulse({
          needs: [row({ empty: 2, out: 1, bye: 1, questionable: 3, severity: 4 })],
          needsTotal: 1,
        })}
      />,
    )
    const text = container.textContent ?? ''
    expect(text).toContain('slots empty')
    expect(text).toContain('ruled out')
    expect(text).toContain('on bye')
    expect(text).toContain('questionable')
  })

  /*
   * The single most important assertion in this file. `bye: null` means the
   * week's schedule was too thin to judge — rendering it as "0 bye" would be a
   * claim about the most preventable loss in fantasy that we cannot support.
   */
  it('never renders an unchecked bye count as zero', () => {
    const { container } = render(
      <MyTeamBoard
        allHref={ALL_HREF}
        now={NOW}
        pulse={pulse({
          needs: [row({ bye: null, empty: 1, severity: 1 })],
          needsTotal: 1,
          byeChecked: false,
        })}
      />,
    )
    const text = container.textContent ?? ''
    expect(text).not.toContain('0 on bye')
    expect(text).toMatch(/bye check did not run/i)
  })

  /*
   * 🛑 THIS SHIPPED BROKEN AND A PRODUCTION SCREENSHOT CAUGHT IT.
   *
   * On a 94-league account where every readable lineup was fine, the board
   * rendered ZERO rows — `const rows = pulse.needs` threw `pulse.set` away, so
   * "nothing is broken" and "nothing to show" were the same thing. The blurb
   * promises "ranked by time left before lock" and the handoff's own sample rows
   * include leagues whose only fact is a lock time.
   *
   * Urgency is severity THEN clock: a hole you can still fix outranks a clean
   * lineup, and a clean lineup locking in an hour outranks one locking Sunday.
   */
  it('falls back to lineups that are merely locking soon when nothing is broken', () => {
    const { container } = render(
      <MyTeamBoard
        allHref={ALL_HREF}
        now={NOW}
        pulse={pulse({
          needs: [],
          set: Array.from({ length: 6 }, (_, i) =>
            row({ leagueId: `s${i}`, leagueName: `Quiet League ${i}` }),
          ),
          setTotal: 84,
          considered: 94,
          checked: 84,
        })}
      />,
    )
    const names = [...container.querySelectorAll('.af-bd-name')].map((n) => n.textContent)
    expect(names.length).toBeGreaterThan(0)
    expect(names).toContain('Quiet League 0')
    expect(container.textContent ?? '').not.toMatch(/94 more leagues/)
  })

  it('puts a broken lineup above a merely-soon one', () => {
    const { container } = render(
      <MyTeamBoard
        allHref={ALL_HREF}
        now={NOW}
        pulse={pulse({
          set: [row({ leagueId: 'quiet', leagueName: 'Quiet League' })],
          needs: [row({ leagueId: 'broken', leagueName: 'Broken League', empty: 1, severity: 1 })],
          considered: 2,
          checked: 2,
        })}
      />,
    )
    const names = [...container.querySelectorAll('.af-bd-name')].map((n) => n.textContent)
    expect(names[0]).toBe('Broken League')
    expect(names[1]).toBe('Quiet League')
  })

  it('says a bye check ran clean rather than going silent', () => {
    const { container } = render(
      <MyTeamBoard allHref={ALL_HREF} now={NOW} pulse={pulse({ needs: [row()], needsTotal: 1 })} />,
    )
    expect(container.textContent ?? '').not.toMatch(/bye check did not run/i)
  })

  it('shows a clean lineup as SET instead of leaving the row blank', () => {
    const { container } = render(
      <MyTeamBoard allHref={ALL_HREF} now={NOW} pulse={pulse({ needs: [row()], needsTotal: 1 })} />,
    )
    expect(within(container).getByText('SET')).toBeTruthy()
  })

  it('states an unresolved starter without colouring it as a lineup problem', () => {
    const { container } = render(
      <MyTeamBoard
        allHref={ALL_HREF}
        now={NOW}
        pulse={pulse({ needs: [row({ unresolved: 2 })], needsTotal: 1 })}
      />,
    )
    const tag = container.querySelector('.af-bd-tag[data-sev="info"]')
    expect(tag?.textContent).toContain('unidentified')
  })

  /*
   * ⚠ THE FOOTER'S CTA IS THE ONLY ROUTE LEFT TO THE LEAGUE PICKER, so it must
   * render whether or not anything is hidden. Before this board the picker was
   * on the page; if this link ever became conditional, a manager whose lineups
   * are all set would have no way into a league at all.
   */
  it('always offers the route to every league, even with nothing hidden', () => {
    const { container } = render(
      <MyTeamBoard
        allHref={ALL_HREF}
        now={NOW}
        pulse={pulse({ needs: [row()], needsTotal: 1, considered: 1 })}
      />,
    )
    const cta = container.querySelector('.af-bd-foot-cta')
    expect(cta?.getAttribute('href')).toBe(ALL_HREF)
    expect(container.textContent ?? '').toContain('Every league you hold is on this board.')
  })

  it('accounts for the leagues the board did not show', () => {
    const { container } = render(
      <MyTeamBoard
        allHref={ALL_HREF}
        now={NOW}
        pulse={pulse({
          needs: Array.from({ length: 10 }, (_, i) =>
            row({ leagueId: `l${i}`, empty: 1, severity: 1 }),
          ),
          needsTotal: 10,
          considered: 65,
          checked: 65,
        })}
      />,
    )
    const text = container.textContent ?? ''
    expect(text).toContain('55 more leagues are set')
    expect(text).toContain('View all 65')
  })

  it('tells no-claimed-team apart from nothing-we-could-read', () => {
    const none = render(
      <MyTeamBoard allHref={ALL_HREF} now={NOW} pulse={pulse({ considered: 0, checked: 0 })} />,
    )
    expect(none.container.textContent ?? '').toContain('No team in any league is claimed')

    const unreadable = render(
      <MyTeamBoard
        allHref={ALL_HREF}
        now={NOW}
        pulse={pulse({ considered: 12, checked: 0, notChecked: { noRoster: 12, noLineup: 0 } })}
      />,
    )
    const text = unreadable.container.textContent ?? ''
    expect(text).toContain('12 of your 12 claimed teams could not be checked')
    expect(text).toContain('12 have no roster imported')
  })

  it('links the league name into that league own my-team screen', () => {
    const { container } = render(
      <MyTeamBoard allHref={ALL_HREF} now={NOW} pulse={pulse({ needs: [row()], needsTotal: 1 })} />,
    )
    const link = container.querySelector('a.af-bd-league')
    expect(link?.getAttribute('href')).toBe('/core/my-team?league=l1')
  })

  /*
   * AllFantasy is read-only. The row's action must leave for the platform where
   * the lineup is actually changed, not loop back into a screen that cannot
   * change it.
   */
  it('sends the row action to the platform, not back into AllFantasy', () => {
    const { container } = render(
      <MyTeamBoard allHref={ALL_HREF} now={NOW} pulse={pulse({ needs: [row()], needsTotal: 1 })} />,
    )
    const cta = container.querySelector('a.af-bd-cta')
    expect(cta?.getAttribute('href')).toMatch(/^https?:\/\//)
    expect(cta?.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('says Locked once the first kickoff has passed', () => {
    const { container } = render(
      <MyTeamBoard
        allHref={ALL_HREF}
        now={NOW}
        pulse={pulse({
          needs: [row({ locked: true, lockAt: '2026-09-07T17:00:00Z', empty: 1, severity: 1 })],
          needsTotal: 1,
        })}
      />,
    )
    expect(container.textContent ?? '').toContain('Locked')
  })

  it('renders an em dash, not a zero, when no kickoff could be read', () => {
    const { container } = render(
      <MyTeamBoard
        allHref={ALL_HREF}
        now={NOW}
        pulse={pulse({ needs: [row({ lockAt: null })], needsTotal: 1 })}
      />,
    )
    const lock = container.querySelector('.af-bd-stat')
    expect(lock?.textContent).toBe('—')
    expect(lock?.getAttribute('aria-label')).toMatch(/Lock time unknown/)
  })
})

/*
 * ⚠ THIS BOARD NUMBERED TEN ROWS 01..10 THAT NOTHING HAD SEPARATED. Observed on
 * a 94-league production account: every row read `2d 8h` because `lockAt` is the
 * earliest kickoff among a team's starters, taken from one shared per-sport
 * kickoff map — so leagues whose earliest starter is in the same game carry a
 * byte-identical timestamp. The comparator returned 0, the stable sort kept
 * whatever order the query produced, and the numerals dressed it up as a
 * priority. A rank is a claim that the row above won something.
 */
describe('the board ranks only what it actually ordered', () => {
  const ranksOf = (c: HTMLElement) =>
    Array.from(c.querySelectorAll('.af-bd-rank')).map((n) => n.textContent)

  const board = (rows: MyTeamRow[], over: Partial<MyTeamPulse> = {}) =>
    render(
      <MyTeamBoard
        pulse={pulse({
          set: rows,
          setTotal: rows.length,
          considered: rows.length,
          checked: rows.length,
          ...over,
        })}
        now={NOW}
        allHref={ALL_HREF}
      />,
    )

  const atLocks = (locks: Array<string | null>): MyTeamRow[] =>
    locks.map((lockAt, i) => row({ leagueId: `l${i}`, leagueName: `League ${i}`, lockAt }))

  /*
   * 🛑 NO GUTTER, NOT A GUTTER FULL OF MARKS. This first asserted five bullets
   * and passed while the screen showed a column of ~2px specks — 20px of indent
   * spent saying nothing. The assertion was satisfied by the presence of a mark
   * and had no opinion about whether the column had earned its place.
   */
  it('renders no rank gutter at all when nothing separates the rows', () => {
    const { container } = board(atLocks(Array.from({ length: 5 }, () => '2026-09-13T17:00:00Z')))
    expect(ranksOf(container)).toEqual([])
    expect(container.querySelectorAll('.af-bd-row').length).toBe(5)
  })

  it('says so in the label rather than calling them a top N', () => {
    const { container } = board(atLocks(Array.from({ length: 5 }, () => '2026-09-13T17:00:00Z')))
    const head = container.textContent ?? ''
    expect(head).toContain('all lock together, so in no particular order')
    expect(head).not.toContain('Top 5')
  })

  it('still ranks rows that genuinely differ', () => {
    const { container } = board(
      atLocks(['2026-09-13T17:00:00Z', '2026-09-13T20:00:00Z', '2026-09-14T00:20:00Z']),
    )
    expect(ranksOf(container)).toEqual(['01', '02', '03'])
  })

  /*
   * The mixed case is the normal one in season: a cluster on the first kickoff
   * and a few stragglers. The numeral marks where a new lock time starts, so it
   * keeps counting rows rather than tiers -- "03" means the third ROW, which is
   * what a reader comparing against the list length expects.
   */
  it('numbers the first row of each tier and bullets the rest', () => {
    const { container } = board(
      atLocks([
        '2026-09-13T17:00:00Z',
        '2026-09-13T17:00:00Z',
        '2026-09-14T00:20:00Z',
        '2026-09-14T00:20:00Z',
      ]),
    )
    expect(ranksOf(container)).toEqual(['01', '•', '03', '•'])
  })

  /*
   * ⚠ ROUNDING MUST NOT DECIDE THIS. `formatLockLabel` prints hours past a day,
   * so these two both render "2d 8h" -- but they are 40 minutes apart and the
   * order between them is real. Tiering off the DISPLAY would erase a true rank.
   */
  it('does not merge rows that only LOOK identical once rounded', () => {
    const a = '2026-09-12T20:00:00Z'
    const b = '2026-09-12T20:40:00Z'
    expect(formatLockLabel(Date.parse(a), NOW).text).toBe(formatLockLabel(Date.parse(b), NOW).text)
    const { container } = board(atLocks([a, b]))
    expect(ranksOf(container)).toEqual(['01', '02'])
  })

  /* An unknown lock has no order against another unknown lock. */
  it('treats unknown lock times as one tier', () => {
    const { container } = board(atLocks([null, null]))
    expect(ranksOf(container)).toEqual([])
  })

  /*
   * Severity is part of the comparator, so a broken lineup outranks a clean one
   * even when the two lock at the same moment.
   */
  it('keeps the numeral when severity separates rows that lock together', () => {
    const lockAt = '2026-09-13T17:00:00Z'
    const needs = [row({ leagueId: 'n1', leagueName: 'Broken', lockAt, empty: 2, severity: 2 })]
    const set = [row({ leagueId: 's1', leagueName: 'Clean', lockAt })]
    const { container } = render(
      <MyTeamBoard
        pulse={pulse({ needs, set, needsTotal: 1, setTotal: 1, considered: 2, checked: 2 })}
        now={NOW}
        allHref={ALL_HREF}
      />,
    )
    expect(ranksOf(container)).toEqual(['01', '02'])
  })
})
