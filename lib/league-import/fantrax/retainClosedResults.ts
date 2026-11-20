import type { FantraxScheduleRow, FantraxScoringPeriod } from './fantraxApi'

/** A partial refresh can return an entire closed slate as 0 games played. Preserve only
 * previously observed final scores with the same league, season, period and two provider IDs. */
export function retainClosedResults(fresh:FantraxScheduleRow[],previous:unknown,periods:FantraxScoringPeriod[],observedAt?:Date,now=new Date()){
  const prior=new Map<string,FantraxScheduleRow|null>()
  const key=(f:FantraxScheduleRow)=>JSON.stringify([f.week,...[f.homeTeamId,f.awayTeamId].sort(),f.isPlayoff])
  if(Array.isArray(previous))for(const row of previous as FantraxScheduleRow[]){
    if(!row || !row.homeTeamId || !row.awayTeamId)continue
    const k=key(row);prior.set(k,prior.has(k)?null:row)
  }
  const ends=new Map(periods.map(p=>[p.number,Date.parse(p.endDate??'')]))
  return fresh.map(f=>{
    if(f.played)return {...f,scoreObservedAt:now.toISOString()}
    const p=prior.get(key(f)), end=ends.get(f.week)
    if(!p?.played || !Number.isFinite(p.homeScore) || !Number.isFinite(p.awayScore) || !end)return f
    const stamp=p.scoreObservedAt ?? observedAt?.toISOString()
    if(!stamp || !(Date.parse(stamp)>end) || now.getTime()<=end)return f
    const direct=p.homeTeamId===f.homeTeamId
    return {...f,played:true,homeScore:direct?p.homeScore:p.awayScore,awayScore:direct?p.awayScore:p.homeScore,
      categoryOutcomes:p.categoryOutcomes,tiebreakWinnerId:p.tiebreakWinnerId,scoreObservedAt:stamp,retainedScore:true}
  })
}
