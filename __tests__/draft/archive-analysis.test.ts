import { describe, expect, it } from 'vitest';
import { draftDayReport, resultsReport } from '@/lib/draft-archive/analysisModel';
import { validDraftReference, referenceAdpKey, marketFormat, type DraftReference } from '@/lib/draft-archive/referenceModel';
import type { PreparationContext } from '@/lib/core-app/draftPreparationModel';
const context: PreparationContext = { sport:'NFL',season:2026,leagueType:'redraft',draftType:'snake',teamCount:2,scoring:'ppr',scoringRules:{ rec:1 },rosterSlots:['WRRB_FLEX','REC_FLEX','BN'],playerPool:'all',purpose:'standard' };
const start = '2026-09-01T12:00:00Z';
const basis = { version:'draft-analysis-basis-v2',state:'captured',capturedAt:start,entries:[['w','WR',12],['r','RB',11],['t','TE',10],['w2','WR',9],['r2','RB',8],['t2','TE',7],['w3','WR',6],['r3','RB',5],['t3','TE',4]].map(([id,pos,pts]) => ({ playerId:id, sleeperId:'s-'+id,position:pos,computedAt:'2026-08-31T00:00:00Z',perGameRates:{rec:pts} })) };
const teams = [{rosterId:'a',name:'A'},{rosterId:'b',name:'B'}];
const pick = (playerId:string,rosterId:string) => ({ playerId,rosterId,playerName:playerId,position:'WR',keeper:false });
describe('draft ranking evidence', () => {
  it('uses overlapping flex assignments, frozen aliases and tied ranks', () => {
    const report = draftDayReport(basis, context, [pick('s-w','a'),pick('s-r','a'),pick('s-t','b'),pick('s-w2','b')],teams,start);
    expect(report.state).toBe('ready'); expect(report.teams[0].starterPoints).toBe(23); expect(report.teams.map(t=>t.rank)).toEqual([1,2]);
    const tied = draftDayReport({...basis,entries:basis.entries.map(e=>({...e,perGameRates:{rec:10}}))},context,[pick('w','a'),pick('r','a'),pick('w2','b'),pick('t','b')],teams,start);
    expect(tied.teams.map(t=>t.rank)).toEqual([1,1]);
  });
  it('blocks hindsight, old collapsed PPR baselines, unsupported slots and unknown identities', () => {
    expect(draftDayReport({...basis,capturedAt:'2026-09-02'},context,[],teams,start).state).toBe('unavailable');
    expect(draftDayReport({...basis,version:'draft-analysis-basis-v1'},context,[],teams,start).state).toBe('unavailable');
    expect(draftDayReport(basis,{...context,rosterSlots:['UNKNOWN']},[],teams,start).state).toBe('unavailable');
    const partial = draftDayReport(basis,context,[pick('missing','a')],teams,start); expect(partial.state).toBe('partial'); expect(partial.teams.every(t=>t.rank===null)).toBe(true);
  });
  it('does not compare dynasty or keeper drafts with unverified existing rosters', () => {
    const report = draftDayReport(basis,{...context,leagueType:'dynasty'},[pick('w','a'),pick('r','a'),pick('w2','b'),pick('t','b')],teams,start);
    expect(report.state).toBe('partial'); expect(report.teams.every(t=>t.rank===null)).toBe(true);
  });
  it('keeps zero and negative baseline points distinct from missing data', () => {
    const report = draftDayReport({...basis,entries:basis.entries.map(e=>({...e,perGameRates:{rec:e.playerId==='w' ? 0 : -1}}))},context,[pick('w','a'),pick('r','a'),pick('w2','b'),pick('t','b')],teams,start);
    expect(report.teams[0].starterPoints).toBe(-1); expect(report.players.find(p=>p.playerId==='w')?.points).toBe(0);
  });
  it('requires every drafted player-week and attributes actual starts only to the original team', () => {
    const picks=[pick('w','a'),pick('w2','b')], row={rosterId:'a',playerId:'w',points:10,isStarter:true,week:1};
    const result=resultsReport(picks,teams,[row,{...row,rosterId:'b',playerId:'w2',points:20,isStarter:false}], [1]);
    expect(result.state).toBe('ready'); expect(result.teams.map(t=>t.rank)).toEqual([1,2]); expect(result.teams[1].starterPoints).toBe(0);
    expect(resultsReport(picks,teams,[row], [1,2]).state).toBe('partial');
    expect(resultsReport(picks,teams,[{...row,rosterId:'b'}],[1]).state).toBe('unavailable');
  });
});
const reference: DraftReference = { version:'draft-reference-v1',kind:'market_value',provider:'Stats Guy Fantasy',attributionUrl:'https://statsguyfantasy.com',observedAt:'2026-09-03T00:00:00Z',effectiveAt:'2026-08-31T23:59:59.999Z',historical:true,season:2026,identitySpace:'sleeper',format:'non_sf_redraft',entries:[{playerId:'1',name:'Player',position:'WR',value:100,sample:null}] };
describe('reference provenance', () => {
  it('accepts documented historical retrieval but rejects future-day values and current observations', () => {
    expect(validDraftReference(reference,new Date(start))).not.toBeNull();
    expect(validDraftReference({...reference,effectiveAt:'2026-09-01T23:59:59.999Z'},new Date(start))).toBeNull();
    expect(validDraftReference({...reference,historical:false},new Date(start))).toBeNull();
  });
  it('rejects duplicate identities, uncredited source, wrong provider-kind and empty names', () => {
    expect(validDraftReference({...reference,entries:[...reference.entries,...reference.entries]},new Date(start))).toBeNull();
    expect(validDraftReference({...reference,attributionUrl:'https://example.com'},new Date(start))).toBeNull();
    expect(validDraftReference({...reference,kind:'adp'},new Date(start))).toBeNull();
    expect(validDraftReference({...reference,entries:[{...reference.entries[0],name:''}]},new Date(start))).toBeNull();
  });
  it('does not silently map custom leagues or unknown scoring to a standard provider format', () => {
    expect(marketFormat({...context,leagueType:'keeper'})).toBeNull();
    expect(referenceAdpKey({...context,scoring:'custom'})).toBeNull();
    expect(marketFormat({...context,rosterSlots:['QB','SUPER_FLEX']})).toBe('sf_redraft');
  });
});
