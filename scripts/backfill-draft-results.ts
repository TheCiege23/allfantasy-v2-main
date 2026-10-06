/** Bounded read-only rehearsal unless --apply; original historical facts are never modified. */
import { Prisma } from '@prisma/client';
import { createRequire } from 'node:module';
import { prisma } from '../lib/prisma';
import { getDatabaseUrlOrThrow } from '../lib/env/database-url';
import { captureImportedResults } from '../lib/draft-archive/ingestion/importedResults';
import { referenceStorageKey } from '../lib/draft-archive/references';
import { draftBackfillOptions } from '../lib/draft-archive/backfillOptions';
const { identifyTarget }=createRequire(import.meta.url)('./db-target-identity.cjs');
async function main() {
  const apply=process.argv.includes('--apply'),target=identifyTarget(getDatabaseUrlOrThrow());
  if (apply && (target.kind==='production'?!process.argv.includes('--production'):target.kind!=='safe')) throw new Error('Verified target required');
  const {fromSeason,throughSeason,limit,offset}=draftBackfillOptions(process.argv.slice(2));
  const inventory=await prisma.$queryRaw<Array<{total:bigint}>>(Prisma.sql`SELECT count(*) AS total FROM (SELECT f."leagueId",f.season,f.metadata->>'sourceDraftId' FROM dw_draft_facts f JOIN leagues l ON l.id=f."leagueId" WHERE f.sport='NFL' AND f.season BETWEEN ${fromSeason} AND ${throughSeason} AND lower(l.platform)='sleeper' AND f.metadata->>'sourceDraftId' ~ '^[0-9]+$' GROUP BY f."leagueId",f.season,f.metadata->>'sourceDraftId') sources`);
  const total=Number(inventory[0]?.total??0);
  if(process.argv.includes('--inventory-only')){
    const seasons=await prisma.$queryRaw<Array<{season:number;archives:bigint;scheduleWeeks:bigint}>>(Prisma.sql`SELECT s.season,count(*) AS archives,(SELECT count(DISTINCT g.week) FROM "SportsGame" g WHERE g.sport='NFL' AND g.season=s.season AND g."seasonType"='regular' AND g."startTime" IS NOT NULL) AS "scheduleWeeks" FROM (SELECT f."leagueId",f.season,f.metadata->>'sourceDraftId' AS source FROM dw_draft_facts f JOIN leagues l ON l.id=f."leagueId" WHERE f.sport='NFL' AND f.season BETWEEN ${fromSeason} AND ${throughSeason} AND lower(l.platform)='sleeper' AND f.metadata->>'sourceDraftId' ~ '^[0-9]+$' GROUP BY f."leagueId",f.season,f.metadata->>'sourceDraftId') s GROUP BY s.season ORDER BY s.season`);
    console.log(JSON.stringify({mode:'inventory',target:target.kind,total,seasons:seasons.map(s=>({season:s.season,archives:Number(s.archives),scheduleWeeks:Number(s.scheduleWeeks)}))}));return;
  }
  const all=process.argv.includes('--all-batches'),missing=process.argv.includes('--missing-weekly');
  if(missing&&(!all||offset!==0))throw new Error('Missing-weekly retry requires the full inventory at offset zero');
  if(all&&total-offset>2000)throw new Error('Historical job exceeds 2000-source bound; narrow seasons');
  let drafts=await prisma.$queryRaw<Array<{leagueId:string;sourceId:string}>>(Prisma.sql`SELECT f."leagueId",f.metadata->>'sourceDraftId' AS "sourceId" FROM dw_draft_facts f JOIN leagues l ON l.id=f."leagueId" WHERE f.sport='NFL' AND f.season BETWEEN ${fromSeason} AND ${throughSeason} AND lower(l.platform)='sleeper' AND f.metadata->>'sourceDraftId' ~ '^[0-9]+$' GROUP BY f."leagueId",f.season,f.metadata->>'sourceDraftId' ORDER BY f.season,f."leagueId","sourceId" LIMIT ${all?2001:limit} OFFSET ${offset}`);
  if(all&&drafts.length!==Math.max(0,total-offset))throw new Error('Historical inventory changed; retry before writing');
  const inventoryTotal=total;
  if(missing){
    const keys=drafts.map(d=>referenceStorageKey(d.leagueId+':imported:'+d.sourceId+':weekly-v3'));
    const observed=await prisma.aiAdpSnapshotHistory.findMany({where:{sport:'NFL',leagueType:'draft_results',formatKey:{in:keys}},distinct:['formatKey'],select:{formatKey:true}});
    const existing=new Set(observed.map(r=>r.formatKey));
    drafts=drafts.filter((_,i)=>!existing.has(keys[i]));
  }
  const report={inventoryTotal,remaining:0,mode:apply?'apply':'dry-run',target:target.kind,fromSeason,throughSeason,offset,total:missing?drafts.length:total,nextOffset:offset+drafts.length<total?offset+drafts.length:null,examined:drafts.length,ready:0,partial:0,unavailable:0,failed:0,weeks:0,failureKinds:{} as Record<string,number>};
  const processSource=async(draft:typeof drafts[number])=>{try{const result=await captureImportedResults(draft.leagueId,'imported:'+draft.sourceId,apply);report[result.state]++;report.weeks+=result.weeks;}catch(error){report.failed++;const message=error instanceof Error?error.message:'';const kind=message.includes('Weekly roster evidence bound')?'roster_evidence_bound':message.includes('Final score evidence bound')?'score_evidence_bound':message.includes('refresh time bound')?'refresh_timeout':message.includes('Result evidence bound')?'selected_evidence_bound':message.includes('Result source bound')?'selection_bound':message.includes('mismatch')?'source_mismatch':message.includes('ownership')?'ownership_mismatch':message.includes('bound')?'processing_bound':message.includes('scored weeks')?'unscored':message.includes('roster inventory')?'roster_inventory':message.includes('dates')?'schedule_dates':'provider_or_source_unavailable';report.failureKinds[kind]=(report.failureKinds[kind]??0)+1;}};
  report.examined=0;
  for(let batch=0;batch<drafts.length;batch+=limit){
    const page=drafts.slice(batch,batch+limit);
    for(let i=0;i<page.length;i+=2)await Promise.all(page.slice(i,i+2).map(processSource));
    report.examined+=page.length;
    report.remaining=drafts.length-report.examined;
    report.nextOffset=missing?null:offset+report.examined<total?offset+report.examined:null;
    if(all)console.log(JSON.stringify(report));
  }
  if(!all)console.log(JSON.stringify(report));
}
main().catch(()=>{console.error('Historical result rehearsal failed');process.exitCode=1;}).finally(()=>prisma.$disconnect());
