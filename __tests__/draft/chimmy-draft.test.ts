import { beforeEach, describe, expect, it, vi } from 'vitest'
const h=vi.hoisted(()=>({read:vi.fn()}))
vi.mock('@/lib/draft-archive/detail',()=>({draftArchiveDetail:h.read}))
import { buildDraftAnalysisContext } from '@/lib/chimmy/tools/draftAnalysisTool'
import { CHIMMY_TOOL_SPECS, executeChimmyTool } from '@/lib/chimmy/tools/chimmyTools'
const ctx={leagueId:'selected',userId:'signed-in'}
beforeEach(()=>vi.resetAllMocks())
describe('authorized Chimmy draft evidence',()=>{
  it('does not read anything without a session or a valid source',async()=>{
    expect(await buildDraftAnalysisContext({...ctx,userId:null},{archiveKey:'native:d'})).toMatch(/Select/)
    expect(await buildDraftAnalysisContext(ctx,{archiveKey:'guess'})).toMatch(/valid/)
    expect(await buildDraftAnalysisContext(ctx,{archiveKey:'native:d',fromOverall:1.5})).toMatch(/integer/)
    expect(h.read).not.toHaveBeenCalled()
  })
  it('uses the authenticated league and reports permission failures without facts',async()=>{
    h.read.mockResolvedValue(null)
    const result=await executeChimmyTool('get_draft_analysis',{archiveKey:'native:other',leagueId:'attacker'},ctx)
    expect(h.read).toHaveBeenCalledWith('selected','signed-in','native:other')
    expect(result).toMatch(/unavailable.*access/)
    const spec=CHIMMY_TOOL_SPECS.find(s=>s.function.name==='get_draft_analysis')!
    expect(spec.function.parameters.properties).not.toHaveProperty('leagueId')
  })
  it('whitelists evidence, preserves unknowns, and paginates without private metadata',async()=>{
    h.read.mockResolvedValue({choice:{key:'native:d',season:2026,sport:'NFL',format:'snake'},startedAt:null,endedAt:null,elapsedMs:null,activeMs:null,endMeaning:'Completed at',coverage:['Missing original projections'],snapshot:{private:'SECRET'},corrections:[{notes:'SECRET'}],picks:Array.from({length:41},(_,i)=>({overall:i+1,playerName:'P'+i,actor:'SECRET',ownerTime:{SECRET:10},allowanceSeconds:null,activeMs:null,amount:null})),phase4:{components:[{rosterId:'a',name:'Team A',values:[10,null,1,2],scores:[90,null,50,20],marketDiscount:-3,benchmarkPicks:5,totalPicks:6,secret:'SECRET'}],scores:[],replay:{state:'unavailable',reason:'No original projections'},lineage:{lineages:[]}}})
    const result=await buildDraftAnalysisContext(ctx,{archiveKey:'native:d'})
    expect(result).not.toContain('SECRET')
    const data=JSON.parse(result.split('\n')[1])
    expect(data.picks).toHaveLength(40)
    expect(data.nextOverall).toBe(41)
    expect(data.picks[0].adp).toBeNull()
    expect(data.components[0].percentiles).toEqual([90,null,50,20])
    expect(data.componentOrder).toHaveLength(4)
    expect(data.calibration).toBeNull()
    expect(result).toContain('Missing values are unknown')
  })
})
