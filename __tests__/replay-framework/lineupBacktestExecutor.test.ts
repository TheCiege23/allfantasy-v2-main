/**
 * Decision OS Replay Framework Phase 13 — lineup backtest executor coverage.
 * Calls the REAL, unmodified `optimizeLineupDeterministic()` (no mocking of
 * the lineup engine at all, mirroring `tradeBacktestExecutor.idConsistency.test.ts`'s
 * discipline of proving replay glue against the real engine, not assumptions
 * about it) to prove: real points feed the optimizer correctly, the actual
 * vs. optimal comparison is computed correctly, and the SUPER_FLEX slot
 * vocabulary translation (Sleeper's `SUPER_FLEX` -> the engine's own
 * `SUPERFLEX` FLEX_GROUPS key) actually works end-to-end.
 */
import { describe, it, expect } from 'vitest'
import { runLineupBacktest } from '@/lib/replay-framework/backtest/lineupBacktestExecutor'
import type { LineupReplayPayload } from '@/lib/replay-framework/types'

describe('runLineupBacktest', () => {
  it('computes actualPoints as the real sum of the starters the manager actually started', async () => {
    const payload: LineupReplayPayload = {
      actualStarterIds: ['qb1', 'rb1'],
      fullRoster: [
        { providerAssetId: 'qb1', name: 'Started QB', pos: ['QB'], actualPoints: 20 },
        { providerAssetId: 'rb1', name: 'Started RB', pos: ['RB'], actualPoints: 10 },
        { providerAssetId: 'rb2', name: 'Benched RB', pos: ['RB'], actualPoints: 5 },
      ],
      slotPositions: ['QB', 'RB'],
    }

    const result = await runLineupBacktest({ replayId: 'replay-1', season: 2025, payload })
    const output = result.backtestedOutput as { actualPoints: number }
    expect(output.actualPoints).toBe(30)
  })

  it('finds a real, non-zero missed opportunity when a higher-scoring bench player should have started', async () => {
    const payload: LineupReplayPayload = {
      // The manager started the weaker RB (5 pts) over the stronger one (25 pts) -- a real mistake.
      actualStarterIds: ['qb1', 'rb-weak'],
      fullRoster: [
        { providerAssetId: 'qb1', name: 'Started QB', pos: ['QB'], actualPoints: 20 },
        { providerAssetId: 'rb-weak', name: 'Weak RB (started)', pos: ['RB'], actualPoints: 5 },
        { providerAssetId: 'rb-strong', name: 'Strong RB (benched)', pos: ['RB'], actualPoints: 25 },
      ],
      slotPositions: ['QB', 'RB'],
    }

    const result = await runLineupBacktest({ replayId: 'replay-2', season: 2025, payload })
    const output = result.backtestedOutput as {
      actualPoints: number
      optimalPoints: number
      pointsLeftOnBench: number
      efficiencyPct: number
      benchValueLeft: number
      startSitMistakeCount: number
      missedOptimalStarters: Array<{ providerAssetId: string }>
      subOptimalActualStarters: Array<{ providerAssetId: string }>
    }

    expect(output.actualPoints).toBe(25) // 20 + 5
    expect(output.optimalPoints).toBe(45) // 20 + 25
    expect(output.pointsLeftOnBench).toBe(20)
    expect(output.efficiencyPct).toBeCloseTo(25 / 45, 3)
    expect(output.benchValueLeft).toBe(25) // the strong RB's real points, unrealized
    expect(output.startSitMistakeCount).toBe(1)
    expect(output.missedOptimalStarters.map((m) => m.providerAssetId)).toEqual(['rb-strong'])
    expect(output.subOptimalActualStarters.map((m) => m.providerAssetId)).toEqual(['rb-weak'])
  })

  it('reports 100% efficiency and zero mistakes when the manager already started the exact optimal lineup', async () => {
    const payload: LineupReplayPayload = {
      actualStarterIds: ['qb1', 'rb-strong'],
      fullRoster: [
        { providerAssetId: 'qb1', name: 'Started QB', pos: ['QB'], actualPoints: 20 },
        { providerAssetId: 'rb-strong', name: 'Strong RB (started)', pos: ['RB'], actualPoints: 25 },
        { providerAssetId: 'rb-weak', name: 'Weak RB (benched)', pos: ['RB'], actualPoints: 5 },
      ],
      slotPositions: ['QB', 'RB'],
    }

    const result = await runLineupBacktest({ replayId: 'replay-3', season: 2025, payload })
    const output = result.backtestedOutput as { efficiencyPct: number; pointsLeftOnBench: number; startSitMistakeCount: number }

    expect(output.efficiencyPct).toBe(1)
    expect(output.pointsLeftOnBench).toBe(0)
    expect(output.startSitMistakeCount).toBe(0)
  })

  it('translates Sleeper\'s real SUPER_FLEX slot code so it correctly fills with an eligible QB/RB/WR/TE, not left permanently unfillable', async () => {
    const payload: LineupReplayPayload = {
      // The manager sat a real, scorable QB2 in a real SUPER_FLEX league.
      actualStarterIds: ['qb1'],
      fullRoster: [
        { providerAssetId: 'qb1', name: 'Started QB1', pos: ['QB'], actualPoints: 20 },
        { providerAssetId: 'qb2', name: 'Benched QB2', pos: ['QB'], actualPoints: 18 },
      ],
      slotPositions: ['QB', 'SUPER_FLEX'],
    }

    const result = await runLineupBacktest({ replayId: 'replay-4', season: 2025, payload })
    const output = result.backtestedOutput as { optimalPoints: number; missedOptimalStarters: Array<{ providerAssetId: string }> }

    // Both real QBs should be usable (one in QB, one in SUPER_FLEX) -- if the
    // SUPER_FLEX slot were left unfillable (the untranslated-vocabulary bug),
    // optimalPoints would incorrectly stay at 20 instead of the real 38.
    expect(output.optimalPoints).toBe(38)
    expect(output.missedOptimalStarters.map((m) => m.providerAssetId)).toEqual(['qb2'])
  })

  it('excludes non-starting bench/taxi/IR slot codes from the optimal-lineup calculation', async () => {
    const payload: LineupReplayPayload = {
      actualStarterIds: ['qb1'],
      fullRoster: [{ providerAssetId: 'qb1', name: 'Only QB', pos: ['QB'], actualPoints: 20 }],
      slotPositions: ['QB', 'BN', 'BN', 'TAXI', 'IR'],
    }

    const result = await runLineupBacktest({ replayId: 'replay-5', season: 2025, payload })
    const output = result.backtestedOutput as { optimalPoints: number }
    // Only one real player and one real starting slot (QB) -- BN/TAXI/IR
    // must not consume it or introduce phantom unfilled-slot noise.
    expect(output.optimalPoints).toBe(20)
  })

  it('produces no realOutcome and a stable, config-free deterministicConfigVersion -- lineup replay has no tunable calibration', async () => {
    const payload: LineupReplayPayload = {
      actualStarterIds: ['qb1'],
      fullRoster: [{ providerAssetId: 'qb1', name: 'Only QB', pos: ['QB'], actualPoints: 20 }],
      slotPositions: ['QB'],
    }

    const result = await runLineupBacktest({ replayId: 'replay-6', season: 2025, payload })
    expect(result.realOutcome).toBeNull()
    expect(result.deterministicConfigVersion).toBe('none')
    expect(result.decisionType).toBe('lineup')
  })
})
