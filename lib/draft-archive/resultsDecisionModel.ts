import type { AnalysisSelection } from './analysisModel';
export type WeeklyContribution={rosterId:string;playerId:string;points:number;isStarter:boolean;week:number;held?:boolean};
export type PlayerContribution={playerId:string;name:string;rosterId:string;state:'complete'|'partial';weeks:Array<{week:number;points:number;starter:boolean;held?:boolean}>;expectedWeeks:number;totalPoints:number;starterPoints:number;starts:number;usage:number|null;earlyStarterPoints:number|null;lateStarterPoints:number|null};
/** Observed original-team usage, never hypothetical replacement production or missing-week zeroes. */
export function playerContributions(picks:AnalysisSelection[],rows:WeeklyContribution[],finalWeeks:number[]):PlayerContribution[]{
  if(rows.length>10000||picks.length>1000)return [];
  const weeks=[...new Set(finalWeeks)].filter(w=>Number.isInteger(w)&&w>=1&&w<=18).sort((a,b)=>a-b);
  if(!weeks.length)return [];
  return picks.flatMap(p=>{
    if(!p.playerId||!p.rosterId)return [];
    const matching=rows.filter(r=>r.playerId===p.playerId&&r.rosterId===p.rosterId&&weeks.includes(r.week));
    if(new Set(matching.map(r=>r.week)).size!==matching.length||matching.some(r=>!Number.isFinite(r.points)||typeof r.isStarter!=='boolean'))return [];
    const covered=matching.sort((a,b)=>a.week-b.week),complete=covered.length===weeks.length,mid=Math.ceil(weeks.length/2);
    const starter=(included:number[])=>covered.filter(r=>r.isStarter&&included.includes(r.week)).reduce((s,r)=>s+r.points,0);
    return [{playerId:p.playerId,name:p.playerName,rosterId:p.rosterId,state:complete?'complete' as const:'partial' as const,weeks:covered.map(r=>({week:r.week,points:r.points,starter:r.isStarter,...(typeof r.held==='boolean'?{held:r.held}:{})})),expectedWeeks:weeks.length,totalPoints:covered.reduce((s,r)=>s+r.points,0),starterPoints:starter(weeks),starts:covered.filter(r=>r.isStarter).length,usage:complete?covered.filter(r=>r.isStarter).length/weeks.length:null,earlyStarterPoints:complete?starter(weeks.slice(0,mid)):null,lateStarterPoints:complete?starter(weeks.slice(mid)):null}];
  });
}
