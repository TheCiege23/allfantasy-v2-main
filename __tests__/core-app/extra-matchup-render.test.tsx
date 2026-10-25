/**
 * An odd-team league's extra matchup is visible on the matchup screen and the week board:
 * "Extra matchup vs <team> (last week's top scorer)".
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { LeagueWeekBoard } from '@/lib/core-app/weekBoard'
import type { MatchupData } from '@/lib/core-app/matchup'

vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useOptionalLanguage: () => ({ language: 'en' }) }))
vi.mock('next/navigation', async (orig) => ({
  ...(await orig<typeof import('next/navigation')>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, prefetch() {}, back() {}, forward() {} }),
}))

import Matchup from '@/components/core-app/screens/Matchup'
import YourWeekLeague from '@/components/core-app/screens/YourWeekLeague'

const EXTRA = {
  role: 'leftover' as const,
  teamName: 'Gridiron Gang',
  reason: 'top_scorer' as const,
  countsForYou: true,
  label: "Extra matchup vs Gridiron Gang (last week's top scorer)",
}

beforeEach(() => {
  ;(globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = class {
    observe() {}
    disconnect() {}
  }
})
afterEach(() => {
  cleanup()
  delete (globalThis as unknown as { IntersectionObserver?: unknown }).IntersectionObserver
})

function matchupData(extraMatchup: MatchupData['extraMatchup']): MatchupData {
  return {
    league: { id: 'l1', name: 'Odd League', platform: 'native', logoUrl: null, sourceLink: null, lineupLink: null },
    week: { available: true, data: { week: 4, season: 2026, isFinal: false } },
    extraMatchup,
    teams: {
      available: true,
      data: {
        you: { teamName: 'Mine', ownerName: 'me', record: '2-1', isYou: true, avatarUrl: null },
        opponent: { teamName: 'Opponent not identified', ownerName: '', record: null, isYou: false, avatarUrl: null },
      },
    },
    sides: { available: false, reason: 'not scored yet' },
    lineups: { available: false, reason: 'n/a' },
    identityNote: null,
    playerScoring: { available: false, reason: 'projections' },
    winProbability: { available: false, reason: 'n/a' },
    projectedFinal: { available: false, reason: 'n/a' },
    yetToPlay: { available: false, reason: 'tally' },
    starterCountsBySide: null,
  } as MatchupData
}

function board(extraMatchup: LeagueWeekBoard['extraMatchup']): LeagueWeekBoard {
  return {
    leagueId: 'l1', leagueName: 'Odd League', platform: 'native', season: 2026, week: 4,
    yours: null, sidelines: [], rivalry: null, records: {}, yourRosterId: 'r1', yourTeamName: 'Mine', yourAvatarUrl: null,
    extraMatchup,
  }
}

describe('the extra matchup on screen', () => {
  it('the matchup screen names it', () => {
    render(<Matchup data={matchupData(EXTRA)} />)
    expect(screen.getByTestId('matchup-extra-matchup').textContent).toBe("Extra matchup vs Gridiron Gang (last week's top scorer)")
  })

  it('the week board names it, in place of the bye', () => {
    render(<YourWeekLeague board={board(EXTRA)} allWeeksHref="/core/week" />)
    expect(screen.getByTestId('week-board-extra-matchup').textContent).toContain('Extra matchup vs Gridiron Gang')
  })

  it('neither shows anything without one', () => {
    render(<Matchup data={matchupData(null)} />)
    render(<YourWeekLeague board={board(null)} allWeeksHref="/core/week" />)
    expect(screen.queryByTestId('matchup-extra-matchup')).toBeNull()
    expect(screen.queryByTestId('week-board-extra-matchup')).toBeNull()
  })
})
