import React from 'react'
import { describe, expect, it } from 'vitest'
import { render, within } from '@testing-library/react'

import { MyTeamBoard, columnsTooUneven } from '@/components/core-app/MyTeamBoard'
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
        now={NOW}
        pulse={pulse({
          needs: [row({ empty: 2, out: 1, bye: 1, questionable: 3, severity: 4 })],
          needsTotal: 1,
        })}
      />,
    )
    const text = container.textContent ?? ''
    expect(text).toContain('2 empty')
    expect(text).toContain('1 out')
    expect(text).toContain('1 bye')
    expect(text).toContain('3 Q')
  })

  /*
   * The single most important assertion in this file. `bye: null` means the
   * week's schedule was too thin to judge — rendering it as "0 bye" would be a
   * claim about the most preventable loss in fantasy that we cannot support.
   */
  it('never renders an unchecked bye count as zero', () => {
    const { container } = render(
      <MyTeamBoard
        now={NOW}
        pulse={pulse({
          needs: [row({ bye: null, empty: 1, severity: 1 })],
          needsTotal: 1,
          byeChecked: false,
        })}
      />,
    )
    const text = container.textContent ?? ''
    expect(text).not.toContain('0 bye')
    expect(text).toMatch(/not checked for byes|no lineup below was checked for byes/i)
  })

  it('says a bye check ran clean rather than going silent', () => {
    const { container } = render(
      <MyTeamBoard now={NOW} pulse={pulse({ set: [row()], setTotal: 1 })} />,
    )
    expect(container.textContent ?? '').not.toMatch(/checked for byes/i)
  })

  it('shows a clean lineup as set instead of leaving the row blank', () => {
    const { container } = render(
      <MyTeamBoard now={NOW} pulse={pulse({ set: [row()], setTotal: 1 })} />,
    )
    expect(within(container).getByText('set')).toBeTruthy()
  })

  it('states an unresolved starter without colouring it as a lineup problem', () => {
    const { container } = render(
      <MyTeamBoard
        now={NOW}
        pulse={pulse({ set: [row({ unresolved: 2 })], setTotal: 1 })}
      />,
    )
    const chip = within(container).getByText('2 unknown')
    expect(chip.getAttribute('data-tone')).toBe('quiet')
  })

  it('says how many rows a capped column is hiding', () => {
    const { container } = render(
      <MyTeamBoard
        now={NOW}
        pulse={pulse({
          needs: Array.from({ length: 5 }, (_, i) =>
            row({ leagueId: `l${i}`, empty: 1, severity: 1 }),
          ),
          needsTotal: 9,
        })}
      />,
    )
    expect(container.textContent ?? '').toContain('4 more need a change')
  })

  it('tells no-claimed-team apart from nothing-we-could-read', () => {
    const none = render(<MyTeamBoard now={NOW} pulse={pulse({ considered: 0, checked: 0 })} />)
    expect(none.container.textContent ?? '').toContain('No claimed team yet')

    const unreadable = render(
      <MyTeamBoard
        now={NOW}
        pulse={pulse({ considered: 12, checked: 0, notChecked: { noRoster: 12, noLineup: 0 } })}
      />,
    )
    const text = unreadable.container.textContent ?? ''
    expect(text).toContain('None of your 12 claimed teams')
    expect(text).toContain('12 have no roster imported')
  })

  it('links each row into that league own my-team screen', () => {
    const { container } = render(
      <MyTeamBoard now={NOW} pulse={pulse({ set: [row()], setTotal: 1 })} />,
    )
    const link = container.querySelector('a.af-mtb-row')
    expect(link?.getAttribute('href')).toBe('/core/my-team?league=l1')
  })

  it('marks a locked row so it can be dimmed rather than dropped', () => {
    const { container } = render(
      <MyTeamBoard
        now={NOW}
        pulse={pulse({
          needs: [row({ locked: true, lockAt: '2026-09-07T17:00:00Z', empty: 1, severity: 1 })],
          needsTotal: 1,
        })}
      />,
    )
    const link = container.querySelector('a.af-mtb-row')
    expect(link?.getAttribute('data-locked')).toBe('true')
    expect(container.textContent ?? '').toContain('Locked')
  })

  it('renders an em dash, not a zero, when no kickoff could be read', () => {
    const { container } = render(
      <MyTeamBoard now={NOW} pulse={pulse({ set: [row({ lockAt: null })], setTotal: 1 })} />,
    )
    const lock = container.querySelector('.af-mtb-lock')
    expect(lock?.getAttribute('data-state')).toBe('unknown')
    expect(lock?.textContent).toBe('—')
  })
})

/*
 * When the two columns stop sitting side by side.
 *
 * ⚠ THE ORIGINAL RULE ASKED "IS ONE SIDE EMPTY", AND EMPTY IS THE RARE CASE.
 * Observed on a real 66-league portfolio: 1 needing a change against 5 set,
 * which left roughly 160px of blank column — four rows of nothing beside five
 * rows of content, on the state this board exists to reach. One-or-two-against-
 * dozens is the STEADY state, so the balanced layout the grid assumes is the one
 * that almost never happens.
 */
describe('columnsTooUneven', () => {
  it('stacks when one side is empty', () => {
    expect(columnsTooUneven(0, 5)).toBe(true)
    expect(columnsTooUneven(5, 0)).toBe(true)
  })

  /* The case that prompted this: one row beside five. */
  it('stacks at one against five', () => {
    expect(columnsTooUneven(1, 5)).toBe(true)
  })

  it('stays side by side when the columns are close', () => {
    expect(columnsTooUneven(5, 5)).toBe(false)
    expect(columnsTooUneven(4, 5)).toBe(false)
    expect(columnsTooUneven(3, 5)).toBe(false)
  })

  /* Three rows of difference is the boundary; check both sides of it. */
  it('turns over at a difference of exactly three', () => {
    expect(columnsTooUneven(2, 5)).toBe(true)
    expect(columnsTooUneven(3, 6)).toBe(true)
    expect(columnsTooUneven(3, 5)).toBe(false)
  })

  /* Symmetric — it must not matter which side is the short one. */
  it('does not care which column is the short one', () => {
    expect(columnsTooUneven(1, 5)).toBe(columnsTooUneven(5, 1))
    expect(columnsTooUneven(4, 5)).toBe(columnsTooUneven(5, 4))
  })

  it('does not stack two short columns', () => {
    expect(columnsTooUneven(0, 0)).toBe(false)
    expect(columnsTooUneven(1, 1)).toBe(false)
  })
})

describe('MyTeamBoard — column stacking', () => {
  it('marks the board for stacking when one row faces five', () => {
    const { container } = render(
      <MyTeamBoard
        pulse={pulse({
          needs: [row({ leagueId: 'n1', empty: 1 })],
          needsTotal: 1,
          set: [1, 2, 3, 4, 5].map((n) => row({ leagueId: `s${n}` })),
          setTotal: 5,
        })}
        now={NOW}
      />,
    )
    expect(container.querySelector('.af-mtb-cols')?.getAttribute('data-stack')).toBe('true')
  })

  it('leaves a balanced board in two columns', () => {
    const { container } = render(
      <MyTeamBoard
        pulse={pulse({
          needs: [1, 2, 3].map((n) => row({ leagueId: `n${n}`, empty: 1 })),
          needsTotal: 3,
          set: [1, 2, 3, 4].map((n) => row({ leagueId: `s${n}` })),
          setTotal: 4,
        })}
        now={NOW}
      />,
    )
    expect(container.querySelector('.af-mtb-cols')?.getAttribute('data-stack')).toBeNull()
  })
})
