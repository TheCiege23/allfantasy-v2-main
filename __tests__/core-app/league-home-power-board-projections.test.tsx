import { render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LeagueHome } from '@/components/core-app/screens/LeagueHome'
import type { LeagueHomeData } from '@/lib/core-app/leagueHome'
import type { AllPlayBoard } from '@/lib/core-app/allPlay'
import type { StandingsLineups } from '@/lib/core-app/standingsLineups'

/**
 * The Power board's AF / API columns (2026-09-30): this week's lineups, projected, beside each
 * team's all-play row. Display only — the rank is all-play and the fixture proves the order is
 * untouched by the projections.
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

const row = (rosterId: string, powerRank: number) => ({
  rosterId,
  teamName: `Team ${rosterId}`,
  managerName: null,
  avatarUrl: null,
  wins: 2,
  losses: 1,
  ties: 0,
  allPlayWins: 20,
  allPlayLosses: 13,
  allPlayTies: 0,
  pointsFor: 300,
  luckWins: 0,
  powerRank,
  powerRankChange: null,
})

const powerBoard: AllPlayBoard = { rows: [row('1', 1), row('0002', 2), row('3', 3)], weeksCounted: 3, seasonYear: 2026 }

/* Roster '2' is keyed the MFL way ("0002") on the board and plainly ("2") on the lineups. */
const lineups: StandingsLineups = {
  season: 2026,
  week: 4,
  rows: [
    { rosterId: '2', name: 'Team 2', isYou: false, af: 131.2, afFrom: 9, api: 128.4, apiFrom: 9, starterCount: 9 },
    { rosterId: '1', name: 'Team 1', isYou: true, af: 120.5, afFrom: 7, api: null, apiFrom: 0, starterCount: 9 },
  ],
}

function page(): LeagueHomeData {
  return {
    pairing: null,
    league: { id: 'lg-1', name: 'Kings of Buffalo', platform: 'mfl', format: 'Dynasty', sport: 'NFL', season: 2026, currentWeek: 4 },
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
    weekPicker: { weeks: [1, 2, 3, 4], selected: 4, current: 4, isFuture: false },
    standings: off,
    timeline: off,
    matchup: off,
    draftHq: off,
    commissioner: off,
    buzz: off,
    scoreboard: off,
    powerBoard: { available: true, data: powerBoard },
    rivalry: off,
    syncAge: { label: '3m ago', stale: false },
  } as unknown as LeagueHomeData
}

describe('LeagueHome — Power board, AF beside API', () => {
  it('adds AF and API to every row, keeps the all-play order, and states the projected week', () => {
    const root = render(<LeagueHome data={page()} otherLeagueIssueCount={0} identityInShell lineups={lineups} />).container
    const list = root.querySelector('.af-pb-list')!
    expect(list.getAttribute('data-proj')).toBe('true')
    expect(root.querySelector('.af-lh-power-panel')!.textContent).toContain('AF / API projected, week 4')

    const rows = [...list.querySelectorAll('.af-pb-row')]
    // The board's own order: rank 1, 2, 3 — the higher AF team stays second.
    expect(rows.map((r) => r.querySelector('.af-pb-rank')!.textContent)).toEqual(['1', '2', '3'])
    const proj = rows.map((r) => [...r.querySelectorAll('.af-pb-proj')].map((c) => c.textContent))
    // Partial coverage is shown; an unpriced API side is a dash, not 0.
    expect(proj[0]).toEqual(['120.5 7/9', '—'])
    // "0002" on the board finds "2" on the lineups.
    expect(proj[1]).toEqual(['131.2', '128.4'])
    // A roster the loader did not return is two dashes, never a number.
    expect(proj[2]).toEqual(['—', '—'])
  })

  it('draws the board exactly as before without lineups', () => {
    const root = render(<LeagueHome data={page()} otherLeagueIssueCount={0} identityInShell />).container
    expect(root.querySelector('.af-pb-list')!.getAttribute('data-proj')).toBeNull()
    expect(root.querySelector('.af-pb-proj')).toBeNull()
    expect(root.querySelector('.af-lh-power-panel')!.textContent).not.toContain('projected')
  })
})
