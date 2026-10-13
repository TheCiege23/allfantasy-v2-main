/**
 * Seat tracker on the native league home (2026-10-13): who has joined, and open seats the
 * commissioner can invite into. Replaces "3 of 12 manager seats claimed".
 */
import React from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useLanguage: () => ({ t: (key: string) => key, language: 'en' }) }))

import type { UserLeagueTeam } from '@/app/dashboard/types'
import { LeagueSeatTracker, SEAT_PREVIEW_LIMIT, buildSeatRows, initialsOf } from '@/components/league/native/LeagueSeatTracker'

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.style.overflow = ''
})

function team(over: Partial<UserLeagueTeam> & { id: string }): UserLeagueTeam {
  return {
    externalId: over.id,
    teamName: `Team ${over.id}`,
    ownerName: '',
    avatarUrl: null,
    role: 'member',
    isOrphan: false,
    claimedByUserId: null,
    draftPosition: null,
    wins: 0,
    losses: 0,
    ties: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    currentRank: null,
    faabRemaining: null,
    waiverPriority: null,
    divisionId: null,
    ...over,
  } as UserLeagueTeam
}

const teams: UserLeagueTeam[] = [
  team({ id: 't3', ownerName: 'Casey Lee', claimedByUserId: 'u3', draftPosition: 3 }),
  team({ id: 't1', ownerName: 'Ari Moss', claimedByUserId: 'u1', draftPosition: 1, teamName: 'Moss Bosses' }),
  team({ id: 't2', ownerName: 'Me Myself', claimedByUserId: 'u2', draftPosition: 2 }),
  // Placeholder rows create makes for unclaimed seats: never counted as joined.
  team({ id: 't4', ownerName: 'Open team' }),
  team({ id: 't5' }),
]

describe('seat rows', () => {
  it('you first, then draft order, then one open chip per unclaimed seat — counted from the league size', () => {
    const rows = buildSeatRows(teams, 12, 't2')
    expect(rows.filter((r) => r.kind === 'claimed').map((r) => (r.kind === 'claimed' ? r.name : ''))).toEqual(['Me Myself', 'Ari Moss', 'Casey Lee'])
    expect(rows[0]).toMatchObject({ isYou: true })
    expect(rows.filter((r) => r.kind === 'open')).toHaveLength(9)
  })

  it('never shows a negative number of open seats', () => {
    expect(buildSeatRows(teams, 2, null).filter((r) => r.kind === 'open')).toHaveLength(0)
  })

  it('initials', () => {
    expect(initialsOf('John Doe')).toBe('JD')
    expect(initialsOf('john')).toBe('JO')
    expect(initialsOf('Mary Ann Smith')).toBe('MS')
    expect(initialsOf('   ')).toBe('?')
  })
})

describe('the card', () => {
  const base = { teams, teamCount: 12, userTeamId: 't2', leagueName: 'Tight End Club', inviteCode: 'ABC123', onOpenInviteSettings: vi.fn() }

  it('says how many joined, lists them, and offers Invite on open seats to the commissioner', () => {
    render(<LeagueSeatTracker {...base} canInvite />)
    expect(screen.getByTestId('seat-tracker-count').textContent).toBe('3 of 12 joined')
    const list = screen.getByTestId('seat-tracker-list')
    expect(within(list).getByText('Me Myself (you)')).toBeTruthy()
    expect(within(list).getByText('Moss Bosses')).toBeTruthy()
    expect(within(list).getByText('AM')).toBeTruthy()
    expect(screen.getAllByTestId('seat-tracker-invite')).toHaveLength(9)
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('3')
  })

  it('managers see the open seats waiting, with nothing to tap', () => {
    render(<LeagueSeatTracker {...base} canInvite={false} />)
    expect(screen.queryByTestId('seat-tracker-invite')).toBeNull()
    expect(screen.getAllByText('Open seat')).toHaveLength(9)
    expect(screen.getByText(/the commissioner is still inviting/i)).toBeTruthy()
  })

  it('Invite opens the share sheet with the league link on this host; Escape closes it', () => {
    render(<LeagueSeatTracker {...base} canInvite />)
    fireEvent.click(screen.getAllByTestId('seat-tracker-invite')[0])
    const sheet = screen.getByTestId('seat-invite-sheet')
    expect(sheet.parentElement).toBe(document.body)
    expect((screen.getByTestId('seat-invite-url') as HTMLInputElement).value).toBe(`${window.location.origin}/join?code=ABC123`)
    expect(screen.getByTestId('seat-invite-seats').textContent).toBe('3 of 12 managers joined')
    expect(document.body.style.overflow).toBe('hidden')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByTestId('seat-invite-sheet')).toBeNull()
    expect(document.body.style.overflow).toBe('')
  })

  it('no invite code yet: Invite goes to Settings › Invite, which mints one', () => {
    const onOpenInviteSettings = vi.fn()
    render(<LeagueSeatTracker {...base} inviteCode="" canInvite onOpenInviteSettings={onOpenInviteSettings} />)
    fireEvent.click(screen.getAllByTestId('seat-tracker-invite')[0])
    expect(onOpenInviteSettings).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('seat-invite-sheet')).toBeNull()
  })

  it('a full league says so and offers no invite', () => {
    const full = Array.from({ length: 4 }, (_, i) => team({ id: `f${i}`, ownerName: `Owner ${i}`, claimedByUserId: `u${i}` }))
    render(<LeagueSeatTracker {...base} teams={full} teamCount={4} canInvite />)
    expect(screen.getByTestId('seat-tracker-count').textContent).toBe('League full · 4 of 4')
    expect(screen.queryByTestId('seat-tracker-invite')).toBeNull()
  })

  it('a big league shows the first seats and expands to all of them', () => {
    render(<LeagueSeatTracker {...base} teamCount={20} canInvite />)
    expect(screen.getByTestId('seat-tracker-list').children).toHaveLength(SEAT_PREVIEW_LIMIT)
    fireEvent.click(screen.getByTestId('seat-tracker-more'))
    expect(screen.getByTestId('seat-tracker-list').children).toHaveLength(20)
    expect(screen.getByTestId('seat-tracker-more').textContent).toBe('Show fewer')
  })
})
