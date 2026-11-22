import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AskChimmyCard } from '@/app/survivor/components/chimmy/AskChimmyCard'

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ reply: '**Voting**\n• Vote privately.' }) }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('AskChimmyCard', () => {
  it('asks a starter question privately and shows the answer without markdown stars', async () => {
    render(<AskChimmyCard leagueId="L1" />)
    fireEvent.click(screen.getByText('How does voting work?'))
    await waitFor(() => expect(screen.getByText(/Vote privately/)).toBeTruthy())
    expect(screen.queryByText(/\*\*/)).toBeNull()
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ leagueId: 'L1', message: 'How does voting work?' })
    expect(fetchMock.mock.calls[0][0]).toBe('/api/survivor/chimmy')
  })

  it('sends a typed question and shows an error when Chimmy cannot answer', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({ error: 'Forbidden' }) })
    render(<AskChimmyCard leagueId="L1" />)
    fireEvent.change(screen.getByLabelText('Ask Chimmy a question'), { target: { value: 'When is the merge?' } })
    fireEvent.click(screen.getByText('Ask'))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Forbidden'))
  })
})
