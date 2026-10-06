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
  it('does not send weekly evidence unrelated to the paginated selections',async()=>{
    h.read.mockResolvedValue({choice:{key:'imported:222',season:2026,sport:'NFL',format:'snake'},coverage:[],picks:[],phase4:{components:[],scores:[],replay:{state:'unavailable'},lineage:{lineages:[]},contributions:[{playerId:'WEEKLY_PRIVATE',rosterId:'a',name:'WEEKLY_PRIVATE',weeks:[{week:1,points:9876,starter:true,held:true}]}]}})
    const result=await buildDraftAnalysisContext(ctx,{archiveKey:'imported:222'})
    expect(result).not.toContain('WEEKLY_PRIVATE')
    expect(result).not.toContain('9876')
    expect(JSON.parse(result.split('\n')[1])).not.toHaveProperty('contributions')
  })
  const weeklyDetail = (weeks: unknown[] = [{week:1,points:-2,starter:true,held:true},{week:2,points:0,starter:false,held:false}]) => ({
    choice:{key:'imported:222',season:2026,sport:'NFL',format:'snake'},coverage:[],
    resultsReport:{provisional:true,teams:[]},resultsObservedAt:'2026-10-06T12:00:00Z',
    picks:[{overall:1,playerId:'p',rosterId:'a',originalRosterId:'b',playerName:'Player'}],
    phase4:{components:[],scores:[],replay:{state:'unavailable'},lineage:{lineages:[]},
      contributions:[{playerId:'p',rosterId:'a',expectedWeeks:2,weeks,private:'SECRET',totalPoints:99999}]},
  })
  it('shares approved original selecting-team rows with provenance and derived totals only',async()=>{
    h.read.mockResolvedValue(weeklyDetail())
    const result=await buildDraftAnalysisContext(ctx,{archiveKey:'imported:222'})
    const weekly=JSON.parse(result.split('\n')[1]).picks[0].weeklyContribution
    expect(weekly).toEqual({state:'complete',provisional:true,observedAt:'2026-10-06T12:00:00Z',expectedWeeks:2,coveredWeeks:2,recordedPoints:-2,starterPoints:-2,starts:1,usage:0.5,earlyStarterPoints:-2,lateStarterPoints:0,weeks:[{week:1,points:-2,starter:true,held:true},{week:2,points:0,starter:false,held:false}]})
    expect(result).not.toContain('SECRET')
    expect(result).not.toContain('99999')
    expect(result).toContain('not bench status')
  })
  it('preserves unknown totals for missing rows and limits partial coverage claims',async()=>{
    h.read.mockResolvedValue(weeklyDetail([]))
    let data=JSON.parse((await buildDraftAnalysisContext(ctx,{archiveKey:'imported:222'})).split('\n')[1])
    expect(data.picks[0].weeklyContribution).toMatchObject({state:'partial',coveredWeeks:0,recordedPoints:null,starterPoints:null,starts:null,usage:null,earlyStarterPoints:null,lateStarterPoints:null})
    h.read.mockResolvedValue(weeklyDetail([{week:1,points:0,starter:false}]))
    data=JSON.parse((await buildDraftAnalysisContext(ctx,{archiveKey:'imported:222'})).split('\n')[1])
    expect(data.picks[0].weeklyContribution).toMatchObject({coveredWeeks:1,recordedPoints:0,starts:0,usage:null,earlyStarterPoints:null})
    expect(data.picks[0].weeklyContribution.weeks[0]).not.toHaveProperty('held')
  })
  it('excludes other-roster, ambiguous and invalid evidence',async()=>{
    for(const kind of ['other','duplicate','bad-week','bad-held','too-many']){
      const detail=weeklyDetail()
      if(kind==='other')detail.phase4.contributions[0].rosterId='b'
      if(kind==='duplicate')detail.phase4.contributions.push(detail.phase4.contributions[0])
      if(kind==='bad-week')detail.phase4.contributions[0].weeks=[{week:19,points:0,starter:false}]
      if(kind==='bad-held')detail.phase4.contributions[0].weeks=[{week:1,points:5,starter:true,held:false}]
      if(kind==='too-many')detail.phase4.contributions[0].expectedWeeks=19
      h.read.mockResolvedValue(detail)
      expect(JSON.parse((await buildDraftAnalysisContext(ctx,{archiveKey:'imported:222'})).split('\n')[1]).picks[0].weeklyContribution).toBeNull()
    }
  })
  it('shares weekly rows only for the requested page and leaves native dates unknown',async()=>{
    const detail=weeklyDetail()
    detail.picks=Array.from({length:41},(_,i)=>({overall:i+1,playerId:'p'+i,rosterId:'a',originalRosterId:'b',playerName:'P'+i}))
    detail.resultsReport.provisional=false
    Object.assign(detail,{resultsObservedAt:null})
    detail.phase4.contributions=[{playerId:'p40',rosterId:'a',expectedWeeks:18,weeks:Array.from({length:18},(_,i)=>({week:i+1,points:3,starter:true})),private:'SECRET',totalPoints:99999}]
    h.read.mockResolvedValue(detail)
    const first=JSON.parse((await buildDraftAnalysisContext(ctx,{archiveKey:'native:d'})).split('\n')[1])
    expect(first.picks.every((p:any)=>p.weeklyContribution===null)).toBe(true)
    const next=JSON.parse((await buildDraftAnalysisContext(ctx,{archiveKey:'native:d',fromOverall:first.nextOverall})).split('\n')[1])
    expect(next.picks).toHaveLength(1)
    expect(next.picks[0].weeklyContribution).toMatchObject({provisional:false,observedAt:null,coveredWeeks:18})
    expect(next.picks[0].weeklyContribution.weeks).toHaveLength(18)
  })

})
