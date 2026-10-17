export type NativeAutoSubsAssignment={version:number;enabled:boolean;starters:string[];backups:Record<string,string>;updatedAt:string}
export const nativeAutoSubsKey=(leagueId:string,rosterId:string,season:number,week:number)=>`nativeAutoSubs:${JSON.stringify([leagueId,rosterId,season,week])}`
export const definiteInactive=(s:string|null)=>['OUT','INACTIVE','SCRATCHED','SCRATCH','RULED_OUT'].includes((s??'').trim().toUpperCase().replace(/\s+/g,'_'))
export function freshAutoSubsEvidence(p:{source:string;fetchedAt:Date;expiresAt:Date},now:number):boolean {
  return ['sleeper','rolling_insights','rolling-insights','api-sports','api_sports','thesportsdb','espn'].includes(p.source.toLowerCase()) && p.fetchedAt.getTime()<=now && now-p.fetchedAt.getTime()<=30*60_000 && p.expiresAt.getTime()>now
}
