/**
 * Tests for TradeValueConsoleShadowService.ts — mocks only the true
 * external boundaries (fetchFantasyCalcValues, resolvePlayer), same pattern
 * as every other shared-service test suite in this repo.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFetchFantasyCalcValues, mockFindPlayerByName, mockResolvePlayer, mockSportsPlayerFindMany } = vi.hoisted(() => ({
  mockFetchFantasyCalcValues: vi.fn(),
  mockFindPlayerByName: vi.fn(),
  mockResolvePlayer: vi.fn(),
  mockSportsPlayerFindMany: vi.fn(),
}))

vi.mock('@/lib/player-valuations/canonicalPlayerValuations', () => ({
  fetchFantasyCalcValues: mockFetchFantasyCalcValues,
  findPlayerByName: mockFindPlayerByName,
}))
vi.mock('@/lib/shared-services/player-identity', () => ({ resolvePlayer: mockResolvePlayer }))
vi.mock('@/lib/prisma', () => ({ prisma: { sportsPlayer: { findMany: mockSportsPlayerFindMany } } }))

import { evaluateTradeValueConsoleShadow } from '@/lib/shared-services/trade/TradeValueConsoleShadowService'

function fcPlayer(overrides: Partial<{ name: string; sleeperId: string; espnId: string; value: number }> = {}) {
  return {
    player: {
      id: 1,
      name: overrides.name ?? 'Test Player',
      mflId: '',
      sleeperId: overrides.sleeperId ?? '',
      position: 'WR',
      maybeBirthday: null,
      maybeHeight: null,
      maybeWeight: null,
      maybeCollege: null,
      maybeTeam: 'KC',
      maybeAge: 25,
      maybeYoe: 3,
      espnId: overrides.espnId ?? null,
      fleaflickerId: null,
    },
    value: overrides.value ?? 5000,
    overallRank: 1,
    positionRank: 1,
    trend30Day: 0,
    redraftDynastyValueDifference: 0,
    redraftDynastyValuePercDifference: 0,
    redraftValue: 5000,
    combinedValue: 5000,
    maybeMovingStandardDeviation: null,
    maybeMovingStandardDeviationPerc: null,
    maybeMovingStandardDeviationAdjusted: null,
    displayTrend: false,
    maybeOwner: null,
    starter: true,
    maybeTier: null,
    maybeAdp: null,
  }
}

describe('evaluateTradeValueConsoleShadow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchFantasyCalcValues.mockResolvedValue([])
    mockFindPlayerByName.mockReturnValue(null)
    mockSportsPlayerFindMany.mockResolvedValue([])
  })

  it('returns unsupported for an empty asset list, never calling FantasyCalc or the resolver', async () => {
    const result = await evaluateTradeValueConsoleShadow([])
    expect(result.status).toBe('unsupported')
    expect(mockFetchFantasyCalcValues).not.toHaveBeenCalled()
    expect(mockResolvePlayer).not.toHaveBeenCalled()
  })

  it('resolves directly via a real FantasyCalc-embedded sleeperId when present', async () => {
    const fc = fcPlayer({ name: 'Ja Marr Chase', sleeperId: '7564', value: 9000 })
    mockFetchFantasyCalcValues.mockResolvedValue([fc])
    mockFindPlayerByName.mockReturnValue(fc)
    mockResolvePlayer.mockResolvedValue({
      input: { provider: 'sleeper', sourceId: '7564' },
      player: { canonicalPlayerId: 'uuid-1', canonicalName: 'Ja Marr Chase', normalizedName: 'jamarrchase', position: 'WR', team: 'CIN', sport: 'NFL', providerIds: {} },
      confidence: 'direct',
      source: 'player_identity_map_direct',
      resolvedAt: new Date().toISOString(),
      diagnostics: { matchedField: 'sleeperId', candidateCount: 1, tiedCandidates: 1, reason: 'direct' },
    })

    const result = await evaluateTradeValueConsoleShadow([{ name: 'Ja Marr Chase', position: 'WR', team: 'CIN', authoritativeMarketValue: 8800 }])

    expect(result.status).toBe('equivalent')
    expect(result.assetResults[0].status).toBe('identity_direct')
    expect(result.assetResults[0].matchedProvider).toBe('sleeper')
    expect(mockResolvePlayer).toHaveBeenCalledWith(expect.objectContaining({ provider: 'sleeper', sourceId: '7564' }))
  })

  it('falls back to name-only resolution when FantasyCalc has no cross-provider id for this player', async () => {
    const fc = fcPlayer({ name: 'No Id Guy', sleeperId: '', espnId: null })
    mockFetchFantasyCalcValues.mockResolvedValue([fc])
    mockFindPlayerByName.mockReturnValue(fc)
    mockResolvePlayer.mockResolvedValue({
      input: { provider: 'sleeper', nameHint: 'No Id Guy' },
      player: { canonicalPlayerId: 'uuid-2', canonicalName: 'No Id Guy', normalizedName: 'noidguy', position: 'WR', team: 'KC', sport: 'NFL', providerIds: {} },
      confidence: 'name_match_confident',
      source: 'player_identity_map_name_match',
      resolvedAt: new Date().toISOString(),
      diagnostics: { matchedField: 'normalizedName', candidateCount: 1, tiedCandidates: 1, reason: 'name match' },
    })

    const result = await evaluateTradeValueConsoleShadow([{ name: 'No Id Guy', position: 'WR', team: 'KC', authoritativeMarketValue: 1000 }])

    expect(result.assetResults[0].status).toBe('identity_name_match')
    const callArgs = mockResolvePlayer.mock.calls[0][0]
    expect(callArgs.sourceId).toBeUndefined()
  })

  it('reports identity_unresolvable honestly — never fabricates a match', async () => {
    mockFetchFantasyCalcValues.mockResolvedValue([])
    mockFindPlayerByName.mockReturnValue(null)
    mockResolvePlayer.mockResolvedValue({
      input: { provider: 'sleeper', nameHint: 'Totally Fake Player' },
      player: null,
      confidence: 'unresolved',
      source: 'unresolved',
      resolvedAt: new Date().toISOString(),
      diagnostics: { matchedField: null, candidateCount: 0, tiedCandidates: 0, reason: 'no match' },
    })

    const result = await evaluateTradeValueConsoleShadow([{ name: 'Totally Fake Player', position: null, team: null, authoritativeMarketValue: 100 }])

    expect(result.status).toBe('identity_unresolvable')
    expect(result.assetResults[0].status).toBe('identity_unresolvable')
    expect(result.unresolvedCount).toBe(1)
    expect(result.resolvedCount).toBe(0)
  })

  it('reports partial_identity_unresolved when only some assets resolve', async () => {
    mockFetchFantasyCalcValues.mockResolvedValue([])
    mockFindPlayerByName.mockReturnValue(null)
    mockResolvePlayer
      .mockResolvedValueOnce({
        input: {}, player: { canonicalPlayerId: 'uuid-3', canonicalName: 'Real Guy', normalizedName: 'realguy', position: 'RB', team: 'SF', sport: 'NFL', providerIds: {} },
        confidence: 'name_match_confident', source: 'player_identity_map_name_match', resolvedAt: new Date().toISOString(),
        diagnostics: { matchedField: null, candidateCount: 1, tiedCandidates: 1, reason: 'ok' },
      })
      .mockResolvedValueOnce({
        input: {}, player: null, confidence: 'unresolved', source: 'unresolved', resolvedAt: new Date().toISOString(),
        diagnostics: { matchedField: null, candidateCount: 0, tiedCandidates: 0, reason: 'no match' },
      })

    const result = await evaluateTradeValueConsoleShadow([
      { name: 'Real Guy', position: 'RB', team: 'SF', authoritativeMarketValue: 2000 },
      { name: 'Fake Guy', position: null, team: null, authoritativeMarketValue: 50 },
    ])

    expect(result.status).toBe('partial_identity_unresolved')
    expect(result.resolvedCount).toBe(1)
    expect(result.unresolvedCount).toBe(1)
  })

  it('reports ambiguous matches distinctly from confident ones', async () => {
    mockResolvePlayer.mockResolvedValue({
      input: {}, player: { canonicalPlayerId: 'uuid-4', canonicalName: 'Common Name', normalizedName: 'commonname', position: null, team: null, sport: 'NFL', providerIds: {} },
      confidence: 'name_match_ambiguous', source: 'player_identity_map_name_match', resolvedAt: new Date().toISOString(),
      diagnostics: { matchedField: null, candidateCount: 2, tiedCandidates: 2, reason: 'ambiguous' },
    })

    const result = await evaluateTradeValueConsoleShadow([{ name: 'Common Name', position: null, team: null, authoritativeMarketValue: 500 }])

    expect(result.assetResults[0].status).toBe('identity_ambiguous')
    expect(result.resolvedCount).toBe(0) // ambiguous is not counted as confidently resolved
  })

  it('computes a value delta only when a FantasyCalc match exists, never fabricating one', async () => {
    const fc = fcPlayer({ name: 'Value Guy', value: 6000 })
    mockFetchFantasyCalcValues.mockResolvedValue([fc])
    mockFindPlayerByName.mockReturnValue(fc)
    mockResolvePlayer.mockResolvedValue({
      input: {}, player: { canonicalPlayerId: 'uuid-5', canonicalName: 'Value Guy', normalizedName: 'valueguy', position: 'WR', team: null, sport: 'NFL', providerIds: {} },
      confidence: 'name_match_confident', source: 'player_identity_map_name_match', resolvedAt: new Date().toISOString(),
      diagnostics: { matchedField: null, candidateCount: 1, tiedCandidates: 1, reason: 'ok' },
    })

    const result = await evaluateTradeValueConsoleShadow([{ name: 'Value Guy', position: 'WR', team: null, authoritativeMarketValue: 5800 }])
    expect(result.assetResults[0].valueDelta).toBe(200)
  })

  it('never throws when resolvePlayer rejects for one asset — reports that asset as unresolvable', async () => {
    mockResolvePlayer.mockRejectedValue(new Error('boom'))
    const result = await evaluateTradeValueConsoleShadow([{ name: 'Whatever', position: null, team: null, authoritativeMarketValue: 1 }])
    expect(result.assetResults[0].status).toBe('identity_unresolvable')
  })

  // Phase 19 real-data finding: PlayerIdentityMap is confirmed 100% NFL-only
  // (a real query against .env.test found zero rows for any other sport).
  // Non-NFL assets (NBA/MLB/NHL/NCAAF/Soccer — all real, supported sports
  // for this route) always fell through to `resolvePlayer`'s name-match step,
  // which only searches PlayerIdentityMap — so every non-NFL asset was
  // reported unresolved even when SportsPlayer (a separate, real table
  // this environment confirmed has substantial multi-sport data) had a
  // clean match. Fixed with a narrow, additive fallback scoped to this file
  // only — never touches the canonical PlayerIdentityResolver.
  describe('Phase 19 — SportsPlayer name fallback for non-NFL sports', () => {
    it('falls back to a real SportsPlayer name match when the canonical resolver reports unresolved for a non-NFL asset', async () => {
      mockResolvePlayer.mockResolvedValue({
        input: {}, player: null, confidence: 'unresolved', source: 'unresolved', resolvedAt: new Date().toISOString(),
        diagnostics: { matchedField: null, candidateCount: 0, tiedCandidates: 0, reason: 'PlayerIdentityMap is NFL-only' },
      })
      mockSportsPlayerFindMany.mockResolvedValue([
        { id: 'uuid-nba-1', name: 'LeBron James', position: 'PF', team: 'LOS ANGELES LAKERS', sport: 'NBA' },
      ])

      const result = await evaluateTradeValueConsoleShadow([{ name: 'LeBron James', position: 'PF', team: 'LOS ANGELES LAKERS', sport: 'NBA', authoritativeMarketValue: 1200 }])

      expect(result.assetResults[0].status).toBe('identity_name_match_multisport_fallback')
      expect(result.resolvedCount).toBe(1)
      expect(result.status).toBe('equivalent')
      expect(mockSportsPlayerFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ sport: 'NBA' }) }))
    })

    it('never queries SportsPlayer by name for NFL assets (PlayerIdentityMap already covers NFL)', async () => {
      mockResolvePlayer.mockResolvedValue({
        input: {}, player: null, confidence: 'unresolved', source: 'unresolved', resolvedAt: new Date().toISOString(),
        diagnostics: { matchedField: null, candidateCount: 0, tiedCandidates: 0, reason: 'no match' },
      })
      const result = await evaluateTradeValueConsoleShadow([{ name: 'Totally Fake NFL Player', position: null, team: null, sport: 'NFL', authoritativeMarketValue: 1 }])
      expect(mockSportsPlayerFindMany).not.toHaveBeenCalled()
      expect(result.assetResults[0].status).toBe('identity_unresolvable')
    })

    it('still reports identity_unresolvable honestly when SportsPlayer also has no match — never fabricates one', async () => {
      mockResolvePlayer.mockResolvedValue({
        input: {}, player: null, confidence: 'unresolved', source: 'unresolved', resolvedAt: new Date().toISOString(),
        diagnostics: { matchedField: null, candidateCount: 0, tiedCandidates: 0, reason: 'no match' },
      })
      mockSportsPlayerFindMany.mockResolvedValue([])
      const result = await evaluateTradeValueConsoleShadow([{ name: 'Totally Fake NBA Player', position: null, team: null, sport: 'NBA', authoritativeMarketValue: 1 }])
      expect(result.assetResults[0].status).toBe('identity_unresolvable')
    })

    it('reports an ambiguous SportsPlayer match distinctly rather than guessing', async () => {
      mockResolvePlayer.mockResolvedValue({
        input: {}, player: null, confidence: 'unresolved', source: 'unresolved', resolvedAt: new Date().toISOString(),
        diagnostics: { matchedField: null, candidateCount: 0, tiedCandidates: 0, reason: 'no match' },
      })
      mockSportsPlayerFindMany.mockResolvedValue([
        { id: 'uuid-a', name: 'Duplicate Name', position: 'PG', team: 'A', sport: 'NBA' },
        { id: 'uuid-b', name: 'Duplicate Name', position: 'SF', team: 'B', sport: 'NBA' },
      ])
      const result = await evaluateTradeValueConsoleShadow([{ name: 'Duplicate Name', position: null, team: null, sport: 'NBA', authoritativeMarketValue: 1 }])
      expect(result.assetResults[0].status).toBe('identity_ambiguous')
      expect(result.resolvedCount).toBe(0)
    })

    it('never throws when the SportsPlayer fallback query itself fails', async () => {
      mockResolvePlayer.mockResolvedValue({
        input: {}, player: null, confidence: 'unresolved', source: 'unresolved', resolvedAt: new Date().toISOString(),
        diagnostics: { matchedField: null, candidateCount: 0, tiedCandidates: 0, reason: 'no match' },
      })
      mockSportsPlayerFindMany.mockRejectedValue(new Error('db down'))
      const result = await evaluateTradeValueConsoleShadow([{ name: 'Some NHL Player', position: null, team: null, sport: 'NHL', authoritativeMarketValue: 1 }])
      expect(result.assetResults[0].status).toBe('identity_unresolvable')
    })
  })
})
