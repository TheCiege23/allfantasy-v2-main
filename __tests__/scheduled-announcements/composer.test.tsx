import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'

/** The announcement composer's Schedule mode. `fetch` is the only seam. */

import CommissionerBroadcastForm, { toLocalInputValue } from '@/components/chat/CommissionerBroadcastForm'

type Call = { url: string; method: string; body: unknown }
let calls: Call[]
let scheduled: Array<Record<string, unknown>>

beforeEach(() => {
  calls = []
  scheduled = [{ id: 'p1', message: 'Keepers due Friday', sendAt: '2026-10-24T22:00:00.000Z', status: 'pending' },
    { id: 'f1', message: 'Old note', sendAt: '2026-10-01T22:00:00.000Z', status: 'failed', reason: 'Whoever scheduled it can no longer send announcements here' }]
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null })
    const reply = (body: unknown, status = 200) => ({ ok: status < 300, status, json: async () => body })
    if (url === '/api/commissioner/leagues') return reply({ leagues: [{ id: 'L1', isNative: true }] })
    if (url.includes('scheduled-announcements')) {
      if (method === 'GET') return reply({ announcements: scheduled })
      if (method === 'POST') {
        const b = JSON.parse(String(init?.body))
        const row = { id: 'n1', message: b.message, sendAt: b.sendAt, status: 'pending' }
        scheduled = [row, ...scheduled]
        return reply({ announcement: row })
      }
      if (method === 'DELETE') {
        scheduled = scheduled.map((s) => (s.id === 'p1' ? { ...s, status: 'cancelled' } : s))
        return reply({ cancelled: true })
      }
    }
    return reply({ ok: true, results: [{ leagueId: 'L1', sent: true }] })
  }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('CommissionerBroadcastForm — Schedule', () => {
  it('lists waiting and failed posts, with the failure reason', async () => {
    const r = render(<CommissionerBroadcastForm leagueId="L1" />)
    await waitFor(() => expect(r.getAllByTestId('commissioner-announcement-scheduled-row')).toHaveLength(2))
    expect(r.getByTestId('commissioner-announcement-scheduled').textContent).toContain('Keepers due Friday')
    expect(r.getByTestId('commissioner-announcement-scheduled').textContent).toContain('can no longer send')
    expect(r.getAllByRole('button', { name: 'Cancel' })).toHaveLength(1) // only the pending one
  })

  it('Schedule sends the message and the picked local time as ISO — not to the send-now route', async () => {
    const r = render(<CommissionerBroadcastForm leagueId="L1" />)
    await r.findByTestId('commissioner-announcement-input')
    fireEvent.change(r.getByTestId('commissioner-announcement-input'), { target: { value: 'Draft is Sunday 7pm' } })
    fireEvent.click(r.getByTestId('commissioner-announcement-when-later'))
    const send = r.getByTestId('commissioner-announcement-send') as HTMLButtonElement
    expect(send.disabled).toBe(true) // no time picked yet
    const local = '2026-10-26T19:00'
    fireEvent.change(r.getByTestId('commissioner-announcement-send-at'), { target: { value: local } })
    expect(send.textContent).toContain('Schedule @everyone')
    fireEvent.click(send)
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true))
    const post = calls.find((c) => c.method === 'POST')!
    expect(post.url).toBe('/api/commissioner/leagues/L1/scheduled-announcements')
    expect(post.body).toEqual({ message: 'Draft is Sunday 7pm', sendAt: new Date(local).toISOString() })
    expect(calls.some((c) => c.url === '/api/commissioner/broadcast')).toBe(false)
    await r.findByText(/It posts within 15 minutes of that time/)
  })

  it('Send now still posts straight away', async () => {
    const r = render(<CommissionerBroadcastForm leagueId="L1" />)
    await r.findByTestId('commissioner-announcement-input')
    fireEvent.change(r.getByTestId('commissioner-announcement-input'), { target: { value: 'Now please' } })
    fireEvent.click(r.getByTestId('commissioner-announcement-send'))
    await waitFor(() => expect(calls.some((c) => c.url === '/api/commissioner/broadcast')).toBe(true))
    expect(calls.some((c) => c.method === 'POST' && c.url.includes('scheduled'))).toBe(false)
  })

  it('Cancel deletes that post and refreshes the list', async () => {
    const r = render(<CommissionerBroadcastForm leagueId="L1" />)
    fireEvent.click(await r.findByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.url.endsWith('?id=p1'))).toBe(true))
    await waitFor(() => expect(r.queryAllByRole('button', { name: 'Cancel' })).toHaveLength(0))
  })

  it('toLocalInputValue round-trips through the browser’s own parsing', () => {
    const d = new Date(2026, 9, 26, 19, 5)
    expect(toLocalInputValue(d)).toBe('2026-10-26T19:05')
    expect(new Date(toLocalInputValue(d)).getTime()).toBe(d.getTime())
  })
})
