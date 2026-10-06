import {describe,it,expect,vi} from 'vitest'
const h=vi.hoisted(()=>({query:vi.fn().mockResolvedValue([])}))
vi.mock('@/lib/prisma',()=>({prisma:{$queryRaw:h.query}}))
import {validateCalibrationFilters,recomputeDraftCalibration} from '@/lib/draft-archive/ingestion/calibration'
describe('historical calibration selection',()=>{
  it('rejects malformed ranges before reading or publishing',()=>{
    expect(()=>validateCalibrationFilters({fromSeason:2026,throughSeason:2025})).toThrow()
    expect(()=>validateCalibrationFilters({teamCount:1})).toThrow()
    expect(()=>validateCalibrationFilters({leagueType:"' OR true"})).toThrow()
  })
  it('binds filters to original frozen context and remains read-only by default',async()=>{
    const result=await recomputeDraftCalibration(false,100,{fromSeason:2023,throughSeason:2025,leagueType:'dynasty',purpose:'startup',teamCount:12})
    expect(result.eligible).toBe(0)
    const query=h.query.mock.calls[0][0]
    expect(query.sql).toContain("'snapshot'->'context'->>'season'")
    expect(query.values).toContain('dynasty')
    expect(query.values).toContain(2023)
    expect(query.values).toContain('12')
  })
})
