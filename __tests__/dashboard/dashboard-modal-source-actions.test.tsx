// @vitest-environment jsdom
/**
 * Secure source-platform action loop for the three prop-fed dashboard modals — PendingTradesModal,
 * WaiverRecommendationsModal, LineupIssuesModal. Each imported/actionable league surfaces an internal
 * AllFantasy analysis link (pro-gated, unchanged) PLUS a secure external "complete on the source
 * platform" action, with the read-only disclosure shown ONCE per modal. Native / non-actionable leagues
 * get the internal action only — no external link, no disclosure.
 *
 * These are UI-contract tests over the SERVER-RESOLVED `actionLinks` bundle the modals receive as props.
 * The server-side resolution (canonical League row, no cached/client URL, no provider fetch, cross-league
 * isolation, honest fallback) is proven separately in league-action-bundles.test.ts / sourceLinkResolver.
 */
import React from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: unknown }) => (
    <a href={typeof href === 'string' ? href : '#'}>{children}</a>
  ),
}))
vi.mock('@/components/subscription/SubscriptionGateModal', () => ({
  SubscriptionGateModal: () => null,
}))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({
  useLanguage: () => ({ t: (k: string) => k, tInterpolate: (k: string) => k }),
}))

import { PendingTradesModal } from '@/app/dashboard/components/PendingTradesModal'
import { WaiverRecommendationsModal } from '@/app/dashboard/components/WaiverRecommendationsModal'
import { LineupIssuesModal, type LineupCheckPayload } from '@/app/dashboard/components/LineupIssuesModal'
import { IMPORTED_LEAGUE_READONLY_NOTE } from '@/lib/league-links/readOnlyNote'
import type { SourceLink } from '@/lib/league-links/sourceLinkResolver'
import type { DecisionOsActionLinks } from '@/lib/lineup-actions/types'
import type {
  TradesDashboardResponse,
  WaiverDashboardResponse,
} from '@/app/dashboard/dashboardStripApiTypes'

// ----- fixtures (shaped exactly as the server enricher emits) -----------------------------------

function sleeperLink(id: string): SourceLink {
  return {
    href: `https://sleeper.com/leagues/${id}/league`,
    destinationType: 'league',
    provider: 'sleeper',
    providerLabel: 'Sleeper',
    label: 'Sleeper',
    isFallback: false,
    opensExternally: true,
  }
}

// A homepage fallback (MFL/Fantrax/Fleaflicker) — no verified league page. The server already collapses
// the label to the honest "Go to {provider}"; the component must ALSO refuse any specific-page override.
function mflFallbackLink(): SourceLink {
  return {
    href: 'https://www.myfantasyleague.com/',
    destinationType: 'homepage',
    provider: 'mfl',
    providerLabel: 'MyFantasyLeague',
    label: 'Go to MyFantasyLeague',
    isFallback: true,
    opensExternally: true,
  }
}

function bundle(over: Partial<DecisionOsActionLinks>): DecisionOsActionLinks {
  return {
    actionable: true,
    imported: true,
    dataAsOf: '2026-07-27T12:00:00.000Z',
    internal: { href: '/league/L1?tab=team', label: 'Review Lineup in AF' },
    external: null,
    ...over,
  }
}

function tradesData(
  leagues: Array<{ leagueId: string; leagueName: string; actionLinks?: DecisionOsActionLinks }>,
): TradesDashboardResponse {
  return {
    totalPending: leagues.length,
    trades: leagues.map((l) => ({
      leagueId: l.leagueId,
      leagueName: l.leagueName,
      leagueAvatar: null,
      sport: 'NFL',
      trades: [
        {
          transactionId: `${l.leagueId}-t1`,
          proposedBy: 'Rival',
          proposedAt: null,
          assetsGiven: [],
          assetsReceived: [],
          chimmyVerdict: 'negotiate',
          chimmyReason: 'Close call.',
        },
      ],
      actionLinks: l.actionLinks,
    })),
  }
}

