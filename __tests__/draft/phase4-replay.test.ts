import {describe,it,expect} from 'vitest';
import {buildReplay,replayAt,frozenExistingRoster,decisionComponents,frozenIdentities,auctionAwardBudget,auctionAlternative} from '@/lib/draft-archive/phase4Model';
import {draftDayReport} from '@/lib/draft-archive/analysisModel';
import {fillLineup} from '@/lib/decision-os/trade/rosterImpact';
import type {PreparationContext} from '@/lib/core-app/draftPreparationModel';
const start='2026-09-01T00:00:00Z';
const context:PreparationContext={sport:'NFL',season:2026,leagueType:'redraft',purpose:'standard',draftType:'snake',teamCount:2,playerPool:'all',scoring:'ppr',scoringRules:{rec:1},rosterSlots:['WRRB_FLEX','REC_FLEX','BN']};
const basis={version:'draft-analysis-basis-v2',state:'captured',capturedAt:start,entries:[['r','RB',20],['w','WR',18],['t','TE',16],['w2','WR',14],['r2','RB',12],['t2','TE',10],['w3','WR',8],['r3','RB',6]].map(([id,position,points])=>({playerId:id,sleeperId:'s-'+id,playerName:'Player '+id,position,computedAt:'2026-08-31',perGameRates:{rec:points}}))};
const picks=[['s-w','a'],['s-t','b'],['s-r2','b'],['s-w2','a']].map(([playerId,rosterId],i)=>({playerId,rosterId,playerName:playerId,position:'WR',keeper:false,overall:i+1}));
const teams=[{rosterId:'a',name:'A'},{rosterId:'b',name:'B'}];
describe('causal draft replay',()=>{
  it('keeps frozen identity links separate from incomplete projection scoring',()=>{
    expect(frozenIdentities(basis,start)[0]).toEqual({playerId:'r',sleeperId:'s-r'});
    expect(buildReplay(basis,{...context,scoringRules:{rec:1,unknown_stat:2}},start,picks,[]).state).toBe('unavailable');
    expect(frozenIdentities({...basis,capturedAt:'2027-01-01'},start)).toEqual([]);
  });
  it('does not double-count an existing keeper in bench value',()=>{
    const existing=[{...picks[0],playerId:'r',rosterId:'a'},{...picks[0],playerId:'w',rosterId:'a'},{...picks[0],playerId:'t',rosterId:'a'},{...picks[0],playerId:'r2',rosterId:'b'},{...picks[0],playerId:'w2',rosterId:'b'}];
    const c={...context,leagueType:'dynasty'};
    const before=draftDayReport(basis,c,[],teams,start,existing),after=draftDayReport(basis,c,[{...picks[0],playerId:'t',rosterId:'a',keeper:true}],teams,start,existing);
    expect(before.teams[0].benchValue).toBeGreaterThan(0);
    expect(after.teams[0].benchValue).toBe(before.teams[0].benchValue);
  });
  it('does not replay an existing keeper as a second copy of the same player',()=>{
    const kept=[{...picks[0],keeper:true},...picks.slice(1)],data=buildReplay(basis,context,start,kept,[picks[0]]),at=replayAt(data,1)!;
    expect(at.actual.gain).toBe(0);expect(at.opportunityGap).toBeNull();expect(at.candidates.some(p=>p.playerId==='w')).toBe(false);
  });
  it('preserves negative gains when a candidate must fill a vacant legal slot',()=>{
    const b={...basis,entries:basis.entries.map(e=>({...e,perGameRates:{rec:-Number(e.perGameRates.rec)}}))},data=buildReplay(b,context,start,picks,[]),at=replayAt(data,1)!;
    for(const p of at.candidates)expect(p.gain).toBeCloseTo(fillLineup([p],data.slots).points,8);
  });
  it('excludes only earlier picks, never later recorded selections',()=>{
    const data=buildReplay(basis,context,start,picks,[]),before=replayAt(data,1)!,after=replayAt(data,3)!;
    expect(before.candidates.map(p=>p.playerId)).toContain('t');
    expect(after.candidates.map(p=>p.playerId)).not.toContain('w');
    expect(after.candidates.map(p=>p.playerId)).not.toContain('t');
    expect(after.candidates.map(p=>p.playerId)).toContain('w2');
  });
  it('matches a full assignment for every available alternative with overlapping flex',()=>{
    const data=buildReplay(basis,context,start,picks,[]),at=replayAt(data,4)!;
    const roster=data.players.filter(p=>p.playerId==='w');
    for(const candidate of at.candidates)expect(candidate.gain).toBeCloseTo(fillLineup([...roster,candidate],data.slots).points-fillLineup(roster,data.slots).points,8);
  });
  it('reserves future keeper picks and existing players across the board',()=>{
    const keeper=[...picks.slice(0,3),{...picks[3],keeper:true}],data=buildReplay(basis,context,start,keeper,[]);
    expect(replayAt(data,1)!.candidates.map(p=>p.playerId)).not.toContain('w2');
    expect(replayAt(data,4)!.opportunityGap).toBeNull();
  });
  it('blocks hindsight, restricted pools, auctions and duplicate identities',()=>{
    expect(buildReplay({...basis,capturedAt:'2026-10-01'},context,start,picks,[]).state).toBe('unavailable');
    expect(buildReplay(basis,{...context,playerPool:'rookies'},start,picks,[]).state).toBe('unavailable');
    expect(buildReplay(basis,{...context,draftType:'auction'},start,picks,[]).state).toBe('unavailable');
    expect(buildReplay(basis,context,start,[...picks.slice(0,3),{...picks[3],playerId:'w'}],[]).state).toBe('unavailable');
  });
  it('does not turn partial reports into percentiles',()=>{
    const report=draftDayReport(basis,context,picks.slice(0,1),teams,start),rows=decisionComponents(report,buildReplay(basis,context,start,picks.slice(0,1),[]));
    expect(rows.every(r=>r.scores.every(v=>v===null))).toBe(true);
  });
});
describe('frozen dynasty roster evidence',()=>{
  const dynasty={...context,leagueType:'dynasty',purpose:'rookie',playerPool:'rookies'};
  const snapshot={teams:[{externalId:'a',platformUserId:'owner-a'},{externalId:'b',platformUserId:'owner-b'}],rosters:[{id:'internal-a',platformUserId:'owner-a',playerData:{players:['r','w']}},{id:'internal-b',platformUserId:'owner-b',playerData:{players:['t','w2']}}]};
  it('binds recorded owners and includes the saved roster before ranking the draft',()=>{
    const existing=frozenExistingRoster(snapshot,dynasty,teams)!;
    expect(existing.map(p=>p.rosterId)).toEqual(['a','a','b','b']);
    const additions=[{...picks[0],playerId:'r2'},{...picks[1],playerId:'t2'}],report=draftDayReport(basis,dynasty,additions,teams,start,existing);
    expect(report.state).toBe('ready');expect(report.teams[0].rosterPlayers).toBe(3);expect(report.teams[0].existingCovered).toBe(2);
    expect(report.teams[0].starterGain).toBe(0);expect(report.teams[0].rank).toBe(1);
  });
  it('blocks current, ambiguous, malformed or incomplete roster bindings',()=>{
    expect(frozenExistingRoster({},dynasty,teams)).toBeNull();
    expect(frozenExistingRoster({...snapshot,rosters:[...snapshot.rosters,snapshot.rosters[0]]},dynasty,teams)).toBeNull();
    expect(frozenExistingRoster({...snapshot,rosters:[{...snapshot.rosters[0],playerData:{players:[{name:'unknown'}]}},snapshot.rosters[1]]},dynasty,teams)).toBeNull();
    expect(draftDayReport(basis,dynasty,picks,teams,start).state).toBe('partial');
  });
});

