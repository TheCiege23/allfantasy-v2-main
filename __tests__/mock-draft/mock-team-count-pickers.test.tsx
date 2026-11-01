/**
 * The open mock room's Teams picker offers every size a redraft league of that sport accepts (it was
 * 8, 10, 12, 14), and asks for a player pool big enough for the whole draft (it asked for 300, which a
 * 20-team, 20-round room outruns at pick 301).
 */
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MockDraftSleeperRoomClient from '@/components/mock-draft/MockDraftSleeperRoomClient'
import { getMockDraftTeamCountOptions } from '@/lib/mock-draft/mockTeamCount'

const calls: string[] = []
beforeEach(() => {
  localStorage.clear()
  calls.length = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(String(url))
      if (String(url).includes('/api/mock-draft/adp')) {
        return new Response(JSON.stringify({ entries: Array.from({ length: 50 }, (_, i) => ({ playerId: `p${i}`, name: `P${i}`, position: 'PG', team: 'LAL', adp: i + 1, value: 100 })) }), { status: 200 })
      }
      return new Response(JSON.stringify({ leagues: [] }), { status: 200 })
    }),
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const teamChips = () =>
  screen
    .getAllByTestId(/^mock-draft-open-teams-\d+$/)
    .map((el) => Number(el.getAttribute('data-testid')!.replace('mock-draft-open-teams-', '')))

describe('open mock room Teams picker', () => {
  it('lists the league sizes for the sport, 4 through 20 and the e2e 8 chip included', async () => {
    render(<MockDraftSleeperRoomClient viewerId="viewer" />)
    fireEvent.click(await screen.findByTestId('mock-draft-entry-open'))
    fireEvent.click(screen.getByTestId('mock-draft-open-sport-NBA'))
    expect(teamChips()).toEqual(getMockDraftTeamCountOptions('NBA', 'redraft'))
    for (const n of [4, 5, 8, 19, 20]) expect(teamChips()).toContain(n)
  })

  it('a 20-team, 20-round room asks for at least one player per pick', async () => {
    render(<MockDraftSleeperRoomClient viewerId="viewer" />)
    fireEvent.click(await screen.findByTestId('mock-draft-entry-open'))
    fireEvent.click(screen.getByTestId('mock-draft-open-sport-NFL'))
    fireEvent.click(screen.getByTestId('mock-draft-open-teams-20'))
    fireEvent.click(screen.getByTestId('mock-draft-open-rounds-20'))
    fireEvent.click(screen.getByTestId('mock-draft-open-start'))
    await waitFor(() => expect(calls.some((u) => u.includes('/api/mock-draft/adp'))).toBe(true))
    const url = new URL(calls.find((u) => u.includes('/api/mock-draft/adp'))!, 'http://localhost')
    expect(url.searchParams.get('teamCount')).toBe('20')
    expect(Number(url.searchParams.get('limit'))).toBeGreaterThanOrEqual(400)
  })
})
