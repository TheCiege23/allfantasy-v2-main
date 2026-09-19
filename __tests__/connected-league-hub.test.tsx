import React from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { ConnectedRoster } from '@/components/core-app/screens/ConnectedRoster'
import { ConnectedFranchiseWarRoom } from '@/components/core-app/screens/ConnectedFranchiseWarRoom'
import { groupLeagueHubs } from '@/lib/core-app/leagueHubGroups'
import { buildFranchiseView } from '@/lib/franchise/franchiseLink'
import type { FranchiseSide } from '@/lib/core-app/leaguePairing'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
const sides: FranchiseSide[] = ['Peach Bowl', 'Cream Bowl'].map((name, i) => ({
  memberId: `member-${i}`,
  name, role: i ? 'college' : 'pro', platform: i ? 'fantrax' : 'sleeper', sport: i ? 'NCAAF' : 'NFL',
  leagueId: `league-${i}`, memberLeagueId: `league-${i}`, season: 2026, teamLabel: 'My team', teamCandidates: [], avatarUrl: null, playerCount: 1,
  unavailableReason: null, draft: null, activity: null,
  sync: { lastSyncedAt: new Date('2026-09-19T12:00:00Z'), stale: false, refreshHref: '/import', detail: 'Fresh' },
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
        memberId: 'member-2',
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
        linkId="hub-1"
        franchiseName="One franchise"
        primaryMemberId="member-0"
        selectedLeagueId="league-0"
        sides={expanded.map((side) => ({
          role: side.role,
          memberId: side.memberId,
          leagueId: side.leagueId,
          memberLeagueId: side.memberLeagueId,
          name: side.name,
          platform: side.platform,
          sport: side.sport ?? null,
          season: side.season,
          teamLabel: side.teamLabel,
          teamCandidates: side.teamCandidates,
          avatarUrl: side.avatarUrl,
          playerCount: side.playerCount,
          unavailableReason: side.unavailableReason,
          draft: side.draft,
          activity: side.activity,
          sync: side.sync,
          players: side.players ?? [],
        }))}
      />,
    )
    expect(screen.getByText('3', { selector: '.af-cwr-scoreboard strong' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Playoff Tournament' })).toBeTruthy()
    expect(screen.getAllByRole('link', { name: 'Roster' })).toHaveLength(3)
    expect(screen.getByRole('link', { name: 'Open combined roster →' })).toHaveAttribute('href', '/core?league=league-0')
  })

  it('saves a corrected team identity for one league without reconnecting the hub', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    vi.stubGlobal('fetch', fetchMock)
    render(
      <ConnectedFranchiseWarRoom
        linkId="hub-1"
        franchiseName="One franchise"
        primaryMemberId="member-0"
        selectedLeagueId="league-0"
        sides={[{
          ...sides[0],
          memberLeagueId: 'provider-league-0',
          teamLabel: 'Team One',
          teamCandidates: [{ id: '1', label: 'Team One' }, { id: '2', label: 'Team Two' }],
        }]}
      />,
    )
    fireEvent.change(screen.getByLabelText('Your team in Peach Bowl'), { target: { value: '2' } })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      action: 'update-team-mapping',
      linkId: 'hub-1',
      member: { platform: 'sleeper', leagueId: 'provider-league-0', teamExternalId: '2' },
    })
  })

  it('renames the shared hub through the owned franchise endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    vi.stubGlobal('fetch', fetchMock)
    render(
      <ConnectedFranchiseWarRoom
        linkId="hub-1"
        franchiseName="Old name"
        primaryMemberId="member-0"
        selectedLeagueId="league-0"
        sides={sides}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Manage hub' }))
    fireEvent.change(screen.getByLabelText('Franchise name'), { target: { value: 'Peach and Cream' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      action: 'rename-franchise',
      linkId: 'hub-1',
      franchiseName: 'Peach and Cream',
    })
  })
})
