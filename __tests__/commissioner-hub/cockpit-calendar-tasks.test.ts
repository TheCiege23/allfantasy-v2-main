import { describe, it, expect } from 'vitest'
import {
  buildIcs,
  buildLeagueCalendar,
  foldIcsLine,
  nextDeadline,
  nextWeeklyRun,
  type CalendarInput,
} from '@/lib/core-app/commissioner/calendar'
import { buildTaskCards } from '@/lib/core-app/commissioner/tasks'
import { abandonedTeamsFlag, unresolvedVotesFlag, type LeaguePoll } from '@/lib/core-app/commissioner/health'
import type { CoreIssue } from '@/lib/core-app/outstandingIssues'

const NOW = new Date('2026-10-12T15:00:00Z') // a Monday

function input(over: Partial<CalendarInput> = {}): CalendarInput {
  return {
    now: NOW,
    leagueId: 'L1',
    platformLabel: 'Sleeper',
    native: false,
    status: 'in_season',
    season: 2026,
    draftAt: null,
    waivers: null,
    tradeDeadlineWeek: 11,
    noTradeDeadline: false,
    playoffStartWeek: 15,
    currentWeek: 6,
    weekStarts: new Map([
      [11, new Date('2026-11-13T01:15:00Z')],
      [15, new Date('2026-12-11T01:15:00Z')],
    ]),
    dues: null,
    polls: [],
    ...over,
  }
}

describe('league calendar', () => {
  it('dates week-keyed events only from real kickoffs', () => {
    const cal = buildLeagueCalendar(input({ weekStarts: new Map([[11, new Date('2026-11-13T01:15:00Z')]]) }))
    const deadline = cal.events.find((e) => e.kind === 'trade_deadline')
    const playoffs = cal.events.find((e) => e.kind === 'playoffs')
    expect(deadline?.at).toBe('2026-11-13T01:15:00.000Z')
    // No kickoff on file for week 15, so no date is invented for it.
    expect(playoffs?.at).toBeNull()
    expect(playoffs?.whenLabel).toBe('Week 15')
  })

  it('never puts "Week 99" on the calendar', () => {
    const cal = buildLeagueCalendar(input({ tradeDeadlineWeek: null, noTradeDeadline: true }))
    expect(cal.events.some((e) => e.kind === 'trade_deadline')).toBe(false)
    expect(cal.gaps.join(' ')).toContain('No trade deadline')
  })

  it('says an imported league’s draft date and waiver schedule are not on file', () => {
    const cal = buildLeagueCalendar(input({ status: 'pre_draft' }))
    const draft = cal.events.find((e) => e.kind === 'draft')
    expect(draft?.at).toBeNull()
    expect(draft?.detail).toContain('Sleeper holds this draft’s date')
    expect(cal.gaps.join(' ')).toContain('Waivers process on Sleeper')
  })

  it('schedules a native league’s next waiver run from its own settings', () => {
    const cal = buildLeagueCalendar(
      input({ native: true, waivers: { type: 'faab', dayOfWeek: 3, timeUtc: '08:00' }, draftAt: new Date('2026-10-14T00:00:00Z') }),
    )
    const waivers = cal.events.find((e) => e.kind === 'waivers')
    expect(waivers?.at).toBe('2026-10-14T08:00:00.000Z')
    expect(waivers?.status).toBe('soon')
  })

  it('puts open votes on the calendar and dues without a date', () => {
    const cal = buildLeagueCalendar(
      input({
        dues: { enabled: true, amountLabel: '$50', unpaid: 3 },
        polls: [{ id: 'm1', question: 'Add a keeper?', closesAt: '2026-10-13T12:00:00Z' }],
      }),
    )
    const vote = cal.events.find((e) => e.kind === 'vote')
    expect(vote?.status).toBe('soon')
    const dues = cal.events.find((e) => e.kind === 'dues')
    expect(dues?.at).toBeNull()
    expect(dues?.title).toBe('Dues — 3 unpaid')
  })

  it('offers renewal once the platform says the season is complete', () => {
    const cal = buildLeagueCalendar(input({ status: 'complete' }))
    expect(cal.events[0]?.kind).toBe('renewal')
  })

  it('next deadline is the soonest dated or week-keyed event still ahead', () => {
    const cal = buildLeagueCalendar(input({ polls: [{ id: 'm1', question: 'Q', closesAt: null }] }))
    expect(nextDeadline(cal)?.kind).toBe('trade_deadline')
  })

  it('nextWeeklyRun rolls to next week when today’s slot has passed', () => {
    expect(nextWeeklyRun(NOW, 1, '09:00')?.toISOString()).toBe('2026-10-19T09:00:00.000Z')
    expect(nextWeeklyRun(NOW, 1, '18:30')?.toISOString()).toBe('2026-10-12T18:30:00.000Z')
    expect(nextWeeklyRun(NOW, 9, '18:30')).toBeNull()
    expect(nextWeeklyRun(NOW, 1, 'noon')).toBeNull()
  })
})

