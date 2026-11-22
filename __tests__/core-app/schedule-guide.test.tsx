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
    expect(items.map((i) => i.key)).toEqual(['regular-early', 'trade-deadline', 'playoffs'])
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

/* ── Your games left (2026-11-13 follow-up) ─────────────────────────────────────────────────────────── */
import { yourGamesLeft } from '@/lib/core-app/remainingSchedule'

describe('yourGamesLeft', () => {
  const rows = [
    // week 10 is being played (one side scored) — not "left"
    { week: 10, rosterId: '1', matchupId: 1, pointsFor: 20.3, pointsAgainst: 18.1 },
    { week: 10, rosterId: '2', matchupId: 1, pointsFor: 18.1, pointsAgainst: 20.3 },
    { week: 11, rosterId: '1', matchupId: 1, pointsFor: 0, pointsAgainst: 0 },
    { week: 11, rosterId: '3', matchupId: 1, pointsFor: 0, pointsAgainst: 0 },
    { week: 12, rosterId: '4', matchupId: 2, pointsFor: 0, pointsAgainst: 0 },
    { week: 12, rosterId: '1', matchupId: 2, pointsFor: 0, pointsAgainst: 0 },
    // a game you are not in
    { week: 12, rosterId: '2', matchupId: 1, pointsFor: 0, pointsAgainst: 0 },
    { week: 12, rosterId: '3', matchupId: 1, pointsFor: 0, pointsAgainst: 0 },
    // a playoff week
    { week: 15, rosterId: '1', matchupId: 1, pointsFor: 0, pointsAgainst: 0 },
    { week: 15, rosterId: '2', matchupId: 1, pointsFor: 0, pointsAgainst: 0 },
  ]
  const teams = [
    { rosterId: '1', name: 'Me', wins: 5, losses: 4, ties: 0 },
    { rosterId: '2', name: 'Two', wins: 8, losses: 1, ties: 0 },
    { rosterId: '3', name: 'Three', wins: 7, losses: 2, ties: 0 },
    { rosterId: '4', name: 'Four', wins: 2, losses: 7, ties: 0 },
    { rosterId: '5', name: 'Five', wins: 4, losses: 5, ties: 0 },
    { rosterId: '6', name: 'Six', wins: 3, losses: 6, ties: 0 },
  ]

  it('lists your unplayed games after this week, soonest first, with records and the tough ones marked', () => {
    const left = yourGamesLeft({ rows, myRosterIds: ['1'], afterWeek: 10, beforeWeek: 15, teams })
    expect(left).toEqual([
      { week: 11, opponentId: '3', opponentName: 'Three', record: { wins: 7, losses: 2, ties: 0 }, tough: true },
      { week: 12, opponentId: '4', opponentName: 'Four', record: { wins: 2, losses: 7, ties: 0 }, tough: false },
    ])
  })

  it('stops at the playoffs only when told where they start, and returns nothing without your team', () => {
    expect(yourGamesLeft({ rows, myRosterIds: ['1'], afterWeek: 10, teams }).map((g) => g.week)).toEqual([11, 12, 15])
    expect(yourGamesLeft({ rows, myRosterIds: [], afterWeek: 10, teams })).toEqual([])
  })

  it('leaves out a game already under way, even after the stored current week', () => {
    const underway = rows.map((r) => (r.week === 11 && r.rosterId === '3' ? { ...r, pointsFor: 4.2 } : r))
    expect(yourGamesLeft({ rows: underway, myRosterIds: ['1'], afterWeek: 10, beforeWeek: 15, teams }).map((g) => g.week)).toEqual([12])
  })

  it('marks nobody tough before anyone has played', () => {
    const fresh = teams.map((t) => ({ ...t, wins: 0, losses: 0, ties: 0 }))
    expect(yourGamesLeft({ rows, myRosterIds: ['1'], afterWeek: 10, beforeWeek: 15, teams: fresh }).some((g) => g.tough)).toBe(false)
  })
})

