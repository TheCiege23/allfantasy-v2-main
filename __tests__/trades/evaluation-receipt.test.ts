// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
const db = vi.hoisted(() => ({ create: vi.fn(), findFirst: vi.fn(), access: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { tradeAnalysisSnapshot: { create: db.create, findFirst: db.findFirst } } }))
vi.mock('@/lib/league/league-access', () => ({ assertLeagueMember: db.access }))
import { gradeTrade } from '@/lib/decision-os/trade/tradeGrade'
import { evaluationReceiptSchema, receiptGrade, receiptScoringRules, type TradeEvaluationReceipt } from '@/lib/decision-os/trade/evaluationReceipt'
import { readTradeEvaluationReceipt, receiptContextKey, receiptOwnerKey, saveTradeEvaluationReceipt } from '@/lib/decision-os/trade/evaluationReceiptStore'
import { applyTradeAnalysisDepth, TRADE_VERDICT_FIELDS } from '@/lib/trade-value-console/tradeAnalysisDepth'

export function fixture(): TradeEvaluationReceipt {
  return { version: 1, model: 'trade-value-league-scoring-v1', evaluatedAt: '2026-09-27T12:00:00.000Z', sourceUpdatedAt: null, origin: 'calculator',
    league: { id: 'league-a', name: 'Dynasty SF', sport: 'NFL', leagueType: 'dynasty', leagueSize: 12, isDynasty: true, scoring: 'PPR', scoringRules: { rec: 1, bonus_rec_te: 0.5 } },
    input: { sportFilter: 'ALL', leagueId: 'league-a', strategy: 'neutral', teamContext: 'my_team', analysisTab: 'raw',
      sideGive: [{ kind: 'player', name: 'DK Metcalf', providerIdentity: { provider: 'sleeper', id: '9000' } }], sideGet: [{ kind: 'pick', year: 2027, round: 2 }] },
    grade: receiptGrade(gradeTrade({ giveValue: 1766, getValue: 1584, giveMarket: 1766, getMarket: 1584, unpriced: 0, giveCount: 1, getCount: 1,
      basis: 'Dynasty · Superflex · 12 teams · PPR · TE premium +0.5', scoringApplied: false, needApplied: false, needGap: null, moves: [],
      lines: [{ side: 'give', name: 'DK Metcalf', marketValue: 1766, leagueValue: 1766 }, { side: 'get', name: '2027 2nd', marketValue: 1584, leagueValue: 1584 }] })),
    sources: ['fantasycalc'], assetSources: [{ side: 'give', index: 0, source: 'fantasycalc', playerId: '9000', position: 'WR' }], dataGaps: [],
  }
}

beforeEach(() => { vi.clearAllMocks(); db.access.mockResolvedValue({ ok: true }); db.create.mockResolvedValue({ id: 'receipt-1' }) })

