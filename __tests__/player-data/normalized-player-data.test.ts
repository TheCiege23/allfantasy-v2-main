import { describe, expect, it, vi } from 'vitest'
import {
  getNormalizedPlayerData,
  type NormalizedPlayerDataRow,
} from '@/lib/player-data/getNormalizedPlayerData'

vi.mock('@/lib/player-data/getPlayerDataForSurface', () => ({
  getPlayerDataForSurface: vi.fn(async (): Promise<NormalizedPlayerDataRow[]> => {
    const row = {
      name: 'Test',
      display: {} as never,
      unified: {
        sport: 'NFL',
        playerId: 'p1',
        headshotUrl: null,
        normalizedStats: {},
        injuryStatus: null,
        experience: { status: 'unknown' },
      },
      adp: null,
      aiAdp: null,
      injuryStatus: null,
    } as unknown as NormalizedPlayerDataRow
    return [row]
  }),
}))

describe('getNormalizedPlayerData', () => {
  it('adds diagnostics when requested', async () => {
    const rows = await getNormalizedPlayerData({
      surface: 'draft',
      leagueId: 'x',
      includeProviderFallbackDiagnostics: true,
    })
    expect(rows[0]?.providerFallbackDiagnostics?.playerId).toBe('p1')
    expect(rows[0]?.providerFallbackDiagnostics?.missingDomains).toContain('player_images')
    expect(rows[0]?.providerFallbackDiagnostics?.missingDomains).toContain('rookie_experience')
  })

  it('skips diagnostics by default', async () => {
    const rows = await getNormalizedPlayerData({ surface: 'draft', leagueId: 'x' })
    expect(rows[0]?.providerFallbackDiagnostics).toBeUndefined()
  })
})
