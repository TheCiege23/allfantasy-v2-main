/** Rehearsal by default; no provider requests, raw IDs or league payloads are printed. */
import { createRequire } from 'node:module';
import { getDatabaseUrlOrThrow } from '../lib/env/database-url';
import { prisma } from '../lib/prisma';
import { recomputeDraftCalibration } from '../lib/draft-archive/ingestion/calibration';
const {identifyTarget}=createRequire(import.meta.url)('./db-target-identity.cjs');
async function main(){
  const apply=process.argv.includes('--apply'),target=identifyTarget(getDatabaseUrlOrThrow());
  if(apply&&(target.kind==='production'?!process.argv.includes('--production'):target.kind!=='safe'))throw new Error('Verified database target required');
  const limit=Number(process.argv.find(v=>v.startsWith('--limit='))?.slice(8)??100);
  const option=(name:string)=>process.argv.find(v=>v.startsWith('--'+name+'='))?.split('=')[1];
  const numeric=(name:string)=>option(name)===undefined?undefined:Number(option(name));
  const filters={fromSeason:numeric('from-season'),throughSeason:numeric('through-season'),leagueType:option('league-type'),purpose:option('purpose'),teamCount:numeric('team-count')};
  console.log(JSON.stringify({mode:apply?'apply':'dry-run',target:target.kind,...await recomputeDraftCalibration(apply,limit,filters)}));
}
main().catch(e=>{console.error('Calibration rehearsal failed',e instanceof Error?e.name:'Unknown');process.exitCode=1;}).finally(()=>prisma.$disconnect());
