import 'server-only';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { calibrateDraftModel, type CalibrationCohort } from '../calibrationModel';
import { calibrationKey } from '../phase4Loader';
import type { PreparationContext } from '@/lib/core-app/draftPreparationModel';
const obj=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
/** Offline, DB-only model ingestion. It never runs in a page render. */
export type CalibrationFilters={fromSeason?:number;throughSeason?:number;leagueType?:string;purpose?:string;teamCount?:number};
export function validateCalibrationFilters(f:CalibrationFilters){
  for(const year of [f.fromSeason,f.throughSeason])if(year!==undefined&&(!Number.isInteger(year)||year<1900||year>2100))throw new Error('Invalid calibration season');
  if(f.fromSeason!==undefined&&f.throughSeason!==undefined&&f.fromSeason>f.throughSeason)throw new Error('Invalid calibration season range');
  if(f.leagueType!==undefined&&!['redraft','dynasty','keeper'].includes(f.leagueType))throw new Error('Invalid calibration league type');
  if(f.purpose!==undefined&&!['standard','startup'].includes(f.purpose))throw new Error('Invalid calibration purpose');
  if(f.teamCount!==undefined&&(!Number.isInteger(f.teamCount)||f.teamCount<2||f.teamCount>32))throw new Error('Invalid calibration team count');
  return f;
}
export async function recomputeDraftCalibration(apply=false,limit=100,filters:CalibrationFilters={}){
  const f=validateCalibrationFilters(filters);
  const bound=Math.max(45,Math.min(200,Math.floor(limit)||100));
  // A draft-start v2 projection snapshot AND completed season coverage are prerequisites.
  const sources=await prisma.$queryRaw<Array<{id:string;leagueId:string;userId:string}>>(Prisma.sql`
    SELECT d.id,d."leagueId",l."userId" FROM draft_sessions d JOIN leagues l ON l.id=d."leagueId"
    WHERE d.status='completed' AND d."sessionKind"='live' AND l.sport='NFL' AND l."userId" IS NOT NULL
    AND EXISTS(SELECT 1 FROM audit_logs a WHERE a."leagueId"=d."leagueId" AND a."entityId"=d.id AND a."actionType"='draft_archive_event'
      AND a."afterState"->>'event'='start' AND a."afterState"->'snapshot'->'analysisBasis'->>'version'='draft-analysis-basis-v2'
      AND EXISTS(SELECT 1 FROM team_week_results w WHERE w."leagueId"=d."leagueId"
        AND w.season=CASE WHEN a."afterState"->'snapshot'->'context'->>'season' ~ '^[0-9]{4}$' THEN (a."afterState"->'snapshot'->'context'->>'season')::integer ELSE NULL END
        AND w.status='final' AND w.week>=14)
      AND (${f.fromSeason??null}::integer IS NULL OR CASE WHEN a."afterState"->'snapshot'->'context'->>'season' ~ '^[0-9]{4}$' THEN (a."afterState"->'snapshot'->'context'->>'season')::integer ELSE NULL END >= ${f.fromSeason??null})
      AND (${f.throughSeason??null}::integer IS NULL OR CASE WHEN a."afterState"->'snapshot'->'context'->>'season' ~ '^[0-9]{4}$' THEN (a."afterState"->'snapshot'->'context'->>'season')::integer ELSE NULL END <= ${f.throughSeason??null})
      AND (${f.leagueType??null}::text IS NULL OR a."afterState"->'snapshot'->'context'->>'leagueType'=${f.leagueType??null})
      AND (${f.purpose??null}::text IS NULL OR a."afterState"->'snapshot'->'context'->>'purpose'=${f.purpose??null})
      AND (${f.teamCount??null}::integer IS NULL OR a."afterState"->'snapshot'->'context'->>'teamCount'=${f.teamCount===undefined?null:String(f.teamCount)}))
    ORDER BY d."startedAt" DESC,d.id LIMIT ${bound+1}`);
  if(sources.length>bound)return {examined:0,eligible:0,models:0,validated:0,reason:'Cohort bound exceeded; narrow the input using season, league-type, purpose or team-count filters before publishing weights.'};
  const groups=new Map<string,{context:PreparationContext;cohorts:CalibrationCohort[]}>();let eligible=0,failed=0;
  // Import only when there is a candidate; no page/provider reads are used to create candidates.
  const detailReader=sources.length?(await import('../detail')).draftArchiveDetail:null;
  for(const source of sources){
    try{
      const detail=await detailReader!(source.leagueId,source.userId,'native:'+source.id),context=obj(detail?.snapshot).context as PreparationContext|undefined;
      const phase=detail?.phase4,results=detail?.resultsReport;
      if(!detail||!context||!phase||detail.analysisReport?.state!=='ready'||phase.replay.state!=='ready'||results?.state!=='ready'||results.provisional||!detail.startedAt||!detail.choice.season)continue;
      const weeks=results.teams[0]?.weeks??[],last=Math.max(...weeks);
      if(last<14||last>18||Array.from({length:last},(_,i)=>i+1).some(w=>results.teams.some(t=>!t.weeks.includes(w))))continue;
      const teams=phase.components.flatMap(c=>{
        const outcome=results.teams.find(t=>t.rosterId===c.rosterId);
        if(!outcome||c.scores.some(v=>v===null))return[];
        const lower=results.teams.filter(t=>t.starterPoints<outcome.starterPoints-1e-6).length,tied=results.teams.filter(t=>Math.abs(t.starterPoints-outcome.starterPoints)<=1e-6).length;
        return[{rosterId:c.rosterId,components:c.scores as [number,number,number,number],outcome:100*(lower+(tied-1)/2)/(results.teams.length-1)}];
      });
      if(teams.length!==context.teamCount)continue;
      const key=calibrationKey(context),group=groups.get(key)??{context,cohorts:[]};
      group.cohorts.push({leagueId:source.leagueId,draftId:source.id,season:detail.choice.season,startedAt:detail.startedAt,observedAt:new Date().toISOString(),finalThroughWeek:last,teams});groups.set(key,group);eligible++;
    }catch{failed++;}
  }
  if(failed)return{examined:sources.length,eligible,models:0,validated:0,failed,reason:'A source read failed; publication is blocked until every candidate is examined.'};
  let validated=0;
  for(const [key,group] of groups){
    const model=calibrateDraftModel(group.cohorts);if(model.state==='validated')validated++;
    const hash=createHash('sha256').update(JSON.stringify({key,model})).digest('hex');
    if(apply)await prisma.aiAdpSnapshotHistory.create({data:{id:'hqm-'+hash.slice(0,40),sport:group.context.sport,leagueType:'draft_model',formatKey:key,computedAt:new Date(model.observedAt),snapshotData:model as unknown as Prisma.InputJsonValue,totalDrafts:group.cohorts.length,totalPicks:model.trainingTeams+model.holdoutTeams}});
  }
  return{examined:sources.length,eligible,models:groups.size,validated,failed,reason:groups.size?'Publication depends on independent later-season validation.':'No complete historical v2 cohorts are available; weights and grades remain unavailable.'};
}
