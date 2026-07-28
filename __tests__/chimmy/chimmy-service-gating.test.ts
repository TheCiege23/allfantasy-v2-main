// @vitest-environment jsdom
/**
 * Gating/token certification at the client boundary. The contract work must not alter charging: a premium
 * gate or a user cancel must return WITHOUT calling the server (no server call ⇒ no token charge), and a
 * confirmed basic request proceeds normally. The server-side spend ledger is unchanged by this batch.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'

const confirmTokenSpendMock = vi.fn()
vi.mock('@/lib/tokens/client-confirm', () => ({
  confirmTokenSpend: (...args: unknown[]) => confirmTokenSpendMock(...args),
}))

import { sendChimmyMessage } from '@/lib/chimmy-chat/ChimmyChatService'

function mockJson(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: async () => payload,
    body: null,
  } as unknown as Response
}

const origFetch = global.fetch
beforeEach(() => confirmTokenSpendMock.mockReset())
afterEach(() => {
  global.fetch = origFetch
  vi.restoreAllMocks()
})

describe('client gating — no server call (no charge) on gate/cancel', () => {
  it('premium gate (cannot spend) returns upgrade WITHOUT calling the server', async () => {
    confirmTokenSpendMock.mockResolvedValue({ confirmed: false, preview: { canSpend: false } })
    const fetchMock = vi.fn()
    global.fetch = fetchMock as unknown as typeof fetch
    const r = await sendChimmyMessage({ message: 'deep analysis' }) // confirmTokenSpend defaults true
    expect(r.upgradeRequired).toBe(true)
    expect(r.meta?.variant).toBe('premium_gate')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('user cancels the spend → no server call, ok:false', async () => {
    confirmTokenSpendMock.mockResolvedValue({ confirmed: false, preview: { canSpend: true } })
    const fetchMock = vi.fn()
    global.fetch = fetchMock as unknown as typeof fetch
    const r = await sendChimmyMessage({ message: 'x' })
    expect(r.ok).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a confirmed basic request proceeds to the server exactly once', async () => {
    confirmTokenSpendMock.mockResolvedValue({ confirmed: true, preview: { canSpend: true } })
    const fetchMock = vi.fn().mockResolvedValue(mockJson({ response: 'Schedule: 3 games', meta: { schemaVersion: '1', intent: 'sports_schedule' } }))
    global.fetch = fetchMock as unknown as typeof fetch
    const r = await sendChimmyMessage({ message: 'what games are on tonight' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(r.content).toContain('Schedule')
    expect(r.meta?.intent).toBe('sports_schedule')
  })
})
