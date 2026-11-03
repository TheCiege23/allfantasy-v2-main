import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SurvivorGovernancePanel } from '@/app/league/[leagueId]/components/settings/survivor/SurvivorGovernancePanel'
import { SurvivorGovernanceCard } from '@/components/survivor/SurvivorGovernanceCard'
import { SurvivorGovernanceHubPanel } from '@/components/survivor/SurvivorGovernanceHubPanel'
import { SURVIVOR_GOVERNANCE_DEFAULTS } from '@/lib/survivor/survivorGovernanceSettings'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

afterEach(() => cleanup())

describe('league settings → Rules & Conduct', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        const patch = JSON.parse(String(init.body)).settings
        return { ok: true, json: async () => ({ ok: true, settings: { ...SURVIVOR_GOVERNANCE_DEFAULTS, ...patch } }) }
      }
      return { ok: true, json: async () => ({ settings: SURVIVOR_GOVERNANCE_DEFAULTS, locked: ['tribeSplit'], context: { currentWeek: 3, firstWeek: 1 } }) }
    })
  })

  it('saves only what changed, through the commissioner governance action', async () => {
    render(<SurvivorGovernancePanel leagueId="L1" canEdit hasAfCommissionerSub={false} />)
    await screen.findByText('Allow alliance chats')
    fireEvent.click(within(screen.getByText('Allow alliance chats').closest('div.border-b') as HTMLElement).getByRole('switch'))
    fireEvent.click(screen.getByTestId('survivor-governance-add-swap'))
    fireEvent.click(screen.getByTestId('survivor-governance-save'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/survivor/commissioner', expect.objectContaining({ method: 'POST' })))
    const body = JSON.parse(String(fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')![1].body))
    expect(body.action).toBe('governance_settings')
    expect(body.settings).toEqual({ alliancesEnabled: true, swapSchedule: [{ week: 4, mode: 'random_shuffle' }] })
    expect(await screen.findByRole('status')).toHaveTextContent('Saved.')
  })

  it('shows a locked setting as locked and disables it', async () => {
    render(<SurvivorGovernancePanel leagueId="L1" canEdit hasAfCommissionerSub={false} />)
    expect(await screen.findByTestId('survivor-governance-split-locked')).toBeInTheDocument()
  })

  it('read-only when the viewer cannot edit', async () => {
    render(<SurvivorGovernancePanel leagueId="L1" canEdit={false} hasAfCommissionerSub={false} />)
    await screen.findByText('Allow alliance chats')
    expect(screen.getByTestId('survivor-governance-save')).toBeDisabled()
  })
})

describe('the castaway card', () => {
  beforeEach(() => fetchMock.mockReset())

  it('renders nothing for a league that uses none of it', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ rules: { tradeRulesEnabled: false, alliancesEnabled: false, strikeLimit: 2, allianceMaxSize: 4 }, tradeWindow: null, me: null, myStrikes: [], alliances: [], inviteable: [] }) })
    const { container } = render(<SurvivorGovernanceCard leagueId="L1" />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('shows my strikes and lets me form an alliance', async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => init?.method === 'POST'
      ? { ok: true, json: async () => ({ ok: true }) }
      : { ok: true, json: async () => ({
        rules: { tradeRulesEnabled: true, alliancesEnabled: true, strikeLimit: 2, allianceMaxSize: 3 },
        tradeWindow: { crossTribeOpen: false, crossTribeClosesAt: null, frozen: false },
        me: { playerState: 'active', canFormAlliance: true },
        myStrikes: [{ id: 's1', reason: 'Insults in league chat' }],
        alliances: [],
        inviteable: [{ userId: 'u2', displayName: 'Ben' }, { userId: 'u3', displayName: 'Cy' }],
      }) })
    render(<SurvivorGovernanceCard leagueId="L1" />)
    expect(await screen.findByTestId('survivor-governance-card-strikes')).toHaveTextContent('1 of 2 conduct strike')
    expect(screen.getByText('Insults in league chat')).toBeInTheDocument()
    expect(screen.getByTestId('survivor-governance-card-trades')).toHaveTextContent('closed until after Tribal Council')
    fireEvent.change(screen.getByLabelText('Alliance name'), { target: { value: 'The Core' } })
    fireEvent.click(screen.getByLabelText('Ben'))
    fireEvent.click(screen.getByTestId('survivor-governance-create-alliance'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/survivor/governance', expect.objectContaining({ method: 'POST' })))
    const body = JSON.parse(String(fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')![1].body))
    expect(body).toEqual({ leagueId: 'L1', action: 'alliance_create', name: 'The Core', memberUserIds: ['u2'] })
  })
})

describe('Commissioner Hub → Rules & conduct', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => init?.method === 'POST'
      ? { ok: true, json: async () => ({ ok: true, activeStrikes: 1, limit: 2, limitReached: false, removed: false }) }
      : { ok: true, json: async () => ({
        settings: SURVIVOR_GOVERNANCE_DEFAULTS,
        castaways: [{ userId: 'u1', displayName: 'Ana', playerState: 'active', strikes: [], experience: { experience: 'rookie', source: 'default' } }],
        tradeWindow: null,
        context: { merged: false },
      }) })
  })

  it('issues a strike with the reason', async () => {
    render(<SurvivorGovernanceHubPanel leagueId="L1" />)
    const reason = await screen.findByLabelText('Reason the castaway will see: Ana')
    expect(screen.getByTestId('survivor-governance-strike-u1')).toBeDisabled()
    fireEvent.change(reason, { target: { value: 'Harassment in chat' } })
    fireEvent.click(screen.getByTestId('survivor-governance-strike-u1'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/survivor/commissioner', expect.objectContaining({ method: 'POST' })))
    const body = JSON.parse(String(fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')![1].body))
    expect(body).toEqual({ leagueId: 'L1', action: 'issue_strike', userId: 'u1', reason: 'Harassment in chat' })
    expect(await screen.findByRole('status')).toHaveTextContent('Strike 1 of 2 issued.')
  })

  it('seals a 2 → 3 swap', async () => {
    render(<SurvivorGovernanceHubPanel leagueId="L1" />)
    fireEvent.click(await screen.findByTestId('survivor-governance-swap-now'))
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true))
    const body = JSON.parse(String(fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')![1].body))
    expect(body).toEqual({ leagueId: 'L1', action: 'swap_now', swap: { mode: 'resize', tribeCount: 3 } })
  })
})