describe('.ics export', () => {
  it('exports only dated, not-yet-passed events', () => {
    const cal = buildLeagueCalendar(input())
    const ics = buildIcs({ leagueId: 'L1', leagueName: 'Dynasty Dragons', events: cal.events, now: NOW })
    expect(ics).not.toBeNull()
    expect(ics).toContain('BEGIN:VCALENDAR')
    expect(ics).toContain('SUMMARY:Dynasty Dragons: Trade deadline')
    // Week 15 has a kickoff in this input, so playoffs are exported as an all-day event.
    expect(ics).toMatch(/DTSTART;VALUE=DATE:20261210/)
    expect((ics as string).split('BEGIN:VEVENT').length - 1).toBe(2)
  })

  it('returns nothing rather than an empty calendar', () => {
    const cal = buildLeagueCalendar(input({ tradeDeadlineWeek: null, playoffStartWeek: null }))
    expect(buildIcs({ leagueId: 'L1', leagueName: 'X', events: cal.events, now: NOW })).toBeNull()
  })

  it('escapes commas and semicolons in text', () => {
    const ics = buildIcs({
      leagueId: 'L1',
      leagueName: 'Tacos, Beer; Glory',
      events: buildLeagueCalendar(input()).events,
      now: NOW,
    })
    expect(ics).toContain('Tacos\\, Beer\\; Glory')
  })

  it('folds at 75 octets without splitting a multi-byte character', () => {
    const line = `SUMMARY:${'—'.repeat(40)}`
    const folded = foldIcsLine(line)
    for (const part of folded.split('\r\n')) {
      expect(Buffer.byteLength(part, 'utf8')).toBeLessThanOrEqual(75)
    }
    expect(folded.replace(/\r\n /g, '')).toBe(line)
  })
})

