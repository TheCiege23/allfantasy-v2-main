import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { id: 'u1' } } }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/components/ui/AppModal', () => ({ AppModal: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <div>{children}</div> : null }))
vi.mock('@/app/components/PlayerImage', () => ({ PlayerImage: () => null }))
vi.mock('@/app/components/TeamLogo', () => ({ TeamLogo: () => null }))

import { ProposeTradeModal } from '@/app/league/[leagueId]/tabs/ProposeTradeModal'

const rosters = [
  { rosterId: 'r1', platformUserId: 'u1', ownerName: 'Me', wins: 0, losses: 0, canReceiveProposal: true, players: [{ id: 'p1', name: 'Alpha', position: 'RB' }], picks: [], faabRemaining: 100 },
  { rosterId: 'r2', platformUserId: 'u2', ownerName: 'Rival', wins: 0, losses: 0, canReceiveProposal: true, players: [{ id: 'p2', name: 'Beta', position: 'WR' }], picks: [], faabRemaining: 100 },
]

function setup(stale = false) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    let body: unknown
    if (url.endsWith('/rosters')) body = { rosters, viewerRosterId: 'r1', viewerTeamRosterId: 'r1' }
    else if (url.endsWith('/t1/counter') && init?.method === 'POST') body = { ok: true, tradeId: 't2' }
    else if (url.endsWith('/t1')) body = { trade: { status: 'pending', proposerRosterId: 'r2', receiverRosterId: 'r1', items: [
      { itemType: 'player', itemReference: stale ? 'missing' : 'p1', fromRosterId: 'r1', toRosterId: 'r2' },
      { itemType: 'player', itemReference: 'p2', fromRosterId: 'r2', toRosterId: 'r1' },
    ] } }
    else body = { grade: { graded: false, reason: 'Unavailable' } }
    return { ok: true, json: async () => body }
  })
  vi.stubGlobal('fetch', fetchMock)
  const onClose = vi.fn(), onSubmitted = vi.fn()
  render(<ProposeTradeModal open leagueId="league1" teams={[]} platform="allfantasy" counterTradeId="t1" onClose={onClose} onSubmitted={onSubmitted} />)
  return { fetchMock, onClose, onSubmitted }
}

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('native counteroffer builder', () => {
  it('loads the pending offer, permits edits, and posts a linked counteroffer', async () => {
    const { fetchMock, onClose, onSubmitted } = setup()
    const alpha = await screen.findByRole('checkbox', { name: /Alpha/ }) as HTMLInputElement
    expect(alpha.checked).toBe(true)
    expect((screen.getByRole('checkbox', { name: /Beta/ }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByTestId('propose-trade-partner-select') as HTMLSelectElement).disabled).toBe(true)
    const submit = screen.getByRole('button', { name: 'Send counteroffer' }) as HTMLButtonElement
    await waitFor(() => expect(submit.disabled).toBe(false))
    fireEvent.click(alpha)
    fireEvent.click(submit)
    await waitFor(() => expect(onSubmitted).toHaveBeenCalledOnce())
    expect(onClose).toHaveBeenCalledOnce()
    const call = fetchMock.mock.calls.find(([url, init]) => url.endsWith('/t1/counter') && init?.method === 'POST')
    expect(call).toBeDefined()
    const payload = JSON.parse(String(call![1]?.body))
    expect(payload.proposerRosterId).toBe('r1')
    expect(payload.receiverRosterId).toBe('r2')
    expect(payload.assets).toEqual([expect.objectContaining({ itemType: 'player', itemReference: 'p2', fromRosterId: 'r2', toRosterId: 'r1' })])
  })

  it('does not enable submission if an original asset is no longer available', async () => {
    const { fetchMock } = setup(true)
    await screen.findByText(/An original asset is unavailable/)
    expect((screen.getByRole('button', { name: 'Send counteroffer' }) as HTMLButtonElement).disabled).toBe(true)
    expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/counter'))).toBe(false)
  })
})
