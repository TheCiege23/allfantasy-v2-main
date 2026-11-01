/**
 * Batch A3 gating: the broadcast-deck tabs change for native redraft leagues only. A redraft league's
 * Commissioner tab gets the league-health panel (and not the Sleeper-only CommissionerPulse); Legacy and
 * Live Intel get an empty state that tells the truth about an AllFantasy league; every deck root carries
 * the `data-rd-deck` stamp. Dynasty, imported and best-ball leagues render exactly as before.
 */
import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CommissionerOperationsWorkspace } from '@/components/league-home/CommissionerOperationsWorkspace'
import { LegacyHome } from '@/components/decide/LegacyHome'
import { DraftIntelHome } from '@/components/decide/DraftIntelHome'
import { DecideHome } from '@/components/decide/DecideHome'
import { buildWeeklyChecklist } from '@/lib/commissioner/weeklyChecklist'
import type { CommishHealthSummary } from '@/lib/league-media/redraftDeck'

const NOW = new Date()

function league(over: Record<string, unknown> = {}) {
  return {
    id: 'lg1', name: 'Sunday League', platform: 'allfantasy', sport: 'NBA', season: 2026, teamCount: 12, format: 'redraft',
    scoring: 'Points', currentWeek: 4, lifecycleState: 'in_season', leagueType: 'redraft', tradeDeadlineWeek: 16, isCommissioner: true, ...over,
  } as never
}

function summary(history: number[] = []): CommishHealthSummary {
  return {
    score: {
      available: true, score: 82, status: 'healthy', summary: 'Lineups are set.', confidencePct: 84, activeManagers: 11, totalManagers: 12,
      sub: { activity: 88, participation: null, fairness: 78, sustainability: 74 }, history,
    },
    managers: [{ rosterId: 'r1', name: 'Taco Tuesday', initials: 'TT', status: 'inactive', issues: ['No roster move in 19 days'] }],
    managersRead: true,
  }
}

let routes: Record<string, unknown>
const calls: string[] = []

beforeEach(() => {
  calls.length = 0
  routes = {}
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    const url = String(input)
    calls.push(url)
    const path = url.split('?')[0]
    const hit = Object.keys(routes).find((k) => path.endsWith(k))
    if (!hit) return { ok: false, status: 404, json: async () => ({ error: 'nope' }) }
    return { ok: true, status: 200, json: async () => routes[hit] }
  }))
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }))
})
afterEach(() => vi.unstubAllGlobals())

const mountCommish = (lg = league()) =>
  render(
    <CommissionerOperationsWorkspace league={lg} leagueId="lg1" isCommissioner isOwner={false} hasActiveRedraftSeason
      onOpenSettings={() => {}} onOpenTab={() => {}} />,
  )

describe('Commissioner tab', () => {
  it('a native redraft league gets the health panel: ring without a trend (no past scores), bars, checklist, managers', async () => {
    routes['/health-summary'] = summary([])
    routes['/weekly-checklist'] = {
      applies: true,
      week: 4,
      items: buildWeeklyChecklist(
        { leagueId: 'lg1', week: 4, totalWeeks: 21, playoffStartWeek: 19, lastWeekMatchups: [], pendingClaims: [], processedClaimsLast7Days: 3,
          lineups: [], tradesAwaitingReview: 0, tradeDeadlineWeek: 16, dues: null },
        NOW,
      ),
    }
    const { container } = mountCommish()
    const root = container.querySelector('[data-testid=commissioner-operations-workspace]')!
    expect(root.getAttribute('data-rd-deck')).toBe('nba')
    await waitFor(() => expect(screen.getByTestId('redraft-health-status').textContent).toBe('Healthy'))
    expect(screen.getByRole('img', { name: 'Health score 82 out of 100' })).toBeTruthy()
    expect(screen.queryByTestId('redraft-health-trend')).toBeNull()
    // Participation is null → dropped, never drawn at zero.
    expect([...container.querySelectorAll('[data-testid=redraft-health-bars] li')].map((li) => li.getAttribute('data-key'))).toEqual([
      'activity', 'fairness', 'sustainability',
    ])
    await waitFor(() => expect(screen.getAllByTestId('redraft-health-check').length).toBeGreaterThan(0))
    const ids = screen.getAllByTestId('redraft-health-check').map((li) => li.getAttribute('data-item'))
    expect(ids).toContain('trade_deadline_countdown')
    expect(screen.getByTestId('redraft-health-manager').textContent).toContain('Taco Tuesday')
    expect(screen.getByRole('button', { name: /Message in league chat/ })).toBeTruthy()
    // The Sleeper-only pulse is not mounted for a league AllFantasy runs.
    expect(screen.queryByTestId('commissioner-pulse')).toBeNull()
    expect(calls.some((u) => u.includes('/api/league/commissioner-pulse'))).toBe(false)
  })

  it('draws the trend line once there are at least two past scores', async () => {
    routes['/health-summary'] = summary([71, 76, 82])
    mountCommish()
    await waitFor(() => expect(screen.getByTestId('redraft-health-trend')).toBeTruthy())
  })

  it('a withheld score says why and draws no number', async () => {
    routes['/health-summary'] = { score: { available: false, reason: 'Not enough synced data.' }, managers: [], managersRead: false }
    mountCommish()
    await waitFor(() => expect(screen.getByTestId('redraft-health-status').textContent).toBe('Not scored yet'))
    expect(screen.getByText('Not enough synced data.')).toBeTruthy()
    expect(screen.queryByTestId('redraft-health-bars')).toBeNull()
    expect(screen.getByText('Manager activity could not be read for this league yet.')).toBeTruthy()
  })

  it.each([
    ['dynasty', { leagueType: 'dynasty', isDynasty: true }],
    ['imported', { platform: 'sleeper' }],
    ['best ball', { bestBallMode: true }],
  ])('a %s league keeps the commissioner pulse and gets no health panel', async (_n, over) => {
    const { container } = mountCommish(league(over))
    expect(container.querySelector('[data-testid=commissioner-operations-workspace]')!.hasAttribute('data-rd-deck')).toBe(false)
    expect(screen.queryByTestId('redraft-commish-health')).toBeNull()
    await waitFor(() => expect(calls.some((u) => u.includes('/api/league/commissioner-pulse'))).toBe(true))
    expect(calls.some((u) => u.includes('/health-summary'))).toBe(false)
  })
})

