import React from 'react'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SurvivorIdolRevealModal } from '@/components/survivor/SurvivorIdolRevealModal'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const reveals = [
  { messageId: 'm1', playerName: 'LeBron James', playerImageUrl: null, idolTypeId: 'immunity', idolLabel: 'Immunity idol', idolDescription: 'Votes against you do not count.', expiryText: 'Play it before the merge.', foundInDraft: true, message: '…' },
  { messageId: 'm2', playerName: 'Jalen Green', playerImageUrl: null, idolTypeId: 'vote-steal', idolLabel: 'Vote steal', idolDescription: null, expiryText: null, foundInDraft: false, message: '…' },
]

describe('idol reveal popup', () => {
  it('shows each unread reveal in turn with the player, idol, rule, and expiry, acknowledging on Got it', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => ({ ok: true, json: async () => (init?.method === 'POST' ? { ok: true } : { reveals }) }))
    vi.stubGlobal('fetch', fetchMock)
    render(<SurvivorIdolRevealModal leagueId="lg" />)
    const dialog = await screen.findByTestId('survivor-idol-reveal')
    expect(dialog).toHaveTextContent('Found in the draft')
    expect(screen.getByRole('heading', { name: 'Immunity idol' })).toBeTruthy()
    expect(dialog).toHaveTextContent('LeBron James')
    expect(screen.getByTestId('svr-expiry')).toHaveTextContent('Play it before the merge.')
    expect(dialog).toHaveTextContent('1 more to see')
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({ messageId: 'm1' })
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Vote steal' })).toBeTruthy())
    expect(screen.getByTestId('survivor-idol-reveal')).toHaveTextContent('A hidden idol is yours')
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
    await waitFor(() => expect(screen.queryByTestId('survivor-idol-reveal')).toBeNull())
  })

  it('renders nothing when there is nothing unread', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ reveals: [] }) })))
    render(<SurvivorIdolRevealModal leagueId="lg" />)
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled())
    expect(screen.queryByTestId('survivor-idol-reveal')).toBeNull()
  })
})
