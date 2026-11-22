/**
 * The two newer "fix a problem" tools in SurvivorSeasonFixPanel: changing the latest Tribal Council
 * result (POST override_tribal, after a confirming second tap) and redrawing the tribes (redraw_tribes,
 * before the merge only). The override's outcome — who came back, which released players another team
 * kept — is said in the success line.
 */
import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SurvivorSeasonFixPanel } from '@/components/survivor/SurvivorSeasonFixPanel'

const managers = [{ userId: 'u1', name: 'Ava' }]
const target = {
  councilId: 'c1', week: 5, eliminatedUserId: 'u-wrong', eliminatedName: 'Wes', resolved: true,
  candidates: [{ userId: 'u-right', name: 'Rae' }, { userId: 'u3', name: 'Cy' }],
}
let fetchMock: ReturnType<typeof vi.fn>
let postReply: Record<string, unknown>
beforeEach(() => {
  postReply = { ok: true }
  fetchMock = vi.fn(async (_url: string, init?: RequestInit) => ({
    ok: true, status: 200,
    json: async () => (init?.method === 'POST' ? postReply : { target }),
  }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())
const posts = () => fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST').map(([, init]) => JSON.parse((init as RequestInit).body as string))

describe('Change a Tribal result', () => {
  it('loads the latest council, then changes it only after the second tap, and says what came back', async () => {
    postReply = { ok: true, restoredPlayerIds: ['a', 'b'], claimedElsewherePlayerIds: ['c'], eliminationApplied: true }
    render(<SurvivorSeasonFixPanel leagueId="L1" managers={managers} week={5} merged={false} />)
    fireEvent.click(screen.getByText('Change a Tribal result'))
    await screen.findByText(/was voted out\./)
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/survivor/commissioner?leagueId=L1&type=tribal_override')
    expect(screen.getByTestId('survivor-tribal-override').textContent).toContain('Wes')
    expect([...(screen.getByLabelText('Manager to vote out instead') as HTMLSelectElement).options].map((o) => o.text)).toEqual(['Choose a manager', 'Rae', 'Cy'])

    fireEvent.change(screen.getByLabelText('Manager to vote out instead'), { target: { value: 'u-right' } })
    fireEvent.change(screen.getByLabelText('Reason for changing the result'), { target: { value: 'Idol was missed' } })
    fireEvent.click(screen.getByText('Change the result'))
    expect(posts()).toEqual([])
    fireEvent.click(screen.getByText('Confirm: vote out Rae'))
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(
      'Rae is now the one voted out. Wes is back in the game with 2 of their released players. 1 released player was already claimed by another team and stays there.',
    ))
    expect(posts()).toEqual([{ leagueId: 'L1', action: 'override_tribal', councilId: 'c1', eliminateUserId: 'u-right', notes: 'Idol was missed' }])
  })

  it('says when the right manager’s elimination did not finish', async () => {
    postReply = { ok: true, restoredPlayerIds: [], claimedElsewherePlayerIds: [], eliminationApplied: false, eliminationError: 'Link this manager to their league roster' }
    render(<SurvivorSeasonFixPanel leagueId="L1" managers={managers} week={5} merged={false} />)
    fireEvent.click(screen.getByText('Change a Tribal result'))
    fireEvent.change(await screen.findByLabelText('Manager to vote out instead'), { target: { value: 'u3' } })
    fireEvent.click(screen.getByText('Change the result'))
    fireEvent.click(screen.getByText('Confirm: vote out Cy'))
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Their elimination did not finish (Link this manager to their league roster)'))
  })

  it('with no council to change, says so and offers nothing', async () => {
    fetchMock.mockImplementation(async () => ({ ok: true, status: 200, json: async () => ({ target: null }) }))
    render(<SurvivorSeasonFixPanel leagueId="L1" managers={managers} week={5} merged={false} />)
    fireEvent.click(screen.getByText('Change a Tribal result'))
    await screen.findByText('No Tribal Council result can be changed right now.')
    expect(screen.queryByText('Change the result')).toBeNull()
  })
})

describe('Redraw the tribes', () => {
  it('posts redraw_tribes after the second tap', async () => {
    render(<SurvivorSeasonFixPanel leagueId="L1" managers={managers} week={5} merged={false} />)
    fireEvent.click(screen.getAllByText('Redraw the tribes')[0]!)
    fireEvent.click(screen.getAllByText('Redraw the tribes').at(-1)!)
    expect(posts()).toEqual([])
    fireEvent.click(screen.getByText('Confirm: redraw now'))
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('The tribes have been redrawn.'))
    expect(posts()).toEqual([{ leagueId: 'L1', action: 'redraw_tribes', notes: 'Commissioner redrew the tribes' }])
  })

  it('is not offered after the merge', () => {
    render(<SurvivorSeasonFixPanel leagueId="L1" managers={managers} week={5} merged />)
    expect(screen.queryByText('Redraw the tribes')).toBeNull()
  })
})
