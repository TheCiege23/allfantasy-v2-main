/**
 * Tests for lib/decision-os/trade/sharedServiceTradeValueShadowCompare.ts —
 * mocks only the true external boundaries (the shared shadow evaluator,
 * emitShadowParity), same pattern as the Waiver shadow-compare seam tests.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockEvaluateTradeValueConsoleShadow, mockEmitShadowParity } = vi.hoisted(() => ({
  mockEvaluateTradeValueConsoleShadow: vi.fn(),
  mockEmitShadowParity: vi.fn(),
}))

vi.mock('@/lib/shared-services/trade/TradeValueConsoleShadowService', () => ({
  evaluateTradeValueConsoleShadow: mockEvaluateTradeValueConsoleShadow,
}))
vi.mock('@/lib/decision-os/core/parity', () => ({ emitShadowParity: mockEmitShadowParity }))

import {
  runSharedTradeValueShadowCompare,
  shouldRunSharedTradeShadowCompare,
} from '@/lib/decision-os/trade/sharedServiceTradeValueShadowCompare'

function makeEvaluation(overrides: Partial<{ status: string; resolvedCount: number; unresolvedCount: number }> = {}) {
  return {
    status: overrides.status ?? 'equivalent',
    assetResults: [],
    resolvedCount: overrides.resolvedCount ?? 1,
    unresolvedCount: overrides.unresolvedCount ?? 0,
    fantasyCalcFetchMs: 5,
  }
}

describe('shouldRunSharedTradeShadowCompare', () => {
  it('is false when the flag is unset', () => {
    expect(shouldRunSharedTradeShadowCompare({})).toBe(false)
  })
  it('is true when the flag is exactly "true"', () => {
    expect(shouldRunSharedTradeShadowCompare({ SHARED_SERVICES_TRADE_SHADOW_COMPARE: 'true' })).toBe(true)
  })
  it('is false for a malformed truthy-looking value', () => {
    expect(shouldRunSharedTradeShadowCompare({ SHARED_SERVICES_TRADE_SHADOW_COMPARE: 'TRUE_ISH' })).toBe(false)
  })
})

describe('runSharedTradeValueShadowCompare', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns unsupported and never calls the shared evaluator for an empty asset list', async () => {
    const result = await runSharedTradeValueShadowCompare({ leagueId: null, assets: [], authoritativeDurationMs: 10 })
    expect(result.status).toBe('unsupported')
    expect(mockEvaluateTradeValueConsoleShadow).not.toHaveBeenCalled()
    expect(mockEmitShadowParity).toHaveBeenCalledWith('shared_services.trade', expect.objectContaining({ ran: false, reason: 'no_player_assets' }))
  })

  it('runs the shared evaluator and reports equivalent on a clean match', async () => {
    mockEvaluateTradeValueConsoleShadow.mockResolvedValue(makeEvaluation())
    const result = await runSharedTradeValueShadowCompare({
      leagueId: 'league-1',
      assets: [{ name: 'X', position: 'WR', team: null, authoritativeMarketValue: 100 }],
      authoritativeDurationMs: 25,
    })
    expect(result.ran).toBe(true)
    expect(result.status).toBe('equivalent')
    expect(result.sharedServiceDurationMs).not.toBeNull()
  })

  it('reports shadow_execution_failure and never throws when the shared evaluator rejects', async () => {
    mockEvaluateTradeValueConsoleShadow.mockRejectedValue(new Error('db down'))
    const result = await runSharedTradeValueShadowCompare({
      leagueId: 'league-1',
      assets: [{ name: 'X', position: null, team: null, authoritativeMarketValue: 100 }],
      authoritativeDurationMs: 25,
    })
    expect(result.status).toBe('shadow_execution_failure')
    expect(result.failureReason).toContain('db down')
  })

  it('reports shadow_execution_failure on a real timeout, bounded by TRADE_SHADOW_COMPARE_TIMEOUT_MS', async () => {
    mockEvaluateTradeValueConsoleShadow.mockImplementation(() => new Promise(() => {}))
    const result = await runSharedTradeValueShadowCompare({
      leagueId: 'league-1',
      assets: [{ name: 'X', position: null, team: null, authoritativeMarketValue: 100 }],
      authoritativeDurationMs: 25,
    })
    expect(result.status).toBe('shadow_execution_failure')
    expect(result.failureReason).toMatch(/timed out/)
  }, 10000)

  it('emits telemetry with the phase18 comparison version and no secrets/tokens', async () => {
    mockEvaluateTradeValueConsoleShadow.mockResolvedValue(makeEvaluation({ status: 'partial_identity_unresolved', resolvedCount: 1, unresolvedCount: 1 }))
    await runSharedTradeValueShadowCompare({
      leagueId: 'league-1',
      assets: [{ name: 'X', position: null, team: null, authoritativeMarketValue: 100 }],
      authoritativeDurationMs: 25,
    })
    const [, flags] = mockEmitShadowParity.mock.calls[0]
    expect(flags).toMatchObject({ comparisonVersion: 'phase18-trade-value-console', status: 'partial_identity_unresolved', resolvedCount: 1, unresolvedCount: 1 })
    expect(JSON.stringify(flags)).not.toMatch(/token|password|authorization|cookie/i)
  })

  it('never includes raw asset names in telemetry (only counts)', async () => {
    mockEvaluateTradeValueConsoleShadow.mockResolvedValue(makeEvaluation())
    await runSharedTradeValueShadowCompare({
      leagueId: 'league-1',
      assets: [{ name: 'Sensitive Real Name', position: null, team: null, authoritativeMarketValue: 100 }],
      authoritativeDurationMs: 25,
    })
    const [, flags] = mockEmitShadowParity.mock.calls[0]
    expect(JSON.stringify(flags)).not.toContain('Sensitive Real Name')
  })
})
