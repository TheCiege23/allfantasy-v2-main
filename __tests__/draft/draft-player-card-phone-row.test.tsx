/**
 * Phone player card (2026-10-29): below md the row card is one line as tall as its 44px actions.
 * The ADP/Bye box and team badge hide on a phone and the team, ADP and Bye ride the meta line; the
 * "ADP n" fallback stat line hides there too because it repeats that meta line. Measured at Pixel 7
 * size: 116px -> 60px per card (~4 -> ~7.5 players visible); the desktop card is unchanged at 111px.
 */
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { DraftPlayerCard } from '@/components/app/draft-room/DraftPlayerCard'
import { normalizeDraftPlayer } from '@/lib/draft-sports-models/normalize-draft-player'

afterEach(cleanup)

const classes = (el: Element | null) => (el?.getAttribute('class') ?? '').split(/\s+/)

function card(extra: Record<string, unknown> = {}) {
  render(
    <ul>
      <DraftPlayerCard name="Example Guard" position="PG" team="OKC" adp={3} byeWeek={7} draftSport="NBA"
        variant="row" presentationVariant="redraft_snake" testId="c0" {...extra} />
    </ul>,
  )
}

describe('DraftPlayerCard row on a phone', () => {
  it('moves ADP and Bye into the meta line and hides the box and team badge below md only', () => {
    card()
    const inline = screen.getByTestId('c0-adp-inline')
    expect(classes(inline)).toContain('md:hidden')
    // NBA has no bye week, so — like the md+ box (`showBye`) — the phone line carries ADP only.
    expect(inline.textContent).toBe(' · ADP 3')
    expect(screen.queryByTestId('c0-bye')).toBeNull()
    // The desktop box is still rendered (desktop + e2e read `-adp`), hidden only below md.
    const box = screen.getByTestId('c0-adp').closest('div')!.parentElement!
    expect(classes(box)).toContain('max-md:hidden')
    const teamBadge = [...screen.getByTestId('c0-name').parentElement!.children].find((el) => el.textContent === 'OKC')
    expect(classes(teamBadge ?? null)).toContain('max-md:hidden')
  })

  it('carries Bye on the phone line where the sport has one, matching the md+ box', () => {
    card({ draftSport: 'NFL' })
    expect(screen.getByTestId('c0-adp-inline').textContent).toBe(' · ADP 3 · Bye 7')
    expect(screen.getByTestId('c0-bye').textContent).toBe('7')
  })

  it('hides the ADP fallback stat line on a phone, but keeps a line with real stats', () => {
    card()
    expect(screen.getByTestId('c0-stats-summary').textContent).toBe('')
    expect(classes(screen.getByTestId('c0-stats-summary'))).toContain('max-md:hidden')
    cleanup()
    const player = normalizeDraftPlayer({
      name: 'Example Guard', position: 'PG', team: 'OKC',
      nbaDraftStats: { pointsPerGame: 25, reboundsPerGame: 6.5, minutesPerGame: 34.2 },
    }, 'NBA')
    card({ display: player.display })
    expect(screen.getByTestId('c0-stats-summary').textContent).toBe('PPG 25.0 · RPG 6.5 · MPG 34.2')
    expect(classes(screen.getByTestId('c0-stats-summary'))).not.toContain('max-md:hidden')
  })
})
