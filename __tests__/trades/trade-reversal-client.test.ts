import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  describeBlocker,
  previewGenericTradeReversal,
  previewNativeTradeReversal,
  requestGenericTradeReversal,
  requestNativeTradeReversal,
} from '@/lib/trade-reversal/client'

/**
 * The browser client for both reversal endpoints. What is pinned: each helper reaches the right route
 * with the right action, and every server answer — including a dropped connection — becomes an outcome
 * the dialog can render honestly.
 */

const fetchMock = vi.fn()

function respond(status: number, body: unknown) {
  fetchMock.mockResolvedValueOnce({ status, ok: status >= 200 && status < 300, json: async () => body })
}

function sent() {
  const [url, init] = fetchMock.mock.calls[0]
  return { url, body: JSON.parse(init.body) }
}

describe('trade reversal client', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('generic preflight posts reverse_preflight to the process route, with ids encoded', async () => {
    respond(200, { readiness: { ok: true, blockers: [] } })
    const r = await previewGenericTradeReversal('league 1', 'trade/2')
    expect(sent()).toEqual({
      url: '/api/leagues/league%201/trades/trade%2F2/process',
      body: { action: 'reverse_preflight' },
    })
    expect(r).toEqual({ ok: true, readiness: { ok: true, blockers: [], drift: undefined } })
  })

  it('generic reverse posts reverse with the reason', async () => {
    respond(200, { ok: true, reversalId: 'rev-1' })
    expect(await requestGenericTradeReversal('l-1', 't-1', 'collusion')).toEqual({ ok: true })
    expect(sent()).toEqual({ url: '/api/leagues/l-1/trades/t-1/process', body: { action: 'reverse', reason: 'collusion' } })
  })

  it('native preflight and reverse post to trade-votes with the commissioner actions', async () => {
    respond(200, { readiness: { ok: false, blockers: ['NO_EXECUTION_SNAPSHOT'] } })
    const pre = await previewNativeTradeReversal('p-1')
    expect(sent()).toEqual({
      url: '/api/redraft/trade-votes',
      body: { proposalId: 'p-1', action: 'commissioner_reverse_preflight' },
    })
    expect(pre.ok && pre.readiness.blockers).toEqual(['NO_EXECUTION_SNAPSHOT'])

    fetchMock.mockReset()
    respond(200, { ok: true })
    await requestNativeTradeReversal('p-1', 'collusion')
    expect(sent()).toEqual({
      url: '/api/redraft/trade-votes',
      body: { proposalId: 'p-1', action: 'commissioner_reverse', reason: 'collusion' },
    })
  })

  it('turns a 409 refusal into an outcome carrying the readiness, and says nothing changed', async () => {
    respond(409, {
      error: 'Trade cannot be reversed',
      code: 'REVERSAL_BLOCKED',
      readiness: { ok: false, blockers: ['ROSTER_CHANGED_SINCE_EXECUTION'] },
    })
    const r = await requestGenericTradeReversal('l-1', 't-1', 'x')
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('unreachable')
    expect(r.readiness?.blockers).toEqual(['ROSTER_CHANGED_SINCE_EXECUTION'])
    expect(r.message).toMatch(/Nothing was changed\./)
  })

  it('🛑 a dropped connection does NOT claim nothing was changed', async () => {
    // The request may have committed before the connection dropped. Saying "nothing changed" would
    // invite a second attempt on a trade that is already reversed.
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const r = await requestNativeTradeReversal('p-1', 'x')
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('unreachable')
    expect(r.message).not.toMatch(/nothing was changed/i)
    expect(r.message).toMatch(/refresh/i)
    expect(r.readiness).toBeNull()
  })

  it('does not treat a 200 without ok:true as success', async () => {
    respond(200, { readiness: { ok: true, blockers: [] } })
    const r = await requestGenericTradeReversal('l-1', 't-1', 'x')
    expect(r.ok).toBe(false)
  })

  it('names a 403 as a permission problem', async () => {
    respond(403, { error: 'Commissioner access required' })
    const pre = await previewGenericTradeReversal('l-1', 't-1')
    expect(pre).toEqual({ ok: false, message: 'Only a commissioner can reverse a trade.' })
  })

  it('describes known blockers in plain language and still names unknown ones', () => {
    expect(describeBlocker('CAP_RECORD_MOVED_SINCE_EXECUTION')).toMatch(/salary/i)
    expect(describeBlocker('SOMETHING_NEW')).toContain('SOMETHING_NEW')
  })
})
