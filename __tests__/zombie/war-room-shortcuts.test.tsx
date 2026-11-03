import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { ZombieWarRoomShortcuts } from '@/components/zombie/ZombieWarRoomShortcuts'

const payload = (myStatus: string | null) => ({ myRosterId: myStatus ? 'my-roster' : null, myStatus, revivedRosterIds: [], myResources: { serums: 2, weapons: 1, ambush: 3 } })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
describe('Zombie War Room shortcuts', () => {
  it.each([
    ['Whisperer', 'Whisperer strategy', 'Chimmy action cards', '/zombie/lg%201/chat'],
    ['Zombie', 'Zombie strategy', 'Your items', '/zombie/lg%201/items'],
    ['Survivor', 'Survivor strategy', 'Your items', '/zombie/lg%201/items'],
  ])('shows %s actions from the viewer summary', async (status, heading, label, href) => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => payload(status) })))
    render(<ZombieWarRoomShortcuts leagueId="lg 1" />)
    await screen.findByRole('heading', { name: heading })
    expect(screen.getByRole('link', { name: label }).getAttribute('href')).toBe(href)
    expect(screen.getByText(/Your supplies:/).textContent).toContain(status === 'Whisperer' ? '3 ambushes' : '2 serums')
    if (status !== 'Whisperer') expect(screen.getByText(/Your supplies:/).textContent).not.toContain('ambush')
  })
  it('does not invent a role or show personal action links when the summary is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })))
    render(<ZombieWarRoomShortcuts leagueId="lg" />)
    await screen.findByText(/Your status is unavailable/)
    expect(screen.queryByRole('link', { name: 'Your items' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Chimmy action cards' })).toBeNull()
  })
})
