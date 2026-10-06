/** Read-only end-to-end loader check; no account or player details are printed. */
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { readImportedResults } from '../lib/draft-archive/importedResults';
import { canViewLeague } from '../server/services/permissionService';
import { draftBackfillOptions } from '../lib/draft-archive/backfillOptions';
async function main() {
  const {fromSeason,throughSeason,limit,offset}=draftBackfillOptions(process.argv.slice(2));
  const samples=await prisma.$queryRaw<Array<{leagueId:string;sourceId:string;userId:string;season:number}>>(Prisma.sql`SELECT f."leagueId",f.season,f.metadata->>'sourceDraftId' AS "sourceId",l."userId" FROM dw_draft_facts f JOIN leagues l ON l.id=f."leagueId" WHERE f.sport='NFL' AND f.season BETWEEN ${fromSeason} AND ${throughSeason} AND lower(l.platform)='sleeper' AND f.metadata->>'sourceDraftId' ~ '^[0-9]+$' GROUP BY f."leagueId",f.season,f.metadata->>'sourceDraftId',l."userId" ORDER BY f.season,f."leagueId","sourceId" LIMIT ${limit} OFFSET ${offset}`);
  for (const sample of samples) {
    if (process.argv.includes('--weekly-only')) {
      if (!await canViewLeague(sample.leagueId,sample.userId)) throw new Error('Weekly probe access denied');
      const facts=await prisma.draftFact.findMany({where:{leagueId:sample.leagueId,sport:'NFL',season:sample.season,metadata:{path:['sourceDraftId'],equals:sample.sourceId}},take:1001,select:{playerId:true,metadata:true}});
      if (facts.length>1000) throw new Error('Weekly probe bound exceeded');
      const object=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
      const picks=facts.map(f=>{const meta=object(f.metadata),player=object(meta.playerSnapshot);return{playerId:f.playerId,rosterId:typeof meta.selectionRosterId==='string'||typeof meta.selectionRosterId==='number'?String(meta.selectionRosterId):null,playerName:typeof player.name==='string'?player.name:'Recorded player',position:typeof player.position==='string'?player.position:'Unknown',keeper:meta.isKeeper===true};});
      const observation=await readImportedResults(sample.leagueId,'imported:'+sample.sourceId,picks);
      if (!observation?.contributions) throw new Error('Verified weekly observation unavailable');
      console.log(JSON.stringify({mode:'weekly-only',authorized:true,picks:picks.length,results:observation.report.state,provisional:observation.report.provisional,playersWithWeeklyEvidence:observation.contributions.filter(p=>p.weeks.length>0).length,recordedPlayerWeeks:observation.contributions.reduce((sum,p)=>sum+p.weeks.length,0)}));
      continue;
    }
    const { draftArchiveDetail }=await import('../lib/draft-archive/detail');
    const detail=await draftArchiveDetail(sample.leagueId,sample.userId,'imported:'+sample.sourceId);
    console.log(JSON.stringify({authorized:!!detail,picks:detail?.picks.length,references:detail?.references?.map(r=>({kind:r.kind,entries:r.entries.length,formatBasis:r.formatBasis})),results:detail?.resultsReport?.state,provisional:detail?.resultsReport?.provisional,observed:!!detail?.resultsObservedAt,refresh:detail?.canRefreshResults,playersWithWeeklyEvidence:detail?.phase4?.contributions?.filter(p=>p.weeks.length>0).length,recordedPlayerWeeks:detail?.phase4?.contributions?.reduce((sum,p)=>sum+p.weeks.length,0)}));
  }
}
main().catch(e=>{console.error('Analysis loader probe failed',e instanceof Error ? e.name : 'Unknown');process.exitCode=1;}).finally(()=>prisma.$disconnect());