describe('LeagueSchedule — games left and the forward headline', () => {
  const gamesLeft = [
    { week: 11, opponentId: '3', opponentName: 'Three', record: { wins: 7, losses: 2, ties: 0 }, tough: true },
    { week: 12, opponentId: '4', opponentName: 'Four', record: { wins: 2, losses: 7, ties: 0 }, tough: false },
    { week: 16, opponentId: '2', opponentName: 'Two', record: null, tough: false },
  ]
  const withGame = data({
    matchup: { available: true, data: { week: 10, season: 2026, you: { name: 'Me', points: 20.3 }, opponent: { name: 'Riley', points: 18.1 }, winProbability: null } },
  } as Partial<LeagueHomeData>)

  it('leads with what is left before the playoffs and the next game; this week’s score is one line under it', () => {
    render(<LeagueSchedule data={withGame} gamesLeft={gamesLeft} />)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('After this week: 2 games before the playoffs. Next: Three (7-2) in week 11.')
    expect(document.querySelector('.af-sg-thisweek')?.textContent).toBe('This week you lead Riley 20.3 to 18.1.')
    const list = screen.getByTestId('schedule-games-left')
    expect([...list.querySelectorAll('.af-sg-left-opp')].map((e) => e.textContent)).toEqual(['Three', 'Four'])
    expect(list.querySelector('[data-tough] .af-sg-badge')?.textContent).toBe('Tough')
  })

  it('keeps the old headline when no games are left or they could not be read', () => {
    render(<LeagueSchedule data={withGame} gamesLeft={null} />)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Week 10 · you vs Riley — you lead 20.3 to 18.1')
    expect(screen.queryByTestId('schedule-games-left')).toBeNull()
  })
})

