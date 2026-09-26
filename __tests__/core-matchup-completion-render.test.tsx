import React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { Dash3AMatchups } from '@/components/core-app/screens/Dashboard3A'
import { YourWeek } from '@/components/core-app/dash-v2/YourWeek'
import type { WeekAllData } from '@/lib/core-app/weekAll'

afterEach(cleanup)
const data = (completed: boolean | undefined, pointsFor = 74.2, pointsAgainst = 2.3): WeekAllData => ({
  rows: [{ leagueId: 'l1', leagueName: 'My league', platform: 'sleeper', season: 2026, week: 3, pointsFor, pointsAgainst, won: true, completed }],
  season: 2026, week: 3, withoutHistory: 0, unscored: 0, record: null,
})

describe('matchup completion evidence', () => {
  it.each([false, undefined])('partial or legacy scores (%s) cannot claim a result', (completed) => {
    const week = data(completed)
    render(<Dash3AMatchups leagues={[]} week={week} winProb={{ l1: 0.15 }} weekLabel="NFL WK 3" />)
    expect(screen.getByText(/Week 3 · scores so far/)).toBeTruthy()
    expect(screen.getByText('15% win')).toBeTruthy()
    expect(screen.queryByText(/you won|you lost|you tied/)).toBeNull()
    render(<YourWeek data={week} />)
    expect(screen.getByText('Live')).toBeTruthy()
    expect(screen.queryByText('W')).toBeNull()
  })

  it.each([[100, 90, 'you won', 'W'], [90, 100, 'you lost', 'L'], [100, 100, 'you tied', 'T']] as const)(
    'recorded score %s–%s shows %s with no predictive odds', (pointsFor, pointsAgainst, label, result) => {
      const week = data(true, pointsFor, pointsAgainst)
      render(<Dash3AMatchups leagues={[]} week={week} winProb={{ l1: 0.88 }} weekLabel="NFL WK 3" />)
      expect(screen.getByText(`Week 3 · ${label}`)).toBeTruthy()
      expect(screen.queryByText(/% win/)).toBeNull()
      render(<YourWeek data={week} />)
      expect(screen.getByText(result)).toBeTruthy()
    },
  )
})
