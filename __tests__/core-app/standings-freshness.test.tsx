import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { render } from '@testing-library/react'
import { Standings, type StandingsFreshness } from '@/components/core-app/screens/Standings'
import type { LeagueStandingsResult } from '@/lib/core-app/leagueStandings'
import { freshnessLabel, shouldWarnAboutFreshness, type FreshnessMeta } from '@/lib/sports-os/freshness'

const NOW = 1_700_000_000_000

const freshnessFor = (m: FreshnessMeta): StandingsFreshness => ({
  meta: m,
  initialLabel: freshnessLabel(m, NOW),
  initialWarn: shouldWarnAboutFreshness(m, NOW),
})

/** The refusal branch — the cheapest complete board, and the one that matters most here. */
const unavailable: LeagueStandingsResult = {
  available: false,
  leagueName: 'Test League',
  history: [],
  reason: 'this league has no scored weeks yet',
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('Standings freshness', () => {
  it('labels the refusal branch too', () => {
    /*
     * ⚠ NOT AN EDGE CASE. An `available: false` board is cached exactly like an available one, so
     * "we could not read this league's results" can itself be minutes old. A reader who has just
     * fixed the cause needs to see the refusal is stale rather than assume it is live.
     */
    const { container } = render(
      <Standings
        data={unavailable}
        freshness={freshnessFor({ fetchedAt: NOW - 4 * 60_000, source: 'cache', staleAfterMs: 2 * 60_000 })}
      />,
    )
    expect(container.querySelector('.af-fresh')).not.toBeNull()
    expect(container.textContent).toContain('4m ago')
    // The refusal itself must still be the thing on screen.
    expect(container.textContent).toContain('no scored weeks yet')
  })

  it('renders NO chip for the off-cohort read', () => {
    // 🛑 Most readers are still on the direct call, which has no envelope. A chip over that board
    // would invent an age for a value that was just computed — and "unknown" is worse than silent,
    // because it claims uncertainty that does not exist.
    const { container } = render(<Standings data={unavailable} />)
    expect(container.querySelector('.af-fresh')).toBeNull()

    const { container: explicitNull } = render(<Standings data={unavailable} freshness={null} />)
    expect(explicitNull.querySelector('.af-fresh')).toBeNull()
  })

  it('surfaces a failed refresh rather than presenting it as merely old', () => {
    const { container } = render(
      <Standings
        data={unavailable}
        freshness={freshnessFor({ fetchedAt: NOW - 30_000, source: 'last-known', staleAfterMs: 5 * 60_000 })}
      />,
    )
    expect(container.querySelector('.af-fresh')?.getAttribute('data-state')).toBe('last-known')
    expect(container.textContent).toContain('refresh failed')
  })
})
