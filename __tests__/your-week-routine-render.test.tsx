import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('@/components/decide/shareCard', () => ({ shareCardImage: vi.fn(async () => 'downloaded') }))

import { shareCardImage } from '@/components/decide/shareCard'
import { YourWeekRoutine } from '@/components/core-app/screens/YourWeekRoutine'
import type { RoutineStep, WeeklyRoutineData } from '@/lib/core-app/weeklyRoutine'

/*
 * The "Your week" card as rendered (2026-09-14): five steps, today's marked, a check mark only for
 * an observed done, and the recap expanded on Monday.
 */

const steps = (today: RoutineStep['key'], over: Partial<Record<RoutineStep['key'], Partial<RoutineStep>>> = {}): RoutineStep[] =>
  (
    [
      { key: 'results', day: 'Tue', title: 'Results review', href: '/core/week', state: 'done', summary: '2026 week 1: 1-1 across 2 leagues' },
      { key: 'waivers', day: 'Wed', title: 'Waivers', href: '/core/waivers', state: 'open', summary: 'No adds of yours on file this week.' },
      { key: 'lineups', day: 'Thu', title: 'Lineup check', href: '/core/my-team', state: 'unknown', summary: null },
      { key: 'gameday', day: 'Sun', title: 'Game day', href: '/core/matchup', state: 'open', summary: '3 matchups this week.' },
      { key: 'recap', day: 'Mon', title: 'Recap', href: '/core/week', state: 'unknown', summary: '1-1 in week 1' },
    ] as RoutineStep[]
  ).map((s) => ({ ...s, today: s.key === today, ...over[s.key] }))

const recap = {
  season: 2026,
  week: 1,
  wins: 1,
  losses: 1,
  biggestWin: { leagueName: 'Ice Kings', margin: 23.5 },
  closestLoss: { leagueName: 'Dynasty', margin: 2.2 },
  topScorer: { name: 'Jahmyr Gibbs', points: 28.4, leagueName: 'Ice Kings' },
}

const data = (over: Partial<WeeklyRoutineData> = {}): WeeklyRoutineData => ({
  today: 'waivers',
  todayLabel: 'Wednesday',
  steps: steps('waivers'),
  recap,
  ...over,
})

describe('YourWeekRoutine', () => {
  it('lists the five steps, each linking to its screen, with today’s marked', () => {
    const { container } = render(<YourWeekRoutine data={data()} />)
    expect(screen.getByRole('heading', { name: 'Your week' })).toBeTruthy()
    expect(screen.getByText('Wednesday · Waivers')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Waivers' }).getAttribute('href')).toBe('/core/waivers')
    expect(screen.getByRole('link', { name: 'Lineup check' }).getAttribute('href')).toBe('/core/my-team')
    const items = container.querySelectorAll('li.af3a-routine-step')
    expect([...items].map((li) => li.getAttribute('data-step'))).toEqual(['results', 'waivers', 'lineups', 'gameday', 'recap'])
    expect(container.querySelector('[aria-current="step"]')?.getAttribute('data-step')).toBe('waivers')
    expect(container.querySelectorAll('[data-today="true"]')).toHaveLength(1)
  })

  it('🛑 a check mark only for a done step; unknown shows no mark and no summary', () => {
    const { container } = render(<YourWeekRoutine data={data()} />)
    const marks = container.querySelectorAll('[aria-label="Done"]')
    expect(marks).toHaveLength(1)
    expect(marks[0].closest('li')?.getAttribute('data-step')).toBe('results')
    const lineups = container.querySelector('[data-step="lineups"]')!
    expect(lineups.querySelector('.af3a-routine-summary')).toBeNull()
    expect(screen.getByText('No adds of yours on file this week.')).toBeTruthy()
  })

  it('🛑 on Monday the recap expands with last week’s details, and says games may still count', () => {
    render(<YourWeekRoutine data={data({ today: 'recap', todayLabel: 'Monday', steps: steps('recap') })} />)
    expect(screen.getByText('2026 week 1 recap: 1-1')).toBeTruthy()
    expect(screen.getByText('Biggest win: Ice Kings by 23.5')).toBeTruthy()
    expect(screen.getByText('Closest loss: Dynasty by 2.2')).toBeTruthy()
    expect(screen.getByText('Top scorer: Jahmyr Gibbs 28.4 (Ice Kings)')).toBeTruthy()
    expect(screen.getByText('Monday night games may still change these.')).toBeTruthy()
  })

  it('the recap block is Monday-only, and absent parts are left out', () => {
    const { container, rerender } = render(<YourWeekRoutine data={data()} />)
    expect(container.querySelector('.af3a-routine-recap')).toBeNull()
    rerender(<YourWeekRoutine data={data({ today: 'recap', todayLabel: 'Monday', steps: steps('recap'), recap: { ...recap, biggestWin: null, topScorer: null } })} />)
    expect(screen.queryByText(/Biggest win/)).toBeNull()
    expect(screen.queryByText(/Top scorer/)).toBeNull()
    expect(screen.getByText('Closest loss: Dynasty by 2.2')).toBeTruthy()
  })

  it('🛑 awards you won are listed with a share button that builds the award card image', async () => {
    const awards = [
      { leagueId: 'af-ice', leagueName: 'Ice Kings', season: 2026, week: 1, kind: 'topScore', label: 'Top score', value: 162.4, unit: 'pts' },
      { leagueId: 'af-dyn', leagueName: 'Dynasty', season: 2026, week: 1, kind: 'narrowEscape', label: 'Narrow escape', value: 0.8, unit: 'margin' },
    ] as WeeklyRoutineData['awards']
    const { container } = render(<YourWeekRoutine data={data({ awards })} />)
    expect(screen.getByText('Week 1 awards')).toBeTruthy()
    const rows = container.querySelectorAll('li.af3a-routine-award')
    expect([...rows].map((r) => r.textContent)).toEqual([
      'Top score · Ice Kings · 162.4 ptsShare',
      'Narrow escape · Dynasty · 0.8 pt marginShare',
    ])
    fireEvent.click(screen.getAllByRole('button', { name: 'Share' })[0]!)
    expect(shareCardImage).toHaveBeenCalledWith(
      '/api/share/rivalry-card?kind=award&leagueId=af-ice&award=topScore',
      'award-topScore-week-1.png',
      'Top score — Ice Kings, week 1',
    )
    await waitFor(() => expect(screen.getByRole('button', { name: 'Card saved ✓' })).toBeTruthy())
  })

  it('no awards, no awards block', () => {
    const { container } = render(<YourWeekRoutine data={data({ awards: [] })} />)
    expect(container.querySelector('.af3a-routine-awards')).toBeNull()
  })

  it('null renders nothing', () => {
    const { container } = render(<YourWeekRoutine data={null} />)
    expect(container.innerHTML).toBe('')
  })
})
