import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SurvivorTribalPanel } from '@/app/league/[leagueId]/components/settings/survivor/SurvivorTribalPanel'
import { SurvivorExilePanel } from '@/app/league/[leagueId]/components/settings/survivor/SurvivorExilePanel'
import { SurvivorIdolsPanel } from '@/app/league/[leagueId]/components/settings/survivor/SurvivorIdolsPanel'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

const foundation = {
  tribalCouncilDay: 'Tuesday', tribalCouncilTime: '20:00', voteCloseOffset: 24,
  selfVotesAllowed: false, lateVotesAllowed: false, voteChangePolicy: 'first_valid_locks',
  exileIslandEnabled: true, exileReturnWeek: 10, exileReturnTokens: 4,
}

describe('Survivor commissioner settings panels', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/survivor/config')) return { ok: true, json: async () => ({ config: { idolCount: 8, idolPowerPool: null } }) }
      if (init?.method === 'POST') {
        const patch = JSON.parse(String(init.body)).settings
        return { ok: true, json: async () => ({ settings: { ...foundation, ...patch } }) }
      }
      return { ok: true, json: async () => ({ settings: foundation }) }
    })
  })
  afterEach(() => cleanup())

  it('saves council voting and ceremony rules to the foundation API', async () => {
    render(<SurvivorTribalPanel leagueId="nba-1" canEdit hasAfCommissionerSub={false} />)
    await screen.findByText('Private voting')
    fireEvent.click(screen.getAllByRole('switch')[0])
    fireEvent.click(screen.getByRole('button', { name: 'Save council rules' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/leagues/nba-1/survivor/update-settings', expect.objectContaining({ method: 'POST' })))
    const call = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')
    expect(JSON.parse(String(call?.[1]?.body)).settings).toEqual(expect.objectContaining({ selfVotesAllowed: true, tribalCouncilDay: 'Tuesday', tribalCouncilTime: '20:00' }))
  })

  it('saves Exile return rules and never offers the unfinished boss controls', async () => {
    render(<SurvivorExilePanel leagueId="nba-1" canEdit hasAfCommissionerSub={false} />)
    await screen.findByText('Exile return')
    expect(screen.queryByText('Boss reset')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save Exile rules' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/leagues/nba-1/survivor/update-settings', expect.objectContaining({ method: 'POST' })))
    const call = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')
    expect(JSON.parse(String(call?.[1]?.body)).settings).toEqual({ exileIslandEnabled: true, exileReturnWeek: 10, exileReturnTokens: 4 })
  })

  it('shows the idol configuration without fake editable switches', async () => {
    render(<SurvivorIdolsPanel leagueId="nba-1" canEdit hasAfCommissionerSub={false} />)
    await screen.findByText('Configured idol count')
    expect(screen.getByText('8')).toBeInTheDocument()
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
  })
})
