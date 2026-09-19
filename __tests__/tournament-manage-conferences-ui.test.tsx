// @vitest-environment jsdom
import React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { ManageConferencesPanel } from '@/app/tournament-hub/[tournamentId]/ManageConferencesPanel'
import type { StandingsBoard } from '@/lib/tournament/standingsBoard'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

function board(locked = false): StandingsBoard {
  const row = (id: string) => ({
    leagueParticipantId: `lp-${id}`,
    participantId: `p-${id}`,
    userId: `u-${id}`,
    displayName: `Manager ${id}`,
    wins: 1,
    losses: 0,
    ties: 0,
    pointsFor: 100,
    pointsAgainst: 90,
    leagueRank: 1,
    conferenceRank: 1,
    appUserId: null,
    unmatched: false,
    matchedBy: 'platformUserId' as const,
    standing: 'in' as const,
  })
  return {
    tournamentId: 't1',
    name: 'Invitational',
    roundNumber: 1,
    conferences: [
      {
        id: 'c1', name: 'Black', colorHex: null, qualifyingCount: 1, conferencePoints: 100,
        leagues: [{ tournamentLeagueId: 'l1', leagueNumber: 1, leagueId: 'source-1', name: 'North', rows: [row('1')], unmatchedCount: 0, unclaimedTeams: [], oldestUpdatedAt: null }],
      },
      {
        id: 'c2', name: 'Gold', colorHex: null, qualifyingCount: 1, conferencePoints: 100,
        leagues: [{ tournamentLeagueId: 'l2', leagueNumber: 2, leagueId: 'source-2', name: 'South', rows: [row('2')], unmatchedCount: 0, unclaimedTeams: [], oldestUpdatedAt: null }],
      },
    ],
    archivedConferences: [{ id: 'c3', name: 'Silver', colorHex: null }],
    conferenceMembershipLocked: locked,
    advancersPerLeague: 0,
    wildcardCount: 1,
    bubbleEnabled: false,
    bubbleSize: 0,
    tiebreakerMode: 'points_for',
    unmatchedTotal: 0,
    oldestUpdatedAt: null,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) })))
})

it('moves a league, reviews the complete plan, and saves only on the final action', async () => {
  render(<ManageConferencesPanel board={board()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Manage conferences' }))

  const moveSouth = screen.getByLabelText('Move South')
  fireEvent.change(moveSouth, { target: { value: 'c1' } })
  expect(fetch).not.toHaveBeenCalled()

  fireEvent.click(screen.getByRole('button', { name: 'Review conference changes' }))
  const review = screen.getByRole('region', { name: 'Review conference changes' })
  expect(within(review).getByText(/1 league changes conference/)).toBeTruthy()
  expect(within(review).getByText('South')).toBeTruthy()
  expect(fetch).not.toHaveBeenCalled()

  fireEvent.click(within(review).getByRole('button', { name: 'Save conference setup' }))
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
  const request = vi.mocked(fetch).mock.calls[0]!
  const payload = JSON.parse(String((request[1] as RequestInit).body))
  expect(payload.conferencePlan.find((conference: Draft) => conference.clientId === 'c1').leagueIds).toEqual(['l1', 'l2'])
  expect(refresh).toHaveBeenCalled()
})

type Draft = { clientId: string; leagueIds: string[] }

it('supports custom names, new conferences, archive restore, search, and accessible ordering', () => {
  render(<ManageConferencesPanel board={board()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Manage conferences' }))
  fireEvent.change(screen.getAllByLabelText('Conference name')[0]!, { target: { value: 'AFC' } })
  fireEvent.click(screen.getByRole('button', { name: '+ Add conference' }))
  expect(screen.getByRole('region', { name: 'Conference 3' })).toBeTruthy()
  fireEvent.click(screen.getByText(/Archived conferences/))
  fireEvent.click(screen.getByRole('button', { name: 'Restore' }))
  expect(screen.getByRole('region', { name: 'Silver' })).toBeTruthy()
  fireEvent.change(screen.getByRole('searchbox', { name: 'Find a league' }), { target: { value: 'North' } })
  expect(screen.getByText('North')).toBeTruthy()
  expect(screen.queryByText('South')).toBeNull()
  expect(screen.getByRole('button', { name: 'Move North up' })).toBeDisabled()
})

it('locks cross-conference moves after advancement but keeps names and order editable', () => {
  render(<ManageConferencesPanel board={board(true)} />)
  fireEvent.click(screen.getByRole('button', { name: 'Manage conferences' }))
  expect(screen.getByText(/advancement is recorded/)).toBeTruthy()
  expect(screen.getByLabelText('Move South')).toBeDisabled()
  expect(screen.getAllByLabelText('Conference name')[0]).toBeEnabled()
})

it('keeps changes editable when the API rejects a stale or historically unsafe plan', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({ error: 'Reload and review it again.' }) })))
  render(<ManageConferencesPanel board={board()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Manage conferences' }))
  fireEvent.change(screen.getAllByLabelText('Conference name')[0]!, { target: { value: 'AFC' } })
  fireEvent.click(screen.getByRole('button', { name: 'Review conference changes' }))
  fireEvent.click(screen.getByRole('button', { name: 'Save conference setup' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Reload and review it again.')
  expect(screen.getByRole('button', { name: 'Edit changes' })).toBeTruthy()
})