function waiversData(
  leagues: Array<{ leagueId: string; leagueName: string; actionLinks?: DecisionOsActionLinks }>,
): WaiverDashboardResponse {
  return {
    totalLeagues: leagues.length,
    recommendations: leagues.map((l) => ({
      leagueId: l.leagueId,
      leagueName: l.leagueName,
      leagueAvatar: null,
      sport: 'NFL',
      platform: 'Sleeper',
      pickups: [{ playerId: 'p1', playerName: 'Backup RB', position: 'RB', team: 'KC', addReason: 'volume' }],
      drops: [],
      chimmyAdvice: 'Grab the handcuff.',
      waiverDeadline: null,
      actionLinks: l.actionLinks,
    })),
  }
}

function lineupData(
  leagues: Array<{
    leagueId: string
    leagueName: string
    issueType?: string
    actionLinks?: DecisionOsActionLinks
  }>,
): LineupCheckPayload {
  return {
    totalIssues: leagues.length,
    totalUnresolvedSlotActions: leagues.length,
    scanWarningLeagues: 0,
    leaguesNeedingAttention: leagues.length,
    lineupsNeedingAttention: leagues.length,
    urgentLineupActions: leagues.length,
    lockedMissedActions: 0,
    displayMode: 'leagues',
    displayCount: leagues.length,
    displayLabelKey: 'x',
    displayLabelParams: {},
    displaySubtextKey: null,
    displaySubtextParams: null,
    urgentSubtextKey: null,
    urgentSubtextParams: null,
    actions: [],
    leagues: leagues.map((l) => ({
      leagueId: l.leagueId,
      leagueName: l.leagueName,
      leagueAvatar: null,
      sport: 'NFL',
      platform: 'sleeper',
      issues: [{ type: l.issueType ?? 'empty_starter', message: 'Empty FLEX slot', severity: 'critical' }],
      chimmyAdvice: 'Slot a starter.',
      actionLinks: l.actionLinks,
    })),
    scannedLeagues: leagues.length,
    scannedSleeperLeagues: leagues.length,
    scannedNativeLeagues: 0,
    lastUpdatedAt: '2026-07-28T00:00:00.000Z',
  }
}

afterEach(cleanup)

// ----- PendingTradesModal ------------------------------------------------------------------------

