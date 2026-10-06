import {weeklyOutcomes,validatedWeeklyRosterEvidence,type WeeklyRosterEvidence} from './weeklyOutcomeModel';
import { resultsReport, type AnalysisSelection } from './analysisModel';
import { playerContributions, type WeeklyContribution } from './resultsDecisionModel';

export type ImportedWeeklyEvidence = {
  selections: Array<{playerId:string;rosterId:string}>;
  expectedWeeks: number[];
  rows: Array<WeeklyContribution & {held:boolean}>;
  completeDraft: boolean;
  weekEvidence?:WeeklyRosterEvidence[];
};
const obj = (v:unknown):Record<string,unknown> => v && typeof v==='object' && !Array.isArray(v) ? v as Record<string,unknown> : {};
const identity = (p:{playerId:string|null;rosterId:string|null}) => JSON.stringify([p.playerId,p.rosterId]);
/** Recompute observations from bounded evidence, tied to the currently selected archive. */
export function importedWeeklyReport(raw:unknown,picks:AnalysisSelection[],teams:Array<{rosterId:string;name:string}>) {
  const v=obj(raw);
  if (!Array.isArray(v.selections)||!Array.isArray(v.expectedWeeks)||!Array.isArray(v.rows)||typeof v.completeDraft!=='boolean'||picks.length>1000||v.selections.length!==picks.length||v.expectedWeeks.length>18||v.rows.length>10000||teams.length<2||teams.length>32) return null;
  const selections=v.selections.map(obj),ids=new Set(picks.map(identity));
  if (!picks.length||ids.size!==picks.length||selections.length!==picks.length||new Set(teams.map(t=>t.rosterId)).size!==teams.length||picks.some(p=>!p.playerId||!p.rosterId||!teams.some(t=>t.rosterId===p.rosterId))||selections.some(p=>typeof p.playerId!=='string'||typeof p.rosterId!=='string'||!ids.has(identity(p as {playerId:string;rosterId:string})))||new Set(selections.map(p=>identity(p as {playerId:string;rosterId:string}))).size!==picks.length) return null;
  const weeks=v.expectedWeeks;
  if (weeks.length>18||new Set(weeks).size!==weeks.length||weeks.some(w=>typeof w!=='number'||!Number.isInteger(w)||w<1||w>18)) return null;
  const seen=new Set<string>(),rows:ImportedWeeklyEvidence['rows']=[];
  for (const value of v.rows) {
    const r=obj(value);
    if (typeof r.playerId!=='string'||typeof r.rosterId!=='string'||!ids.has(identity(r as {playerId:string;rosterId:string}))||typeof r.week!=='number'||!weeks.includes(r.week)||typeof r.points!=='number'||!Number.isFinite(r.points)||typeof r.isStarter!=='boolean'||typeof r.held!=='boolean'||(!r.held&&(r.points!==0||r.isStarter))) return null;
    const key=JSON.stringify([r.week,r.rosterId,r.playerId]);
    if (seen.has(key)) return null;
    seen.add(key);
    rows.push({playerId:r.playerId,rosterId:r.rosterId,week:r.week,points:r.points,isStarter:r.isStarter,held:r.held});
  }
  const report=resultsReport(picks,teams,rows,weeks as number[]);
  report.provisional=true;
  report.coverage='Provider-reported scored weeks at the displayed observation time. Original-team usage only; complete weekly rosters establish zero contribution after departure. Provisional observations are not final NFL totals, weekly replacement value or draft-decision grades.';
  if (!v.completeDraft) {report.state=report.teams.some(t=>t.coveredPicks)?'partial':'unavailable';for(const t of report.teams)t.rank=null;}
  const proof=v.weekEvidence===undefined?null:validatedWeeklyRosterEvidence(v.weekEvidence);
  if(v.weekEvidence!==undefined&&!proof)return null;
  const outcomes=proof?weeklyOutcomes(picks,weeks as number[],teams.map(t=>t.rosterId),proof):null;
  if(proof){
    for(const r of rows){
      const roster=proof.find(e=>e.week===r.week&&e.rosterId===r.rosterId),player=roster?.players.find(p=>p.playerId===r.playerId);
      if(!roster||(r.held?(!player||player.points!==r.points||player.starter!==r.isStarter):!!player))return null;
    }
    if(outcomes!.finalizedWeeks.length===weeks.length&&weeks.length>0&&report.state==='ready'){
      report.provisional=false;
      report.coverage='Recorded selecting-team contribution in reconciled, finalized weeks. Replacement comparisons use only recorded eligible bench players under the slot rules observed at refresh; they are hindsight comparisons, not waiver availability or causal draft grades.';
    }
  }
  return {report,...(outcomes?{outcomes}:{}),contributions:playerContributions(picks,rows,weeks as number[])};
}
