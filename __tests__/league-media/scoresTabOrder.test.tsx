/**
 * Live scores (Game Center): the scoreboard comes first. Start A vs B sits under the games, folded,
 * instead of between the header and the first score (2026-11-05).
 */
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/app/player-comparison/StartVsComparisonLauncher', () => ({
  StartVsComparisonLauncher: () => <div data-testid="start-vs-launcher">launcher</div>,
}))

import { ScoresTab } from '@/app/league/[leagueId]/tabs/ScoresTab'

const league = {
  id: 'lg1', name: 'Sunday League', platform: 'allfantasy', sport: 'NFL', season: 2026, teamCount: 12, format: 'redraft',
  scoring: 'Half PPR', currentWeek: 9, lifecycleState: 'in_season', leagueType: 'redraft',
} as never

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('ScoresTab layout', () => {
  it('puts Start A vs B after the scoreboard, folded until asked for', async () => {
    render(<ScoresTab league={league} />)
    const center = screen.getByTestId('scores-game-center')
    const compare = screen.getByTestId('scores-compare')
    expect(compare.tagName).toBe('DETAILS')
    expect((compare as HTMLDetailsElement).open).toBe(false)
    // Every scoreboard section precedes the compare row in document order.
    const nav = screen.getByTestId('scores-nav-leaders')
    expect(nav.compareDocumentPosition(compare) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(center.lastElementChild).toBe(compare)
    fireEvent.click(compare.querySelector('summary')!)
    expect((compare as HTMLDetailsElement).open).toBe(true)
    expect(screen.getByTestId('start-vs-launcher')).toBeTruthy()
    expect(compare.textContent).toContain('Compare two players for Week 9')
  })
})
