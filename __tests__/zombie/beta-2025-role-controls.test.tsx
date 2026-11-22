import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ZombieRoleActions } from '@/components/zombie/ZombieRoleActions'

const response = (body: unknown, ok = true) => ({ ok, json: async () => body })
const offer = { id: 'offer-1', kind: 'initial_offer', status: 'pending', week: null, deadlineAt: '2099-01-01T00:00:00Z', canRespond: true, choices: ['accept', 'decline'], offerIndex: 0 }
const base = { supported: true, owner: false, canStartDraw: false, canAmbush: false, workflows: [] as unknown[] }
let pack: typeof base
let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  pack = { ...base, workflows: [] }
  fetchMock = vi.fn(async () => response(pack))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('combat and Whisperer controls', () => {
  it('requires saving edited veteran eligibility before beginning offers', async () => {
    const setup = { ...base, owner: true, canStartDraw: true, nominees: [{ id: 'returning', name: 'Returning manager', veteran: false }] }
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => response(init?.method === 'POST' ? { ok: true } : setup))
    render(<ZombieRoleActions leagueId="L" />)
    const start = await screen.findByRole('button', { name: 'Start Whisperer offers' })
    fireEvent.click(screen.getByText('Review returning-manager eligibility'))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Returning manager' }))
    expect(start).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Historical review reason'), { target: { value: 'Verified a complete prior universe year' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save eligibility review' }))
    await waitFor(() => expect(start).not.toBeDisabled())
    const body = JSON.parse(fetchMock.mock.calls.find(call => call[1]?.method === 'POST')![1].body)
    expect(body).toEqual({ leagueId: 'L', action: 'eligibility', veteranUserIds: ['returning'], reason: 'Verified a complete prior universe year' })
  })
  it('accepts the exact reviewed offer and refreshes the league only after success', async () => {
    pack.workflows = [offer]
    const changed = vi.fn()
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') { pack = { ...pack, workflows: [] }; return response({ ok: true }) }
      return response(pack)
    })
    render(<ZombieRoleActions leagueId="L" onChanged={changed} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Accept role' }))
    await waitFor(() => expect(changed).toHaveBeenCalledTimes(1))
    const body = JSON.parse(fetchMock.mock.calls.find(call => call[1]?.method === 'POST')![1].body)
    expect(body).toEqual({ leagueId: 'L', workflowId: 'offer-1', decision: 'accept', offerIndex: 0 })
    expect(screen.getByRole('status')).toHaveTextContent('Saved')
  })
  it('shows a rejected response without pretending the role changed', async () => {
    pack.workflows = [offer]
    const changed = vi.fn()
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => response(init?.method === 'POST' ? { error: 'This offer expired.' } : pack, init?.method !== 'POST'))
    render(<ZombieRoleActions leagueId="L" onChanged={changed} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Accept role' }))
    expect(await screen.findByRole('status')).toHaveTextContent('expired')
    expect(changed).not.toHaveBeenCalled()
  })
  it('disables expired decisions and explains malformed successful responses', async () => {
    pack.workflows = [{ ...offer, deadlineAt: '2000-01-01Z' }]
    const { unmount } = render(<ZombieRoleActions leagueId="L" />)
    expect(await screen.findByRole('button', { name: 'Accept role' })).toBeDisabled()
    unmount()
    fetchMock.mockResolvedValue(response({}))
    render(<ZombieRoleActions leagueId="B" />)
    expect(await screen.findByRole('status')).toHaveTextContent('incomplete response')
    expect(screen.getByRole('button', { name: 'Refresh decisions' })).toBeEnabled()
  })
  it('preserves locked matchups and reuses the request ID after an uncertain network result', async () => {
    pack.canAmbush = true
    let attempts = 0
    const submissions: Record<string, unknown>[] = []
    const preview = { week: 3, previewHash: 'a'.repeat(64), remaining: 2, matches: [
      { id: 'm1', homeRosterId: 'a', awayRosterId: 'b', homeName: 'A', awayName: 'B', locked: true },
      { id: 'm2', homeRosterId: 'c', awayRosterId: 'd', homeName: 'C', awayName: 'D', locked: false },
      { id: 'm3', homeRosterId: 'e', awayRosterId: 'f', homeName: 'E', awayName: 'F', locked: false },
    ] }
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes('/ambush') && init?.method === 'POST') {
        submissions.push(JSON.parse(String(init.body)))
        if (++attempts === 1) throw new Error('Connection interrupted; retry the same plan.')
        pack.canAmbush = false
        return response({ actionId: 'saved', scoreRefreshPending: true })
      }
      return response(url.includes('/ambush') ? preview : pack)
    })
    render(<ZombieRoleActions leagueId="L" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Review ambush matchups' }))
    expect(await screen.findByRole('combobox', { name: 'Matchup 1 home' })).toBeDisabled()
    fireEvent.change(screen.getByRole('combobox', { name: 'Matchup 2 home' }), { target: { value: 'e' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm remap · use 1 ambush' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Connection interrupted'))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm remap · use 1 ambush' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('spent only once'))
    expect(submissions).toHaveLength(2)
    expect(submissions[0]).toEqual(submissions[1])
    const pairs = submissions[0].pairs as Array<{ homeRosterId: string; awayRosterId: string }>
    expect(pairs[0]).toEqual({ homeRosterId: 'a', awayRosterId: 'b' })
    expect(new Set(pairs.flatMap(p => [p.homeRosterId, p.awayRosterId])).size).toBe(6)
  })
  it('does not apply a late response from another league', async () => {
    let resolveA!: (value: unknown) => void
    fetchMock.mockImplementation((url: string) => url.includes('leagueId=A') ? new Promise(resolve => { resolveA = resolve }) : Promise.resolve(response({ ...base, workflows: [{ ...offer, kind: 'survivor_bash', choices: ['spare', 'infect'] }] })))
    const { rerender } = render(<ZombieRoleActions leagueId="A" />)
    rerender(<ZombieRoleActions leagueId="B" />)
    await screen.findByRole('heading', { name: 'You bashed a Survivor' })
    await act(async () => { resolveA(response({ ...base, workflows: [offer] })) })
    expect(screen.queryByRole('heading', { name: 'Whisperer offer' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'You bashed a Survivor' })).toBeInTheDocument()
  })
})
