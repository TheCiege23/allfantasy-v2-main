import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
vi.mock('@/lib/sports-data-normalization/resolveNormalizedPlayerSportsProfiles', () => ({
  resolveNormalizedPlayerSportsProfiles: async () => ({ players: [{
    player: { name: 'Defender', position: { code: 'LB' }, team: { abbrev: 'SEA' } },
    projection: { projectedFantasyPoints: 999 },
  }] }),
}))
import { enrichTradeConsolePlayerLines, sumEffectiveProjections } from '@/lib/trade-value-console/tradeProjectionEnrichment'
import type { TradeConsolePlayerLine } from '@/lib/trade-value-console/types'

const line = (extra: Partial<TradeConsolePlayerLine> = {}): TradeConsolePlayerLine => ({
  name: 'Defender', playerId: 'NFL:lb', sport: 'NFL', position: 'LB', team: 'SEA',
  headshotUrl: null, logoUrl: null, injuryStatus: null, dataSource: 'test',
  composite: 1200, marketValue: 1200, pricedSource: 'idp_league',
  effectiveProjection: 17.1, projectionSource: 'league_idp_history',
  projectionScope: { season: 2026, week: 3 }, projectionNotes: ['League-scored history estimate'], ...extra,
})

describe('complete, comparable trade production estimates', () => {
  it('does not substitute a generic record projection for the league defender estimate', async () => {
    const [result] = await enrichTradeConsolePlayerLines({ sport: 'NFL', leagueScoring: null,
      prisma: { sportsPlayerRecord: { findMany: async () => [{ id: 'NFL:lb', name: 'Defender', position: 'LB', team: 'SEA' }] } } as never,
      lines: [line()],
    })
    expect(result.effectiveProjection).toBe(17.1)
    expect(result.projectionScope).toEqual({ season: 2026, week: 3 })
    expect(result.projectionNotes).toContain('League-scored history estimate')
  })
  it('retains the defender estimate when there is no general record', async () => {
    expect(await enrichTradeConsolePlayerLines({ sport: 'NFL', leagueScoring: null,
      prisma: { sportsPlayerRecord: { findMany: async () => [] } } as never, lines: [line()],
    })).toEqual([line()])
  })
  it('withholds partial totals rather than treating missing production as zero', () => {
    expect(sumEffectiveProjections([line(), line({ effectiveProjection: null })])).toBeNull()
    expect(sumEffectiveProjections([line({ effectiveProjection: 0 })])).toBe(0)
    expect(sumEffectiveProjections([line(), line({ unpriced: true })])).toBeNull()
  })
  it('refuses different weeks, seasons, or unknown scope when the board has a target week', () => {
    for (const projectionScope of [{ season: 2026, week: 4 }, { season: 2025, week: 3 }, undefined]) {
      expect(sumEffectiveProjections([line(), line({ projectionScope })])).toBeNull()
    }
    expect(sumEffectiveProjections([line(), line({ effectiveProjection: 7.25 })])).toBe(24.4)
  })
  it('excludes picks and FAAB from production, without inventing player points', () => {
    expect(sumEffectiveProjections([line(), line({ pricedSource: 'pick', effectiveProjection: undefined }),
      line({ pricedSource: 'faab', effectiveProjection: undefined })])).toBe(17.1)
    expect(sumEffectiveProjections([line({ pricedSource: 'pick' })])).toBeNull()
  })
})
