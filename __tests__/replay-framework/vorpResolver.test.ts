/**
 * Decision OS Replay Framework — VORP resolver coverage (Phase 7). Proves
 * the resolver reuses the real computePlayerVorp() primitive correctly,
 * derives a real LeagueRosterConfig from actual roster_positions, and fails
 * safe (0, never throws) for unresolvable players.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'

const { mockComputePlayerVorp } = vi.hoisted(() => ({ mockComputePlayerVorp: vi.fn() }))

vi.mock('@/lib/vorp-engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/vorp-engine')>()
  return { ...actual, computePlayerVorp: mockComputePlayerVorp }
})

import { deriveLeagueRosterConfig, resolvePlayerVorp } from '@/lib/replay-framework/valuation/vorpResolver'
import type { FantasyCalcPlayer } from '@/lib/fantasycalc'

function makeFcPlayer(overrides: Partial<FantasyCalcPlayer> = {}): FantasyCalcPlayer {
  return {
    player: { name: 'Test Player', position: 'RB', sleeperId: '1001' } as any,
    value: 5000,
    overallRank: 10,
    positionRank: 5,
    trend30Day: 0,
    redraftDynastyValueDifference: 0,
    redraftDynastyValuePercDifference: 0,
    redraftValue: 4500,
    combinedValue: 5000,
    maybeMovingStandardDeviation: null,
    maybeMovingStandardDeviationPerc: null,
    maybeMovingStandardDeviationAdjusted: null,
    displayTrend: false,
    maybeOwner: null,
    starter: true,
    maybeTier: null,
    maybeAdp: null,
    maybeTradeFrequency: null,
    ...overrides,
  }
}

describe('deriveLeagueRosterConfig', () => {
  it('counts real starting-slot positions from actual roster_positions rather than using generic defaults', () => {
    const config = deriveLeagueRosterConfig(
      ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'FLEX', 'BN', 'BN'],
      12,
      false,
    )

    expect(config.startingQB).toBe(1)
    expect(config.startingRB).toBe(2)
    expect(config.startingWR).toBe(3)
    expect(config.startingTE).toBe(1)
    expect(config.startingFlex).toBe(2)
    expect(config.numTeams).toBe(12)
    expect(config.superflex).toBe(false)
  })

  it('counts SUPER_FLEX slots toward both flex count and the superflex flag', () => {
    const config = deriveLeagueRosterConfig(['QB', 'RB', 'WR', 'SUPER_FLEX', 'BN'], 10, true)

    expect(config.superflex).toBe(true)
    expect(config.startingFlex).toBeGreaterThanOrEqual(1)
  })

  it('falls back to sane defaults when roster_positions is empty', () => {
    const config = deriveLeagueRosterConfig([], 0, false)

    expect(config.numTeams).toBe(12)
    expect(config.startingQB).toBe(1)
    expect(config.startingRB).toBe(2)
    expect(config.startingWR).toBe(2)
    expect(config.startingTE).toBe(1)
  })
})

describe('resolvePlayerVorp', () => {
  afterEach(() => vi.clearAllMocks())

  it('calls the real computePlayerVorp() with the resolved player\'s position/positionRank/redraftValue', () => {
    mockComputePlayerVorp.mockReturnValue(42)
    const fc = makeFcPlayer()
    const config = deriveLeagueRosterConfig(['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'BN'], 12, false)

    const result = resolvePlayerVorp(fc, config, [fc])

    expect(result).toBe(42)
    expect(mockComputePlayerVorp).toHaveBeenCalledWith('RB', 5, 4500, config, [fc])
  })

  it('returns 0 (never throws) when the player did not resolve against FantasyCalc', () => {
    const config = deriveLeagueRosterConfig([], 12, false)

    const result = resolvePlayerVorp(null, config, [])

    expect(result).toBe(0)
    expect(mockComputePlayerVorp).not.toHaveBeenCalled()
  })

  it('returns 0 when the resolved player has no position', () => {
    const config = deriveLeagueRosterConfig([], 12, false)
    const fc = makeFcPlayer({ player: { name: 'X', position: '', sleeperId: '1' } as any })

    const result = resolvePlayerVorp(fc, config, [fc])

    expect(result).toBe(0)
  })
})
