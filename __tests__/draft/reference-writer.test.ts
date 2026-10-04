import { beforeEach, describe, expect, it, vi } from 'vitest';
const db=vi.hoisted(()=>({upsert:vi.fn(),find:vi.fn()}));
vi.mock('@/lib/prisma',()=>({prisma:{aiAdpSnapshotHistory:{upsert:db.upsert,findFirst:db.find}}}));
import { preserveReference, syncMarketReferences, auctionPriceReferences } from '@/lib/draft-archive/ingestion/referenceWriter';
import type { DraftReference } from '@/lib/draft-archive/referenceModel';
const reference: DraftReference={version:'draft-reference-v1',kind:'market_value',provider:'Stats Guy Fantasy',attributionUrl:'https://statsguyfantasy.com',effectiveAt:'2026-08-31T23:59:59.999Z',observedAt:'2026-09-02T00:00:00Z',historical:true,season:2026,identitySpace:'sleeper',format:'non_sf_redraft',entries:[{playerId:'1',name:'Name',position:'WR',value:100,sample:null}]};
beforeEach(()=>{vi.clearAllMocks();db.find.mockResolvedValue(null);});
describe('immutable references',()=>{
  it('dry run never writes; keys fit existing schema and updates never overwrite observations',async()=>{
    await preserveReference('sgf:non_sf_redraft',reference,false);expect(db.upsert).not.toHaveBeenCalled();
    await preserveReference('long-source-context-key'.repeat(8),reference,true);const args=db.upsert.mock.calls[0][0];expect(args.update).toEqual({});expect(args.create.leagueType.length).toBeLessThanOrEqual(16);expect(args.create.formatKey.length).toBeLessThanOrEqual(32);
  });
  it('rejects incomplete or future historical boards and honors rate limits',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({format:'sf_dynasty',asOf:'2026-09-01',total:2,rankings:[{id:'1',name:'Name',position:'WR',value:100}]})})));
    expect((await syncMarketReferences('2026-09-01',true,new Date('2026-09-02'))).failed).toBe(4);expect(db.upsert).not.toHaveBeenCalled();
    vi.stubGlobal('fetch',vi.fn(async()=>({ok:false,status:429})));expect((await syncMarketReferences('2026-09-01',false,new Date('2026-09-02'))).failed).toBe(1);expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('does not use pick order as auction price and deduplicates session/player observations',()=>{
    const context={sport:'NFL',season:2026,leagueType:'redraft',draftType:'auction',teamCount:12,scoring:'ppr',scoringRules:{rec:1},rosterSlots:['WR'],playerPool:'all',purpose:'standard'};
    const row={playerId:'1',playerName:'Name',position:'WR',amount:50,pickMetadata:{auctionBudgetPerTeam:200,archive:{eventId:'event',context}},sessionId:'a'};
    const result=auctionPriceReferences([row,row,{...row,amount:100,sessionId:'b'},{...row,amount:201,sessionId:'c'}],new Date('2026-09-01'));
    expect(result[0].snapshot.entries[0]).toMatchObject({value:75,sample:2,low:50,high:100});
  });
});
