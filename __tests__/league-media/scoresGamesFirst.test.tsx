/**
 * Live scores on a phone: the games come before the Start A vs B tool (2026-11-06, found in the dynasty audit; the
 * tab is shared, so it applies to every format). Measured at 390px in /e2e/redraft-league/scores: the tab opened on
 * its header, then the Start A vs B card (two name fields, a button and a hint — ~380px), and the first game sat
 * at y=897, below an 844px screen. The tab's root is a flex column, so on a phone the tool first took `order` last.
 * Merged with the redraft pass (#3290), which went further: the tool now sits after the games in the DOM at every
 * size, folded into a <details>. This test asserts the intent both shared — on a phone the tool comes after the
 * games — and accepts either mechanism.
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('@/components/app/player-comparison/StartVsComparisonLauncher', () => ({
  StartVsComparisonLauncher: () => <div data-testid="stub-start-vs" />,
}))
vi.mock('@/app/idp/components/IDPMatchupView', () => ({ IDPMatchupView: () => null }))
vi.mock('@/components/sports/GameWeatherInline', () => ({ GameWeatherInline: () => null }))
vi.mock('@/app/components/TeamLogo', () => ({ TeamLogo: () => null }))
vi.mock('@/lib/hooks/useSleeperPlayers', () => ({ useSleeperPlayers: () => ({ players: {} }) }))

import { ScoresTab } from '@/app/league/[leagueId]/tabs/ScoresTab'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const league = {
  id: 'L', name: 'Forever Dynasty', platform: 'allfantasy', sport: 'NFL', format: 'dynasty', scoring: 'Half PPR', teamCount: 12,
  season: 2026, lifecycleState: 'in_season', currentWeek: 9, leagueType: 'dynasty', isDynasty: true, isCommissioner: true,
}

describe('Live scores on a phone', () => {
  it('the Start A vs B block comes after the games on a phone', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) }))
    render(<ScoresTab league={league as never} sport="NFL" />)
    const root = screen.getByTestId('scores-game-center')
    // The block that holds the tool is a direct child of the flex-column root.
    let block: HTMLElement = screen.getByTestId('stub-start-vs')
    while (block.parentElement && block.parentElement !== root) block = block.parentElement
    expect(block.parentElement).toBe(root)
    expect(root.className.split(/\s+/)).toEqual(expect.arrayContaining(['flex', 'flex-col']))
    const cls = block.className.split(/\s+/)
    // Either it is the root's last child (after the games in the DOM) or a phone `order` puts it last.
    const games = screen.getByTestId('scores-nav-leaders')
    const afterGames = Boolean(games.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING)
    expect(afterGames || cls.includes('max-md:order-last'), 'the tool must come after the games on a phone').toBe(true)
    // No unconditional `order-*` that would reorder it some other way.
    expect(cls.filter((c) => /^order-/.test(c))).toEqual([])
  })
})
