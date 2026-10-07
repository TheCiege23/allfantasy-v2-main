export type MaintenanceSource={leagueId:string;sourceId:string;season:number;observedAt:string|null;provisional:boolean;state:string|null;attemptedAt:string|null;retryAt:string|null};
/** Oldest successful observation/attempt first; failures cannot permanently occupy the front. */
export function maintenanceQueue(sources:MaintenanceSource[],now:number,currentSeason:number,limit=8){
 const date=(v:string|null)=>v?Date.parse(v):0;
 return sources.filter(s=>{
  const observed=date(s.observedAt),attempted=date(s.attemptedAt),retry=date(s.retryAt);
  if(!Number.isFinite(observed)||!Number.isFinite(attempted)||!Number.isFinite(retry)||observed>now||attempted>now||retry>now)return false;
  if(s.season<currentSeason&&s.state==='ready'&&!s.provisional&&observed>0)return false;
  // Wait for an independent >=12h observation before attempting to seal stable weeks.
  const interval=s.provisional?12*3600000:24*3600000;
  return observed===0||now-observed>=interval;
 }).sort((a,b)=>Math.max(date(a.observedAt),date(a.attemptedAt))-Math.max(date(b.observedAt),date(b.attemptedAt))||a.season-b.season||a.leagueId.localeCompare(b.leagueId)||a.sourceId.localeCompare(b.sourceId)).slice(0,Math.max(0,Math.min(8,limit)));
}
export function maintenanceFailure(error:unknown){
 const message=error instanceof Error?error.message:'';
 if(/ownership|identities|source mismatch|dates|roster inventory|confirmed scored weeks|source bound/.test(message))return {kind:'source_evidence',delayMs:7*86400000};
 return {kind:'provider_or_processing',delayMs:6*3600000};
}
