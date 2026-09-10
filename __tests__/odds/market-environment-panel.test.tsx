import React from 'react'
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'

import { MarketEnvironment } from '@/components/ai-tools/modals/MatchupPrepModal'

/*
 * The scoring-environment panel — where the odds feed finally becomes visible.
 *
 * 🛑 WHAT THIS SUITE ACTUALLY PROTECTS IS THE WORDING, NOT THE LAYOUT.
 * AllFantasy reads the betting market as a FORECAST and is deliberately not a
 * gambling product. Two layers keep that true, and only one of them is enforced
 * elsewhere:
 *
 *   - lib/odds/gameOddsReads.ts refuses to return prices or sportsbook names at
 *     all, and __tests__/odds/game-odds-reads-forecast-only.test.ts pins that at
 *     runtime. So this component CANNOT render an odd even by mistake.
 *   - Nothing but this file stops the remaining formatting from drifting back
 *     into betting notation — rendering the spread as "-3.5" instead of
 *     "favored by 3.5" is a one-character change that no type or guard catches.
 *
 * ⚠ AND THE EMPTY STATE IS A REAL ASSERTION, NOT A COURTESY. Measured against the
 * live vendor: a game three days out returns ZERO odds; only fixtures inside about
 * two days of kickoff are populated. So for most of a week this panel is
 * legitimately empty, and it has to say "not yet" rather than look broken.
 */

type Row = React.ComponentProps<typeof MarketEnvironment>['rows'][number]

function row(over: Partial<Row> = {}): Row {
  return {
    name: "Ja'Marr Chase",
    team: 'CIN',
    impliedTeamTotal: 27.5,
    spread: -3.5,
    gameTotal: 48.5,
    opponent: 'TB',
    isHome: true,
    isStale: false,
    ...over,
  } as Row
}

describe('the forecast/gambling boundary, in the rendered output', () => {
  it('states the spread as game script, never as betting notation', () => {
    const { container } = render(<MarketEnvironment rows={[row({ spread: -3.5 })]} />)
    const text = container.textContent ?? ''

    expect(text).toContain('favored by 3.5')
    // The betting form of the same fact must not appear.
    expect(text).not.toContain('-3.5')
  })

  it('says "underdog by" rather than showing a plus-line', () => {
    const { container } = render(<MarketEnvironment rows={[row({ spread: 3.5 })]} />)
    const text = container.textContent ?? ''

    expect(text).toContain('underdog by 3.5')
    expect(text).not.toContain('+3.5')
  })

  it('calls the game total "combined", not an over/under', () => {
    const { container } = render(<MarketEnvironment rows={[row({ gameTotal: 48.5 })]} />)
    const text = container.textContent ?? ''

    expect(text).toContain('48.5 combined')
    expect(text.toLowerCase()).not.toContain('o/u')
    expect(text.toLowerCase()).not.toContain('over/under')
  })

  it('renders no price-shaped strings and no sportsbook name', () => {
    const { container } = render(
      <MarketEnvironment rows={[row(), row({ name: 'Bijan Robinson', team: 'ATL', spread: 2.5 })]} />,
    )
    const text = container.textContent ?? ''

    // American prices, decimal odds and book branding all absent.
    expect(text).not.toMatch(/[+-]\d{3}/)
    for (const book of ['Bet365', 'DraftKings', 'FanDuel', 'Pinnacle', 'bookmaker']) {
      expect(text).not.toContain(book)
    }
  })

  it('disclaims the two things a reader could wrongly infer', () => {
    const { container } = render(<MarketEnvironment rows={[row()]} />)
    const text = container.textContent ?? ''
    // Not a wager, and NOT the fantasy head-to-head win chance — those are
    // different numbers and conflating them is the likeliest misreading.
    expect(text).toContain('Not a wager')
    expect(text).toContain('not your matchup win chance')
  })
})

describe('an empty panel reads as "not yet", not as broken', () => {
  it('explains that lines post closer to kickoff', () => {
    const { container } = render(<MarketEnvironment rows={[]} />)
    const text = container.textContent ?? ''

    expect(text).toContain('closer to kickoff')
    expect(text.toLowerCase()).not.toContain('error')
    expect(text.toLowerCase()).not.toContain('unavailable')
  })

  it('treats a row with no implied total as absent rather than rendering a blank number', () => {
    // A row can exist with a null implied total when only one side of the market
    // parsed. Showing "—" or "0.0" would both be wrong; it should not list it.
    const { container } = render(<MarketEnvironment rows={[row({ impliedTeamTotal: null })]} />)
    const text = container.textContent ?? ''

    expect(text).toContain('closer to kickoff')
    expect(text).not.toContain("Ja'Marr Chase")
  })
})

describe('the useful content is actually present', () => {
  it('leads with expected points for that player’s offense', () => {
    const { container } = render(<MarketEnvironment rows={[row({ impliedTeamTotal: 27.5 })]} />)
    const text = container.textContent ?? ''

    expect(text).toContain("Ja'Marr Chase")
    expect(text).toContain('27.5')
    expect(text).toContain('vs TB')
  })

  it('says "at" for a road game and "vs" at home', () => {
    const home = render(<MarketEnvironment rows={[row({ isHome: true, opponent: 'TB' })]} />)
    expect(home.container.textContent).toContain('vs TB')

    const away = render(<MarketEnvironment rows={[row({ isHome: false, opponent: 'TB' })]} />)
    expect(away.container.textContent).toContain('at TB')
  })

  it('flags a stale read instead of quietly presenting it as current', () => {
    const { container } = render(<MarketEnvironment rows={[row({ isStale: true })]} />)
    expect(container.textContent).toContain('Past its refresh window')
  })

  it('CONTROL: a fresh row does NOT carry the stale warning', () => {
    // Without this, the stale assertion would pass against a component that always
    // shows the warning — a guard that cannot distinguish the two states.
    const { container } = render(<MarketEnvironment rows={[row({ isStale: false })]} />)
    expect(container.textContent).not.toContain('Past its refresh window')
  })
})
