import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { LeagueLog } from '@/components/league-log/LeagueLog'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const entry = (undo?: { available: boolean; reason: string | null }) => ({
  id: 'a1', at: '2026-10-25T12:00:00Z', actor: 'Coach Dee', category: 'rosters', title: "Set Taco Tuesday's FAAB to $60", detail: null,
  raw: { actionType: 'commissioner_edit_faab', beforeState: null, afterState: null, metadata: null }, ...(undo ? { undo } : {}),
})

function stub(after: ReturnType<typeof entry>) {
  let undone = false
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      undone = true
      return { ok: true, json: async () => ({ status: 'ok' }) }
    }
    const e = undone ? after : entry({ available: true, reason: null })
    return { ok: true, json: async () => ({ canManage: true, visibility: 'league', hidden: false, entries: [e], nextCursor: null }) }
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('league log undo', () => {
  it('asks to confirm, posts the row id, then reloads without the button', async () => {
    const fetchMock = stub(entry({ available: false, reason: 'This was already undone.' }))
    render(<LeagueLog leagueId="L" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    expect(fetchMock.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === 'POST')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Confirm undo' }))
    await screen.findByText('Undone.')
    const post = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === 'POST')!
    expect(JSON.parse(String((post[1] as RequestInit).body))).toEqual({ auditId: 'a1' })
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull())
  })

  it('shows no button on a row that cannot be undone, and cancel backs out', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ canManage: true, visibility: 'league', hidden: false, entries: [entry({ available: false, reason: 'x' }), { ...entry({ available: true, reason: null }), id: 'a2' }], nextCursor: null }) })))
    render(<LeagueLog leagueId="L" />)
    expect(await screen.findAllByRole('button', { name: 'Undo' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy()
  })
})
