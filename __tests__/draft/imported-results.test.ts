import { beforeEach, describe, expect, it, vi } from 'vitest';
const db=vi.hoisted(()=>({catalog:vi.fn(),league:vi.fn(),facts:vi.fn(),games:vi.fn(),finalScores:vi.fn(),finalWrite:vi.fn(),create:vi.fn(),history:vi.fn()}));
vi.mock('@/lib/draft-archive/catalog',()=>({draftArchiveCatalog:db.catalog}));
vi.mock('@/lib/prisma',()=>{const prisma={$executeRaw:db.finalWrite,league:{findUnique:db.league},draftFact:{findMany:db.facts},sportsGame:{findMany:db.games},leaguePlayerWeeklyScore:{findMany:db.finalScores},aiAdpSnapshotHistory:{create:db.create,findFirst:db.history}};return{prisma:{...prisma,$transaction:async(input:unknown[]|((tx:typeof prisma)=>Promise<unknown>))=>typeof input==='function'?input(prisma):Promise.all(input)}}});
import { readImportedResults } from '@/lib/draft-archive/importedResults';
import { captureImportedResults } from '@/lib/draft-archive/ingestion/importedResults';
const facts=[{round:1,pickNumber:1,playerId:'p',metadata:{sourceDraftId:'222',sourceLeagueId:'111',selectionRosterId:'1',playerSnapshot:{name:'Recorded P',position:'WR'}}},{round:1,pickNumber:2,playerId:'q',metadata:{sourceDraftId:'222',sourceLeagueId:'111',selectionRosterId:'2',playerSnapshot:{name:'Recorded Q',position:'WR'}}}];
const matchups=[{roster_id:1,players:['p'],starters:['p'],players_points:{p:10}},{roster_id:2,players:['replacement'],starters:['replacement'],players_points:{replacement:20}}];
const source=(url:string,data=matchups)=>url.includes('/matchups/')?data:url.endsWith('/picks')?[{round:1,pick_no:1,player_id:'p',roster_id:1},{round:1,pick_no:2,player_id:'q',roster_id:2}]:url.includes('/draft/')?{draft_id:'222',league_id:'111',start_time:Date.parse('2026-08-31'),slot_to_roster_id:{1:1,2:2}}:{league_id:'111',season:'2026',settings:{last_scored_leg:1}};
beforeEach(()=>{
  vi.clearAllMocks();db.finalScores.mockResolvedValue([]);db.catalog.mockResolvedValue({choices:[{source:'imported',sourceId:'222',sport:'NFL',season:2026}]});db.league.mockResolvedValue({platform:'sleeper'});db.facts.mockResolvedValue(facts);db.games.mockResolvedValue([{week:1,startTime:new Date('2026-09-10')}]);
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>({ok:true,json:async()=>source(url)})));
});
describe('source-bound historical weekly results',()=>{
  it('uses actual starters and explicit roster departures, labels provider periods provisional',async()=>{
    expect(await captureImportedResults('l','imported:222')).toEqual({weeks:1,state:'ready'});
    const stored=db.create.mock.calls[0][0].data.snapshotData;
    expect(stored.report.provisional).toBe(true);expect(stored.report.teams.map((t:{starterPoints:number})=>t.starterPoints)).toEqual([10,0]);expect(stored.report.teams.map((t:{rank:number})=>t.rank)).toEqual([1,2]);
    expect(stored.version).toBe('draft-results-v3');expect(stored.weekly.rows[1]).toMatchObject({playerId:'q',held:false,isStarter:false,points:0});
    const legacy=db.create.mock.calls[2][0].data;
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
    await captureImportedResults('l','imported:222');const legacy=db.create.mock.calls[2][0].data.snapshotData;
    db.history.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce({snapshotData:legacy});
    expect((await readImportedResults('l','imported:222'))?.report.state).toBe('ready');
    expect(db.history).toHaveBeenCalledTimes(3);
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

it('seals unchanged scores after the correction windows in the observation transaction',async()=>{
 await captureImportedResults('l','imported:222');const prior=db.create.mock.calls[0][0].data.snapshotData
 prior.observedAt=new Date(Date.now()-13*3600000).toISOString()
 db.create.mockClear();db.history.mockResolvedValue({snapshotData:prior});db.games.mockResolvedValue([{week:1,startTime:new Date('2026-09-10'),status:'final',source:'verified-test'}]);db.finalWrite.mockResolvedValue(2)
 await captureImportedResults('l','imported:222')
 expect(db.finalWrite).toHaveBeenCalledTimes(1);expect(db.create).toHaveBeenCalledTimes(3)
 const current=db.create.mock.calls[0][0].data.snapshotData
 expect(current.report.provisional).toBe(false);expect(current.weekly.weekEvidence.every((e:any)=>e.players.every((p:any)=>p.finalized))).toBe(true)
 expect(db.create.mock.calls[1][0].data.snapshotData.report.provisional).toBe(true)
 expect(db.create.mock.calls[2][0].data.snapshotData.report.provisional).toBe(true)
 const picks=facts.map(f=>({playerId:f.playerId,rosterId:f.metadata.selectionRosterId,playerName:'Player',position:'WR',keeper:false}))
 db.history.mockResolvedValue({snapshotData:current})
 expect((await readImportedResults('l','imported:222',picks))?.report.provisional).toBe(false)
})
it('does not publish an observation when a cached score changes during sealing',async()=>{
 await captureImportedResults('l','imported:222');const prior=db.create.mock.calls[0][0].data.snapshotData
 prior.observedAt=new Date(Date.now()-13*3600000).toISOString()
 db.create.mockClear();db.history.mockResolvedValue({snapshotData:prior});db.games.mockResolvedValue([{week:1,startTime:new Date('2026-09-10'),status:'final'}]);db.finalWrite.mockResolvedValue(1)
 await expect(captureImportedResults('l','imported:222')).rejects.toThrow('changed during finalization')
 expect(db.create).not.toHaveBeenCalled()
})

it('keeps the previous aggregate reader compatible when selected-player weeks exceed its v2 bound',async()=>{
 const large=Array.from({length:1000},(_,i)=>({...facts[0],pickNumber:i+1,playerId:'large'+i,metadata:{...facts[0].metadata,selectionRosterId:String(Math.floor(i/100)+1)}}))
 const teams=Array.from({length:10},(_,i)=>i+1),weekly=teams.map(roster_id=>{const players=large.filter(p=>Number(p.metadata.selectionRosterId)===roster_id).map(p=>p.playerId);return{roster_id,players,starters:[],players_points:Object.fromEntries(players.map(p=>[p,0]))}})
 db.facts.mockResolvedValue(large);db.games.mockResolvedValue(Array.from({length:18},(_,i)=>({week:i+1,startTime:new Date('2026-09-10')})))
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>({ok:true,json:async()=>url.includes('/matchups/')?weekly:url.endsWith('/picks')?large.map(p=>({round:1,pick_no:p.pickNumber,player_id:p.playerId,roster_id:Number(p.metadata.selectionRosterId)})):url.includes('/draft/')?{draft_id:'222',league_id:'111',start_time:Date.parse('2026-08-31'),slot_to_roster_id:Object.fromEntries(teams.map(t=>[t,t]))}:{league_id:'111',season:'2026',settings:{last_scored_leg:18}}})))
 expect(await captureImportedResults('l','imported:222')).toEqual({weeks:18,state:'ready'})
 expect(db.create.mock.calls.map(c=>c[0].data.snapshotData.version)).toEqual(['draft-results-v3','draft-results-v1'])
 expect(db.create.mock.calls[0][0].data.snapshotData.weekly.rows).toHaveLength(18000)
})

 it('retains unassigned picks as partial evidence and never invents their owner',async()=>{
  db.facts.mockResolvedValue([...facts,{round:1,pickNumber:3,playerId:'unassigned',metadata:{sourceLeagueId:'111',selectionRosterId:null}}]);
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>({ok:true,json:async()=>url.endsWith('/picks')?[...source(url),{round:1,pick_no:3,player_id:'unassigned',roster_id:null}]:source(url)})));
  expect(await captureImportedResults('l','imported:222')).toEqual({weeks:1,state:'partial'});
  const stored=db.create.mock.calls[0][0].data.snapshotData;
  expect(stored.weekly.selections[2]).toEqual({playerId:'unassigned',rosterId:null});
  expect(stored.report.coverage).toContain('1 unassigned');expect(stored.report.teams.every((t:any)=>t.rank===null)).toBe(true);
  db.history.mockResolvedValue({snapshotData:stored});
  const picks=[...facts.map(f=>({playerId:f.playerId,rosterId:f.metadata.selectionRosterId,playerName:'Player',position:'WR',keeper:false})),{playerId:'unassigned',rosterId:null,playerName:'Player',position:'WR',keeper:false}];
  expect((await readImportedResults('l','imported:222',picks))?.report.state).toBe('partial');
  expect(await readImportedResults('l','imported:222',picks.map(p=>p.playerId==='unassigned'?{...p,rosterId:'1'}:p))).toBeNull();
 });
 it('uses a completed last-pick cutoff without relabelling it a start',async()=>{
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>({ok:true,json:async()=>url.includes('/draft/')&&!url.endsWith('/picks')?{...source(url),status:'complete',start_time:null,last_picked:Date.parse('2026-09-01')}:source(url)})));
  expect((await captureImportedResults('l','imported:222')).state).toBe('ready');
  const stored=db.create.mock.calls[0][0].data.snapshotData;expect(stored.weekly.resultCutoff.basis).toBe('provider_last_pick');expect(stored.report.coverage).toContain('Start time unavailable');
  db.history.mockResolvedValue({snapshotData:stored});const picks=facts.map(f=>({playerId:f.playerId,rosterId:f.metadata.selectionRosterId,playerName:'Player',position:'WR',keeper:false}));
  expect((await readImportedResults('l','imported:222',picks))?.report.coverage).toContain('recorded last pick');
  db.games.mockResolvedValue([{week:1,startTime:new Date('2026-08-31')}]);expect((await captureImportedResults('l','imported:222')).state).toBe('unavailable');
 });

it('preserves known weekly teams when a draft roster later disappears, leaving ranks unavailable',async()=>{
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>({ok:true,json:async()=>url.includes('/matchups/')?[matchups[0]]:source(url)})));
 expect(await captureImportedResults('l','imported:222')).toEqual({weeks:0,state:'partial'});
 const stored=db.create.mock.calls[0][0].data.snapshotData;expect(stored.report.teams[0].starterPoints).toBe(10);expect(stored.report.teams[1].coveredPicks).toBe(0);expect(stored.report.teams.every((t:any)=>t.rank===null)).toBe(true);
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>({ok:true,json:async()=>url.includes('/matchups/')?[{...matchups[0],roster_id:99}]:source(url)})));
 expect((await captureImportedResults('l','imported:222')).state).toBe('unavailable');
});
