/** Read-only end-to-end loader check; no account or player details are printed. */
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { draftArchiveDetail } from '../lib/draft-archive/detail';
async function main() {
  const samples=await prisma.$queryRaw<Array<{leagueId:string;sourceId:string;userId:string}>>(Prisma.sql`SELECT f."leagueId",f.metadata->>'sourceDraftId' AS "sourceId",l."userId" FROM dw_draft_facts f JOIN leagues l ON l.id=f."leagueId" WHERE f.sport='NFL' AND f.season=2026 AND lower(l.platform)='sleeper' AND f.metadata->>'sourceDraftId' ~ '^[0-9]+$' GROUP BY f."leagueId",f.metadata->>'sourceDraftId',l."userId" ORDER BY f."leagueId","sourceId" LIMIT 2`);
  for (const sample of samples) {
    const detail=await draftArchiveDetail(sample.leagueId,sample.userId,'imported:'+sample.sourceId);
    console.log(JSON.stringify({authorized:!!detail,picks:detail?.picks.length,references:detail?.references?.map(r=>({kind:r.kind,entries:r.entries.length,formatBasis:r.formatBasis})),results:detail?.resultsReport?.state,observed:!!detail?.resultsObservedAt,refresh:detail?.canRefreshResults}));
  }
}
main().catch(e=>{console.error('Analysis loader probe failed',e instanceof Error ? e.name : 'Unknown');process.exitCode=1;}).finally(()=>prisma.$disconnect());
