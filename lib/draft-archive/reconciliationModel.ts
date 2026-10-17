import {validatedWeeklyRosterEvidence,weeklyOutcomes,type WeeklyRosterEvidence} from './weeklyOutcomeModel'
/** Publication policy: unchanged complete rosters/scores >=12h apart, completed games >=36h after kickoff. */
export function stableFinalWeeks(current:WeeklyRosterEvidence[],previous:unknown,currentAt:string,previousAt:string,teams:string[],expected:number[],games:Array<{week:number|null;startTime:Date|null;status:string|null}>,now=new Date()){
 const older=validatedWeeklyRosterEvidence(previous),newAt=Date.parse(currentAt),oldAt=Date.parse(previousAt)
 if(!older||!Number.isFinite(newAt)||!Number.isFinite(oldAt)||newAt>now.getTime()||newAt-oldAt<12*3600000||games.length>1000)return []
 const shape=(rows:WeeklyRosterEvidence[],week:number)=>JSON.stringify(rows.filter(r=>r.week===week).sort((a,b)=>a.rosterId.localeCompare(b.rosterId)).map(r=>({rosterId:r.rosterId,players:[...r.players].sort((a,b)=>a.playerId.localeCompare(b.playerId)).map(p=>({playerId:p.playerId,points:p.points,starter:p.starter})),slots:r.slots})))
 const complete=weeklyOutcomes([],expected,teams,current.map(r=>({...r,players:r.players.map(p=>({...p,finalized:true}))}))).finalizedWeeks
 return complete.filter(week=>{
  const scheduled=games.filter(g=>g.week===week)
  return scheduled.length>0&&scheduled.every(g=>g.startTime&&g.startTime.getTime()<=now.getTime()-36*3600000&&g.status?.toLowerCase()==='final')&&shape(current,week)===shape(older,week)
 })
}