describe('PendingTradesModal — secure trade action loop', () => {
  it('imported Sleeper trade → internal "Analyze Trade in AF" + secure external "Review Trade in {League}" + one disclosure', () => {
    render(
      <PendingTradesModal
        isOpen
        onClose={() => {}}
        loading={false}
        hasProAccess
        data={tradesData([
          {
            leagueId: 'L1',
            leagueName: 'Dynasty Warriors',
            actionLinks: bundle({
              internal: { href: '/league/L1?tab=trades', label: 'Analyze Trade in AF' },
              external: { link: sleeperLink('987654321'), label: 'Review Trade in Dynasty Warriors' },
            }),
          },
        ])}
      />,
    )
    const internal = screen.getByRole('link', { name: /analyze trade in af/i })
    expect(internal.getAttribute('href')).toBe('/league/L1?tab=trades')

    const external = screen.getByRole('link', { name: /review trade in dynasty warriors/i })
    expect(external.getAttribute('href')).toBe('https://sleeper.com/leagues/987654321/league')
    expect(external.getAttribute('target')).toBe('_blank')
    expect(external.getAttribute('rel')).toBe('noopener noreferrer')

    // disclosure exactly once
    expect(screen.getAllByText(IMPORTED_LEAGUE_READONLY_NOTE)).toHaveLength(1)
  })

  it('native league → internal only, NO external action, NO disclosure', () => {
    render(
      <PendingTradesModal
        isOpen
        onClose={() => {}}
        loading={false}
        hasProAccess
        data={tradesData([
          {
            leagueId: 'L9',
            leagueName: 'AF Home League',
            actionLinks: bundle({
              imported: false,
              internal: { href: '/league/L9?tab=trades', label: 'Analyze Trade in AF' },
              external: null,
            }),
          },
        ])}
      />,
    )
    expect(screen.getByRole('link', { name: /analyze trade in af/i })).toBeTruthy()
    expect(screen.queryByRole('link', { name: /review trade in/i })).toBeNull()
    expect(screen.queryByText(IMPORTED_LEAGUE_READONLY_NOTE)).toBeNull()
  })

  it('pro-gating preserved → internal is a gated PRO button (not a link) while the external action stays ungated', () => {
    render(
      <PendingTradesModal
        isOpen
        onClose={() => {}}
        loading={false}
        hasProAccess={false}
        data={tradesData([
          {
            leagueId: 'L1',
            leagueName: 'Dynasty Warriors',
            actionLinks: bundle({
              internal: { href: '/league/L1?tab=trades', label: 'Analyze Trade in AF' },
              external: { link: sleeperLink('987654321'), label: 'Review Trade in Dynasty Warriors' },
            }),
          },
        ])}
      />,
    )
    // internal analysis is gated behind PRO → rendered as a button, NOT a navigable link
    expect(screen.queryByRole('link', { name: /analyze trade in af/i })).toBeNull()
    expect(screen.getByRole('button', { name: /dynasty warriors \(pro\)/i })).toBeTruthy()
    // external source action is NOT entitlement-gated
    const external = screen.getByRole('link', { name: /review trade in dynasty warriors/i })
    expect(external.getAttribute('href')).toBe('https://sleeper.com/leagues/987654321/league')
  })

  it('cross-league isolation → each league renders its OWN source URL, disclosure still once', () => {
    render(
      <PendingTradesModal
        isOpen
        onClose={() => {}}
        loading={false}
        hasProAccess
        data={tradesData([
          {
            leagueId: 'L1',
            leagueName: 'Dynasty Warriors',
            actionLinks: bundle({
              internal: { href: '/league/L1?tab=trades', label: 'Analyze Trade in AF' },
              external: { link: sleeperLink('111'), label: 'Review Trade in Dynasty Warriors' },
            }),
          },
          {
            leagueId: 'L2',
            leagueName: 'Gridiron Kings',
            actionLinks: bundle({
              internal: { href: '/league/L2?tab=trades', label: 'Analyze Trade in AF' },
              external: { link: sleeperLink('222'), label: 'Review Trade in Gridiron Kings' },
            }),
          },
        ])}
      />,
    )
    expect(
      screen.getByRole('link', { name: /review trade in dynasty warriors/i }).getAttribute('href'),
    ).toBe('https://sleeper.com/leagues/111/league')
    expect(
      screen.getByRole('link', { name: /review trade in gridiron kings/i }).getAttribute('href'),
    ).toBe('https://sleeper.com/leagues/222/league')
    expect(screen.getAllByText(IMPORTED_LEAGUE_READONLY_NOTE)).toHaveLength(1)
  })
})

// ----- WaiverRecommendationsModal ----------------------------------------------------------------

describe('WaiverRecommendationsModal — secure waiver action loop', () => {
  it('imported Sleeper waiver → internal "Analyze Waivers in AF" + secure external "Manage Waivers in {League}"', () => {
    render(
      <WaiverRecommendationsModal
        isOpen
        onClose={() => {}}
        loading={false}
        hasProAccess
        data={waiversData([
          {
            leagueId: 'L1',
            leagueName: 'Dynasty Warriors',
            actionLinks: bundle({
              internal: { href: '/league/L1?tab=players', label: 'Analyze Waivers in AF' },
              external: { link: sleeperLink('987654321'), label: 'Manage Waivers in Dynasty Warriors' },
            }),
          },
        ])}
      />,
    )
    expect(
      screen.getByRole('link', { name: /analyze waivers in af/i }).getAttribute('href'),
    ).toBe('/league/L1?tab=players')
    const external = screen.getByRole('link', { name: /manage waivers in dynasty warriors/i })
    expect(external.getAttribute('href')).toBe('https://sleeper.com/leagues/987654321/league')
    expect(external.getAttribute('rel')).toBe('noopener noreferrer')
    expect(screen.getAllByText(IMPORTED_LEAGUE_READONLY_NOTE)).toHaveLength(1)
  })

  it('homepage-fallback provider → honest "Go to {provider}" wins even if the bundle label claims a waiver page', () => {
    render(
      <WaiverRecommendationsModal
        isOpen
        onClose={() => {}}
        loading={false}
        hasProAccess
        data={waiversData([
          {
            leagueId: 'L3',
            leagueName: 'Keeper Chaos',
            actionLinks: bundle({
              internal: { href: '/league/L3?tab=players', label: 'Analyze Waivers in AF' },
              // A caller trying to over-claim a specific page — the component must ignore it on a fallback.
              external: { link: mflFallbackLink(), label: 'Manage Waivers in Keeper Chaos' },
            }),
          },
        ])}
      />,
    )
    expect(screen.getByRole('link', { name: /go to myfantasyleague/i })).toBeTruthy()
    expect(screen.queryByRole('link', { name: /manage waivers in keeper chaos/i })).toBeNull()
  })

  it('native league → internal only, no external, no disclosure', () => {
    render(
      <WaiverRecommendationsModal
        isOpen
        onClose={() => {}}
        loading={false}
        hasProAccess
        data={waiversData([
          {
            leagueId: 'L9',
            leagueName: 'AF Home League',
            actionLinks: bundle({
              imported: false,
              internal: { href: '/league/L9?tab=players', label: 'Analyze Waivers in AF' },
              external: null,
            }),
          },
        ])}
      />,
    )
    expect(screen.getByRole('link', { name: /analyze waivers in af/i })).toBeTruthy()
    expect(screen.queryByRole('link', { name: /manage waivers in/i })).toBeNull()
    expect(screen.queryByText(IMPORTED_LEAGUE_READONLY_NOTE)).toBeNull()
  })
})

