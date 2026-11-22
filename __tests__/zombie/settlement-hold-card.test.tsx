import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ZombieSettlementHoldCard } from '@/app/zombie/components/commissioner/ZombieSettlementHoldCard'

/** The commissioner's held-week card: the reason in words and a Retry settlement button. */

const held = { week: 6, reason: { code: 'ZOMBIE_WINNINGS_STATUS_REQUIRED', kind: 'commissioner', text: "A team's status needs fixing." }, heldAt: null }
const json = (body: unknown, status = 200) => ({ ok: status < 300, status, json: async () => body })
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn(async (_url: string, init?: { method?: string }) => (init?.method === 'POST' ? json({ ok: true, outcome: 'settled', detail: 'Week 6 settled.' }) : json({ hold: held })))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('ZombieSettlementHoldCard', () => {
  it('shows the held week and why', async () => {
    render(<ZombieSettlementHoldCard leagueId="L 1" canEdit />)
    expect(await screen.findByText('Week 6 settlement is on hold')).toBeTruthy()
    expect(screen.getByTestId('zombie-settlement-hold-reason').textContent).toBe("A team's status needs fixing.")
    expect(fetchMock.mock.calls[0][0]).toBe('/api/zombie/commissioner?leagueId=L%201&type=settlement_hold')
  })

  it('Retry settlement posts that week and reports the result', async () => {
    render(<ZombieSettlementHoldCard leagueId="L" canEdit />)
    fireEvent.click(await screen.findByTestId('zombie-settlement-retry'))
    expect(await screen.findByText('Week 6 settled.')).toBeTruthy()
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!
    expect(JSON.parse(post[1].body)).toEqual({ leagueId: 'L', action: 'retry_settlement', week: 6 })
  })

  it('held again says so with the reason', async () => {
    fetchMock.mockImplementation(async (_url: string, init?: { method?: string }) =>
      init?.method === 'POST' ? json({ ok: true, outcome: 'held_again', detail: 'Still a bad status.' }) : json({ hold: held }))
    render(<ZombieSettlementHoldCard leagueId="L" canEdit />)
    fireEvent.click(await screen.findByTestId('zombie-settlement-retry'))
    expect(await screen.findByText('Still on hold: Still a bad status.')).toBeTruthy()
  })

  it('a viewer without edit rights sees the hold but no button', async () => {
    render(<ZombieSettlementHoldCard leagueId="L" canEdit={false} />)
    await screen.findByTestId('zombie-settlement-hold')
    expect(screen.queryByTestId('zombie-settlement-retry')).toBeNull()
  })

  it('nothing held, nothing rendered', async () => {
    fetchMock.mockImplementation(async () => json({ hold: null }))
    const { container } = render(<ZombieSettlementHoldCard leagueId="L" canEdit />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(container.innerHTML).toBe('')
  })
})
