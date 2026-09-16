import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'

/**
 * The provider handoff as rendered (user decision, 2026-09-14): what a user can tap.
 *
 * Every anchor must open the provider in a new tab with `noopener`, and appear only
 * where the loader set a verified destination. The loaders' own rules are proven in
 * provider-handoff.test.ts; this file proves the screens do not add or drop a link.
 */

// Device-only cards on the notifications screen are not under test.
vi.mock('@/components/notifications/EnableWebPushCard', () => ({ EnableWebPushCard: () => null }))
vi.mock('@/components/pwa/PWAActions', () => ({ InstallButton: () => null }))

import NotificationsCenter from '@/components/core-app/screens/NotificationsCenter'
import { DashSinceLastVisit } from '@/components/core-app/screens/DashSinceLastVisit'
import Matchup from '@/components/core-app/screens/Matchup'
import type { NotificationRow, NotificationsCenterData } from '@/lib/core-app/notificationsCenter'
import type { SinceLastVisitBrief } from '@/lib/core-app/sinceLastVisit'
import type { MatchupData } from '@/lib/core-app/matchup'

const SLEEPER_TRADES = { href: 'https://sleeper.com/leagues/111/trades', label: 'Open in Sleeper', screen: 'Trade' }

function expectProviderAnchor(a: HTMLElement | null, href: string) {
  expect(a).not.toBeNull()
  expect(a!.getAttribute('href')).toBe(href)
  expect(a!.getAttribute('target')).toBe('_blank')
  expect(a!.getAttribute('rel')).toContain('noopener')
}

describe('notification rows', () => {
  const row = (over: Partial<NotificationRow>): NotificationRow => ({
    id: 'r',
    kind: 'trades',
    title: 'T',
    detail: 'D',
    category: null,
    leagueId: 'L1',
    leagueName: 'Dynasty',
    platform: 'sleeper',
    createdAt: '2026-09-14T00:00:00Z',
    read: false,
    severity: 'info',
    action: null,
    ...over,
  })

  const data = {
    // An urgent row carrying a handoff must still not render one: its action already is the platform link.
    actToday: [row({ id: 'issue:1', title: 'Draft today', kind: 'drafts', handoff: SLEEPER_TRADES })],
    rest: [
      row({ id: 's1', title: 'Trade offer waiting', handoff: SLEEPER_TRADES }),
      row({ id: 's2', title: 'MFL trade', platform: 'mfl' }),
    ],
    counts: { all: 3, trades: 2, waivers: 0, lineups: 0, mentions: 0, commissioner: 0, drafts: 1 },
    unread: 3,
    listed: 2,
    olderNotListed: 0,
    push: { delivered: [], suppressedCount: 0, suppressedLeagues: 0, suppressedReason: null },
    leagueId: null,
    mentionsAvailable: false,
  } as unknown as NotificationsCenterData

  it('a stored row with a verified handoff gets "Open in Sleeper ↗"; the others get none', () => {
    render(<NotificationsCenter data={data} />)
    const item = (title: string) => screen.getByText(title).closest('li') as HTMLElement

    expectProviderAnchor(item('Trade offer waiting').querySelector('a.af-nt-handoff'), SLEEPER_TRADES.href)
    expect(item('MFL trade').querySelector('a.af-nt-handoff')).toBeNull()
    expect(item('Draft today').querySelector('a.af-nt-handoff')).toBeNull()
  })
})

describe('since-last-visit brief', () => {
  const brief: SinceLastVisitBrief = {
    sinceAt: '2026-09-13T00:00:00Z',
    // Equal to `sinceAt` unless a blind trades read left the trade boundary held further back.
    tradesSinceAt: '2026-09-13T00:00:00Z',
    firstVisit: false,
    windowCapped: false,
    trades: {
      items: [
        { leagueId: 'LS', leagueName: 'Dynasty', acceptedAt: '2026-09-13T10:00:00Z', summary: 'A got B', handoff: SLEEPER_TRADES },
        { leagueId: 'LM', leagueName: 'MFL league', acceptedAt: '2026-09-13T11:00:00Z', summary: 'C got D' },
      ],
      atLeast: false,
    },
    injuries: [
      {
        playerId: 'p1',
        name: 'Hurt Starter',
        position: 'RB',
        from: null,
        to: 'Out',
        leagues: ['Waiver Warriors'],
        leagueIds: ['LY'],
        handoff: { href: 'https://football.fantasysports.yahoo.com/f1/1361311/3', label: 'Open in Yahoo', screen: 'Lineup' },
      },
      { playerId: 'p2', name: 'Everywhere', position: 'WR', from: null, to: 'Out', leagues: ['A', 'B'], leagueIds: ['LS', 'LY'] },
    ],
    standings: [],
    alerts: { total: 0, groups: [] },
    comparisonPending: false,
  }

  it('links the trade and the one-league injury, and nothing else', () => {
    const { container } = render(<DashSinceLastVisit brief={brief} now={new Date('2026-09-14T00:00:00Z')} />)
    const anchors = [...container.querySelectorAll('a.af-brief-handoff')] as HTMLElement[]
    expect(anchors.map((a) => a.getAttribute('href'))).toEqual([
      SLEEPER_TRADES.href,
      'https://football.fantasysports.yahoo.com/f1/1361311/3',
    ])
    for (const a of anchors) expectProviderAnchor(a, a.getAttribute('href')!)
  })
})

describe('matchup banner', () => {
  function data(lineupLink: MatchupData['league']['lineupLink']): MatchupData {
    return {
      league: { id: 'l1', name: 'Dynasty', platform: 'sleeper', logoUrl: null, sourceLink: null, lineupLink },
      week: { available: true, data: { week: 1, season: 2026, isFinal: false } },
      teams: { available: false, reason: 'no teams' },
      sides: { available: false, reason: 'no score' },
      lineups: { available: false, reason: 'no lineups' },
      identityNote: null,
      playerScoring: { available: false, reason: 'no per-player scoring' },
      winProbability: { available: false, reason: 'no probability' },
      projectedFinal: { available: false, reason: 'no projection' },
      yetToPlay: { available: false, reason: 'no game state' },
    }
  }

  it('shows "Set lineup in Sleeper ↗" when the loader set a verified lineup link', () => {
    render(
      <Matchup
        data={data({
          href: 'https://sleeper.com/leagues/111/team',
          label: 'Open in Sleeper',
          platformLabel: 'Sleeper',
          screen: 'Lineup',
          external: true,
        })}
      />,
    )
    expectProviderAnchor(screen.getByRole('link', { name: /Set lineup in Sleeper/ }), 'https://sleeper.com/leagues/111/team')
  })

  it('shows nothing when there is no verified lineup link', () => {
    const { container } = render(<Matchup data={data(null)} />)
    expect(container.querySelector('[data-handoff="lineup"]')).toBeNull()
    expect(screen.queryByRole('link', { name: /Set lineup/ })).toBeNull()
  })
})