/* ── 2026-11-14: one regular season, the offseason later, this week in words ─────────────────────────── */
describe('Schedule — simpler (2026-11-14)', () => {
  const SPLIT: TimelinePhase[] = [
    { key: 'regular-early', label: 'Regular season', when: 'WK 1-12', state: 'now' },
    { key: 'trade-deadline', label: 'Trade deadline', when: 'WK 12', state: 'future', detail: 'Read from this league — no trades accepted after it' },
    { key: 'regular-late', label: 'Run-in', when: 'WK 13-14', state: 'future' },
    { key: 'playoffs', label: 'Playoffs', when: 'WK 15-16', state: 'future', detail: '8 teams' },
    { key: 'championship', label: 'Championship', when: 'WK 17', state: 'future' },
    { key: 'offseason-next', label: 'Offseason', when: null, state: 'future', detail: 'Rookie draft order, keepers and taxi decisions' },
  ]

  it('says the regular season once, weeks 1–14, and never "Run-in"', () => {
    const items = whatsNext({ timeline: SPLIT, calendar: [], currentWeek: 10 })
    expect(items.map((i) => [i.label, i.span, i.state])).toEqual([
      ['Regular season', { start: 1, end: 14 }, 'now'],
      ['Trade deadline', { start: 12, end: 12 }, 'future'],
      ['Playoffs', { start: 15, end: 16 }, 'future'],
      ['Championship', { start: 17, end: 17 }, 'future'],
    ])
    expect(items.find((i) => i.label === 'Trade deadline')?.away).toBe(2)
  })

  it('after the deadline the regular season is still the one row, and still "now"', () => {
    const late = SPLIT.map((p) =>
      p.key === 'regular-early' ? { ...p, state: 'past' as const } : p.key === 'trade-deadline' ? { ...p, state: 'past' as const } : p.key === 'regular-late' ? { ...p, state: 'now' as const } : p,
    )
    const items = whatsNext({ timeline: late, calendar: [], currentWeek: 13 })
    expect(items[0]).toMatchObject({ label: 'Regular season', state: 'now', span: { start: 1, end: 14 } })
    expect(items.some((i) => i.label === 'Run-in')).toBe(false)
  })

  it('the offseason shows once the playoffs are under way', () => {
    const playoffs = SPLIT.map((p) => (p.key === 'playoffs' ? { ...p, state: 'now' as const } : p.key.startsWith('regular') || p.key === 'trade-deadline' ? { ...p, state: 'past' as const } : p))
    expect(whatsNext({ timeline: playoffs, calendar: [], currentWeek: 15 }).map((i) => i.label)).toEqual(['Playoffs', 'Championship', 'Offseason'])
  })

  it('renders: no Run-in, no Offseason in week 10, no "Your game is highlighted", the tough count said once', () => {
    const gamesLeft = [
      { week: 11, opponentId: 'a', opponentName: 'A', record: { wins: 6, losses: 3, ties: 0 }, tough: true },
      { week: 12, opponentId: 'b', opponentName: 'B', record: { wins: 5, losses: 4, ties: 0 }, tough: true },
      { week: 13, opponentId: 'c', opponentName: 'C', record: { wins: 3, losses: 6, ties: 0 }, tough: false },
      { week: 14, opponentId: 'd', opponentName: 'D', record: { wins: 5, losses: 4, ties: 0 }, tough: true },
    ]
    render(
      <LeagueSchedule
        data={data({
          timeline: { available: true, data: SPLIT },
          matchup: { available: true, data: { week: 10, season: 2026, you: { name: 'Me', points: 0 }, opponent: { name: 'Dolphins', points: 13 }, winProbability: null } },
          scoreboard: { available: true, data: { seasonYear: 2026, week: 10, games: [], allUnplayed: false, unpaired: [], projectionBasis: null, unpricedReason: null } },
        } as unknown as Partial<LeagueHomeData>)}
        gamesLeft={gamesLeft}
      />,
    )
    const text = document.body.textContent ?? ''
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('After this week: 4 games before the playoffs. Next: A (6-3) in week 11.')
    expect(document.querySelector('.af-sg-thisweek')?.textContent).toBe('This week you trail Dolphins 0.0 to 13.0.')
    expect(screen.getByTestId('schedule-tough-summary').textContent).toBe('3 of your 4 are against top teams.')
    expect(text).toContain('weeks 1–14')
    expect(text).toContain('All games')
    for (const gone of ['Run-in', 'Offseason', 'Your game is highlighted', 'Regular season, after this week', 'This week (week']) {
      expect(text).not.toContain(gone)
    }
  })

  it('says nothing about tough games when there are none', () => {
    const easy = [{ week: 11, opponentId: 'c', opponentName: 'C', record: { wins: 3, losses: 6, ties: 0 }, tough: false }]
    render(<LeagueSchedule data={data()} gamesLeft={easy} />)
    expect(screen.queryByTestId('schedule-tough-summary')).toBeNull()
  })

  it('this week and the tough count in plain words, English and Spanish', () => {
    const en = scheduleGuideMessages.en
    const es = scheduleGuideMessages.es!
    expect(en.thisWeekScore(10, 'X', 0, 0, false)).toBe('This week: you vs X.')
    expect(en.thisWeekScore(10, 'X', 20, 20, true)).toBe('This week you’re tied with X at 20.0.')
    expect(en.toughSummary(1, 4)).toBe('1 of your 4 is against a top team.')
    expect(en.toughSummary(4, 4)).toBe('All 4 are against top teams.')
    expect(en.toughSummary(1, 1)).toBe('It’s against a top team.')
    expect(en.headAhead(1, true, 14, 'Z', null)).toBe('After this week: 1 game before the playoffs. Next: Z in week 14.')
    expect(en.headAhead(3, false, 11, 'Z', null)).toBe('After this week: 3 games left. Next: Z in week 11.')
    expect(es.thisWeekScore!(10, 'X', 0, 13, true)).toBe('Esta semana pierdes contra X 0.0 a 13.0.')
    expect(es.headAhead!(4, true, 11, 'Z', { wins: 6, losses: 3, ties: 0 })).toBe('Después de esta semana: quedan 4 partidos antes de los playoffs. Próximo: Z (6-3) en la semana 11.')
    expect(es.toughSummary!(3, 4)).toBe('3 de tus 4 son contra equipos de arriba.')
  })
})
