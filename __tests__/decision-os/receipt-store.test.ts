/**
 * ONE receipt table (2026-09-26): `evaluateTrade()` receipts live in `trade_decision_snapshots`.
 * A proposal's receipt rides in its own trade row; an evaluation that is not a trade gets a row with
 * `tradeId` NULL. And none of it may write a column an unmigrated database lacks.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import {
  adHocSnapshotData,
  RECEIPT_REUSE_WINDOW_MS,
  receiptColumns,
  receiptContentHash,
  receiptColumnsReady,
  resetReceiptColumnsCache,
  saveAdHocReceipt,
} from '@/lib/decision-os/trade/receiptStore'
import type { TradeEvaluationReceipt } from '@/lib/decision-os/trade/evaluateTrade'
import { writeTradeDecisionSnapshot, type TradeDecisionSnapshotPayload } from '@/lib/league-trade-engine/tradeDecisionSnapshot'

const RECEIPT = {
  receiptId: null,
  persisted: false,
  persistError: null,
  modelVersion: 'trade-eval-v1',
  surface: 'trade-evaluator',
  evaluatedAt: '2026-09-26T12:00:00.000Z',
  inputHash: 'a'.repeat(64),
  leagueId: 'l1',
  userId: 'u1',
  grade: {
    graded: false,
    reason: 'Nobody Special could not be found.',
    basis: null,
    leagueType: { type: 'dynasty', label: 'Dynasty', source: 'platform', platform: 'sleeper' },
  },
  partnerGrade: { graded: false, reason: 'Nobody Special could not be found.', basis: null },
  assets: [{ side: 'give', name: 'Nobody Special', kind: 'player', marketValue: null, leagueValue: null, source: null, adjustments: [] }],
  unpriceable: [],
  canonical: null,
  canonicalError: null,
} as unknown as TradeEvaluationReceipt

describe('receiptColumnsReady — the gate that keeps unmigrated databases safe', () => {
  beforeEach(() => resetReceiptColumnsCache())

  it('is false until the columns exist, re-asks after 10 minutes, and stays true once true', async () => {
    let t = 0
    const probe = vi.fn(async () => false)
    expect(await receiptColumnsReady({ probe, now: () => t })).toBe(false)
    t = 60_000
    expect(await receiptColumnsReady({ probe, now: () => t })).toBe(false)
    expect(probe).toHaveBeenCalledTimes(1) // cached inside the window
    t = 10 * 60_000 + 1
    probe.mockResolvedValue(true)
    expect(await receiptColumnsReady({ probe, now: () => t })).toBe(true)
    probe.mockResolvedValue(false)
    expect(await receiptColumnsReady({ probe, now: () => t + 99 * 60_000 })).toBe(true)
    expect(probe).toHaveBeenCalledTimes(2)
  })

  it('a probe that throws is "not ready", never a thrown request', async () => {
    const probe = vi.fn(() => {
      throw new Error('no $queryRaw')
    }) as unknown as () => Promise<boolean>
    expect(await receiptColumnsReady({ probe, now: () => 0 })).toBe(false)
  })
})

describe('an evaluation that is not a trade', () => {
  it('is a row with NO tradeId, so no trade screen (all of which select by tradeId) can show it', () => {
    const row = adHocSnapshotData(RECEIPT)
    expect(row).toMatchObject({
      tradeId: null,
      leagueId: 'l1',
      proposedByUserId: 'u1',
      policyVersion: 'trade-eval-v1',
      format: 'dynasty',
      surface: 'trade-evaluator',
      inputHash: 'a'.repeat(64),
      completeness: 'partial',
      readiness: { graded: false, withheldReason: 'Nobody Special could not be found.' },
      rosterContext: { captured: false },
      capturedAt: new Date('2026-09-26T12:00:00.000Z'),
    })
    expect(row.evaluationReceipt).toEqual(JSON.parse(JSON.stringify(RECEIPT)))
  })

  it('is refused — not written — while the database is unmigrated', async () => {
    const create = vi.fn()
    await expect(saveAdHocReceipt(RECEIPT, { ready: async () => false, store: () => ({ create }) })).rejects.toThrow(/not migrated/)
    expect(create).not.toHaveBeenCalled()
  })

  it('once migrated, writes one row and asks for only its id back', async () => {
    const create = vi.fn(async () => ({ id: 'snap_1' }))
    expect(await saveAdHocReceipt(RECEIPT, { ready: async () => true, store: () => ({ create }) })).toEqual({ id: 'snap_1' })
    expect(create).toHaveBeenCalledTimes(1)
    expect(create.mock.calls[0]![0]).toMatchObject({ select: { id: true }, data: { tradeId: null, surface: 'trade-evaluator' } })
  })
})

describe('an identical evaluation reuses its receipt instead of writing a new row', () => {
  // List screens grade every row on every view; without reuse each page load adds a row per trade.
  const NOW = Date.parse('2026-09-27T12:00:00.000Z')
  const ready = async () => true
  const later = { ...RECEIPT, evaluatedAt: '2026-09-27T11:00:00.000Z' } as TradeEvaluationReceipt

  it('the fingerprint ignores bookkeeping (id, save status, time) and nothing else', () => {
    expect(receiptContentHash(later)).toBe(receiptContentHash(RECEIPT))
    expect(receiptContentHash({ ...RECEIPT, receiptId: 'x', persisted: true } as TradeEvaluationReceipt)).toBe(receiptContentHash(RECEIPT))
    expect(receiptContentHash({ ...RECEIPT, userId: 'u2' } as TradeEvaluationReceipt)).not.toBe(receiptContentHash(RECEIPT))
    expect(adHocSnapshotData(RECEIPT).evidence.contentHash).toBe(receiptContentHash(RECEIPT))
  })

  it('same surface, viewer, league, inputs and content within the window: the old id, no write', async () => {
    const create = vi.fn()
    const findFirst = vi.fn(async () => ({ id: 'snap_old', evidence: { contentHash: receiptContentHash(RECEIPT) } }))
    expect(await saveAdHocReceipt(later, { ready, store: () => ({ create, findFirst }), now: () => NOW })).toEqual({ id: 'snap_old' })
    expect(create).not.toHaveBeenCalled()
    const args = findFirst.mock.calls[0]![0] as { where: Record<string, unknown>; select: unknown }
    expect(args.where).toMatchObject({ inputHash: RECEIPT.inputHash, surface: 'trade-evaluator', proposedByUserId: 'u1', leagueId: 'l1', tradeId: null })
    expect(args.where.capturedAt).toEqual({ gte: new Date(NOW - RECEIPT_REUSE_WINDOW_MS) })
    expect(args.select).toEqual({ id: true, evidence: true })
  })

  it('different content (a grade that moved): a new row', async () => {
    const create = vi.fn(async () => ({ id: 'snap_new' }))
    const findFirst = vi.fn(async () => ({ id: 'snap_old', evidence: { contentHash: 'something else' } }))
    expect(await saveAdHocReceipt(later, { ready, store: () => ({ create, findFirst }), now: () => NOW })).toEqual({ id: 'snap_new' })
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('a lookup that fails still writes — reuse is an optimisation, never a reason to lose the receipt', async () => {
    const create = vi.fn(async () => ({ id: 'snap_new' }))
    const findFirst = vi.fn(async () => { throw new Error('boom') })
    expect(await saveAdHocReceipt(later, { ready, store: () => ({ create, findFirst }), now: () => NOW })).toEqual({ id: 'snap_new' })
  })

  it('no lookup at all while unmigrated', async () => {
    const findFirst = vi.fn()
    await expect(saveAdHocReceipt(RECEIPT, { ready: async () => false, store: () => ({ create: vi.fn(), findFirst }) })).rejects.toThrow(/not migrated/)
    expect(findFirst).not.toHaveBeenCalled()
  })
})

describe("a proposal's receipt rides in its own trade row", () => {
  const snapshot = {
    policyVersion: 'p',
    format: 'dynasty',
    leagueContext: {},
    rosterContext: {},
    assetContext: {},
    managerContext: {},
    outcomeSimulation: null,
    decisionResult: null,
    evidence: {},
    readiness: {},
    completeness: 'partial',
  } as unknown as TradeDecisionSnapshotPayload

  it('with the receipt: one row carrying surface, hash and receipt', async () => {
    const create = vi.fn(async () => ({ id: 's' }))
    await writeTradeDecisionSnapshot({ tradeDecisionSnapshot: { create } } as never, {
      tradeId: 't1', leagueId: 'l1', proposedByUserId: 'u1', snapshot, receipt: receiptColumns({ ...RECEIPT, surface: 'proposal' }),
    })
    expect(create).toHaveBeenCalledTimes(1)
    expect(create.mock.calls[0]![0]).toMatchObject({
      select: { id: true },
      data: { tradeId: 't1', surface: 'proposal', inputHash: 'a'.repeat(64) },
    })
    expect((create.mock.calls[0]![0] as { data: { evaluationReceipt: { surface: string } } }).data.evaluationReceipt.surface).toBe('proposal')
  })

  /* The unmigrated path: exactly the columns that existed before, so the trade transaction cannot abort on them. */
  it('without it: no new column is written at all', async () => {
    const create = vi.fn(async () => ({ id: 's' }))
    await writeTradeDecisionSnapshot({ tradeDecisionSnapshot: { create } } as never, {
      tradeId: 't1', leagueId: 'l1', proposedByUserId: 'u1', snapshot, receipt: null,
    })
    const data = (create.mock.calls[0]![0] as { data: Record<string, unknown> }).data
    expect(Object.keys(data)).not.toEqual(expect.arrayContaining(['surface']))
    expect('surface' in data || 'inputHash' in data || 'evaluationReceipt' in data).toBe(false)
  })
})
