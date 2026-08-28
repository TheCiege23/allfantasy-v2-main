import React from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { DashGameDayBand } from '@/components/core-app/screens/DashGameDayBand'
import type { PlayFeedItem } from '@/lib/live/playFeedPresentation'
import type { TodayStripData } from '@/lib/core-app/todayStrip'

/**
 * The band's contract is mostly about when it does NOT exist. A live-looking
 * scoreboard on a Tuesday is the failure this component is designed to avoid.
 */

const NOW = new Date('2026-09-07T18:30:00Z')

function play(over: Partial<PlayFeedItem> = {}): PlayFeedItem {
  return {
    id: 'evt-1',
    gameId: 'g1',
    type: 'TOUCHDOWN',
    playerName: 'Bijan Robinson',
    team: 'ATL',
    // Null rather than a URL: this band never renders a badge, and a fixture
    // that supplies one would imply a coupling the component does not have.
    teamLogoUrl: null,
    imageUrl: null,
    position: 'RB',
    headline: 'Bijan Robinson ran for a touchdown',
    yards: 12,
    detectedAt: new Date(NOW.getTime() - 5 * 60_000).toISOString(),
    ...over,
  }
}

function strip(over: Partial<TodayStripData> = {}): TodayStripData {
  return {
    record: { available: false, reason: 'nothing scored yet' },
    health: { available: false, reason: 'not read' },
    next24: [],
    ...over,
  } as TodayStripData
}

describe('DashGameDayBand', () => {
  it('renders nothing outside a game window', () => {
    const quiet = render(<DashGameDayBand strip={strip()} plays={[]} now={NOW} regularSeasonUnderway />)
    expect(quiet.container.innerHTML).toBe('')

    // A play from last Sunday is not this Sunday's slate.
    const stale = render(
      <DashGameDayBand
        strip={strip()}
        plays={[play({ detectedAt: new Date(NOW.getTime() - 7 * 86_400_000).toISOString() })]}
        now={NOW}
        regularSeasonUnderway
      />,
    )
    expect(stale.container.innerHTML).toBe('')
  })

  it('renders nothing when both loaders failed', () => {
    const { container } = render(<DashGameDayBand strip={null} plays={[]} now={NOW} regularSeasonUnderway />)
    expect(container.innerHTML).toBe('')
  })

  it('renders the feed once a recent play lands', () => {
    render(<DashGameDayBand strip={strip()} plays={[play()]} now={NOW} regularSeasonUnderway />)
    expect(screen.getByText('Game day')).toBeTruthy()
    expect(screen.getByText(/Bijan Robinson ran for a touchdown/)).toBeTruthy()
    expect(screen.getByText('TD')).toBeTruthy()
  })

  it("says so when plays are landing but none of the user's matchups are scored", () => {
    const { container } = render(<DashGameDayBand strip={strip()} plays={[play()]} now={NOW} regularSeasonUnderway />)
    expect(container.textContent).toContain('none of your matchups have scored yet')
    // Never a 0–0, which reads as a day played and lost.
    expect(container.textContent).not.toContain('0–0')
  })

  it('shows the record when one is available, even with no plays cached', () => {
    const withRecord = strip({
      record: { available: true, data: { wins: 4, losses: 2, week: 1, season: 2026 } },
    } as Partial<TodayStripData>)
    const { container } = render(
      <DashGameDayBand strip={withRecord} plays={[]} now={NOW} regularSeasonUnderway />,
    )
    expect(container.textContent).toContain('4')
    expect(container.textContent).toContain('2')
    expect(container.textContent).toContain('week 1')
  })

  it('never prints a fantasy point total for a play', () => {
    const { container } = render(
      <DashGameDayBand
        strip={strip()}
        plays={[play({ headline: 'Bijan Robinson ran for 17 yards', yards: 17 })]}
        now={NOW}
        regularSeasonUnderway
      />,
    )
    const text = container.textContent ?? ''
    expect(text).toContain('Bijan Robinson ran for 17 yards')
    // The same catch is worth different points in each league — no figure here.
    expect(text).not.toMatch(/\bpts\b|\bpoints\b|\+\d+\.\d/)
  })

  it('lists what is still to come today', () => {
    const withNext = strip({
      next24: [
        { kind: 'game', text: 'Bills at Ravens', sub: 'NFL · Week 1', time: NOW.toISOString(), tone: null },
        { kind: 'waiver', text: 'Waivers run', sub: 'Four Horsemen Vol. 5', time: NOW.toISOString(), tone: 'warn' },
      ],
    })
    const { container } = render(
      <DashGameDayBand strip={withNext} plays={[play()]} now={NOW} regularSeasonUnderway />,
    )
    expect(container.textContent).toContain('Bills at Ravens')
    expect(container.textContent).toContain('Waivers run')
  })

  it('renders nothing in the preseason, however live the plays are', () => {
    // The bug this pins: preseason football produces real plays that score
    // nobody's lineup. The band claimed this rule in prose and did not enforce
    // it, so a Saturday exhibition could lead the page.
    const { container } = render(
      <DashGameDayBand
        strip={strip({
          record: { available: true, data: { wins: 4, losses: 2, week: 1, season: 2026 } },
        } as Partial<TodayStripData>)}
        plays={[play()]}
        now={NOW}
        regularSeasonUnderway={false}
      />,
    )
    expect(container.innerHTML).toBe('')
  })

  it('says the feed is league-wide rather than implying these are your players', () => {
    const { container } = render(
      <DashGameDayBand strip={strip()} plays={[play()]} now={NOW} regularSeasonUnderway />,
    )
    // Asserted on meaning, not on the exact sentence: the band must
    // disclaim that these plays are league-wide, however that is worded.
    expect(container.textContent).toMatch(/not only your players|not filtered to your rosters/)
  })

  it('caps the feed rather than printing an entire slate', () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      play({ id: `evt-${i}`, playerName: `Player ${i}`, headline: `Player ${i} scored` }),
    )
    const { container } = render(
      <DashGameDayBand strip={strip()} plays={many} now={NOW} regularSeasonUnderway />,
    )
    expect(container.querySelectorAll('.af-gd-play').length).toBe(6)
  })
})
