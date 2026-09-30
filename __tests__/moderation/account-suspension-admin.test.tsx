/**
 * The admin half of account suspension: the route the moderation queue calls, and the queue's
 * "Suspend author" / "Ban author" buttons (lib/moderation/accountSuspension).
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NextResponse } from 'next/server'

const h = vi.hoisted(() => ({
  gate: vi.fn(),
  restrict: vi.fn(),
  lift: vi.fn(),
}))

vi.mock('@/lib/adminAuth', () => ({ requireAdmin: h.gate }))
vi.mock('@/lib/moderation/accountSuspension', () => ({ restrictAccount: h.restrict, liftAccountRestriction: h.lift }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))

import { POST } from '@/app/api/admin/moderation/users/[userId]/route'
import { ModerationQueue } from '@/app/admin/moderation/ModerationQueue'

const call = (userId: string, body: unknown) =>
  POST(new Request('http://x/api', { method: 'POST', body: JSON.stringify(body) }), { params: { userId } })

beforeEach(() => {
  vi.clearAllMocks()
  h.gate.mockResolvedValue({ ok: true, user: { id: 'admin-1' } })
  h.restrict.mockImplementation(async (i: { kind: string }) => ({ kind: i.kind, until: null, reason: null }))
  h.lift.mockResolvedValue(1)
})

describe('POST /api/admin/moderation/users/[userId]', () => {
  it('is admin-only', async () => {
    h.gate.mockResolvedValue({ ok: false, res: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) })
    const res = await call('u-bad', { action: 'ban' })
    expect(res.status).toBe(403)
    expect(h.restrict).not.toHaveBeenCalled()
  })

  it('suspends for one of the offered lengths, and bans', async () => {
    expect((await call('u-bad', { action: 'suspend', days: 7, reason: 'report r1' })).status).toBe(200)
    expect(h.restrict).toHaveBeenCalledWith({ userId: 'u-bad', kind: 'suspend', days: 7, reason: 'report r1', adminUserId: 'admin-1' })
    expect((await call('u-bad', { action: 'ban' })).status).toBe(200)
    expect(h.restrict).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'ban', days: null }))
  })

  it('refuses a length it does not offer, an unknown action, and suspending yourself', async () => {
    expect((await call('u-bad', { action: 'suspend', days: 3650 })).status).toBe(400)
    expect((await call('u-bad', { action: 'delete' })).status).toBe(400)
    expect((await call('admin-1', { action: 'ban' })).status).toBe(400)
    expect(h.restrict).not.toHaveBeenCalled()
  })

  it('lifts, and 404s an unknown user', async () => {
    expect(await (await call('u-bad', { action: 'lift' })).json()).toEqual({ ok: true, removed: 1 })
    h.restrict.mockRejectedValue(new Error('USER_NOT_FOUND'))
    expect((await call('ghost', { action: 'ban' })).status).toBe(404)
  })
})

describe('the moderation queue', () => {
  const report = {
    id: 'r1',
    status: 'pending',
    reason: 'harassment',
    createdAt: new Date().toISOString(),
    threadId: 't1',
    messageId: 'm1',
    reporter: { id: 'u-rep', username: 'rep' },
    message: {
      store: 'league',
      text: 'abuse',
      authorId: 'u-bad',
      authorUsername: 'bad',
      createdAt: new Date().toISOString(),
      deleted: false,
      removedByModeration: false,
      roomName: 'KBFL',
    },
    reportsOnMessage: 1,
  }

  afterEach(() => vi.unstubAllGlobals())

  it("suspends the message's AUTHOR after a confirm, and says so", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }))
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('confirm', vi.fn(() => true))
    render(<ModerationQueue reports={[report] as never} />)

    fireEvent.click(screen.getByRole('button', { name: 'Suspend author 7 days' }))
    await waitFor(() => expect(screen.getByTestId('author-restricted').textContent).toBe('@bad: Suspended for 7 days'))
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/moderation/users/u-bad',
      expect.objectContaining({ body: JSON.stringify({ action: 'suspend', days: 7, reason: 'report r1' }) }),
    )
  })

  it('does nothing when the confirm is declined', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('confirm', vi.fn(() => false))
    render(<ModerationQueue reports={[report] as never} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ban author' }))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('offers no author action when the message is gone (control)', () => {
    render(<ModerationQueue reports={[{ ...report, message: null }] as never} />)
    expect(screen.queryByRole('button', { name: 'Ban author' })).toBeNull()
  })
})
