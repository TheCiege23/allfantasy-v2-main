import { beforeEach, describe, expect, it, vi } from 'vitest';
const db=vi.hoisted(()=>({catalog:vi.fn(),league:vi.fn(),facts:vi.fn(),update:vi.fn(),audit:vi.fn(),transaction:vi.fn()}));
vi.mock('@/lib/draft-archive/catalog',()=>({draftArchiveCatalog:db.catalog}));
vi.mock('@/lib/prisma',()=>({prisma:{league:{findUnique:db.league},draftFact:{findMany:db.facts},$transaction:db.transaction}}));
import { reconciliationPreview, applyReconciliation } from '@/lib/draft-archive/reconciliation';
const fact={draftId:'f',leagueId:'l',sport:'NFL',season:2026,round:1,pickNumber:1,playerId:'p',metadata:{ownerSleeperId:'owner'}};
beforeEach(()=>{
  vi.resetAllMocks();
  db.catalog.mockResolvedValue({choices:[{source:'legacy',sport:'NFL',season:2026}]});
  db.league.mockResolvedValue({platform:'sleeper',platformLeagueId:'111'}); db.facts.mockResolvedValue([fact]);db.update.mockResolvedValue({count:1});
  db.transaction.mockImplementation(async fn=>fn({draftFact:{updateMany:db.update},leagueAuditLog:{create:db.audit}}));
  vi.stubGlobal('fetch',vi.fn(async (url:string)=>({ok:true,json:async()=>url.endsWith('/picks') ? [{draft_id:'222',round:1,pick_no:1,player_id:'p',metadata:{first_name:'Recorded',last_name:'Player',position:'WR'}}] : url.endsWith('/drafts') ? [{draft_id:'222',league_id:'111',status:'complete',type:'snake'}] : {league_id:'111',season:'2026',settings:{type:2},scoring_settings:{rec:1},roster_positions:['WR']} })));
});
describe('historical source reconciliation',()=>{
  it('binds exact source matches without changing raw selections and audits privately',async()=>{
    const preview=await reconciliationPreview('l','legacy:NFL:2026','222');
    expect(preview.updates).toHaveLength(1);
    expect(await applyReconciliation('l','legacy:NFL:2026','222',preview.digest,'u','Original draft verified')).toBe(1);
    const data=db.update.mock.calls[0][0].data;
    expect(Object.keys(data)).toEqual(['metadata']);expect(data.metadata.sourceDraftId).toBe('222');expect(data.metadata.historyVerification).toBe('commissioner_verified');
    expect(db.audit.mock.calls[0][0].data).toMatchObject({userId:'u',actionType:'draft_history_reconciliation',beforeState:[{draftId:'f',metadata:fact.metadata}]});
  });
  it('rejects a foreign source before reading its picks',async()=>{
    await expect(reconciliationPreview('l','key','999')).rejects.toThrow('outside');
    expect(fetch).not.toHaveBeenCalledWith(expect.stringContaining('draft/999'),expect.anything());
  });
  it('preserves mismatches and duplicate local selection identities',async()=>{
    db.facts.mockResolvedValue([{...fact,round:2}]);expect((await reconciliationPreview('l','key','222')).updates).toHaveLength(0);
    db.facts.mockResolvedValue([fact,{...fact,draftId:'duplicate'}]);expect((await reconciliationPreview('l','key','222')).updates).toHaveLength(0);
  });
  it('rejects stale previews and concurrent writes without a successful audit',async()=>{
    const preview=await reconciliationPreview('l','key','222');db.facts.mockResolvedValue([{...fact,metadata:{ownerSleeperId:'changed'}}]);
    await expect(applyReconciliation('l','key','222',preview.digest,'u','Verified original')).rejects.toThrow('Preview changed');expect(db.update).not.toHaveBeenCalled();
    db.facts.mockResolvedValue([fact]);db.update.mockResolvedValue({count:0});await expect(applyReconciliation('l','key','222',preview.digest,'u','Verified original')).rejects.toThrow('record changed');expect(db.audit).not.toHaveBeenCalled();
  });
});
