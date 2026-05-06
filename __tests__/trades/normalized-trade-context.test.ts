import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildNormalizedTradeContext, buildNormalizedTradeEvidencePrompt } from '@/lib/trades/buildNormalizedTradeContext'
import { getNormalizedPlayerData } from '@/lib/player-data/getNormalizedPlayerData'
import { buildUnifiedPlayerProductView } from '@/lib/player-data/unifiedPlayerProductView'
import { normalizeDraftPlayer } from '@/lib/draft-sports-models/normalize-draft-player'

vi.mock('@/lib/player-data/getNormalizedPlayerData', () => ({
  getNormalizedPlayerData: vi.fn(),
}))

const mockedGet = vi.mocked(getNormalizedPlayerData)

describe('buildNormalizedTradeContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls normalized player data for resolved ids and keeps ADP vs AI ADP separate', async () => {
    const entry = normalizeDraftPlayer(
      {
        full_name: 'Evidence Wr',
        position: 'WR',
        team: 'DAL',
        playerId: 'p-ev-1',
        injuryStatus: 'Questionable',
        adp: 33,
      },
      'NFL',
    )
    const row = buildUnifiedPlayerProductView({ ...entry, aiAdp: 40, aiAdpSampleSize: 50 })
    mockedGet.mockResolvedValueOnce([
      {
        ...row,
        providerFallbackDiagnostics: {
          missingDomains: ['stats'],
          summary: 'partial cache',
        },
      } as any,
    ])

    const out = await buildNormalizedTradeContext({
      internalLeagueId: 'league-uuid',
      sport: 'nfl',
      playerIds: ['p-ev-1'],
      unresolved: [],
      totalAssetCount: 2,
      includeProviderFallbackDiagnostics: true,
    })

    expect(mockedGet).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'trade',
        leagueId: 'league-uuid',
        playerIds: ['p-ev-1'],
        includeProviderFallbackDiagnostics: true,
      }),
    )
    expect(out.players).toHaveLength(1)
    expect(out.players[0].adp).toBe(33)
    expect(out.players[0].aiAdp).toBe(40)
    expect(out.players[0].injuryStatus).toContain('Questionable')
    expect(out.summary.totalAssets).toBe(2)
    const prompt = buildNormalizedTradeEvidencePrompt(out)
    expect(prompt).toContain('adp=33')
    expect(prompt).toContain('aiAdp=40')
  })

  it('returns empty players when league id missing without calling getNormalizedPlayerData', async () => {
    const out = await buildNormalizedTradeContext({
      internalLeagueId: null,
      sport: 'nfl',
      playerIds: ['x'],
      unresolved: [{ originalAsset: { name: 'N' }, reason: 'no_league' }],
      totalAssetCount: 3,
    })
    expect(mockedGet).not.toHaveBeenCalled()
    expect(out.players).toHaveLength(0)
    expect(out.summary.unresolvedPlayers).toBe(1)
    expect(out.summary.totalAssets).toBe(3)
  })
})