describe('price-conditioned auction replay',()=>{
  const auctionPicks=picks.map(p=>({...p,selectedAt:start,amount:5,auctionEvidence:{version:'auction-award-v1',capturedAt:start,rosterId:p.rosterId,budgetBefore:20,slotsRemaining:3,minimumBid:1}}));
  it('requires recorded purchasing power and reserves minimum bids',()=>{
    expect(buildReplay(basis,{...context,draftType:'auction'},start,picks,[]).state).toBe('unavailable');
    const data=buildReplay(basis,{...context,draftType:'auction'},start,auctionPicks,[]);
    expect(data.state).toBe('ready');expect(replayAt(data,1)?.opportunityGap).toBeNull();
    expect(auctionAwardBudget(auctionPicks[0])?.maxBid).toBe(18);
    expect(auctionAlternative(data,1,'r',19)).toBeNull();expect(auctionAlternative(data,1,'r',NaN)).toBeNull();
    expect(auctionAlternative(data,1,'r',18)?.remainingBudget).toBe(2);
  });
  it('rejects wrong-owner and overspent award evidence',()=>{
    expect(auctionAwardBudget({...auctionPicks[0],auctionEvidence:{...auctionPicks[0].auctionEvidence,rosterId:'other'}})).toBeNull();
    expect(auctionAwardBudget({...auctionPicks[0],amount:19})).toBeNull();
  });
});

