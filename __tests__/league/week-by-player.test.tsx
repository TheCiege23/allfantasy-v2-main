/**
 * "Week by player" on the daily-lineup lineup screen (2026-11-27): each player's points day by day,
 * his week total, and his points left on the bench. The model is checked against the real scorer in
 * __tests__/redraft/daily-lineup-view.test.ts; this file pins the model's own rules and the card.
 */
import React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'

import { weekByPlayer } from '@/lib/league/native/weekByPlayer'
import { WeekByPlayerCard } from '@/components/league/native/screens/WeekByPlayerCard'
import type { DailyLineupView } from '@/lib/redraft/dailyLineupView'

afterEach(cleanup)

function view(over: Partial<DailyLineupView> = {}): DailyLineupView {
  return {
    week: 4,
    today: '2026-11-26',
    days: [
      // Mon: both start. Ava 5, Ben 3.
      { day: '2026-11-24', status: 'past', slots: { ava: 'C', ben: 'LW' }, points: { ava: 5, ben: 3 }, starterPoints: 8, startedIds: ['ava', 'ben'] },
      // Tue: Ben benched and scores 4 — left on the bench. Ava no game.
      { day: '2026-11-25', status: 'past', slots: { ava: 'C', ben: 'bench' }, points: { ben: 4 }, starterPoints: 0, startedIds: [] },
      // Wed (today): Cal added and starts, 2.5. Ava 1.
      { day: '2026-11-26', status: 'today', slots: { ava: 'C', ben: 'bench', cal: 'UTIL' }, points: { ava: 1, cal: 2.5 }, starterPoints: 3.5, startedIds: ['ava', 'cal'] },
      { day: '2026-11-27', status: 'future', slots: { ava: 'C', ben: 'bench', cal: 'UTIL' }, points: {}, starterPoints: 0, startedIds: [] },
    ],
    weekPoints: 11.5,
    startedPoints: { ava: 6, ben: 3, cal: 2.5 },
    ...over,
  }
}

describe('weekByPlayer', () => {
  it('totals each player from the scorer breakdown, sorted best first, and adds up to the week', () => {
    const w = weekByPlayer(view())!
    expect(w.rows.map((r) => [r.playerId, r.week, r.bench])).toEqual([
      ['ava', 6, 0],
      ['ben', 3, 4],
      ['cal', 2.5, 0],
    ])
    expect(w.total).toBe(11.5)
    expect(w.benchTotal).toBe(4)
    expect(w.days.map((d) => d.starterPoints)).toEqual([8, 0, 3.5, 0])
  })

  it('marks each day: counted, scored on the bench, no game, or not on the roster yet', () => {
    const w = weekByPlayer(view())!
    const ben = w.rows.find((r) => r.playerId === 'ben')!
    expect(ben.cells.map((c) => [c.pts, c.counted])).toEqual([[3, true], [4, false], [null, false], [null, false]])
    const cal = w.rows.find((r) => r.playerId === 'cal')!
    expect(cal.cells.map((c) => c.onRoster)).toEqual([false, false, true, true])
    const ava = w.rows.find((r) => r.playerId === 'ava')!
    expect(ava.cells[1]).toMatchObject({ pts: null, onRoster: true })
    expect(ava.daysCounted).toBe(2)
  })

  it("trusts the scorer's counted list over the slot name", () => {
    // A starter slot the scorer did NOT count (say a games-limit cut it): bench points, not week points.
    const v = view()
    v.days[0].startedIds = ['ava']
    v.startedPoints = { ava: 6, cal: 2.5 }
    const ben = weekByPlayer(v)!.rows.find((r) => r.playerId === 'ben')!
    expect(ben.cells[0].counted).toBe(false)
    expect(ben.week).toBe(0)
    expect(ben.bench).toBe(7)
  })

  it('falls back to slot names for a view built before startedIds existed', () => {
    const v = view()
    for (const d of v.days) delete d.startedIds
    const ben = weekByPlayer(v)!.rows.find((r) => r.playerId === 'ben')!
    expect(ben.cells.map((c) => c.counted)).toEqual([true, false, false, false])
  })

  it('is null without a view, and before anyone has played this week', () => {
    expect(weekByPlayer(null)).toBeNull()
    expect(weekByPlayer({ ...view(), days: [] })).toBeNull()
    const unplayed = view()
    for (const d of unplayed.days) d.points = {}
    expect(weekByPlayer(unplayed)).toBeNull()
  })
})

describe('WeekByPlayerCard', () => {
  it('shows each player, his week total, his bench points and the day totals', () => {
    render(<WeekByPlayerCard data={weekByPlayer(view())!} renderName={(id) => <span>{id.toUpperCase()}</span>} />)
    const card = screen.getByTestId('week-by-player')
    expect(within(card).getByText('Week 4 by player')).toBeTruthy()

    const ben = screen.getByTestId('week-by-player-ben')
    expect(within(ben).getByText('BEN')).toBeTruthy()
    // His bench day is marked, and his bench total is shown beside his week total.
    expect(within(ben).getByLabelText('on bench')).toBeTruthy()
    const cells = within(ben).getAllByRole('cell').map((c) => c.textContent)
    expect(cells.slice(0, 2)).toEqual(['3.0', '4.0'])

    expect(screen.getByTestId('week-by-player-bench-note').textContent).toContain('4.0 pts were scored on your bench')
  })
})
