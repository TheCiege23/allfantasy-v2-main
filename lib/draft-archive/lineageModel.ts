import type { ArchivePick } from './detail';
export type AssetTransfer={transactionId:string;at:string;kind:'pick'|'player';playerId?:string;season?:number;round?:number;originalRosterId?:string;draftId?:string;from:string;to:string;reversedAt?:string|null;packageAssets:number};
export type AssetLineage={pickId:string;overall:number;playerName:string;originalRosterId:string|null;selectingRosterId:string|null;edges:Array<AssetTransfer&{phase:'before_selection'|'after_selection'|'selection_time_unknown'}>;state:'linked'|'no_recorded_links'|'ambiguous';};
/** A season/round asset may belong to multiple drafts. Never resolve it by player name or nearest time. */
export function assetLineages(picks:ArchivePick[],transfers:AssetTransfer[],season:number|null,draftId:string,oneDraftInSeason:boolean):AssetLineage[]{
  return picks.map(p=>{
    let ambiguous=false;
    const edges=transfers.filter(t=>{
      if(t.kind==='player') return !!p.playerId && t.playerId===p.playerId;
      const matches=t.season===season && t.round===p.round && !!p.originalRosterId && t.originalRosterId===p.originalRosterId;
      if(!matches)return false;
      if(t.draftId&&t.draftId!==draftId)return false;
      if((!t.draftId&&!oneDraftInSeason) || picks.filter(q=>q.round===p.round&&q.originalRosterId===p.originalRosterId).length!==1){ambiguous=true;return false;}
      return true;
    }).filter(t=>Number.isFinite(Date.parse(t.at))).map(t=>({...t,phase: !p.selectedAt || !Number.isFinite(Date.parse(p.selectedAt)) ? 'selection_time_unknown' as const : Date.parse(t.at)<=Date.parse(p.selectedAt)?'before_selection' as const:'after_selection' as const})).sort((a,b)=>a.at.localeCompare(b.at)||a.transactionId.localeCompare(b.transactionId));
    return {pickId:p.id,overall:p.overall,playerName:p.playerName,originalRosterId:p.originalRosterId,selectingRosterId:p.rosterId,edges,state:ambiguous?'ambiguous':edges.length?'linked':'no_recorded_links'};
  });
}
