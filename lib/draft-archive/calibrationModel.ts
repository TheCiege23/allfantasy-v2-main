import { PHASE4_VERSION, type DecisionComponents } from './phase4Model';
export const CALIBRATION_VERSION = 'draft-calibration-v1';
export type CalibrationCohort = { leagueId:string; draftId:string; season:number; startedAt:string; observedAt:string; finalThroughWeek:number; teams:Array<{ rosterId:string; components:[number,number,number,number]; outcome:number }> };
export type CalibrationModel = {
  version:typeof CALIBRATION_VERSION; featureVersion:typeof PHASE4_VERSION; state:'validated'|'insufficient_data'|'failed_validation';
  observedAt:string; weights:[number,number,number,number]|null; trainingLeagues:number; holdoutLeagues:number; trainingTeams:number; holdoutTeams:number;
  holdoutSeason:number|null; baselineError:number|null; modelError:number|null; improvement:number|null; reason:string;
  target:'original-team-final-starter-contribution-percentile';
};
const predict = (x:number[],w:number[]) => x.reduce((s,v,i)=>s+v*w[i],0);
const error = (rows:CalibrationCohort['teams'],weights:number[]) => rows.reduce((s,r)=>s+Math.abs(predict(r.components,weights)-r.outcome),0)/rows.length;
/** Whole leagues stay in one split. The latest season is held out, never used to choose weights. */
export function calibrateDraftModel(cohorts:CalibrationCohort[], now=new Date()): CalibrationModel {
  const base:CalibrationModel={version:CALIBRATION_VERSION,featureVersion:PHASE4_VERSION,state:'insufficient_data',observedAt:now.toISOString(),weights:null,trainingLeagues:0,holdoutLeagues:0,trainingTeams:0,holdoutTeams:0,holdoutSeason:null,baselineError:null,modelError:null,improvement:null,reason:'At least 30 independent training leagues and 15 independent later-season holdout leagues with complete final-week contribution coverage are required.',target:'original-team-final-starter-contribution-percentile'};
  if (cohorts.length>500) return base;
  const seen=new Set<string>();
  const valid=cohorts.filter(c=>{
    if (seen.has(c.draftId)) return false; seen.add(c.draftId);
    const start=Date.parse(c.startedAt), observed=Date.parse(c.observedAt);
    return c.leagueId && c.draftId && Number.isInteger(c.season) && c.finalThroughWeek>=14 && c.finalThroughWeek<=18 && Number.isFinite(start) && Number.isFinite(observed) && start<observed && observed<=now.getTime() && c.teams.length>=2 && c.teams.length<=32 && new Set(c.teams.map(t=>t.rosterId)).size===c.teams.length && c.teams.every(t=>t.components.length===4 && [...t.components,t.outcome].every(v=>Number.isFinite(v)&&v>=0&&v<=100));
  });
  const seasons=[...new Set(valid.map(c=>c.season))].sort((a,b)=>a-b);
  if (seasons.length<2) return base;
  const holdoutSeason=seasons[seasons.length-1], holdout=valid.filter(c=>c.season===holdoutSeason), holdoutIds=new Set(holdout.map(c=>c.leagueId));
  const train=valid.filter(c=>c.season<holdoutSeason && !holdoutIds.has(c.leagueId));
  // Multiple drafts in a league do not manufacture independent samples.
  const dedup=(items:CalibrationCohort[])=>[...new Map([...items].sort((a,b)=>a.startedAt.localeCompare(b.startedAt)).map(c=>[c.leagueId,c])).values()];
  const training=dedup(train), testing=dedup(holdout), trainRows=training.flatMap(c=>c.teams), testRows=testing.flatMap(c=>c.teams);
  const counts={...base,holdoutSeason,trainingLeagues:training.length,holdoutLeagues:testing.length,trainingTeams:trainRows.length,holdoutTeams:testRows.length};
  if (training.length<30 || testing.length<15) return counts;
  let weights:[number,number,number,number]=[1,0,0,0], trainError=error(trainRows,weights);
  for(let a=0;a<=10;a++)for(let b=0;b<=10-a;b++)for(let c=0;c<=10-a-b;c++){
    const candidate:[number,number,number,number]=[a/10,b/10,c/10,(10-a-b-c)/10], e=error(trainRows,candidate);
    if(e<trainError-1e-9){weights=candidate;trainError=e;}
  }
  const baselineError=error(testRows,[1,0,0,0]),modelError=error(testRows,weights),improvement=baselineError>0?(baselineError-modelError)/baselineError:0;
  const validated=improvement>=.1 && modelError<=20;
  return {...counts,state:validated?'validated':'failed_validation',weights:validated?weights:null,baselineError,modelError,improvement,reason:validated?'Weights selected only on older independent leagues improved held-out percentile error by at least 10% over starter-strength-only rankings. This estimates relative original-team starter contribution, not win probability.':'Held-out accuracy did not meet the publication criteria. No weighted letter grade is published.'};
}
export function validCalibration(value:unknown,now=new Date()):CalibrationModel|null {
  if(!value || typeof value!=='object')return null;
  const m=value as CalibrationModel;
  if(m.version!==CALIBRATION_VERSION || m.featureVersion!==PHASE4_VERSION || m.target!=='original-team-final-starter-contribution-percentile' || !['validated','insufficient_data','failed_validation'].includes(m.state) || typeof m.observedAt!=='string' || !Number.isFinite(Date.parse(m.observedAt)) || Date.parse(m.observedAt)>now.getTime())return null;
  if(m.state==='validated' && (!Array.isArray(m.weights)||m.weights.length!==4||m.weights.some(v=>!Number.isFinite(v)||v<0||v>1)||Math.abs(m.weights.reduce((s,v)=>s+v,0)-1)>1e-9||m.trainingLeagues<30||m.holdoutLeagues<15||!Number.isFinite(m.modelError)||m.modelError!>20||!Number.isFinite(m.improvement)||m.improvement!<.1))return null;
  const counts=[m.trainingLeagues,m.holdoutLeagues,m.trainingTeams,m.holdoutTeams];
  if(counts.some(v=>!Number.isInteger(v)||v<0||v>16000)||m.trainingTeams<m.trainingLeagues*2||m.holdoutTeams<m.holdoutLeagues*2||!(m.holdoutSeason===null||(Number.isInteger(m.holdoutSeason)&&m.holdoutSeason>=1900&&m.holdoutSeason<=2100))||typeof m.reason!=='string'||m.reason.length>2000)return null;
  if([m.baselineError,m.modelError].some(v=>v!==null&&(!Number.isFinite(v)||v<0||v>100))||!(m.improvement===null||(Number.isFinite(m.improvement)&&m.improvement<=1)))return null;
  if(m.state!=='validated'&&m.weights!==null)return null;
  if(m.state==='validated'&&(m.holdoutSeason===null||m.baselineError===null||m.baselineError<=0||m.modelError===null||m.improvement===null||Math.abs((m.baselineError-m.modelError)/m.baselineError-m.improvement)>1e-6))return null;
  return {version:CALIBRATION_VERSION,featureVersion:PHASE4_VERSION,state:m.state,observedAt:m.observedAt,weights:m.weights? [...m.weights] as [number,number,number,number]:null,trainingLeagues:m.trainingLeagues,holdoutLeagues:m.holdoutLeagues,trainingTeams:m.trainingTeams,holdoutTeams:m.holdoutTeams,holdoutSeason:m.holdoutSeason,baselineError:m.baselineError,modelError:m.modelError,improvement:m.improvement,reason:m.reason,target:m.target};
}
export function calibratedScores(rows:DecisionComponents[],model:CalibrationModel|null,season:number|null=null,start:string|null=null){
  return rows.map(r=>{
    const score=model?.state==='validated' && model.weights && season!==null && model.holdoutSeason!==null && season>model.holdoutSeason && start!==null && Date.parse(model.observedAt)<=Date.parse(start) && r.scores.every(v=>v!==null) ? predict(r.scores as number[],model.weights):null;
    return {rosterId:r.rosterId,score,grade:score===null?null:score>=90?'A':score>=75?'B':score>=50?'C':score>=25?'D':'F'};
  });
}
