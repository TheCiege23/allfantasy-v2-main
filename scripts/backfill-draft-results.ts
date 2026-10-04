/** Bounded read-only rehearsal unless --apply; original historical facts are never modified. */
import { Prisma } from '@prisma/client';
import { createRequire } from 'node:module';
import { prisma } from '../lib/prisma';
import { getDatabaseUrlOrThrow } from '../lib/env/database-url';
import { captureImportedResults } from '../lib/draft-archive/importedResults';
const { identifyTarget }=createRequire(import.meta.url)('./db-target-identity.cjs');
async function main() {
  const apply=process.argv.includes('--apply'),target=identifyTarget(getDatabaseUrlOrThrow());
  if (apply && (target.kind==='production'?!process.argv.includes('--production'):target.kind!=='safe')) throw new Error('Verified target required');
  const limit=Math.max(1,Math.min(20,Number(process.argv.find(v=>v.startsWith('--limit='))?.split('=')[1])||2));
  const drafts=await prisma.$queryRaw<Array<{leagueId:string;sourceId:string}>>(Prisma.sql`SELECT f."leagueId",f.metadata->>'sourceDraftId' AS "sourceId" FROM dw_draft_facts f JOIN leagues l ON l.id=f."leagueId" WHERE f.sport='NFL' AND f.season=2026 AND lower(l.platform)='sleeper' AND f.metadata->>'sourceDraftId' ~ '^[0-9]+$' GROUP BY f."leagueId",f.metadata->>'sourceDraftId' ORDER BY f."leagueId","sourceId" LIMIT ${limit}`);
  const report={mode:apply?'apply':'dry-run',target:target.kind,examined:drafts.length,ready:0,partial:0,unavailable:0,failed:0,weeks:0};
  for (const draft of drafts) {try {const result=await captureImportedResults(draft.leagueId,'imported:'+draft.sourceId,apply);report[result.state]++;report.weeks+=result.weeks;}catch{report.failed++;}}
  console.log(JSON.stringify(report));
}
main().catch(()=>{console.error('Historical result rehearsal failed');process.exitCode=1;}).finally(()=>prisma.$disconnect());
