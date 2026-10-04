import 'server-only';
import { prisma } from '@/lib/prisma';
import { preparationFormatKey, type PreparationContext } from '@/lib/core-app/draftPreparationModel';
import { referenceStorageKey, draftReferences } from './references';
import { validCalibration, type CalibrationModel } from './calibrationModel';
import { assetLineages, type AssetTransfer, type AssetLineage } from './lineageModel';
import { frozenIdentities } from './phase4Model';
import type { ArchivePick } from './detail';
import type { DraftReference } from './referenceModel';
const obj=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const text=(v:unknown)=>typeof v==='string'&&v? v:typeof v==='number'&&Number.isInteger(v)?String(v):null;
const integer=(v:unknown)=>typeof v==='number'&&Number.isInteger(v)?v:typeof v==='string'&&/^\d+$/.test(v)?Number(v):null;
export const calibrationKey=(context:PreparationContext)=>referenceStorageKey('model:'+preparationFormatKey({...context,season:0}));
export async function readCalibration(context:PreparationContext|null,cutoff:string|null=null):Promise<CalibrationModel|null>{
  if(!context)return null;
  const row=await prisma.aiAdpSnapshotHistory.findFirst({where:{sport:context.sport,leagueType:'draft_model',formatKey:calibrationKey(context),...(cutoff?{computedAt:{lte:new Date(cutoff)}}:{})},orderBy:[{computedAt:'desc'},{id:'desc'}],select:{snapshotData:true}});
  return validCalibration(row?.snapshotData);
}
export type LineageReport={state:'ready'|'partial'|'unavailable';lineages:AssetLineage[];pending:AssetTransfer[];reason:string;observedAt:string};
/** Caller must have passed selected-league access. Reads all bounded packages, independently of timeline paging. */
export async function loadAssetLineage(leagueId:string,source:'native'|'imported'|'reset'|'legacy',sourceId:string,sessionId:string|null,season:number|null,sport:string,picks:ArchivePick[],oneDraft:boolean,basis:unknown,context:PreparationContext|null,start:string|null,boundary?:Date):Promise<LineageReport>{
  const base:LineageReport={state:'unavailable',lineages:[],pending:[],reason:'Recorded trade lineage is unavailable.',observedAt:new Date().toISOString()};
  const native=source==='native'||source==='reset', until=boundary??new Date();
  const rows=native? await prisma.tradeExecutionSnapshot.findMany({where:{leagueId,executedAt:{lte:until}},orderBy:[{executedAt:'asc'},{id:'asc'}],take:1001,select:{tradeId:true,executedAt:true,assetSummary:true,completeness:true,reversal:{select:{reversedAt:true}}}}):await prisma.transactionFact.findMany({where:{leagueId,sport,type:'trade'},orderBy:[{createdAt:'asc'},{transactionId:'asc'}],take:1001,select:{transactionId:true,payload:true}});
  const proposals=native&&sessionId?await prisma.draftPickTradeProposal.findMany({where:{sessionId,status:'accepted',respondedAt:{lte:until}},orderBy:[{respondedAt:'asc'},{id:'asc'}],take:1001}):[];
  if(rows.length>1000||proposals.length>1000)return {...base,reason:'Trade history exceeds the lineage bound; no incomplete causal chain is presented.'};
  const aliases=new Map(frozenIdentities(basis,start).flatMap(p=>[p.playerId,p.sleeperId].filter((a):a is string=>!!a).map(a=>[a,p.playerId] as const)));
  const selectionId=(value:string)=>{const matches=picks.filter(p=>p.playerId===value||(p.playerId&&aliases.has(value)&&aliases.get(p.playerId)===aliases.get(value)));return matches.length===1?matches[0].playerId!:value;};
  const transfers:AssetTransfer[]=[];let incomplete=false;
  for(const raw of rows){
    const row=obj(raw);
    if(native){
      const summary=obj(row.assetSummary), assets=Array.isArray(summary.assets)?summary.assets.map(obj):[];
      if(row.completeness!=='complete'||assets.length>100){incomplete=true;continue;}
      for(const a of assets){
        const from=text(a.fromRosterId),to=text(a.toRosterId),type=String(a.assetType??a.itemType).toLowerCase(),meta=obj(a.metadata),playerId=text(a.playerId??a.itemReference);
        if(!from||!to||from===to)continue;
        const at=row.executedAt instanceof Date?row.executedAt.toISOString():null;
        if(!at)continue;
        const transfer:AssetTransfer={transactionId:String(row.tradeId),at,kind:type==='player'?'player':'pick',from,to,reversedAt:obj(row.reversal).reversedAt instanceof Date && (obj(row.reversal).reversedAt as Date).getTime()<=until.getTime() ? (obj(row.reversal).reversedAt as Date).toISOString():null,packageAssets:assets.length};
        if(type==='player'&&playerId){transfer.playerId=selectionId(playerId);transfers.push(transfer);}
        else if(['pick','draft_pick','future_pick','rookie_pick','devy_pick'].includes(type)){const year=integer(a.pickSeason??meta.pickSeason??meta.season),round=integer(a.pickRound??meta.pickRound??meta.round),original=text(a.originalRosterId??meta.originalRosterId);if(year&&round&&original)transfers.push({...transfer,season:year,round,originalRosterId:original,draftId:text(meta.draftSessionId)??undefined,...(['future_pick','rookie_pick','devy_pick'].includes(type)?{draftPurpose:type==='devy_pick'?'devy' as const:'rookie' as const}:{})});else incomplete=true;}
      }
    }else{
      const payload=obj(row.payload),atMs=typeof payload.status_updated==='number'?payload.status_updated:payload.created;
      if(payload.status!=='complete'||typeof atMs!=='number'||!Number.isFinite(atMs)||atMs>until.getTime())continue;
      const at=new Date(atMs).toISOString(),adds=obj(payload.adds),drops=obj(payload.drops),assets=Array.isArray(payload.draft_picks)?payload.draft_picks.map(obj):[];
      if(assets.length>100||Object.keys(adds).length>100){incomplete=true;continue;}
      const count=Object.keys(adds).length+assets.length;
      for(const playerId of Object.keys(adds)){const from=text(drops[playerId]),to=text(adds[playerId]);if(from&&to&&from!==to)transfers.push({transactionId:String(row.transactionId),at,kind:'player',playerId,from,to,packageAssets:count});else incomplete=true;}
      for(const a of assets){const year=integer(a.season),round=integer(a.round),original=text(a.roster_id),from=text(a.previous_owner_id),to=text(a.owner_id);if(year&&round&&original&&from&&to&&from!==to)transfers.push({transactionId:String(row.transactionId),at,kind:'pick',season:year,round,originalRosterId:original,from,to,draftId:text(a.draft_id)??undefined,packageAssets:count});else incomplete=true;}
    }
  }
  for(const p of proposals)for(const leg of [{round:p.giveRound,original:p.giveOriginalRosterId,from:p.proposerRosterId,to:p.receiverRosterId},{round:p.receiveRound,original:p.receiveOriginalRosterId,from:p.receiverRosterId,to:p.proposerRosterId}]){
    if(p.respondedAt&&leg.original&&season)transfers.push({transactionId:p.id,at:p.respondedAt.toISOString(),kind:'pick',season,round:leg.round,originalRosterId:leg.original,from:leg.from,to:leg.to,draftId:start&&Number.isFinite(Date.parse(start))&&p.respondedAt.getTime()>=Date.parse(start)?sourceId:undefined,packageAssets:2});
  }
  const compatible=transfers.filter(t=>!t.draftPurpose||t.draftId===sourceId||(context&&new RegExp(t.draftPurpose,'i').test(context.purpose)));
  const lineages=assetLineages(picks,compatible,season,sourceId,oneDraft), linked=new Set(lineages.flatMap(l=>l.edges.filter(e=>e.kind==='pick').map(e=>`${e.transactionId}:${e.season}:${e.round}:${e.originalRosterId}`)));
  return {...base,state:incomplete||lineages.some(l=>l.state==='ambiguous')?'partial':'ready',lineages,pending:transfers.filter(t=>t.kind==='pick'&&!linked.has(`${t.transactionId}:${t.season}:${t.round}:${t.originalRosterId}`)),reason:'Recorded packages only. Asset identity links do not allocate a multi-asset trade price to one player. Reversed trades remain visible. Missing transaction history, unresolved future picks and ambiguous same-season drafts prevent a complete ownership chain.'};
}
export type DynastyMark={playerName:string;draftValue:number|null;currentValue:number|null;draftAt:string|null;currentAt:string;source:string;attributionUrl:string|null};
export async function dynastyMarks(context:PreparationContext|null,picks:ArchivePick[],basis:unknown,start:string|null,prior:DraftReference[]):Promise<DynastyMark[]>{
  if(!context||context.leagueType!=='dynasty')return [];
  const current=(await draftReferences(context,new Date())).find(r=>r.kind==='market_value'),draft=prior.find(r=>r.kind==='market_value' && r.format===current?.format && r.provider===current?.provider);
  if(!current)return [];
  const aliases=new Map(frozenIdentities(basis,start).flatMap(p=>p.sleeperId?[[p.playerId,p.sleeperId],[p.sleeperId,p.sleeperId]] as Array<[string,string]>:[]));
  return picks.flatMap(p=>{const playerId=p.playerId?(aliases.get(p.playerId)??p.playerId):null;if(!playerId)return[];const value=current.entries.find(e=>e.playerId===playerId);if(!value)return[];return[{playerName:p.playerName,draftValue:draft?.entries.find(e=>e.playerId===playerId)?.value??null,currentValue:value.value,draftAt:draft?.effectiveAt??null,currentAt:current.effectiveAt,source:current.provider,attributionUrl:current.attributionUrl}];});
}