describe('Legacy and Live Intel', () => {
  it('Legacy: a redraft league is told the truth about its history and pointed at standings', async () => {
    routes['/api/league/history'] = { supported: false, platform: 'allfantasy' }
    const { container } = render(<LegacyHome league={league()} leagueId="lg1" />)
    await waitFor(() => expect(screen.getByTestId('redraft-legacy-empty')).toBeTruthy())
    expect(container.querySelector('[data-testid=legacy-home]')!.getAttribute('data-rd-deck')).toBe('nba')
    expect(screen.getByRole('link', { name: /Open standings/ }).getAttribute('href')).toBe('/league/lg1?view=standings')
  })

  it('Legacy: a native dynasty league keeps the old copy', async () => {
    routes['/api/league/history'] = { supported: false, platform: 'allfantasy' }
    render(<LegacyHome league={league({ leagueType: 'dynasty', isDynasty: true })} leagueId="lg1" />)
    await waitFor(() => expect(screen.getByText(/History for allfantasy leagues/)).toBeTruthy())
    expect(screen.queryByTestId('redraft-legacy-empty')).toBeNull()
  })

  it('Live Intel: a redraft league points at Draft HQ instead of asking for a Sleeper link', async () => {
    routes['/api/draft/intel'] = { linked: false, scope: 'league', drafts: [] }
    render(<DraftIntelHome league={league()} leagueId="lg1" />)
    await waitFor(() => expect(screen.getByTestId('redraft-intel-empty')).toBeTruthy())
    expect(screen.queryByText('No linked Sleeper account')).toBeNull()
    expect(screen.getByRole('link', { name: /Open Draft HQ/ }).getAttribute('href')).toBe('/league/lg1?view=draft')
  })

  it('Live Intel: the dashboard (no league) and a non-redraft league keep the old states', async () => {
    routes['/api/draft/intel'] = { linked: false, scope: 'league', drafts: [] }
    render(<DraftIntelHome league={league({ platform: 'sleeper' })} leagueId="lg1" />)
    await waitFor(() => expect(screen.getByText('No linked Sleeper account')).toBeTruthy())
    expect(screen.queryByTestId('redraft-intel-empty')).toBeNull()
  })
})

describe('Decision OS', () => {
  it('stamps the deck root for a redraft league only', () => {
    const a = render(<DecideHome league={league()} teams={[]} onOpenTab={() => {}} />)
    expect(a.container.querySelector('[data-testid=decide-home]')!.getAttribute('data-rd-deck')).toBe('nba')
    a.unmount()
    const b = render(<DecideHome league={league({ leagueType: 'dynasty', isDynasty: true })} teams={[]} onOpenTab={() => {}} />)
    expect(b.container.querySelector('[data-testid=decide-home]')!.hasAttribute('data-rd-deck')).toBe(false)
  })
})
