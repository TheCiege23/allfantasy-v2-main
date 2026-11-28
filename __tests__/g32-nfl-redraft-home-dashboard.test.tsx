import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NflRedraftLeagueHomeDashboard } from '@/components/league-home/NflRedraftLeagueHomeDashboard'
import { ConceptIntroVideoOverlay } from '@/components/league/ConceptIntroVideoOverlay'
import type { UserLeague, UserLeagueTeam } from '@/app/dashboard/types'

const entitlements = vi.hoisted(() => ({
  hasPro: false,
  hasSupreme: false,
  hasCommissioner: false,
}))

vi.mock('@/hooks/useEntitlements', () => ({
  useEntitlements: () => entitlements,
}))

const league = {
  id: 'league-g32',
  name: 'G32 Redraft',
  platform: 'allfantasy',
  sport: 'NFL',
  format: 'redraft',
  teamCount: 12,
  leagueType: 'redraft',
} as UserLeague

const teams = Array.from({ length: 12 }, (_, index) => ({
  id: index < 8 ? `team-${index}` : '',
  externalId: String(index + 1),
  teamName: index === 0 ? 'User Team' : `Team ${index + 1}`,
  ownerName: index < 8 ? `Manager ${index + 1}` : '',
  avatarUrl: null,
  role: index === 0 ? 'commissioner' : 'member',
  isOrphan: index >= 8,
  claimedByUserId: index < 8 ? `user-${index}` : null,
  draftPosition: index + 1,
  wins: 0,
  losses: 0,
  ties: 0,
  pointsFor: 0,
  pointsAgainst: 0,
  currentRank: null,
  faabRemaining: null,
  waiverPriority: null,
  divisionId: null,
})) as UserLeagueTeam[]

function renderHome(overrides: { commissioner?: boolean } = {}) {
  return render(
    <NflRedraftLeagueHomeDashboard
      league={league}
      leagueId="league-g32"
      teamSlots={teams}
      userTeamName="User Team"
      isCommissioner={overrides.commissioner ?? false}
      draftDateIso={null}
      onOpenSettings={vi.fn()}
      onOpenTab={vi.fn()}
    />,
  )
}

