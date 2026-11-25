// @vitest-environment jsdom
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { CollegeSeasonView } from '@/components/c2c/CollegeSeasonPanel'
import type { CampusSeasonView } from '@/lib/c2c/campusSeason/campusSeasonView'

afterEach(cleanup)

const view = (over: Partial<CampusSeasonView> = {}): CampusSeasonView => ({
  season: 2026,
  status: 'playoffs',
  regularSeasonWeeks: 10,
  playoffTeams: 6,
  championRosterId: null,
  week: 12,
  weeks: [1, 2, 11, 12, 13],
  teams: { a: { name: 'Scorescotty' }, b: { name: 'Ciege82' }, c: { name: 'TQ Trojans' } },
  standings: [
    { rosterId: 'a', rank: 1, seed: 1, wins: 8, losses: 2, ties: 0, medianWins: 7, medianLosses: 3, medianTies: 0, pointsFor: 1234.5, pointsAgainst: 1001 },
    { rosterId: 'b', rank: 2, seed: 2, wins: 7, losses: 3, ties: 0, medianWins: 6, medianLosses: 4, medianTies: 0, pointsFor: 1200, pointsAgainst: 1100 },
    { rosterId: 'c', rank: 3, seed: null, wins: 2, losses: 8, ties: 0, medianWins: 2, medianLosses: 8, medianTies: 0, pointsFor: 900, pointsAgainst: 1300 },
  ],
  matchups: [{ id: 'm1', week: 12, kind: 'playoff', playoffRound: 2, status: 'active', homeRosterId: 'a', awayRosterId: 'b', homeScore: 61.2, awayScore: 58 }],
  overall: [{ rosterId: 'b', rank: 1, wins: 20, losses: 10, ties: 0, pointsFor: 2500 }],
  ...over,
})

describe('CollegeSeasonView', () => {
  it('shows the college table with seeds and the median record once', () => {
    render(<CollegeSeasonView view={view()} />)
    expect(screen.getByRole('heading', { name: 'College standings' })).toBeTruthy()
    expect(screen.getByText('vs median')).toBeTruthy()
    expect(screen.getByText(/seed 1/)).toBeTruthy()
    expect(screen.getByText('8-2')).toBeTruthy()
  })

  it('names playoff weeks and shows a live game', () => {
    render(<CollegeSeasonView view={view()} />)
    expect(screen.getByRole('option', { name: 'College semifinals' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'College final' })).toBeTruthy()
    expect(screen.getByText(/live/)).toBeTruthy()
  })

  it('names the college champion and the overall leader', () => {
    render(<CollegeSeasonView view={view({ status: 'complete', championRosterId: 'a' })} />)
    expect(screen.getByText(/won the college title/).textContent).toContain('Scorescotty')
    expect(screen.getByText(/Overall title: Ciege82 leads, 20-10/)).toBeTruthy()
  })

  it('hides the median column when the league plays no median', () => {
    const noMedian = view().standings.map((s) => ({ ...s, medianWins: 0, medianLosses: 0, medianTies: 0 }))
    render(<CollegeSeasonView view={view({ standings: noMedian })} />)
    expect(screen.queryByText('vs median')).toBeNull()
  })

  it('picking a week asks for it', () => {
    const onWeek = vi.fn()
    render(<CollegeSeasonView view={view()} onWeek={onWeek} />)
    fireEvent.change(screen.getByLabelText('College week'), { target: { value: '2' } })
    expect(onWeek).toHaveBeenCalledWith(2)
  })
})
