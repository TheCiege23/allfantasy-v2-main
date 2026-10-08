import {recordCompletedSpan} from './rootTiming'
export type TeamReadPhase='league'|'roster'|'players'|'enrichment'|'matchup'|'identities'|'injuries'|'schedule'|'opponents'|'format'|'elimination'|'provider'|'bye'|'values'
/** Fixed names and numeric durations only. No request URLs, identities, SQL, roster or error content. */
export function teamLoadTiming(mode:'full'|'saved'|'alerts'|'portfolio'|'core-summary'){
 const started=performance.now(),phases:Partial<Record<TeamReadPhase,number>>={}
 return {
  async read<T>(phase:TeamReadPhase,load:()=>Promise<T>):Promise<T>{
   const start=performance.now(),spanStart=Date.now()
   try{return await load()}finally{
    phases[phase]=Math.max(0,Math.round(performance.now()-start))
    recordCompletedSpan({name:`team.${phase}`,op:'team.read',startedAtMs:spanStart,attributes:{'af.team.mode':mode}})
   }
  },
  finish(){
   try{const totalMs=Math.max(0,Math.round(performance.now()-started));if(totalMs>=2500)console.info('[team-load-timing]',JSON.stringify({mode,totalMs,phases}))}catch{/* Diagnostics cannot fail a page. */}
  },
 }
}
