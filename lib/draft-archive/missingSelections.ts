import {createHash} from 'node:crypto';
import {sleeperDraftArchiveMetadata} from '@/lib/league-import/sleeper/draftArchiveMetadata';
export type RecordedSourcePick={draftId:string;leagueId:string;sport:string;season:number|null;round:number;pickNumber:number;playerId:string;metadata:unknown};
export type SelectionRepairScope={leagueId:string;sourceDraftId:string;sourceLeagueId:string;season:number};
const object=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const rosterId=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0?String(v):typeof v==='string'&&/^\d+$/.test(v)&&Number.isSafeInteger(Number(v))&&Number(v)>0?v:null;
const identity=(p:{round:number;pickNumber:number;playerId:string})=>JSON.stringify([p.round,p.pickNumber,p.playerId]);
/** Only explicit provider positions and selecting teams; never current manager slots or inferred pick order. */
export function missingSelectionPlan(scope:SelectionRepairScope,facts:RecordedSourcePick[],source:{league:unknown;draft:unknown;picks:unknown},sameSeason:RecordedSourcePick[]=facts,observedAt=new Date().toISOString()){
 const league=object(source.league),draft=object(source.draft);
 if(!/^\d+$/.test(scope.sourceDraftId)||!/^\d+$/.test(scope.sourceLeagueId)||!Number.isInteger(scope.season)||league.league_id!==scope.sourceLeagueId||Number(league.season)!==scope.season||String(league.sport).toLowerCase()!=='nfl'||draft.draft_id!==scope.sourceDraftId||draft.league_id!==scope.sourceLeagueId||draft.status!=='complete'||(draft.sport!==undefined&&String(draft.sport).toLowerCase()!=='nfl'))throw Error('Historical selection source mismatch');
 if(!Array.isArray(source.picks)||!source.picks.length||source.picks.length>1000||!facts.length||facts.length>1000||sameSeason.length>10000)throw Error('Historical selection repair bound exceeded');
 const rosterValues=Object.values(object(draft.slot_to_roster_id)).filter(v=>v!==null&&v!==undefined),rosters=rosterValues.map(rosterId);
 if(rosters.length<2||rosters.length>32||rosters.some(r=>r===null)||new Set(rosters).size!==rosters.length)throw Error('Verified original draft roster inventory required');
 const picks=source.picks.map(raw=>{const p=object(raw),round=Number(p.round),pickNumber=Number(p.pick_no),playerId=p.player_id,owner=rosterId(p.roster_id);
  if(!Number.isSafeInteger(round)||round<1||!Number.isSafeInteger(pickNumber)||pickNumber<1||typeof playerId!=='string'||!playerId||playerId.trim()!==playerId||playerId.length>64||!owner||!rosters.includes(owner))throw Error('Explicit historical pick and selecting-team identities required');
  return {round,pickNumber,playerId,owner,raw};});
 if(new Set(picks.map(p=>p.playerId)).size!==picks.length||new Set(picks.map(p=>JSON.stringify([p.round,p.pickNumber]))).size!==picks.length)throw Error('Duplicate historical source selections');
 const byIdentity=new Map(picks.map(p=>[identity(p),p]));
 if(new Set(facts.map(identity)).size!==facts.length)throw Error('Duplicate recorded historical selections');
 for(const f of facts){const m=object(f.metadata),p=byIdentity.get(identity(f));if(f.leagueId!==scope.leagueId||f.sport!=='NFL'||f.season!==scope.season||m.sourceDraftId!==scope.sourceDraftId||m.sourceLeagueId!==scope.sourceLeagueId||!p||rosterId(m.selectionRosterId)!==p.owner)throw Error('Recorded historical selection changed');}
 const existing=new Set(facts.map(identity)),missing=picks.filter(p=>!existing.has(identity(p)));
 if(missing.some(p=>sameSeason.some(f=>f.leagueId===scope.leagueId&&f.sport==='NFL'&&f.season===scope.season&&!object(f.metadata).sourceDraftId&&identity(f)===identity(p))))throw Error('Unprovenanced historical selection conflict');
 if(!Number.isFinite(Date.parse(observedAt)))throw Error('Verified repair observation time required');
 return missing.map(p=>({draftId:'hqr-pick-'+createHash('sha256').update(JSON.stringify([scope.leagueId,scope.sourceDraftId,scope.season,p.round,p.pickNumber,p.playerId])).digest('hex').slice(0,40),leagueId:scope.leagueId,sport:'NFL',season:scope.season,round:p.round,pickNumber:p.pickNumber,playerId:p.playerId,managerId:null,metadata:{...sleeperDraftArchiveMetadata({sourceDraftId:scope.sourceDraftId,sourceLeagueId:scope.sourceLeagueId,season:scope.season,draft:source.draft,league:source.league,pick:p.raw,tradedPicks:null,includeDraftSnapshot:false}),selectionRepair:{version:1,observedAt,method:'verified_missing_selection_append'}}}));
}
/** Optimistic guard covers the whole original source, including its preserved metadata. */
export function sourceFactsFingerprint(facts:RecordedSourcePick[]){return createHash('sha256').update(JSON.stringify([...facts].sort((a,b)=>a.draftId.localeCompare(b.draftId)).map(f=>[f.draftId,f.leagueId,f.sport,f.season,f.round,f.pickNumber,f.playerId,f.metadata]))).digest('hex');}
