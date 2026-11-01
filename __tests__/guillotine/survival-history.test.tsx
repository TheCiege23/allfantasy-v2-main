/**
 * Survival history (lib/guillotine/survivalHistory.ts, components/guillotine/GuillotineSurvivalHistory.tsx):
 * each chop week and every team's path, from the chop's own scores and the week each team fell.
 */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { buildSurvivalHistory } from '@/lib/guillotine/survivalHistory'
import { GuillotineSurvivalHistory } from '@/components/guillotine/GuillotineSurvivalHistory'

const names = { a: 'Aces', b: 'Bricklayers', c: 'Clutch', d: 'Dynamo' }
// Week 1: B chopped at 60; C escaped by 2. Week 2: no chop. Week 3: D chopped at 80 (tied with C; C won the tiebreak).
const scores = [
  { rosterId: 'a', week: 1, points: 120 }, { rosterId: 'b', week: 1, points: 60 }, { rosterId: 'c', week: 1, points: 62 }, { rosterId: 'd', week: 1, points: 95 },
  { rosterId: 'a', week: 2, points: 110 }, { rosterId: 'c', week: 2, points: 70 }, { rosterId: 'd', week: 2, points: 88 },
  { rosterId: 'a', week: 3, points: 131.24 }, { rosterId: 'c', week: 3, points: 80 }, { rosterId: 'd', week: 3, points: 80 },
]
const chopped = [{ rosterId: 'b', week: 1 }, { rosterId: 'd', week: 3 }]
const history = () => buildSurvivalHistory({ scores, chopped, names, closeCallMargin: 10 })

describe('buildSurvivalHistory', () => {
  it('each week: the chop line, who fell, the closest escape and the top score — latest first', () => {
    const { weeks } = history()
    expect(weeks.map((w) => w.week)).toEqual([3, 2, 1])
    expect(weeks[2]).toEqual({
      week: 1, chopLine: 60, teamsScored: 4,
      chopped: [{ rosterId: 'b', name: 'Bricklayers', points: 60 }],
      closestEscape: { rosterId: 'c', name: 'Clutch', margin: 2 },
      topScorer: { rosterId: 'a', name: 'Aces', points: 120 },
    })
    // A no-chop week has no line and no escape.
    expect(weeks[1]).toMatchObject({ week: 2, chopLine: null, chopped: [], closestEscape: null })
    // A tie on the line: the team that won the tiebreak escaped by 0.
    expect(weeks[0]).toMatchObject({ chopLine: 80, closestEscape: { rosterId: 'c', margin: 0 }, topScorer: { points: 131.2 } })
  })

  it('every team’s path: survived chops, close calls, its closest escape and the week it fell', () => {
    const teams = Object.fromEntries(history().teams.map((t) => [t.rosterId, t]))
    expect(teams.c).toMatchObject({ status: 'alive', choppedWeek: null, weeksSurvived: 2, closeCalls: 2, bestEscape: 0, seasonPoints: 212 })
    expect(teams.a).toMatchObject({ status: 'alive', weeksSurvived: 2, closeCalls: 0, bestEscape: 51.2 })
    expect(teams.d).toMatchObject({ status: 'chopped', choppedWeek: 3, weeksSurvived: 1, bestEscape: 35 })
    expect(teams.b).toMatchObject({ status: 'chopped', choppedWeek: 1, weeksSurvived: 0, bestEscape: null })
    expect(teams.c.path).toEqual([
      { week: 1, points: 62, margin: 2, chopped: false },
      { week: 2, points: 70, margin: null, chopped: false },
      { week: 3, points: 80, margin: 0, chopped: false },
    ])
  })

  it('alive first (longest survivors, then season points), then the chopped, the latest to fall first', () => {
    expect(history().teams.map((t) => t.rosterId)).toEqual(['a', 'c', 'd', 'b'])
  })

  it('a double chop: the line is the HIGHEST score chopped, and margins are measured from it', () => {
    const h = buildSurvivalHistory({
      scores: [{ rosterId: 'x', week: 4, points: 50 }, { rosterId: 'y', week: 4, points: 58 }, { rosterId: 'z', week: 4, points: 68 }],
      chopped: [{ rosterId: 'x', week: 4 }, { rosterId: 'y', week: 4 }],
      names: {},
      closeCallMargin: 10,
    })
    expect(h.weeks[0]).toMatchObject({ chopLine: 58, closestEscape: { rosterId: 'z', margin: 10 } })
    // Exactly at the danger margin is a close call.
    expect(h.teams.find((t) => t.rosterId === 'z')).toMatchObject({ closeCalls: 1, bestEscape: 10 })
  })

  it('a team without a name reads "A team", never an id', () => {
    const h = buildSurvivalHistory({ scores: [{ rosterId: 'x', week: 1, points: 1 }], chopped: [{ rosterId: 'x', week: 1 }], names: {}, closeCallMargin: 10 })
    expect(h.weeks[0]!.chopped[0]!.name).toBe('A team')
  })
})

describe('GuillotineSurvivalHistory', () => {
  it('shows each chop and every team’s row, and marks the viewer’s', () => {
    render(<GuillotineSurvivalHistory history={history()} myRosterId="c" closeCallMargin={10} />)
    const w1 = screen.getByTestId('guillotine-history-week-1')
    expect(w1.textContent).toContain('chop line 60.0')
    expect(w1.textContent).toContain('Chopped: Bricklayers (60.0)')
    expect(w1.textContent).toContain('Closest escape: Clutch by 2.0')
    // No-chop weeks are not listed as chops.
    expect(screen.queryByTestId('guillotine-history-week-2')).toBeNull()
    expect(screen.getByTestId('guillotine-history-team-c').textContent).toContain('You · Clutch')
    expect(screen.getByTestId('guillotine-history-team-c').textContent).toContain('Alive · 2 chops survived')
    expect(screen.getByTestId('guillotine-history-team-d').textContent).toContain('Chopped wk 3')
    // Each square of a path says what happened, for a screen reader too.
    expect(screen.getByTestId('guillotine-history-team-c').textContent).toContain('Week 1: 62.0 points, close call, +2.0')
  })

  it('replays a week, and shows the latest four chops until asked for all', () => {
    const many = buildSurvivalHistory({
      scores: [1, 2, 3, 4, 5, 6].flatMap((week) => [{ rosterId: `t${week}`, week, points: 50 }, { rosterId: 'z', week, points: 100 }]),
      chopped: [1, 2, 3, 4, 5, 6].map((week) => ({ rosterId: `t${week}`, week })),
      names: {},
      closeCallMargin: 10,
    })
    const onReplay = vi.fn()
    render(<GuillotineSurvivalHistory history={many} closeCallMargin={10} onReplay={onReplay} />)
    expect(screen.queryByTestId('guillotine-history-week-2')).toBeNull()
    fireEvent.click(screen.getByTestId('guillotine-history-all-weeks'))
    expect(screen.getByTestId('guillotine-history-week-1')).toBeTruthy()
    fireEvent.click(screen.getByTestId('guillotine-history-week-6').querySelector('button')!)
    expect(onReplay).toHaveBeenCalledWith(6)
  })

  it('before the first chop it says so', () => {
    render(<GuillotineSurvivalHistory history={{ weeks: [], teams: [] }} closeCallMargin={10} />)
    expect(screen.getByTestId('guillotine-history-empty')).toBeTruthy()
  })
})