describe('frozen restricted membership',()=>{
  const rookie={...context,purpose:'rookie',playerPool:'rookies_only',leagueType:'dynasty'};
  const eligible={...basis,eligibility:{version:'draft-pool-eligibility-v1',pool:'rookies_only',season:2026,capturedAt:start,observedAt:'2026-08-31T20:00:00Z',source:'Sleeper years_exp by verified ID',playerIds:['w','t','r2','w2']}};
  it('excludes non-eligible projected stars without changing existing roster baselines',()=>{
    const data=buildReplay(eligible,rookie,start,picks,[]);
    expect(data.state).toBe('ready');expect(replayAt(data,1)?.candidates.map(p=>p.playerId)).toEqual(expect.arrayContaining(['w','t']));
    expect(replayAt(data,1)?.candidates.map(p=>p.playerId)).not.toContain('r');
  });
  it('blocks missing, future-dated, wrong-season and mismatched selection evidence',()=>{
    expect(buildReplay(basis,rookie,start,picks,[]).state).toBe('unavailable');
    expect(buildReplay({...eligible,eligibility:{...eligible.eligibility,observedAt:'2027-01-01'}},rookie,start,picks,[]).state).toBe('unavailable');
    expect(buildReplay({...eligible,eligibility:{...eligible.eligibility,season:2025}},rookie,start,picks,[]).state).toBe('unavailable');
    expect(buildReplay({...eligible,eligibility:{...eligible.eligibility,playerIds:['w']}},rookie,start,picks,[]).state).toBe('unavailable');
  });
});

it('does not offer ordinary-pool replay for development or salary-contract formats',()=>{
  expect(buildReplay(basis,{...context,leagueType:'devy'},start,picks,[]).state).toBe('unavailable');
  expect(buildReplay(basis,{...context,leagueType:'salary_cap'},start,picks,[]).state).toBe('unavailable');
});

it('replays a player-only dispersal under explicit frozen participants and protected IDs',()=>{
 const c={...context,leagueType:'dynasty',purpose:'dispersal'}
 const specialty={version:'draft-specialty-v1',capturedAt:start,dispersal:{eligibleRosterIds:['a','b'],protectedPlayerIds:['s-r'],allowedAssetTypes:['player']}}
 const data=buildReplay({...basis,specialty},c,start,picks,[])
 expect(data.state).toBe('ready');expect(replayAt(data,1)?.candidates.some(p=>p.playerId==='r')).toBe(false)
 expect(buildReplay(basis,c,start,picks,[]).state).toBe('unavailable')
 expect(buildReplay({...basis,specialty:{...specialty,dispersal:{...specialty.dispersal,eligibleRosterIds:['a']}}},c,start,picks,[]).state).toBe('unavailable')
 expect(buildReplay({...basis,specialty:{...specialty,dispersal:{...specialty.dispersal,allowedAssetTypes:['player','rookie_pick']}}},c,start,picks,[]).state).toBe('unavailable')
})
