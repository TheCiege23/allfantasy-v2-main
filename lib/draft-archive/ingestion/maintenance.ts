import {randomUUID} from 'node:crypto';
import {Prisma} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import {createRunBudget} from '@/lib/cron/runBudget';
import {referenceStorageKey} from '../references';
import {maintenanceQueue,maintenanceFailure,type MaintenanceSource} from '../maintenancePolicy';
import {captureImportedResults} from './importedResults';
const obj=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const attemptKey=(s:{leagueId:string;sourceId:string})=>'draft-maintenance:'+referenceStorageKey(s.leagueId+':'+s.sourceId);
/** Existing reconciler owns score validation. This job only schedules bounded independent observations. */
export async function maintainDraftResults(budgetMs=180000){
 const now=new Date(),token=randomUUID(),leaseKey='draft-analysis-maintenance:lease:v1',budget=createRunBudget(Math.min(180000,Math.max(0,budgetMs)));
 const claimed=await prisma.$executeRaw(Prisma.sql`INSERT INTO "SportsDataCache" ("key",data,"expiresAt","createdAt") VALUES (${leaseKey},${JSON.stringify({token})}::jsonb,${new Date(now.getTime()+300000)},now()) ON CONFLICT ("key") DO UPDATE SET data=EXCLUDED.data,"expiresAt"=EXCLUDED."expiresAt" WHERE "SportsDataCache"."expiresAt"<=now()`);
 if(!claimed)return {skipped:'already_running',inventory:0,selected:0,examined:0,ready:0,partial:0,unavailable:0,failed:0,elapsedMs:budget.elapsedMs()};
 try{
 const inventory=await prisma.$queryRaw<Array<{leagueId:string;sourceId:string;season:number}>>(Prisma.sql`SELECT f."leagueId",f.metadata->>'sourceDraftId' AS "sourceId",f.season FROM dw_draft_facts f JOIN leagues l ON l.id=f."leagueId" WHERE f.sport='NFL' AND f.season BETWEEN 2019 AND ${now.getUTCFullYear()} AND lower(l.platform)='sleeper' AND f.metadata->>'sourceDraftId' ~ '^[0-9]+$' GROUP BY f."leagueId",f.season,f.metadata->>'sourceDraftId' ORDER BY f.season,f."leagueId","sourceId" LIMIT 2001`);
 if(inventory.length>2000)throw new Error('Draft maintenance inventory bound exceeded');
 if(!inventory.length)return {inventory:0,selected:0,examined:0,ready:0,partial:0,unavailable:0,failed:0,elapsedMs:budget.elapsedMs()};
 const keys=inventory.map(s=>referenceStorageKey(s.leagueId+':imported:'+s.sourceId+':weekly-v3'));
 const observed=await prisma.$queryRaw<Array<{formatKey:string;computedAt:Date;state:string|null;provisional:string|null}>>(Prisma.sql`SELECT DISTINCT ON ("formatKey") "formatKey","computedAt","snapshotData"->'report'->>'state' AS state,"snapshotData"->'report'->>'provisional' AS provisional FROM ai_adp_snapshot_history WHERE sport='NFL' AND "leagueType"='draft_results' AND "formatKey" IN (${Prisma.join(keys)}) AND "snapshotData"->>'version'='draft-results-v3' ORDER BY "formatKey","computedAt" DESC,id DESC`);
 const attempts=await prisma.sportsDataCache.findMany({where:{cacheKey:{in:inventory.map(attemptKey)}},select:{cacheKey:true,data:true},take:2000});
 const byObservation=new Map(observed.map(s=>[s.formatKey,s])),byAttempt=new Map(attempts.map(s=>[s.cacheKey,obj(s.data)]));
 const sources:MaintenanceSource[]=inventory.map((s,i)=>{const o=byObservation.get(keys[i]),a=byAttempt.get(attemptKey(s));return {...s,observedAt:o?.computedAt.toISOString()??null,state:o?.state??null,provisional:o?.provisional!=='false',attemptedAt:typeof a?.attemptedAt==='string'?a.attemptedAt:null,retryAt:typeof a?.retryAt==='string'?a.retryAt:null};});
 const queue=maintenanceQueue(sources,now.getTime(),now.getUTCFullYear());
 const report={inventory:inventory.length,selected:queue.length,examined:0,ready:0,partial:0,unavailable:0,failed:0,elapsedMs:0};
 for(const s of queue){
  if(budget.remainingMs()<100000)break;
  const attemptedAt=new Date();let retryAt=new Date(attemptedAt.getTime()+12*3600000),kind='observed';
  try{const result=await captureImportedResults(s.leagueId,'imported:'+s.sourceId,true);report[result.state]++;if(result.state==='unavailable'){kind='source_evidence';retryAt=new Date(attemptedAt.getTime()+7*86400000);}}
  catch(error){report.failed++;const failure=maintenanceFailure(error);kind=failure.kind;retryAt=new Date(attemptedAt.getTime()+failure.delayMs);}
  await prisma.sportsDataCache.upsert({where:{cacheKey:attemptKey(s)},create:{cacheKey:attemptKey(s),data:{attemptedAt:attemptedAt.toISOString(),retryAt:retryAt.toISOString(),kind},expiresAt:new Date(attemptedAt.getTime()+30*86400000)},update:{data:{attemptedAt:attemptedAt.toISOString(),retryAt:retryAt.toISOString(),kind},expiresAt:new Date(attemptedAt.getTime()+30*86400000)}});
  report.examined++;
 }
 report.elapsedMs=budget.elapsedMs();return report;
 }finally{await prisma.sportsDataCache.deleteMany({where:{cacheKey:leaseKey,data:{path:['token'],equals:token}}});}
}
