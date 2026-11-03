/**
 * Batch A1: the redraft League home pieces render ONLY for a native redraft league, and each drops
 * without its data. Every other format keeps the standings preview it had.
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { UserLeague, UserLeagueTeam } from '@/app/dashboard/types'
import type { MatchupCenterPayload } from '@/lib/matchup-center/types'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }), usePathname: () => '/league/L1', useSearchParams: () => new URLSearchParams() }))

import { NativeLeagueHome } from '@/components/league/native/NativeLeagueHome'

const teams = Array.from({ length: 10 }, (_, i) => ({
  id: `team-${i + 1}`, externalId: `roster-${i + 1}`, teamName: `Team ${i + 1}`, ownerName: `M${i + 1}`, avatarUrl: null, role: 'member',
  isOrphan: false, claimedByUserId: `u${i + 1}`, draftPosition: i + 1, wins: 8 - Math.min(i, 8), losses: Math.min(i, 8), ties: 0,
  pointsFor: 900 - i * 20, pointsAgainst: 800, currentRank: i + 1, faabRemaining: 50, waiverPriority: i + 1, divisionId: null,
})) as UserLeagueTeam[]

function league(extra: Partial<UserLeague> = {}): UserLeague {
  return {
    id: 'L1', name: 'Test League', platform: 'allfantasy', sport: 'NBA', format: 'redraft', scoring: 'Points', teamCount: 10, season: 2026,
    status: 'in_season', lifecycleState: 'in_season', currentWeek: 9, leagueType: 'redraft',
    settings: { playoff_structure: { playoff_team_count: 6 } }, ...extra,
  } as UserLeague
}

const payload: MatchupCenterPayload = {
  leagueId: 'L1', season: 2026, week: 9, sport: 'NBA', matchupStatus: 'live', conceptOverlay: null,
  left: { projectedTotalIncludesFallback: false, rosterId: 'roster-1', teamName: 'Team 1', avatarUrl: null, record: { wins: 8, losses: 0, ties: 0 }, winPct: 1, totalPoints: 612.5, projectedTotal: 1140, starters: [], remainingStarters: 3 },
  right: { projectedTotalIncludesFallback: false, rosterId: 'roster-3', teamName: 'Team 3', avatarUrl: null, record: { wins: 6, losses: 2, ties: 0 }, winPct: 0.75, totalPoints: 588, projectedTotal: 1100, starters: [], remainingStarters: 1 },
  winProbabilityLeft: 0.51,
  insights: { matchupEdge: '', startSit: '', weather: '', injuryNews: '', swingPlayers: [], riskLevel: 'low', floorVsCeiling: '' },
  partialData: false, refreshIntervalMs: 60000,
}

let urls: string[]
function mockFetch(opts: { matchup?: boolean; lastWeek?: boolean } = {}) {
  urls = []
  globalThis.fetch = vi.fn(async (input: unknown) => {
    const url = String(input)
    urls.push(url)
    if (url.includes('/matchup-center') && opts.matchup !== false) return new Response(JSON.stringify({ payload }))
    // A waiver run keeps the strip's tile row on screen, so "no matchup tile" is a real assertion.
    if (url.includes('/waiver-wire/')) return new Response(JSON.stringify({ settings: { nextRunAt: new Date(Date.now() + 86_400_000).toISOString() } }))
    if (url.includes('/scoring/matchups') && opts.lastWeek !== false) {
      return new Response(JSON.stringify({ season: 2026, week: 8, matchups: [
        { rosterId: 'roster-1', teamName: 'Team 1', totalPoints: 700, opponentRosterId: 'roster-2', opponentName: 'Team 2', winLoss: 'W', status: 'final' },
        { rosterId: 'roster-2', teamName: 'Team 2', totalPoints: 650, opponentRosterId: 'roster-1', opponentName: 'Team 1', winLoss: 'L', status: 'final' },
      ] }))
    }
    return new Response('{}', { status: 404 })
  }) as typeof fetch
}

function renderHome(l: UserLeague) {
  return render(<NativeLeagueHome league={l} teams={teams} userTeamId="team-1" isCommissioner={false} draftDateIso={null} snapshot={null} settingsOpen={false} onOpenSettings={() => {}} onSelectTab={() => {}} />)
}

beforeEach(() => mockFetch())
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('native redraft League home', () => {
  it('draws the playoff race with the line at the league’s field, the score bug and last week’s recap', async () => {
    renderHome(league())
    expect(screen.getByTestId('redraft-playoff-race')).toBeTruthy()
    expect(screen.getByTestId('redraft-playoff-line')).toBeTruthy()
    expect(screen.getByTestId('redraft-playoff-race-you').textContent).toContain('Team 1')
    expect(document.querySelector('.nl-standings-preview')).toBeNull()
    const bug = await screen.findByTestId('redraft-score-bug')
    expect(bug.textContent).toContain('612.5')
    expect(screen.getByTestId('redraft-score-bug-odds').textContent).toBe('51%')
    // The score bug replaces the strip's own matchup tile rather than repeating it.
    expect(screen.getByTestId('your-week-waivers')).toBeTruthy()
    expect(screen.queryByTestId('your-week-matchup')).toBeNull()
    expect((await screen.findByTestId('redraft-last-week')).textContent).toContain('Week 8 recap')
    expect(urls.some((u) => u.includes('/scoring/matchups?season=2026&week=8'))).toBe(true)
  })

  it('drops each piece without its data: no playoff field, no matchup, no finished week', async () => {
    mockFetch({ matchup: false, lastWeek: false })
    renderHome(league({ settings: {} }))
    expect(screen.queryByTestId('redraft-playoff-race')).toBeNull()
    expect(document.querySelector('.nl-standings-preview')).toBeTruthy()
    await waitFor(() => expect(urls.some((u) => u.includes('/scoring/matchups'))).toBe(true))
    expect(screen.queryByTestId('redraft-score-bug')).toBeNull()
    expect(screen.queryByTestId('redraft-last-week')).toBeNull()
  })

  it('a category league gets no points recap', () => {
    renderHome(league({ settings: { playoff_team_count: 6, scoring_mode: 'h2h_categories' } }))
    expect(urls.some((u) => u.includes('/scoring/matchups'))).toBe(false)
  })

  it('pre-draft: a countdown to a future draft time, nothing in-season', () => {
    const at = new Date(Date.now() + 2 * 86_400_000 + 3 * 3_600_000).toISOString()
    render(<NativeLeagueHome league={league({ status: 'pre_draft', lifecycleState: 'pre_draft', currentWeek: null })} teams={teams} userTeamId="team-1" isCommissioner={false} draftDateIso={at} snapshot={null} settingsOpen={false} onOpenSettings={() => {}} onSelectTab={() => {}} />)
    expect(screen.getByTestId('redraft-draft-countdown').textContent).toMatch(/Draft in 2d 0[23]h/)
    expect(screen.queryByTestId('redraft-playoff-race')).toBeNull()
  })
})

describe('every other format is unchanged', () => {
  it.each([
    ['dynasty', { leagueType: 'dynasty', isDynasty: true }],
    ['imported redraft', { platform: 'sleeper' }],
    ['guillotine variant', { leagueVariant: 'guillotine' }],
  ])('%s keeps the standings preview and gets no redraft pieces', async (_label, extra) => {
    renderHome(league(extra as Partial<UserLeague>))
    expect(document.querySelector('.nl-standings-preview')).toBeTruthy()
    expect(screen.queryByTestId('redraft-playoff-race')).toBeNull()
    await waitFor(() => expect(urls.some((u) => u.includes('/matchup-center'))).toBe(true))
    expect(screen.queryByTestId('redraft-score-bug')).toBeNull()
    expect(screen.queryByTestId('redraft-last-week')).toBeNull()
    expect(urls.some((u) => u.includes('/scoring/matchups'))).toBe(false)
  })
})