describe('task cards', () => {
  const issue = (over: Partial<CoreIssue>): CoreIssue => ({
    id: 'L1:stale',
    severity: 'warn',
    glyph: '⟳',
    title: 'Data is 3 days old',
    meta: 'Sleeper › Sync',
    leagueId: 'L1',
    leagueName: 'X',
    platform: 'sleeper',
    deadline: null,
    action: { label: 'Re-sync', href: '/core/sync', external: false },
    ...over,
  })

  it('puts the worst first and folds the rest behind a disclosure', () => {
    const flags = [
      abandonedTeamsFlag({
        managers: [
          { name: 'a', status: 'inactive' },
          { name: 'b', status: 'inactive' },
        ],
        orphanTeams: [],
        totalTeams: 4,
        action: null,
      }),
    ]
    const result = buildTaskCards({
      issues: [issue({}), issue({ id: 'L1:draft', severity: 'info', title: 'Draft soon' })],
      flags,
      calendar: [],
      workspace: [],
      limit: 2,
    })
    expect(result.cards.map((c) => c.severity)).toEqual(['bad', 'warn'])
    expect(result.overflow.map((c) => c.title)).toEqual(['Draft soon'])
  })

  it('does not show one idle manager twice when the workspace scan found it too', () => {
    const flags = [
      abandonedTeamsFlag({ managers: [{ name: 'a', status: 'inactive' }], orphanTeams: [], totalTeams: 4, action: null }),
    ]
    const result = buildTaskCards({
      issues: [issue({})],
      flags,
      calendar: [],
      workspace: [
        { id: 'w1', sourceKey: 'inactive-managers:v1', title: 'Inactive', description: '', priority: 'elevated', dueAt: null, href: null },
        { id: 'w2', sourceKey: 'data-stale:v1', title: 'Stale', description: '', priority: 'critical', dueAt: null, href: null },
        { id: 'w3', sourceKey: 'never-imported:v1', title: 'Never imported', description: '', priority: 'advisory', dueAt: null, href: null },
      ],
    })
    const titles = [...result.cards, ...result.overflow].map((c) => c.title)
    expect(titles).not.toContain('Inactive')
    expect(titles).not.toContain('Stale')
    expect(titles).toContain('Never imported')
  })

  it('shows one card for a vote closing soon, not a flag card and a deadline card', () => {
    const poll: LeaguePoll = {
      id: 'm1',
      question: 'Keepers?',
      options: [{ id: 'a', text: 'Yes', count: 0, mine: false }],
      totalVotes: 0,
      closesAt: '2026-10-13T12:00:00Z',
      closedByHand: false,
      allowMultiple: false,
      anonymous: false,
      postedAt: '2026-10-11T00:00:00Z',
    }
    const flags = [unresolvedVotesFlag({ polls: [poll], now: NOW, action: null })]
    const cal = buildLeagueCalendar(input({ polls: [{ id: 'm1', question: 'Keepers?', closesAt: poll.closesAt }] }))
    const result = buildTaskCards({ issues: [], flags, calendar: cal.events, workspace: [] })
    expect(result.cards.map((c) => c.title)).toEqual(['Vote closes: Keepers?'])
    // A second poll with no deadline is not covered, so the flag card comes back.
    const two = [poll, { ...poll, id: 'm2', closesAt: null }]
    const both = buildTaskCards({ issues: [], flags: [unresolvedVotesFlag({ polls: two, now: NOW, action: null })], calendar: cal.events, workspace: [] })
    expect(both.cards.map((c) => c.title)).toContain('2 league votes still open')
  })

  it('raises a per-league re-sync card when the shell folded stale leagues into one row', () => {
    const stale = { days: 14, href: '/core/sync?league=L1', platformLabel: 'Sleeper' }
    const result = buildTaskCards({ issues: [], flags: [], calendar: [], workspace: [], staleSync: stale })
    expect(result.cards[0]).toMatchObject({ title: 'This league’s data is 14 days old', severity: 'bad' })
    // Not twice when the shell already has one for this league.
    const dup = buildTaskCards({ issues: [issue({})], flags: [], calendar: [], workspace: [], staleSync: stale })
    expect(dup.cards.filter((c) => /days old/.test(c.title))).toHaveLength(1)
  })

  it('turns deadlines this week into cards, but not the weekly waiver run', () => {
    const cal = buildLeagueCalendar(
      input({
        native: true,
        waivers: { type: 'faab', dayOfWeek: 3, timeUtc: '08:00' },
        polls: [{ id: 'm1', question: 'Keepers?', closesAt: '2026-10-13T12:00:00Z' }],
      }),
    )
    const result = buildTaskCards({ issues: [], flags: [], calendar: cal.events, workspace: [] })
    expect(result.cards.map((c) => c.title)).toEqual(['Vote closes: Keepers?'])
  })
})
