import { describe, expect, it, vi } from 'vitest'
import { analysisReadiness, captureDraftAnalysisBasis } from '@/lib/draft-archive/analysisBasis'
describe('draft-day analysis provenance', () => {
  it('cuts projection capture off at draft start and preserves baseline values', async () => {
    const at = new Date('2026-08-01T00:00:00Z')
    const rows = [{ id: 'snapshot', playerId: 'canonical', rosProjection: 200, rosWeeksRemaining: 17 }]
    const read = vi.fn().mockResolvedValue(rows)
    const result = await captureDraftAnalysisBasis({ aFProjectionSnapshot: { findMany: read } } as never, { sport: 'NFL', season: 2026 }, at)
    expect(read.mock.calls[0][0].where.computedAt).toEqual({ lte: at })
    expect(result.entries[0]).toMatchObject({ rosProjection: 200, rosWeeksRemaining: 17 })
    expect(result.scoringBasis).toBe('generic_ppr')
  })
  it('refuses a truncated projection universe', async () => {
    const read = vi.fn().mockResolvedValue(Array(5001).fill({ playerId: 'player' }))
    const result = await captureDraftAnalysisBasis({ aFProjectionSnapshot: { findMany: read } } as never, { sport: 'NFL', season: 2026 }, new Date())
    expect(result.state).toBe('unsupported')
    expect(result.entries).toEqual([])
  })
  it('does not turn captured generic projections into a custom-scoring grade or results grade', () => {
    const result = analysisReadiness({ state: 'captured', entries: [{ playerId: 'player' }], scoringBasis: 'generic_ppr' }, 20)
    expect(result.draftDay.state).toBe('insufficient_data')
    expect(result.resultsToDate).toEqual({ state: 'insufficient_data', coveredPicks: 0 })
  })
})
