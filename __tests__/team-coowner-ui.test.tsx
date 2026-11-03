import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TeamCoOwnerPanel } from '@/app/league/[leagueId]/components/settings/TeamCoOwnerPanel'

afterEach(() => vi.unstubAllGlobals())
describe('team co-owner invitation controls', () => {
  it('invites the named account for the selected roster and displays its pending status', async () => {
    let invited = false
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') { invited = true; return { ok: true, json: async () => ({ ok: true }) } }
      return { ok: true, json: async () => ({ invitations: invited ? [{ id: 'invite-1', acceptedAt: null, user: { username: 'helper', displayName: 'Helper' } }] : [] }) }
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<TeamCoOwnerPanel leagueId="league-1" rosterId="roster-1" />)
    fireEvent.change(screen.getByLabelText('AllFantasy username'), { target: { value: 'helper' } })
    fireEvent.click(screen.getByRole('button', { name: 'Invite' }))
    expect(await screen.findByText('Helper — Invited')).toBeTruthy()
    const request = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')
    expect(JSON.parse(String(request?.[1]?.body))).toEqual({ rosterId: 'roster-1', username: 'helper' })
    expect(screen.getByText(/do not receive commissioner access/)).toBeTruthy()
    expect(screen.getByRole('link', { name: '/team-invitation/league-1' }).getAttribute('href')).toBe('/team-invitation/league-1')
  })
  it('shows server errors without claiming that an invitation succeeded', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'POST'
      ? { ok: false, json: async () => ({ error: 'Username not found' }) }
      : { ok: true, json: async () => ({ invitations: [] }) }))
    render(<TeamCoOwnerPanel leagueId="league-1" rosterId="roster-1" />)
    fireEvent.change(screen.getByLabelText('AllFantasy username'), { target: { value: 'missing' } })
    fireEvent.click(screen.getByRole('button', { name: 'Invite' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Username not found'))
  })
})
