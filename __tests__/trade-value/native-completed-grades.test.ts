/**
 * A completed AllFantasy trade has ONE grade per team (Trade OS, 2026-11-16): its proposal receipt — the Trade
 * Center's "Then" letter — when it graded every team; otherwise a frozen completed original, loaded through the
 * one trade loader and graded through the shared batch helper. Never two "originals" for one trade.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/decision-os/trade/evaluateStoredTrade', () => ({
  gradeInputsOf: (assets: Array<{ kind: string; name?: string }>) => ({ assets: assets.map((a) => ({ kind: 'player', name: a.name })), unpriceable: [] }),
}))
vi.mock('@/lib/decision-os/trade/loadTrade', () => ({ loadTrade: vi.fn() }))
vi.mock('@/lib/decision-os/trade/completedTradeOriginals', () => ({ gradeCompletedTradesWithOriginals: vi.fn() }))

import { gradeNativeCompletedTrades } from '@/lib/decision-os/trade/nativeCompletedGrades'

const loaded = (id: string, status = 'completed') => ({
  ok: true,
  trade: {
    id,
    status,
    completedAt: '2026-10-12T15:00:00.000Z',
    sideA: { teamId: 'r-a', rosterId: 'r-a', gives: [{ kind: 'player', name: 'Davante' }] },
    sideB: { teamId: 'r-b', rosterId: 'r-b', gives: [{ kind: 'player', name: 'Puka' }] },
  },
  viewer: { side: null, isCommissioner: false },
})

let load: ReturnType<typeof vi.fn>
let gradeAll: ReturnType<typeof vi.fn>
let receipts: ReturnType<typeof vi.fn>
const teamsOf = () => ['r-a', 'r-b']

beforeEach(() => {
  load = vi.fn(async ({ ref }: { ref: { tradeId: string } }) =>
    ref.tradeId === 'pending' ? loaded('pending', 'proposed') : ref.tradeId === 'gone' ? { ok: false, refusal: { code: 'not_found' } } : loaded(ref.tradeId),
  )
  gradeAll = vi.fn(async ({ deals }: { deals: Array<{ tradeId: string }> }) =>
    new Map(deals.map((d) => [d.tradeId, { graded: true, letter: 'A', partnerLetter: 'C', frozenAt: '2026-11-16T00:00:00.000Z', frozenBasis: 'first_graded', pricedAsOf: '2026-11-16T00:00:00.000Z', tradeAt: null }])),
  )
  receipts = vi.fn(async () => new Map())
})

const run = (tradeIds: string[]) =>
  gradeNativeCompletedTrades({ leagueId: 'L', userId: 'u', tradeIds, teamsOf }, { load: load as never, gradeAll: gradeAll as never, receipts: receipts as never })

describe('gradeNativeCompletedTrades', () => {
  it('🛑 uses the proposal receipt — the Trade Center’s "Then" — and freezes no second original', async () => {
    receipts.mockResolvedValue(new Map([['t1', { capturedAt: '2026-10-10T18:00:00.000Z', lettersByRoster: { 'r-a': 'B+', 'r-b': 'C' } }]]))
    const out = await run(['t1'])
    expect(out.get('t1')).toEqual({ graded: true, lettersByRoster: { 'r-a': 'B+', 'r-b': 'C' }, moment: 'when it was proposed (Oct 10)', basis: 'proposal_receipt' })
    expect(load).not.toHaveBeenCalled()
    expect(gradeAll).not.toHaveBeenCalled()
  })

  it('a receipt missing a team’s letter is not the grade; the trade gets a frozen completed original', async () => {
    receipts.mockResolvedValue(new Map([['t1', { capturedAt: '2026-10-10T18:00:00.000Z', lettersByRoster: { 'r-a': 'B+' } }]]))
    const out = await run(['t1'])
    expect(out.get('t1')).toMatchObject({ graded: true, lettersByRoster: { 'r-a': 'A', 'r-b': 'C' }, basis: 'completed_original' })
  })

  it('a trade older than receipts is loaded through the one loader and only completed ones are graded', async () => {
    const out = await run(['t1', 'pending', 'gone', 't1'])
    expect(load).toHaveBeenCalledWith({ leagueId: 'L', ref: { kind: 'af', tradeId: 't1' }, userId: 'u' })
    expect(load).toHaveBeenCalledTimes(3) // de-duplicated
    expect(gradeAll.mock.calls[0]![0]).toEqual({
      afLeagueId: 'L',
      deals: [
        {
          tradeId: 't1',
          inputs: { give: { assets: [{ kind: 'player', name: 'Davante' }], unpriceable: [] }, get: { assets: [{ kind: 'player', name: 'Puka' }], unpriceable: [] } },
          completedAt: '2026-10-12T15:00:00.000Z',
        },
      ],
    })
    expect(out.get('t1')).toMatchObject({ graded: true, lettersByRoster: { 'r-a': 'A', 'r-b': 'C' } })
    expect(out.has('pending')).toBe(false)
  })

  it('an unreadable receipt table falls through to the original; a grading failure leaves the trade ungraded', async () => {
    receipts.mockRejectedValue(new Error('down'))
    expect((await run(['t1'])).get('t1')).toMatchObject({ basis: 'completed_original' })
    gradeAll.mockRejectedValue(new Error('down'))
    expect((await run(['t1'])).size).toBe(0)
  })

  it('a withheld grade carries its reason, never a letter', async () => {
    gradeAll.mockResolvedValue(new Map([['t1', { graded: false, reason: 'an asset has no value yet', basis: null }]]))
    expect((await run(['t1'])).get('t1')).toEqual({ graded: false, reason: 'an asset has no value yet' })
  })
})
