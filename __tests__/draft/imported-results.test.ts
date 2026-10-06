import { beforeEach, describe, expect, it, vi } from 'vitest';
const db=vi.hoisted(()=>({catalog:vi.fn(),league:vi.fn(),facts:vi.fn(),games:vi.fn(),create:vi.fn(),history:vi.fn()}));
vi.mock('@/lib/draft-archive/catalog',()=>({draftArchiveCatalog:db.catalog}));
vi.mock('@/lib/prisma',()=>({prisma:{$transaction:async(promises:unknown[])=>Promise.all(promises),league:{findUnique:db.league},draftFact:{findMany:db.facts},sportsGame:{findMany:db.games},aiAdpSnapshotHistory:{create:db.create,findFirst:db.history}}}));
import { readImportedResults } from '@/lib/draft-archive/importedResults';
import { captureImportedResults } from '@/lib/draft-archive/ingestion/importedResults';
const facts=[{round:1,pickNumber:1,playerId:'p',metadata:{sourceDraftId:'222',sourceLeagueId:'111',selectionRosterId:'1',playerSnapshot:{name:'Recorded P',position:'WR'}}},{round:1,pickNumber:2,playerId:'q',metadata:{sourceDraftId:'222',sourceLeagueId:'111',selectionRosterId:'2',playerSnapshot:{name:'Recorded Q',position:'WR'}}}];
const matchups=[{roster_id:1,players:['p'],starters:['p'],players_points:{p:10}},{roster_id:2,players:['replacement'],starters:['replacement'],players_points:{replacement:20}}];
const source=(url:string,data=matchups)=>url.includes('/matchups/')?data:url.endsWith('/picks')?[{round:1,pick_no:1,player_id:'p',roster_id:1},{round:1,pick_no:2,player_id:'q',roster_id:2}]:url.includes('/draft/')?{draft_id:'222',league_id:'111',start_time:Date.parse('2026-08-31'),slot_to_roster_id:{1:1,2:2}}:{league_id:'111',season:'2026',settings:{last_scored_leg:1}};
beforeEach(()=>{
  vi.clearAllMocks();db.catalog.mockResolvedValue({choices:[{source:'imported',sourceId:'222',sport:'NFL',season:2026}]});db.league.mockResolvedValue({platform:'sleeper'});db.facts.mockResolvedValue(facts);db.games.mockResolvedValue([{week:1,startTime:new Date('2026-09-10')}]);
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>({ok:true,json:async()=>source(url)})));
});
describe('source-bound historical weekly results',()=>{
  it('uses actual starters and explicit roster departures, labels provider periods provisional',async()=>{
    expect(await captureImportedResults('l','imported:222')).toEqual({weeks:1,state:'ready'});
    const stored=db.create.mock.calls[0][0].data.snapshotData;
    expect(stored.report.provisional).toBe(true);expect(stored.report.teams.map((t:{starterPoints:number})=>t.starterPoints)).toEqual([10,0]);expect(stored.report.teams.map((t:{rank:number})=>t.rank)).toEqual([1,2]);
    expect(stored.version).toBe('draft-results-v2');expect(stored.weekly.rows[1]).toMatchObject({playerId:'q',held:false,isStarter:false,points:0});
    const legacy=db.create.mock.calls[1][0].data;
    expect(legacy.snapshotData.version).toBe('draft-results-v1');expect(legacy.snapshotData.weekly).toBeUndefined();
    expect(legacy.formatKey).not.toBe(db.create.mock.calls[0][0].data.formatKey);
    db.history.mockResolvedValue({snapshotData:stored});
    const picks=facts.map(f=>({playerId:f.playerId,rosterId:f.metadata.selectionRosterId,playerName:f.metadata.playerSnapshot.name,position:'WR',keeper:false}));
    const observation=await readImportedResults('l','imported:222',picks);
    expect(observation?.contributions?.[0].usage).toBe(1);expect(observation?.contributions?.[1].weeks[0].held).toBe(false);
    expect(await readImportedResults('l','imported:222',[{...picks[0],playerId:'foreign'},picks[1]])).toBeNull();
    db.history.mockResolvedValue({snapshotData:{...stored,version:'draft-results-v1',weekly:undefined}});
    expect((await readImportedResults('l','imported:222'))?.report.state).toBe('ready');
  });
  it('blocks incompatible source seasons and leaves existing observations alone',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({league_id:'foreign',season:'2025'})})));
    await expect(captureImportedResults('l','imported:222')).rejects.toThrow('mismatch');expect(db.create).not.toHaveBeenCalled();
  });
  it('does not turn an owned player missing points into zero or compare incomplete drafts',async()=>{
    vi.stubGlobal('fetch',vi.fn(async(url:string)=>({ok:true,json:async()=>source(url,[{...matchups[0],players_points:{}},matchups[1]])})));
    expect((await captureImportedResults('l','imported:222')).state).toBe('partial');expect(db.create.mock.calls[0][0].data.snapshotData.report.teams.every((t:{rank:number|null})=>t.rank===null)).toBe(true);
  });
  it('never attributes weeks before the draft and enforces reader scope',async()=>{
    db.games.mockResolvedValue([{week:1,startTime:new Date('2026-08-01')}]);expect((await captureImportedResults('l','imported:222')).state).toBe('unavailable');
    db.history.mockResolvedValue({snapshotData:{version:'draft-results-v1',leagueId:'another',key:'imported:222',observedAt:new Date().toISOString(),report:{teams:[]}}});expect(await readImportedResults('l','imported:222')).toBeNull();
  });
  it('falls back to the prior aggregate index when no weekly observation exists',async()=>{
    await captureImportedResults('l','imported:222');const legacy=db.create.mock.calls[1][0].data.snapshotData;
    db.history.mockResolvedValueOnce(null).mockResolvedValueOnce({snapshotData:legacy});
    expect((await readImportedResults('l','imported:222'))?.report.state).toBe('ready');
    expect(db.history).toHaveBeenCalledTimes(2);
  });
  it('rejects contradictory provider ownership and duplicate starters',async()=>{
    for(const data of [[matchups[0],{...matchups[1],players:['p','replacement']}],[{...matchups[0],starters:['p','p']},matchups[1]]]) {
      vi.stubGlobal('fetch',vi.fn(async(url:string)=>({ok:true,json:async()=>source(url,data)})));
      expect((await captureImportedResults('l','imported:222')).state).toBe('unavailable');
    }
  });
  it('rejects malformed persisted totals and observation dates without crashing the page',async()=>{
    await captureImportedResults('l','imported:222');const stored=db.create.mock.calls[0][0].data.snapshotData;
    for(const value of [{...stored,observedAt:'not a date'},{...stored,report:{...stored.report,teams:[{...stored.report.teams[0],starterPoints:'10'},stored.report.teams[1]]}},{...stored,report:{...stored.report,teams:[stored.report.teams[0],stored.report.teams[0]]}}]) {
      db.history.mockResolvedValue({snapshotData:value});expect(await readImportedResults('l','imported:222')).toBeNull();
    }
  });
});
