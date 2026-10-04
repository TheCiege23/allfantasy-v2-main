import {beforeEach,describe,it,expect,vi} from 'vitest';
const db=vi.hoisted(()=>({executions:vi.fn(),proposals:vi.fn(),transactions:vi.fn(),model:vi.fn(),references:vi.fn()}));
vi.mock('@/lib/prisma',()=>({prisma:{tradeExecutionSnapshot:{findMany:db.executions},draftPickTradeProposal:{findMany:db.proposals},transactionFact:{findMany:db.transactions},aiAdpSnapshotHistory:{findFirst:db.model}}}));
vi.mock('@/lib/draft-archive/references',()=>({referenceStorageKey:(s:string)=>s,draftReferences:db.references}));
import {loadAssetLineage,readCalibration} from '@/lib/draft-archive/phase4Loader';
import type {ArchivePick} from '@/lib/draft-archive/detail';
import type {PreparationContext} from '@/lib/core-app/draftPreparationModel';
const pick={id:'p',overall:1,round:1,originalRosterId:'a',rosterId:'b',playerId:'player',playerName:'Player',selectedAt:'2026-09-01'} as ArchivePick;
const context={sport:'NFL',season:2026,leagueType:'redraft',purpose:'standard',draftType:'snake',teamCount:2,playerPool:'all',scoring:'ppr',scoringRules:{rec:1},rosterSlots:['WR']} as PreparationContext;
beforeEach(()=>{vi.resetAllMocks();db.executions.mockResolvedValue([]);db.proposals.mockResolvedValue([]);db.transactions.mockResolvedValue([]);db.model.mockResolvedValue(null);});
describe('bounded stored asset history',()=>{
  it('reads native pick identity from persisted trade item metadata',async()=>{
    db.executions.mockResolvedValue([{tradeId:'t',executedAt:new Date('2026-08-01'),completeness:'complete',assetSummary:{assets:[{itemType:'pick',fromRosterId:'a',toRosterId:'b',metadata:{pickSeason:2026,pickRound:1,originalRosterId:'a'}}]}}]);
    const result=await loadAssetLineage('l','native','d',null,2026,'NFL',[pick],true,null,null,null);expect(result.lineages[0].edges).toHaveLength(1);expect(result.state).toBe('ready');
  });
  it('does not assign a typed rookie future pick to a startup selection',async()=>{
    db.executions.mockResolvedValue([{tradeId:'t',executedAt:new Date('2026-08-01'),completeness:'complete',assetSummary:{assets:[{itemType:'future_pick',fromRosterId:'a',toRosterId:'b',metadata:{pickSeason:2026,pickRound:1,originalRosterId:'a'}}]}}]);
    const result=await loadAssetLineage('l','native','d',null,2026,'NFL',[pick],true,null,context,null);expect(result.lineages[0].edges).toEqual([]);expect(result.pending).toHaveLength(1);
    const rookie=await loadAssetLineage('l','native','d',null,2026,'NFL',[pick],true,null,{...context,purpose:'rookie'},null);expect(rookie.lineages[0].edges).toHaveLength(1);
  });
  it('does not assign an earlier session proposal to a later reused draft attempt',async()=>{
    db.proposals.mockResolvedValue([{id:'proposal',respondedAt:new Date('2026-08-01'),giveRound:1,giveOriginalRosterId:'a',receiveRound:1,receiveOriginalRosterId:'other',proposerRosterId:'a',receiverRosterId:'b'}]);
    const result=await loadAssetLineage('l','native','d','session',2026,'NFL',[pick],false,null,context,'2026-09-01');expect(result.lineages[0].state).toBe('ambiguous');expect(result.lineages[0].edges).toEqual([]);expect(result.pending).toHaveLength(2);
  });
  it('retains package size without private metadata and respects reversal observation boundaries',async()=>{
    db.executions.mockResolvedValue([{tradeId:'t',executedAt:new Date('2026-08-01'),completeness:'complete',assetSummary:{assets:[{itemType:'player',itemReference:'player',fromRosterId:'a',toRosterId:'b',metadata:{privateNote:'secret'}},{itemType:'faab',fromRosterId:'a',toRosterId:'b'}]},reversal:{reversedAt:new Date('2026-10-01')}}]);
    const result=await loadAssetLineage('l','reset','d','s',2026,'NFL',[pick],true,null,context,null,new Date('2026-09-02'));
    expect(result.lineages[0].edges[0]).toMatchObject({packageAssets:2,reversedAt:null});expect(JSON.stringify(result)).not.toContain('secret');
    expect(db.executions.mock.calls[0][0].where).toEqual({leagueId:'l',executedAt:{lte:new Date('2026-09-02')}});
  });
  it('reads provider pick fields and leaves other future assets unresolved',async()=>{
    db.transactions.mockResolvedValue([{transactionId:'t',payload:{status:'complete',created:Date.parse('2026-08-01'),draft_picks:[{season:'2026',round:1,roster_id:1,previous_owner_id:1,owner_id:2},{season:2027,round:1,roster_id:1,previous_owner_id:1,owner_id:2}]}}]);
    const result=await loadAssetLineage('l','imported','d',null,2026,'NFL',[{...pick,originalRosterId:'1'}],true,null,null,null);
    expect(result.lineages[0].edges).toHaveLength(1);expect(result.pending).toHaveLength(1);expect(result.pending[0].season).toBe(2027);
  });
  it('never returns a silently truncated ownership chain',async()=>{
    db.executions.mockResolvedValue(Array.from({length:1001},()=>({})));const result=await loadAssetLineage('l','native','d',null,2026,'NFL',[pick],true,null,null,null);expect(result.state).toBe('unavailable');expect(result.lineages).toEqual([]);
  });
  it('limits model observations to the selected start time',async()=>{
    await readCalibration(context,'2026-09-01');expect(db.model.mock.calls[0][0].where.computedAt).toEqual({lte:new Date('2026-09-01')});
  });
});