// ----- LineupIssuesModal -------------------------------------------------------------------------

describe('LineupIssuesModal — secure lineup action loop', () => {
  it('imported lineup gap → internal "Review Lineup in AF" + secure external "Set Lineup in {League}" + one disclosure', () => {
    render(
      <LineupIssuesModal
        isOpen
        onClose={() => {}}
        loading={false}
        hasProAccess
        data={lineupData([
          {
            leagueId: 'L1',
            leagueName: 'Dynasty Warriors',
            issueType: 'empty_starter',
            actionLinks: bundle({
              internal: { href: '/league/L1?tab=team', label: 'Review Lineup in AF' },
              external: { link: sleeperLink('987654321'), label: 'Set Lineup in Dynasty Warriors' },
            }),
          },
        ])}
      />,
    )
    expect(
      screen.getByRole('link', { name: /review lineup in af/i }).getAttribute('href'),
    ).toBe('/league/L1?tab=team')
    const external = screen.getByRole('link', { name: /set lineup in dynasty warriors/i })
    expect(external.getAttribute('href')).toBe('https://sleeper.com/leagues/987654321/league')
    expect(external.getAttribute('target')).toBe('_blank')
    expect(external.getAttribute('rel')).toBe('noopener noreferrer')
    expect(screen.getAllByText(IMPORTED_LEAGUE_READONLY_NOTE)).toHaveLength(1)
  })

  it('imported roster signal → external CTA reflects the server-mapped "Manage Roster in {League}"', () => {
    render(
      <LineupIssuesModal
        isOpen
        onClose={() => {}}
        loading={false}
        hasProAccess
        data={lineupData([
          {
            leagueId: 'L1',
            leagueName: 'Dynasty Warriors',
            issueType: 'injury_impact',
            actionLinks: bundle({
              internal: { href: '/league/L1?tab=team', label: 'Review Recommendation in AF' },
              external: { link: sleeperLink('987654321'), label: 'Manage Roster in Dynasty Warriors' },
            }),
          },
        ])}
      />,
    )
    expect(screen.getByRole('link', { name: /manage roster in dynasty warriors/i })).toBeTruthy()
  })

  it('native league → internal only, no external, no disclosure', () => {
    render(
      <LineupIssuesModal
        isOpen
        onClose={() => {}}
        loading={false}
        hasProAccess
        data={lineupData([
          {
            leagueId: 'L9',
            leagueName: 'AF Home League',
            actionLinks: bundle({
              imported: false,
              internal: { href: '/league/L9?tab=team', label: 'Review Lineup in AF' },
              external: null,
            }),
          },
        ])}
      />,
    )
    expect(screen.getByRole('link', { name: /review lineup in af/i })).toBeTruthy()
    expect(screen.queryByRole('link', { name: /set lineup in/i })).toBeNull()
    expect(screen.queryByText(IMPORTED_LEAGUE_READONLY_NOTE)).toBeNull()
  })
})
