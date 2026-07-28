// @vitest-environment jsdom
/**
 * RecommendationTimeline (the live Decision OS card feed) renders the internal AllFantasy action + the
 * secure external source-platform action + a single read-only disclosure for imported/actionable cards,
 * and shows internal-only (no external, no disclosure) for informational + native cards.
 */
import React from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: unknown }) => (
    <a href={typeof href === 'string' ? href : '#'}>{children}</a>
  ),
}))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({
  useLanguage: () => ({ t: (k: string) => k, tInterpolate: (k: string) => k }),
}))
vi.mock('@/app/dashboard/components/warroom/WarRoomCard', () => ({
  WarRoomCard: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

import { RecommendationTimeline } from '@/app/dashboard/components/warroom/RecommendationTimeline'
import { IMPORTED_LEAGUE_READONLY_NOTE } from '@/lib/league-links/readOnlyNote'
import type { LineupActionItem } from '@/lib/lineup-actions/types'

const sleeperLink = {
  href: 'https://sleeper.com/leagues/131353/league',
  destinationType: 'league' as const,
  provider: 'sleeper' as const,
  providerLabel: 'Sleeper',
  label: 'Open HailShiva in Sleeper',
  isFallback: false,
  opensExternally: true as const,
}

function baseItem(over: Partial<LineupActionItem>): LineupActionItem {
  return {
    leagueId: 'L1', leagueName: 'HailShiva', sport: 'NFL' as never, platform: 'sleeper',
    teamId: null, slotIndex: null, slotId: 's1', slotLabel: null, playerId: null, playerName: null,
    reasonType: 'empty_starter', urgency: 'urgent', lockTime: null, recommendedAction: 'Fix your lineup',
    suggestedReplacementPlayerId: null, confidence: null, expectedGain: null, sourceModule: 'lineup_scan',
    message: 'x', severity: 'critical', ...over,
  }
}

afterEach(cleanup)

describe('RecommendationTimeline — Decision OS action loop', () => {
  it('imported actionable card → internal AF action + secure external action + read-only disclosure', () => {
    render(
      <RecommendationTimeline
        actions={[
          baseItem({
            actionLinks: {
              actionable: true, imported: true, dataAsOf: '2026-07-28T12:00:00.000Z',
              internal: { href: '/league/L1?tab=team', label: 'Review Lineup in AF' },
              external: { link: sleeperLink, label: 'Set Lineup in HailShiva' },
            },
          }),
        ]}
      />,
    )
    const internal = screen.getByRole('link', { name: /review lineup in af/i })
    expect(internal.getAttribute('href')).toBe('/league/L1?tab=team')
    const external = screen.getByRole('link', { name: /set lineup in hailshiva/i })
    expect(external.getAttribute('href')).toBe('https://sleeper.com/leagues/131353/league')
    expect(external.getAttribute('target')).toBe('_blank')
    expect(external.getAttribute('rel')).toBe('noopener noreferrer')
    expect(screen.getByText(IMPORTED_LEAGUE_READONLY_NOTE)).toBeTruthy()
  })

  it('informational card → internal only, NO external action, NO disclosure', () => {
    render(
      <RecommendationTimeline
        actions={[
          baseItem({
            reasonType: 'matchup_prep',
            actionLinks: { actionable: false, imported: true, dataAsOf: null, internal: { href: '/league/L1?tab=team', label: 'Review Matchup in AF' }, external: null },
          }),
        ]}
      />,
    )
    expect(screen.getByRole('link', { name: /review matchup in af/i })).toBeTruthy()
    expect(screen.queryByRole('link', { name: /in hailshiva/i })).toBeNull()
    expect(screen.queryByText(IMPORTED_LEAGUE_READONLY_NOTE)).toBeNull()
  })

  it('native league card → internal only, no external, no disclosure', () => {
    render(
      <RecommendationTimeline
        actions={[
          baseItem({
            platform: 'allfantasy',
            actionLinks: { actionable: true, imported: false, dataAsOf: null, internal: { href: '/league/L1?tab=team', label: 'Review Lineup in AF' }, external: null },
          }),
        ]}
      />,
    )
    expect(screen.getByRole('link', { name: /review lineup in af/i })).toBeTruthy()
    expect(screen.queryByText(IMPORTED_LEAGUE_READONLY_NOTE)).toBeNull()
  })
})
