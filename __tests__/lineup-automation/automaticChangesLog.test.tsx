// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AutomaticChangesLog } from '@/components/league/AutomaticChangesLog'

const ROWS = [
  { id: 'a2', rosterId: 'r1', teamName: 'Owner FC', at: '2026-10-28T12:00:00Z', message: 'Started qb2.', undoable: true, undone: false },
  { id: 'a1', rosterId: 'r1', teamName: 'Owner FC', at: '2026-10-21T12:00:00Z', message: 'Benched a bye.', undoable: false, undone: false },
]

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('AutomaticChangesLog', () => {
  it('offers Undo only where the server says it is safe, and sends just the change id', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      if (init?.method === 'POST') return new Response(JSON.stringify({ ok: true }), { status: 200 })
      return new Response(JSON.stringify({ rows: calls.some((c) => c.init?.method === 'POST') ? [{ ...ROWS[0], undoable: false, undone: true }, ROWS[1]] : ROWS, commissioner: false }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const onUndone = vi.fn()
    render(<AutomaticChangesLog leagueId="L1" onUndone={onUndone} />)
    await screen.findByTestId('automatic-change-a2')
    expect(screen.getByTestId('undo-a2')).toBeInTheDocument()
    expect(screen.queryByTestId('undo-a1')).toBeNull()
    fireEvent.click(screen.getByTestId('undo-a2'))
    await waitFor(() => expect(onUndone).toHaveBeenCalled())
    const post = calls.find((c) => c.init?.method === 'POST')!
    expect(post.url).toBe('/api/leagues/L1/automatic-changes')
    expect(JSON.parse(String(post.init!.body))).toEqual({ auditId: 'a2' })
    await screen.findByText('Undone')
  })

  it('shows nothing when there are no automatic changes', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ rows: [], commissioner: false }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { container } = render(<AutomaticChangesLog leagueId="L1" />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(container.innerHTML).toBe('')
  })
})
