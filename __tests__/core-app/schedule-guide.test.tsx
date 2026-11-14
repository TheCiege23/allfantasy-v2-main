/**
 * A league's Schedule tab guide (2026-11-13): the headline about this week, the "What's next" list in
 * weeks from now, and the copy.
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/core/schedule',
  useSearchParams: () => new URLSearchParams('league=l1'),
}))
vi.mock('@/components/core-app/TeamDeadlineAlertTarget', () => ({ default: () => null }))

import LeagueSchedule from '@/components/core-app/screens/LeagueSchedule'
import type { LeagueHomeData } from '@/lib/core-app/leagueHome'
import type { TimelinePhase } from '@/lib/core-app/seasonTimeline'
import { scheduleHeadline, weekSpan, whatsNext } from '@/lib/core-app/scheduleGuide'
import { scheduleGuideMessages } from '@/lib/core-app/messages/scheduleGuide'

afterEach(cleanup)

const H2H: TimelinePhase[] = [
  { key: 'regular-early', label: 'Regular season', when: 'WK 1-11', state: 'now' },
  { key: 'old', label: 'Draft', when: null, state: 'past' },
  { key: 'trade-deadline', label: 'Trade deadline', when: 'WK 11', state: 'future', detail: 'Read from this league — no trades accepted after it' },
  { key: 'playoffs', label: 'Playoffs', when: 'WK 15-16', state: 'future', detail: '6 teams' },
  { key: 'offseason-next', label: 'Offseason', when: null, state: 'future' },
]

describe('weekSpan', () => {
  it('reads every week form the timeline writes, and nothing else', () => {
    expect(weekSpan('WK 11')).toEqual({ start: 11, end: 11 })
    expect(weekSpan('WK 15-17')).toEqual({ start: 15, end: 17 })
    expect(weekSpan('week 1 onward')).toEqual({ start: 1, end: null })
    expect(weekSpan('Aug')).toBeNull()
    expect(weekSpan(null)).toBeNull()
  })
})

describe('whatsNext', () => {
  it('drops past phases, counts weeks from now, strips provenance and reads "N teams"', () => {
    const items = whatsNext({ timeline: H2H, calendar: [], currentWeek: 10 })
    expect(items.map((i) => i.key)).toEqual(['regular-early', 'trade-deadline', 'playoffs', 'offseason-next'])
    expect(items[1]).toMatchObject({ away: 1, detail: 'No trades accepted after it' })
    expect(items[2]).toMatchObject({ away: 5, teams: 6, detail: null })
    expect(items[0]!.away).toBeNull()
  })

  it('adds a dated deadline still ahead, never a week-only calendar row or a past date', () => {
    const items = whatsNext({
      timeline: H2H,
      currentWeek: 10,
      now: new Date('2026-11-13T00:00:00Z'),
      calendar: [
        { key: 'keeper', label: 'Keeper deadline', at: '2027-08-20T23:00:00.000Z', when: '', detail: '' },
        { key: 'trade-week', label: 'Trade deadline', at: null, when: 'Week 11', detail: '' },
        { key: 'draft', label: 'Draft', at: '2026-08-01T00:00:00.000Z', when: '', detail: '' },
      ],
    })
    expect(items.filter((i) => i.key.startsWith('cal-')).map((i) => i.key)).toEqual(['cal-keeper'])
  })
})

describe('scheduleHeadline', () => {
  const items = whatsNext({ timeline: H2H, calendar: [], currentWeek: 10 })
  it('your game when there is one; otherwise the phase and what is next', () => {
    expect(scheduleHeadline({ matchup: { week: 10, you: { points: 20.3 }, opponent: { name: 'Riley', points: 18.1 } }, currentWeek: 10, items })).toEqual({
      kind: 'game', week: 10, opponent: 'Riley', you: 20.3, them: 18.1, started: true,
    })
    expect(scheduleHeadline({ matchup: null, currentWeek: 10, items })).toMatchObject({ kind: 'phase', label: 'Regular season', next: { key: 'trade-deadline' } })
    expect(scheduleHeadline({ matchup: null, currentWeek: 10, items: [] })).toEqual({ kind: 'none' })
  })
})

describe('schedule copy', () => {
  const en = scheduleGuideMessages.en
  it('says it in plain words', () => {
    expect(en.headGame(10, 'Riley', 20.3, 18.1, true)).toBe('Week 10 · you vs Riley — you lead 20.3 to 18.1')
    expect(en.headGame(10, 'Riley', 0, 0, false)).toBe('Week 10 · you vs Riley')
    expect(en.headPhase(10, 'Survive', en.nextInline('Trade deadline', en.nextWeek))).toBe('Week 10 · Survive — trade deadline next week')
    expect(en.weeks(15, 16)).toBe('weeks 15–16')
  })

  it('has Spanish for every key, translates the phases, and never says «waiver»', () => {
    const es = scheduleGuideMessages.es!
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort())
    expect(es.phase!('Trade deadline')).toBe('Fecha límite de intercambios')
    expect(es.phase!('Something new')).toBe('Something new')
    const text = JSON.stringify(Object.values(es).map((v) => (typeof v === 'function' ? String(v) : v)))
    expect(text.toLowerCase()).not.toMatch(/waiver/)
  })
})

function data(over: Partial<LeagueHomeData> = {}): LeagueHomeData {
  return {
    league: { id: 'l1', name: 'Kings of Buffalo', sport: 'NFL', season: 2026, currentWeek: 10 },
    calendar: [],
    timeline: { available: true, data: H2H },
    matchup: { available: false, reason: 'n/a' },
    weekPicker: { weeks: [9, 10, 11], selected: 10, current: 10, isFuture: false },
    scoreboard: { available: false, reason: 'no fixtures on file' },
    ...over,
  } as unknown as LeagueHomeData
}

describe('LeagueSchedule with the guide', () => {
  it('one h1 with the headline, one What’s next list, no placeholder sentences', () => {
    render(<LeagueSchedule data={data()} />)
    expect(document.querySelectorAll('h1')).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Week 10 · Regular season — trade deadline next week')
    const text = document.body.textContent ?? ''
    expect(text).toContain('What’s next')
    expect(text).toContain('in 5 weeks')
    expect(text).toContain('6 teams make it')
    for (const gone of ['No dated deadlines', 'Date not supplied', 'Read from this league', '· future', 'Season phases', 'League calendar']) {
      expect(text).not.toContain(gone)
    }
  })

  it('a head-to-head week leads with your game', () => {
    render(
      <LeagueSchedule
        data={data({ matchup: { available: true, data: { week: 10, season: 2026, you: { name: 'Me', points: 0 }, opponent: { name: 'Riley', points: 0 }, winProbability: null } } } as Partial<LeagueHomeData>)}
      />,
    )
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Week 10 · you vs Riley')
  })

  it('before week 1 the next phase reads as when it starts, not as a range', () => {
    const pre: TimelinePhase[] = [
      { key: 'draft', label: 'Draft', when: null, state: 'now', detail: 'Not started' },
      { key: 'regular-early', label: 'Regular season', when: 'WK 1-11', state: 'future' },
    ]
    render(<LeagueSchedule data={data({ timeline: { available: true, data: pre }, weekPicker: null, league: { id: 'l1', name: 'K', currentWeek: null } } as unknown as Partial<LeagueHomeData>)} />)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Draft — regular season starts week 1')
  })

  it('the week switcher steps and stops at the ends', () => {
    render(<LeagueSchedule data={data({ weekPicker: { weeks: [9, 10], selected: 10, current: 10, isFuture: false } } as Partial<LeagueHomeData>)} />)
    expect((screen.getByRole('button', { name: 'Next week' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Previous week' }) as HTMLButtonElement).disabled).toBe(false)
  })
})
