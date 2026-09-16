import { render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LeagueHome } from '@/components/core-app/screens/LeagueHome'
import type { LeagueHomeData } from '@/lib/core-app/leagueHome'
import type { LeagueScoreboard } from '@/lib/core-app/leagueScoreboard'

/**
 * A future week's note under the league scoreboard (scoring audit, 2026-09-16).
 *
 * The note said "Every number is projected from today's rosters". Once the board refuses to
 * show generic totals, a league we cannot score has no numbers at all, and the note must not
 * vouch for them — the board's own header says why instead.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ prefetch() {}, push() {}, replace() {}, refresh() {} }),
  usePathname: () => '/core',
  useSearchParams: () => new URLSearchParams('league=lg-1'),
}))

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(JSON.stringify({ canConfirm: false }), { status: 200 }))),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const off = { available: false as const, reason: 'not in this fixture' }

function board(unpricedReason: string | null): LeagueScoreboard {
  const priced = unpricedReason == null
  return {
    seasonYear: 2026,
    week: 5,
    allUnplayed: true,
    unpaired: [],
    projectionBasis: priced ? { season: '2026', week: 2, matchesViewedWeek: false } : null,
    unpricedReason,
    games: [
      {
        matchupId: 1,
        unplayed: true,
        margin: null,
        winProbability: null,
        teams: ['1', '2'].map((rosterId) => ({
          rosterId,
          teamName: `Team ${rosterId}`,
          managerName: null,
          avatarUrl: null,
          points: null,
          projected: priced ? 100 : null,
          projectedFrom: priced ? 9 : 0,
          starterCount: 9,
          isYou: rosterId === '1',
        })),
      },
    ],
  }
}

function page(scoreboard: LeagueScoreboard): LeagueHomeData {
  return {
    pairing: null,
    league: {
      id: 'lg-1',
      name: 'Kings of Buffalo',
      platform: 'sleeper',
      format: 'Dynasty · Half PPR',
      sport: 'NFL',
      season: 2026,
      currentWeek: 2,
    },
    importCoverage: {
      capabilities: { rosters: true, scoring: true, matchups: true, standings: true, draft: true, trades: true, history: true },
      missing: [],
      partial: [],
      sentence: '',
      hasGaps: false,
    },
    yourTeam: off,
    stage: null,
    preSeason: false,
    weekPicker: { weeks: [1, 2, 3, 4, 5], selected: 5, current: 2, isFuture: true },
    standings: off,
    timeline: off,
    matchup: off,
    draftHq: off,
    commissioner: off,
    buzz: off,
    scoreboard: { available: true, data: scoreboard },
    powerBoard: off,
    rivalry: off,
    syncAge: { label: '3m ago', stale: false },
  } as unknown as LeagueHomeData
}

const noteOf = (data: LeagueHomeData) =>
  (render(<LeagueHome data={data} otherLeagueIssueCount={0} identityInShell />).container.querySelector(
    '.af-lh-weeknote',
  )?.textContent ?? '').replace(/\s+/g, ' ')

describe('League Home future-week note', () => {
  it('names the projection week when the board has league-scored totals', () => {
    const note = noteOf(page(board(null)))
    expect(note).toContain('Nothing in week 5 has been played.')
    expect(note).toContain('Every number is projected from today')
    expect(note).toContain('using week 2 projections')
  })

  it('🛑 does not vouch for numbers the board no longer shows', () => {
    const note = noteOf(
      page(board('we hold no scoring settings for this league, and a generic projection would not be yours')),
    )
    expect(note).toContain('Nothing in week 5 has been played.')
    expect(note).not.toContain('Every number is projected')
  })
})