describe('G32 NFL redraft league home dashboard', () => {
  beforeEach(() => {
    entitlements.hasPro = false
    entitlements.hasSupreme = false
    entitlements.hasCommissioner = false
  })

  it('pre-draft: one Draft card, a short row list, and Manager Intelligence locked to the plans page', () => {
    const onOpenTab = vi.fn()
    render(
      <NflRedraftLeagueHomeDashboard league={league} leagueId="league-g32" teamSlots={teams} userTeamName="User Team" isCommissioner={false}
        draftDateIso={null} hasActiveRedraftSeason={false} onOpenSettings={vi.fn()} onOpenTab={onOpenTab} />,
    )
    expect(screen.getByTestId('g32-home-status')).toHaveTextContent('Pre-draft')
    expect(screen.getByRole('heading', { name: 'Draft' })).toBeInTheDocument()
    expect(screen.getByText('Draft time has not been set')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('g32-home-next-action'))
    expect(onOpenTab).toHaveBeenLastCalledWith('draft')
    expect(screen.getByTestId('g32-home-row-intelligence')).toHaveTextContent('AF Pro')
    expect(screen.getByTestId('g32-home-row-intelligence').getAttribute('href')).toBe('/pricing')
    // No invite row for a member, no standings before the draft, no checklist.
    expect(screen.queryByTestId('g32-home-row-invite')).toBeNull()
    expect(screen.queryByTestId('g32-home-row-standings')).toBeNull()
    expect(screen.queryByText('Suggested checklist')).toBeNull()
  })

  it('unlocks Manager Intelligence for AF Pro users', () => {
    entitlements.hasPro = true
    const onOpenTab = vi.fn()
    render(
      <NflRedraftLeagueHomeDashboard league={league} leagueId="league-g32" teamSlots={teams} isCommissioner={false}
        draftDateIso={null} hasActiveRedraftSeason={false} onOpenSettings={vi.fn()} onOpenTab={onOpenTab} />,
    )
    fireEvent.click(screen.getByTestId('g32-home-row-intelligence'))
    expect(onOpenTab).toHaveBeenLastCalledWith('decide')
  })

  it('commissioner pre-draft: Invite managers shows the seats and goes to the Draft tab, where the invite is', () => {
    const onOpenTab = vi.fn()
    render(
      <NflRedraftLeagueHomeDashboard league={league} leagueId="league-g32" teamSlots={teams} isCommissioner
        draftDateIso={null} hasActiveRedraftSeason={false} onOpenSettings={vi.fn()} onOpenTab={onOpenTab} />,
    )
    expect(screen.getByTestId('g32-home-row-invite')).toHaveTextContent('8/12')
    fireEvent.click(screen.getByTestId('g32-home-row-invite'))
    expect(onOpenTab).toHaveBeenLastCalledWith('draft')
    expect(screen.getByTestId('g32-home-row-intelligence')).toHaveTextContent('AF Commissioner')
  })

  it('in season: the next card is the matchup, standings appear, and the invite row is gone', () => {
    entitlements.hasSupreme = true
    const onOpenTab = vi.fn()
    render(
      <NflRedraftLeagueHomeDashboard league={{ ...league, currentWeek: 5 } as UserLeague} leagueId="league-g32" teamSlots={teams} isCommissioner
        draftDateIso={null} hasActiveRedraftSeason onOpenSettings={vi.fn()} onOpenTab={onOpenTab} />,
    )
    expect(screen.getByTestId('g32-home-status')).toHaveTextContent('Week 5')
    fireEvent.click(screen.getByTestId('g32-home-next-action'))
    expect(onOpenTab).toHaveBeenLastCalledWith('matchups')
    expect(screen.getByTestId('g32-home-row-standings')).toBeInTheDocument()
    expect(screen.queryByTestId('g32-home-row-invite')).toBeNull()
    expect(screen.getByTestId('g32-home-row-intelligence').getAttribute('href')).toBe('/league/league-g32/intelligence')
  })

  it('announcements stay available but folded until asked for', () => {
    renderHome({ commissioner: true })
    expect(screen.queryByTestId('g42-communication-panel')).toBeNull()
    expect(screen.getByTestId('g32-home-announcements-toggle')).toHaveAttribute('aria-expanded', 'false')
  })

  it('dispatches scoped replay intro events from League Home', () => {
    const listener = vi.fn()
    window.addEventListener('af:replay-league-intro', listener)

    renderHome()
    fireEvent.click(screen.getByTestId('g32-replay-intro'))

    expect(listener).toHaveBeenCalledTimes(1)
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual({ leagueId: 'league-g32' })
    window.removeEventListener('af:replay-league-intro', listener)
  })

  it('does not use AI-forward product language in the home surface', () => {
    const { container } = renderHome({ commissioner: true })

    expect(container.textContent).not.toMatch(
      /AI Commissioner|AI tools|AI assistant|AI-powered|AI recommendations|AI everywhere|AI Coaching|AI Settings/,
    )
  })
})

describe('G32 concept intro overlay motion behavior', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('renders a static preview instead of autoplay video when reduced motion is enabled', () => {
    vi.stubGlobal('matchMedia', () => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))

    render(
      <ConceptIntroVideoOverlay
        open
        conceptLabel="Redraft"
        videoSrc="/media/league-intros/redraft-league-intro.mp4"
        posterSrc="/poster.png"
        onDismiss={vi.fn()}
      />,
    )

    expect(screen.getByTestId('concept-intro-reduced-motion')).toBeInTheDocument()
    expect(screen.queryByTestId('concept-intro-video')).not.toBeInTheDocument()
  })

  it('renders muted inline video when reduced motion is not enabled', () => {
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))

    render(
      <ConceptIntroVideoOverlay
        open
        conceptLabel="Redraft"
        videoSrc="/media/league-intros/redraft-league-intro.mp4"
        onDismiss={vi.fn()}
      />,
    )

    const video = screen.getByTestId('concept-intro-video')
    expect(video).toHaveAttribute('src', '/media/league-intros/redraft-league-intro.mp4')
    expect((video as HTMLVideoElement).muted).toBe(true)
    expect((video as HTMLVideoElement).playsInline).toBe(true)
  })
})
