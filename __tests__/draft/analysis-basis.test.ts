import { describe, expect, it, vi } from 'vitest'
import { analysisReadiness, captureDraftAnalysisBasis } from '@/lib/draft-archive/analysisBasis'
describe('draft-day analysis provenance', () => {
  it('cuts projection capture off at draft start and preserves baseline values', async () => {
    const at = new Date('2026-08-01T00:00:00Z')
    const rows = [{ id: 'snapshot', playerId: 'canonical', playerName: 'Archived Player', position: 'WR', computedAt: new Date('2026-07-31T00:00:00Z'), afProjection: 12, rosProjection: 200, rosWeeksRemaining: 17, adjustmentFactors: { perGameRates: { rec: 5, rec_yd: 70, malformed: '70', nonfinite: Infinity } } }]
    const read = vi.fn().mockResolvedValue(rows)
    const identityRead = vi.fn().mockResolvedValue([{ id: 'canonical', sleeperId: 'verified-sleeper' }])
    const result = await captureDraftAnalysisBasis({ aFProjectionSnapshot: { findMany: read }, playerIdentityMap: { findMany: identityRead } } as never, { sport: 'NFL', season: 2026 }, at)
    expect(read.mock.calls[0][0].where.computedAt).toEqual({ lte: at })
    expect(identityRead.mock.calls[0][0].where).toEqual({ sport: 'NFL', id: { in: ['canonical'] } })
    expect(result.entries[0]).toMatchObject({ playerId: 'canonical', sleeperId: 'verified-sleeper', genericAfPerGame: 12, genericRosPoints: 200, rosWeeksRemaining: 17, computedAt: '2026-07-31T00:00:00.000Z' })
    expect(result.entries[0].perGameRates).toEqual({ rec: 5, rec_yd: 70 })
    expect(result.scoringBasis).toBe('league_rescored_stat_rates_per_game')
    expect(result.version).toBe('draft-analysis-basis-v2')
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

it('freezes restricted membership by verified IDs only from a dated matching-season cache',async()=>{
  const at=new Date('2026-08-01T00:00:00Z');
  const cached={data:{v:1,season:2026,observedAt:'2026-07-31T23:00:00Z',bySleeperId:{s1:0,s2:2}},expiresAt:new Date('2026-08-02')};
  const tx={aFProjectionSnapshot:{findMany:vi.fn().mockResolvedValue(['p1','p2'].map(playerId=>({playerId,computedAt:new Date('2026-07-31')})))},playerIdentityMap:{findMany:vi.fn().mockResolvedValue([{id:'p1',sleeperId:'s1'},{id:'p2',sleeperId:'s2'}])},sportsDataCache:{findUnique:vi.fn().mockResolvedValue(cached)}};
  const result=await captureDraftAnalysisBasis(tx as never,{sport:'NFL',season:2026},at,'rookies_only');
  expect(result).toHaveProperty('eligibility.playerIds',['p1']);
  tx.sportsDataCache.findUnique.mockResolvedValue({...cached,data:{...cached.data,season:2025}});
  expect(await captureDraftAnalysisBasis(tx as never,{sport:'NFL',season:2026},at,'rookies_only')).toHaveProperty('eligibility',null);
  tx.sportsDataCache.findUnique.mockResolvedValue({...cached,data:{...cached.data,bySleeperId:{s1:0}}} as typeof cached);
  expect(await captureDraftAnalysisBasis(tx as never,{sport:'NFL',season:2026},at,'rookies_only')).toHaveProperty('eligibility',null);
});