describe('original trade evaluations', () => {
  it('preserves the exact D/B grade and values without later price lookups', async () => {
    const original = fixture()
    await saveTradeEvaluationReceipt('account-a', original)
    const written = db.create.mock.calls[0][0].data
    if (original.grade.graded) original.grade.lines[0].leagueValue = 5000
    expect(written.payloadJson.grade).toMatchObject({ letter: 'D', partnerLetter: 'B', giveValue: 1766, getValue: 1584 })
    expect(written.payloadJson.grade.lines[0].leagueValue).toBe(1766)
    db.findFirst.mockResolvedValue({ leagueId: 'league-a', payloadJson: written.payloadJson })
    expect((await readTradeEvaluationReceipt('account-a', 'receipt-1'))?.grade).toEqual(written.payloadJson.grade)
    expect(written.expiresAt).toBeNull()
  })
  it('creates a second record rather than replacing the first evaluation', async () => {
    await saveTradeEvaluationReceipt('account-a', fixture())
    await saveTradeEvaluationReceipt('account-a', { ...fixture(), evaluatedAt: '2026-09-28T12:00:00.000Z' })
    expect(db.create).toHaveBeenCalledTimes(2)
    expect(db.create.mock.calls[0][0].data.payloadJson.evaluatedAt).not.toBe(db.create.mock.calls[1][0].data.payloadJson.evaluatedAt)
  })
  it('binds reads to the authenticated account, not a Sleeper username', async () => {
    db.findFirst.mockResolvedValue(null)
    expect(await readTradeEvaluationReceipt('account-b', 'receipt-1')).toBeNull()
    expect(db.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'receipt-1', sleeperUsername: receiptOwnerKey('account-b'), snapshotType: 'trade_value_receipt_v1' } }))
    expect(receiptOwnerKey('account-a')).not.toBe(receiptOwnerKey('account-b'))
    expect(receiptOwnerKey('account-a')).not.toContain('account-a')
    expect(receiptOwnerKey('account-a').length).toBeLessThanOrEqual(64)
    expect(db.access).not.toHaveBeenCalled()
  })
  it('requires current membership for both saving and reading', async () => {
    db.access.mockResolvedValue({ ok: false })
    await expect(saveTradeEvaluationReceipt('account-a', fixture())).rejects.toThrow('League access')
    expect(db.create).not.toHaveBeenCalled()
    db.findFirst.mockResolvedValue({ leagueId: 'league-a', payloadJson: fixture() })
    expect(await readTradeEvaluationReceipt('account-a', 'receipt-1')).toBeNull()
  })
  it('refuses corrupt, mismatched, and unknown-version records', async () => {
    for (const payloadJson of [{ ...fixture(), version: 2 }, { ...fixture(), league: { ...fixture().league, id: 'other' } }, { grade: { letter: 'A' } }]) {
      db.findFirst.mockResolvedValue({ leagueId: 'league-a', payloadJson })
      expect(await readTradeEvaluationReceipt('account-a', 'receipt-1')).toBeNull()
    }
    await expect(saveTradeEvaluationReceipt('account-a', { ...fixture(), input: { ...fixture().input, leagueId: 'other' } })).rejects.toThrow('mismatch')
  })
  it('does not leak account, roster, full settings or paid analysis into saved data', () => {
    const parsed = evaluationReceiptSchema.parse({ ...fixture(), userId: 'secret-account', tradeIntelligence: { why: 'paid' },
      league: { ...fixture().league, settings: { accessToken: 'private' } }, input: { ...fixture().input, userId: 'account-a' } })
    const json = JSON.stringify(parsed)
    expect(json).not.toMatch(/secret-account|paid|accessToken|account-a/)
    expect(receiptScoringRules({ scoring_settings: { rec: 1, token: 'private', invalid: Infinity }, token: 'private' })).toEqual({ rec: 1 })
  })
  it('keeps provider namespaces and side orientation in the asset fingerprint', () => {
    const a = fixture()
    const b = { ...a, input: { ...a.input, sideGive: [{ kind: 'player' as const, name: 'DK Metcalf', providerIdentity: { provider: 'yahoo' as const, id: '9000' } }] } }
    expect(receiptContextKey(a)).not.toBe(receiptContextKey(b))
    expect(receiptContextKey(a)).not.toBe(receiptContextKey({ ...a, input: { ...a.input, sideGive: a.input.sideGet, sideGet: a.input.sideGive } }))
  })
  it('keeps original verdict receipts free without unlocking paid analysis', () => {
    expect(TRADE_VERDICT_FIELDS).toContain('evaluationReceipt')
    const result = applyTradeAnalysisDepth({ evaluationReceipt: { status: 'saved', id: 'r' }, tradeIntelligence: { why: 'paid' } }, { unlocked: false } as never)
    expect(result.evaluationReceipt).toEqual({ status: 'saved', id: 'r' })
    expect(result).not.toHaveProperty('tradeIntelligence')
  })
})
