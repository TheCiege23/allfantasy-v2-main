/**
 * Batch A1, Draft HQ: a native redraft league's draftboard is drawn in the identity (same test ids,
 * no hardcoded gradient), the persisted post-draft grades appear once the draft is complete, and every
 * other format — and the League tab's `mode="league"` — keeps the original card.
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { UserLeague, UserLeagueTeam } from '@/app/dashboard/types'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }), usePathname: () => '/league/L1', useSearchParams: () => new URLSearchParams() }))
vi.mock('@/app/league/[leagueId]/components/LeagueManagersStandingsSection', () => ({ LeagueManagersStandingsSection: () => null }))
vi.mock('@/app/league/[leagueId]/components/LeagueRecentActivity', () => ({ LeagueRecentActivity: () => null }))
vi.mock('@/components/redraft-premium', () => ({ DraftPremiumShells: () => null }))

import { DraftTab } from '@/app/league/[leagueId]/tabs/DraftTab'

const teams = [1, 2, 3].map((i) => ({
  id: `team-${i}`, externalId: `roster-${i}`, teamName: `Team ${i}`, ownerName: '', avatarUrl: null, role: 'member', isOrphan: false,
  claimedByUserId: `u${i}`, draftPosition: i, wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0, currentRank: null,
  faabRemaining: null, waiverPriority: null, divisionId: null,
})) as UserLeagueTeam[]

function league(extra: Partial<UserLeague> = {}): UserLeague {
  return { id: 'L1', name: 'L', platform: 'allfantasy', sport: 'MLB', format: 'redraft', scoring: 'points', teamCount: 3, season: 2026, leagueType: 'redraft', status: 'in_season', ...extra } as UserLeague
}

let urls: string[]
function mockFetch(sessionStatus: string, grades: unknown[]) {
  urls = []
  globalThis.fetch = vi.fn(async (input: unknown) => {
    const url = String(input)
    urls.push(url)
    if (url.includes('/draft/session')) return new Response(JSON.stringify({ session: { status: sessionStatus } }))
    if (url.includes('/draft-grades')) return new Response(JSON.stringify({ rows: grades }))
    return new Response('{}', { status: 404 })
  }) as typeof fetch
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Draft HQ for a native redraft league', () => {
  it('draws the identity board and, once the draft is complete, the grades named by this league’s teams', async () => {
    mockFetch('completed', [{ rosterId: 'roster-2', grade: 'A-', score: 90 }, { rosterId: 'someone-else', grade: 'B', score: 80 }])
    render(<DraftTab league={league()} teams={teams} isOwner isCommissioner />)
    const board = screen.getByTestId('league-draftboard-card')
    expect(board.getAttribute('style')).toBeNull()
    expect(board.className).toContain('rdh-draftboard')
    const grades = await screen.findByTestId('redraft-draft-grades')
    expect(grades.textContent).toContain('Team 2')
    expect(grades.textContent).toContain('A-')
    expect(grades.textContent).not.toContain('someone-else')
    expect(urls.some((u) => u.includes('/draft-grades?season=2026'))).toBe(true)
    expect(board.getAttribute('data-phase')).toBe('done')
  })

  it('no grades on file, or a draft not yet run, is no grades card', async () => {
    mockFetch('completed', [])
    render(<DraftTab league={league()} teams={teams} isOwner isCommissioner />)
    await waitFor(() => expect(urls.some((u) => u.includes('/draft-grades'))).toBe(true))
    expect(screen.queryByTestId('redraft-draft-grades')).toBeNull()
    cleanup()
    mockFetch('scheduled', [{ rosterId: 'roster-1', grade: 'A', score: 95 }])
    render(<DraftTab league={league({ draftDate: new Date(Date.now() + 86_400_000 * 3).toISOString() })} teams={teams} isOwner isCommissioner />)
    expect(await screen.findByTestId('redraft-draft-countdown')).toBeTruthy()
    expect(urls.some((u) => u.includes('/draft-grades'))).toBe(false)
  })
})

describe('everything else keeps the original card', () => {
  it.each([
    ['dynasty', { leagueType: 'dynasty', isDynasty: true }],
    ['imported', { platform: 'sleeper' }],
  ])('%s', async (_label, extra) => {
    mockFetch('completed', [{ rosterId: 'roster-1', grade: 'A', score: 95 }])
    render(<DraftTab league={league(extra as Partial<UserLeague>)} teams={teams} isOwner isCommissioner />)
    expect(screen.getByTestId('league-draftboard-card').getAttribute('style')).toContain('linear-gradient')
    await waitFor(() => expect(urls.some((u) => u.includes('/draft/session'))).toBe(true))
    expect(screen.queryByTestId('redraft-draft-grades')).toBeNull()
  })

  it('the League tab (mode="league") draws no board even for a redraft league', () => {
    mockFetch('completed', [])
    render(<DraftTab league={league()} teams={teams} isOwner isCommissioner mode="league" />)
    expect(screen.queryByTestId('league-draftboard-card')).toBeNull()
  })
})
