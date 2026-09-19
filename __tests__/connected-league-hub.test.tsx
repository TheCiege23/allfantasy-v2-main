import React from 'react'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { ConnectedRoster } from '@/components/core-app/screens/ConnectedRoster'
import { ConnectedFranchiseWarRoom } from '@/components/core-app/screens/ConnectedFranchiseWarRoom'
import { groupLeagueHubs } from '@/lib/core-app/leagueHubGroups'
import { buildFranchiseView } from '@/lib/franchise/franchiseLink'
import type { FranchiseSide } from '@/lib/core-app/leaguePairing'

afterEach(cleanup)
const sides: FranchiseSide[] = ['Peach Bowl', 'Cream Bowl'].map((name, i) => ({
  name, role: i ? 'college' : 'pro', platform: i ? 'fantrax' : 'sleeper', sport: i ? 'NCAAF' : 'NFL',
  leagueId: `league-${i}`, season: 2026, teamLabel: 'My team', avatarUrl: null, playerCount: 1,
  unavailableReason: null, draft: null, activity: null,
  players: [{ id: `${i}`, name: i ? 'College Player' : 'Pro Player', position: i ? 'WR' : 'QB', team: i ? 'Texas' : 'KC', imageUrl: null, logoUrl: null }],
}))

describe('connected league hub', () => {
  it('shows both rosters immediately and filters players without navigating away', () => {
    render(<ConnectedRoster sides={sides} />)
    expect(screen.getByText('Pro Player')).toBeTruthy()
    expect(screen.getByText('College Player')).toBeTruthy()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Texas' } })
    expect(screen.queryByText('Pro Player')).toBeNull()
    expect(screen.getByText('College Player')).toBeTruthy()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('Filter roster by position'), { target: { value: 'QB' } })
    expect(screen.getByText('Pro Player')).toBeTruthy()
    expect(screen.queryByText('College Player')).toBeNull()
  })
  it('keeps each lineup link scoped to its own league', () => {
    render(<ConnectedRoster sides={sides} />)
    expect(screen.getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/core/my-team?league=league-0', '/core/my-team?league=league-1'])
    fireEvent.click(screen.getByRole('button', { name: 'Cream Bowl' }))
    expect(screen.queryByText('Pro Player')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'All leagues' }))
    expect(screen.getByText('Pro Player')).toBeTruthy()
  })
  it('groups either visible member into one hub without dropping unrelated leagues', () => {
    const hub = { id: 'h', name: 'Shared', members: [] }
    expect(groupLeagueHubs([{ id: 'cream', hub }, { id: 'other' }, { id: 'peach', hub }]).map((l) => l.id)).toEqual(['cream', 'other'])
    expect(groupLeagueHubs([{ id: 'peach', hub }]).map((l) => l.id)).toEqual(['peach'])
  })
  it('recognizes two same-sport formats as complete without inventing a college side', () => {
    const view = buildFranchiseView({ linkId: 'h', name: 'Tournament hub', members: ['primary', 'linked'].map((role) => ({ role: role as 'primary' | 'linked', platform: 'allfantasy', leagueId: role, teamExternalId: role, leaguePresent: true })) })
    expect(view.complete).toBe(true)
    expect(view.gaps).toEqual([])
  })

  it('renders every resolved league in the franchise command center', () => {
    const expanded = [
      ...sides,
      {
        ...sides[0],
        role: 'tournament' as const,
        leagueId: 'league-2',
        name: 'Playoff Tournament',
        platform: 'allfantasy',
        playerCount: 2,
        players: [
          { ...sides[0].players![0], id: '2', name: 'Tournament Player' },
          { ...sides[0].players![0], id: '3', name: 'Second Tournament Player' },
        ],
      },
    ]
    render(
      <ConnectedFranchiseWarRoom
        franchiseName="One franchise"
        selectedLeagueId="league-0"
        sides={expanded.map((side) => ({
          role: side.role,
          leagueId: side.leagueId,
          name: side.name,
          platform: side.platform,
          sport: side.sport ?? null,
          playerCount: side.playerCount,
          unavailableReason: side.unavailableReason,
          players: side.players ?? [],
        }))}
      />,
    )
    expect(screen.getByText('3', { selector: '.af-cwr-scoreboard strong' })).toBeTruthy()
    expect(screen.getByText('Playoff Tournament')).toBeTruthy()
    expect(screen.getAllByRole('link', { name: 'Open roster →' })).toHaveLength(3)
    expect(screen.getByRole('link', { name: 'Open the combined roster →' })).toHaveAttribute('href', '/core?league=league-0')
  })
})
