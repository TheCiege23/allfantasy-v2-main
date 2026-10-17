/**
 * The injury timeline chip: severity, the previous designation and trend, ESPN's estimated return,
 * the raw-row path playerFinder.ts calls, and the chip.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { buildInjuryTimeline, espnReturnDate, injuryTimelineFromRows, PREVIOUS_WINDOW_DAYS, severity, type TimelineRow } from '@/lib/core-app/injuryTimeline'
import { InjuryTimelineChip, timelineParts } from '@/components/core-app/player-finder/InjuryTimelineChip'

const d = (s: string) => new Date(s)
const NOW = d('2026-09-29T12:00:00Z')
const r = (status: string, date: string | null, over: Partial<TimelineRow> = {}): TimelineRow => ({
  status,
  date: date ? d(date) : null,
  fetchedAt: d('2026-09-29T08:00:00Z'),
  source: 'espn',
  returnDate: null,
  ...over,
})

describe('severity', () => {
  it('ranks designations, folding the short forms the feeds use', () => {
    expect(['Active', 'Questionable', 'Q', 'Doubtful', 'D', 'Out', 'Injured Reserve', 'IR', 'PUP', 'Sus', 'Suspended'].map(severity)).toEqual([0, 1, 1, 2, 2, 3, 4, 4, 4, 4, 4])
    expect(severity('')).toBeNull()
    expect(severity('Contract dispute')).toBeNull()
  })
})

describe('buildInjuryTimeline (pure)', () => {
  const current = { status: 'Questionable', reportedAt: d('2026-09-24T16:00:00Z') }

  it('previous = the latest DIFFERENT designation before this one began; up when it was worse', () => {
    const rows = [r('Out', '2026-09-14T15:00:00Z'), r('Out', '2026-09-18T15:00:00Z'), r('Questionable', '2026-09-24T16:00:00Z')]
    expect(buildInjuryTimeline({ rows, current, now: NOW })).toEqual({ previous: { status: 'Out', lastReported: '2026-09-18' }, trend: 'up', estReturn: null })
  })

  it('down when it was better', () => {
    const rows = [r('Active', '2026-09-20T15:00:00Z'), r('Out', '2026-09-26T15:00:00Z')]
    expect(buildInjuryTimeline({ rows, current: { status: 'Out', reportedAt: d('2026-09-26T15:00:00Z') }, now: NOW })).toMatchObject({ previous: { status: 'Active' }, trend: 'down' })
  })

  it('"Q" after "Questionable" is the same designation, not a change', () => {
    const rows = [r('Questionable', '2026-09-20T15:00:00Z'), r('Q', '2026-09-24T16:00:00Z', { source: 'sleeper_live' })]
    expect(buildInjuryTimeline({ rows, current: { status: 'Q', reportedAt: d('2026-09-24T16:00:00Z') }, now: NOW })).toBeNull()
  })

  it(`ignores reports after the onset, and anything more than ${PREVIOUS_WINDOW_DAYS} days before it`, () => {
    const later = r('Out', '2026-09-27T15:00:00Z') // after the onset: not "before"
    const stale = r('Out', '2026-08-20T15:00:00Z') // outside the window
    expect(buildInjuryTimeline({ rows: [later, stale], current, now: NOW })).toBeNull()
  })

  it('ESPN est. return: this episode, same designation, still ahead', () => {
    const rows = [r('Questionable', '2026-09-24T16:00:00Z', { returnDate: '2026-10-05' })]
    expect(buildInjuryTimeline({ rows, current, now: NOW })).toEqual({ previous: null, trend: null, estReturn: '2026-10-05' })
  })

  it('no est. return from the past, another source, another episode, or another designation', () => {
    const past = r('Questionable', '2026-09-24T16:00:00Z', { returnDate: '2026-09-20' })
    const otherSource = r('Questionable', '2026-09-24T16:00:00Z', { returnDate: '2026-10-05', source: 'rolling_insights' })
    const oldEpisode = r('Questionable', '2026-09-24T16:00:00Z', { returnDate: '2026-10-05', fetchedAt: d('2026-09-10T08:00:00Z') })
    const otherDesignation = r('Out', '2026-09-24T16:00:00Z', { returnDate: '2026-10-05' })
    for (const row of [past, otherSource, otherDesignation]) expect(buildInjuryTimeline({ rows: [row], current, now: NOW })).toBeNull()
    // The old-episode row is compared against the freshest row's fetch time, so give it one fresh sibling.
    expect(buildInjuryTimeline({ rows: [oldEpisode, r('Questionable', null)], current, now: NOW })).toBeNull()
  })

  it('a healthy player gets no estimated return', () => {
    const rows = [r('Out', '2026-09-20T15:00:00Z'), r('Active', '2026-09-26T15:00:00Z', { returnDate: '2026-10-05' })]
    expect(buildInjuryTimeline({ rows, current: { status: 'Active', reportedAt: d('2026-09-26T15:00:00Z') }, now: NOW })).toEqual({
      previous: { status: 'Out', lastReported: '2026-09-20' },
      trend: 'up',
      estReturn: null,
    })
  })

  it('an unranked current designation gets no timeline', () => {
    expect(buildInjuryTimeline({ rows: [r('Out', '2026-09-20T15:00:00Z')], current: { status: 'Not with team', reportedAt: null }, now: NOW })).toBeNull()
  })
})

describe('the raw-row path playerFinder.ts calls', () => {
  it('reads ESPN details.returnDate from raw, and only a plain date', () => {
    expect(espnReturnDate({ details: { returnDate: '2026-10-05', type: 'Hamstring' } })).toBe('2026-10-05')
    expect(espnReturnDate({ details: { returnDate: 'next week' } })).toBeNull()
    expect(espnReturnDate({ returns: 'Questionable For Week 1' })).toBeNull()
    expect(espnReturnDate(null)).toBeNull()
    const t = injuryTimelineFromRows({
      rows: [
        { status: 'Out', date: d('2026-09-18T15:00:00Z'), fetchedAt: d('2026-09-29T08:00:00Z'), source: 'espn', raw: {} },
        { status: 'Questionable', date: d('2026-09-24T16:00:00Z'), fetchedAt: d('2026-09-29T08:00:00Z'), source: 'espn', raw: { details: { returnDate: '2026-10-05' } } },
      ],
      current: { status: 'Questionable', reportedAt: d('2026-09-24T16:00:00Z') },
      now: NOW,
    })
    expect(t).toEqual({ previous: { status: 'Out', lastReported: '2026-09-18' }, trend: 'up', estReturn: '2026-10-05' })
  })
})

describe('InjuryTimelineChip', () => {
  it('shows the direction and the estimate, and says it in full for screen readers', () => {
    const t = { previous: { status: 'Out', lastReported: '2026-09-18' }, trend: 'up' as const, estReturn: '2026-10-05' }
    render(<InjuryTimelineChip timeline={t} />)
    expect(screen.getByText('↑ from Out · ESPN est. return Oct 5')).toBeTruthy()
    expect(screen.getByText('Improved from Out, last reported Sep 18. ESPN estimates a return on Oct 5.')).toBeTruthy()
  })

  it('a worse designation reads down; an estimate alone reads as just that', () => {
    expect(timelineParts({ previous: { status: 'Questionable', lastReported: '2026-09-20' }, trend: 'down', estReturn: null }).short).toEqual(['↓ from Questionable'])
    expect(timelineParts({ previous: null, trend: null, estReturn: '2026-11-02' }).short).toEqual(['ESPN est. return Nov 2'])
  })

  it('renders nothing without a timeline', () => {
    const { container } = render(<InjuryTimelineChip timeline={null} />)
    expect(container.innerHTML).toBe('')
  })
})
