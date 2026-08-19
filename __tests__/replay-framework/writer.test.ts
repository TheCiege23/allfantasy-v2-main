/**
 * Decision OS Replay Framework — writer coverage.
 * Proves: real insertion, idempotent duplicate-import prevention, and
 * explicit isolation from every live-calibration Prisma model
 * (TradeOfferEvent/TradeOutcomeEvent/TradeLearningStats).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'

const { mockReplayImportUpsert, mockBacktestResultUpsert, mockTradeOfferEvent, mockTradeOutcomeEvent, mockTradeLearningStats } = vi.hoisted(() => ({
  mockReplayImportUpsert: vi.fn(),
  mockBacktestResultUpsert: vi.fn(),
  mockTradeOfferEvent: { findMany: vi.fn(), create: vi.fn(), upsert: vi.fn() },
  mockTradeOutcomeEvent: { findMany: vi.fn(), create: vi.fn(), upsert: vi.fn() },
  mockTradeLearningStats: { findUnique: vi.fn(), update: vi.fn(), upsert: vi.fn() },
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    replayImport: { upsert: mockReplayImportUpsert },
    replayBacktestResult: { upsert: mockBacktestResultUpsert },
    tradeOfferEvent: mockTradeOfferEvent,
    tradeOutcomeEvent: mockTradeOutcomeEvent,
    tradeLearningStats: mockTradeLearningStats,
  },
}))

import { upsertBacktestResult, upsertReplayImport } from '@/lib/replay-framework/writer'
import type { BacktestResultInput, ReplayImportInput } from '@/lib/replay-framework/types'

const SAMPLE_REPLAY: ReplayImportInput = {
  provider: 'sleeper',
  decisionType: 'trade',
  providerLeagueId: 'league-1',
  providerTransactionId: 'tx-1',
  season: 2025,
  providerWeek: 1,
  proposedAt: new Date('2025-09-01T00:00:00.000Z'),
  resolvedAt: new Date('2025-09-01T01:00:00.000Z'),
  providerStatus: 'complete',
  participantsInvolved: [1, 2],
  managerUserIds: [{ rosterId: 1, sleeperUserId: 'u1' }],
  managerDisplayNames: [{ rosterId: 1, displayName: 'Alice' }],
  payload: { assetsGiven: [], assetsReceived: [] },
  rawProviderPayload: { raw: true },
  contextSnapshot: { scoring_settings: {} },
  isDynasty: true,
  isSuperFlex: false,
  ingestSourceUserId: 'ingest-user-1',
}

const SAMPLE_BACKTEST: BacktestResultInput = {
  replayId: 'replay-1',
  decisionType: 'trade',
  modelVersion: 'trade-engine-deterministic-v1',
  engineVersionHash: 'abc123',
  deterministicConfigVersion: 'b0:-1.1000',
  backtestedOutput: { acceptProb: 0.5 },
  realOutcome: { outcome: 'ACCEPTED', providerStatus: 'complete' },
}

describe('upsertReplayImport', () => {
  afterEach(() => vi.clearAllMocks())

  it('writes a real replay row keyed by (provider, decisionType, providerLeagueId, providerTransactionId)', async () => {
    mockReplayImportUpsert.mockResolvedValue({ id: 'replay-1' })

    const id = await upsertReplayImport(SAMPLE_REPLAY)

    expect(id).toBe('replay-1')
    expect(mockReplayImportUpsert).toHaveBeenCalledTimes(1)
    const call = mockReplayImportUpsert.mock.calls[0][0]
    expect(call.where.provider_decisionType_providerLeagueId_providerTransactionId).toEqual({
      provider: 'sleeper',
      decisionType: 'trade',
      providerLeagueId: 'league-1',
      providerTransactionId: 'tx-1',
    })
  })

  it('is idempotent — re-ingesting the same transaction upserts rather than creating a duplicate', async () => {
    mockReplayImportUpsert.mockResolvedValue({ id: 'replay-1' })

    await upsertReplayImport(SAMPLE_REPLAY)
    await upsertReplayImport(SAMPLE_REPLAY)

    expect(mockReplayImportUpsert).toHaveBeenCalledTimes(2)
    // Both calls use the identical natural key — proving a second ingest of
    // the same real transaction targets the same row, not a new one.
    const firstKey = mockReplayImportUpsert.mock.calls[0][0].where.provider_decisionType_providerLeagueId_providerTransactionId
    const secondKey = mockReplayImportUpsert.mock.calls[1][0].where.provider_decisionType_providerLeagueId_providerTransactionId
    expect(firstKey).toEqual(secondKey)
  })

  it('never touches TradeOfferEvent, TradeOutcomeEvent, or TradeLearningStats', async () => {
    mockReplayImportUpsert.mockResolvedValue({ id: 'replay-1' })

    await upsertReplayImport(SAMPLE_REPLAY)

    expect(mockTradeOfferEvent.create).not.toHaveBeenCalled()
    expect(mockTradeOfferEvent.upsert).not.toHaveBeenCalled()
    expect(mockTradeOutcomeEvent.create).not.toHaveBeenCalled()
    expect(mockTradeOutcomeEvent.upsert).not.toHaveBeenCalled()
    expect(mockTradeLearningStats.update).not.toHaveBeenCalled()
    expect(mockTradeLearningStats.upsert).not.toHaveBeenCalled()
  })
})

describe('upsertBacktestResult', () => {
  afterEach(() => vi.clearAllMocks())

  it('writes a real backtest row keyed by (replayId, modelVersion, engineVersionHash, deterministicConfigVersion)', async () => {
    mockBacktestResultUpsert.mockResolvedValue({ id: 'backtest-1' })

    const id = await upsertBacktestResult(SAMPLE_BACKTEST)

    expect(id).toBe('backtest-1')
    const call = mockBacktestResultUpsert.mock.calls[0][0]
    expect(call.where.replayId_modelVersion_engineVersionHash_deterministicConfigVersion).toEqual({
      replayId: 'replay-1',
      modelVersion: 'trade-engine-deterministic-v1',
      engineVersionHash: 'abc123',
      deterministicConfigVersion: 'b0:-1.1000',
    })
  })

  it('a new engineVersionHash produces a distinct version key, not an overwrite of the old one', async () => {
    mockBacktestResultUpsert.mockResolvedValue({ id: 'backtest-1' })

    await upsertBacktestResult(SAMPLE_BACKTEST)
    await upsertBacktestResult({ ...SAMPLE_BACKTEST, engineVersionHash: 'def456' })

    const firstKey = mockBacktestResultUpsert.mock.calls[0][0].where.replayId_modelVersion_engineVersionHash_deterministicConfigVersion
    const secondKey = mockBacktestResultUpsert.mock.calls[1][0].where.replayId_modelVersion_engineVersionHash_deterministicConfigVersion
    expect(firstKey.engineVersionHash).not.toBe(secondKey.engineVersionHash)
  })

  it('never touches TradeOfferEvent, TradeOutcomeEvent, or TradeLearningStats', async () => {
    mockBacktestResultUpsert.mockResolvedValue({ id: 'backtest-1' })

    await upsertBacktestResult(SAMPLE_BACKTEST)

    expect(mockTradeOfferEvent.create).not.toHaveBeenCalled()
    expect(mockTradeOutcomeEvent.create).not.toHaveBeenCalled()
    expect(mockTradeLearningStats.update).not.toHaveBeenCalled()
    expect(mockTradeLearningStats.upsert).not.toHaveBeenCalled()
  })
})
