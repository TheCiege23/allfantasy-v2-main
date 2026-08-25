import React from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { DashScheduleBand } from '@/components/core-app/screens/DashScheduleBand'
import type { WeekBoard, WeekMatchup } from '@/lib/core-app/weekBoard'

/**
 * The band's whole reason to exist is that it can speak before a week is
 * scored. These tests pin the two halves of that: it must render the pairing
 * when there are no points, and it must never render a number that implies
 * there are.
 */

function matchup(over: Partial<WeekMatchup> = {}): WeekMatchup {
  return {
    leagueId: 'lg-1',
    leagueName: 'Four Horsemen Vol. 5',
    platform: 'sleeper',
    season: 2026,
    week: 1,
    opponent: { rosterId: 7, name: 'DynastyDan' },
    projection: null,
    yourSampleWeeks: 0,
    href: '/core/matchup?league=lg-1',
    ...over,
  }
}

function board(over: Partial<WeekBoard> = {}): WeekBoard {
  return {
    season: 2026,
    week: 1,
    coinFlips: [],
    leaning: [],
    unprojected: [matchup()],
    model: { basis: 'No completed weeks are on file yet.', sampleSize: 0 },
    withoutSchedule: 0,
    firstKickoffAt: new Date(Date.now() + 5 * 86_400_000).toISOString(),
    ...over,
  }
}

describe('DashScheduleBand', () => {
  it('names the opponent when nothing has been scored', () => {
    render(<DashScheduleBand board={board()} syncLabel={null} />)
    expect(screen.getByText('DynastyDan')).toBeTruthy()
    expect(screen.getByText('Four Horsemen Vol. 5')).toBeTruthy()
    expect(screen.getByText(/Week 1 · who you play/)).toBeTruthy()
  })

  it('renders no score, margin or win probability even when a projection exists', () => {
    const projected = matchup({
      projection: { you: 118.4, them: 102.2, margin: 16.2, winProbability: 0.71 },
      yourSampleWeeks: 6,
    })
    const { container } = render(
      <DashScheduleBand board={board({ coinFlips: [projected], unprojected: [] })} syncLabel={null} />,
    )
    const text = container.textContent ?? ''
    // The pairing survives; every quantity from the projection is absent.
    expect(text).toContain('DynastyDan')
    for (const forbidden of ['118', '102', '16.2', '71%', '0.71']) {
      expect(text).not.toContain(forbidden)
    }
    // No fabricated zero either — the incident weekAll.ts documents.
    expect(text).not.toContain('0.00')
  })

  it('pulls matchups from every projection bucket, sorted by league', () => {
    const { container } = render(
      <DashScheduleBand
        board={board({
          coinFlips: [matchup({ leagueId: 'z', leagueName: 'Zeta League' })],
          leaning: [matchup({ leagueId: 'a', leagueName: 'Alpha League' })],
          unprojected: [matchup({ leagueId: 'm', leagueName: 'Mid League' })],
        })}
        syncLabel={null}
      />,
    )
    const text = container.textContent ?? ''
    expect(text).toContain('3 matchups')
    expect(text.indexOf('Alpha League')).toBeLessThan(text.indexOf('Mid League'))
    expect(text.indexOf('Mid League')).toBeLessThan(text.indexOf('Zeta League'))
  })

  it('says which roster it is rather than inventing a manager name', () => {
    render(
      <DashScheduleBand
        board={board({ unprojected: [matchup({ opponent: { rosterId: 4, name: null } })] })}
        syncLabel={null}
      />,
    )
    expect(screen.getByText('Roster 4')).toBeTruthy()
  })

  it('states leagues carrying no schedule instead of hiding them', () => {
    const { container } = render(
      <DashScheduleBand board={board({ withoutSchedule: 55 })} syncLabel={null} />,
    )
    expect(container.textContent).toContain('no schedule yet for your other 55 leagues')
  })

  it('renders nothing when the read failed or no league has a schedule', () => {
    const failed = render(<DashScheduleBand board={null} syncLabel={null} />)
    expect(failed.container.innerHTML).toBe('')

    const empty = render(
      <DashScheduleBand board={board({ unprojected: [] })} syncLabel={null} />,
    )
    expect(empty.container.innerHTML).toBe('')
  })

  it('drops the week number once its own kickoff has passed', () => {
    /*
     * The tail on "earliest unscored week": if scoring never lands, week 1
     * stays the earliest unscored week forever and this band would say
     * "Week 1" in December. The neutral label is true whatever ingestion does.
     */
    const { container } = render(
      <DashScheduleBand
        board={board({ week: 1, firstKickoffAt: new Date(Date.now() - 60 * 86_400_000).toISOString() })}
        syncLabel={null}
      />,
    )
    expect(container.textContent).toContain('This week · who you play')
    expect(container.textContent).not.toContain('Week 1')
  })

  it('drops a kickoff that has already passed rather than reporting it as upcoming', () => {
    const { container } = render(
      <DashScheduleBand
        board={board({ firstKickoffAt: new Date(Date.now() - 86_400_000).toISOString() })}
        syncLabel={null}
      />,
    )
    expect(container.textContent).not.toContain('first kickoff')
  })
})
