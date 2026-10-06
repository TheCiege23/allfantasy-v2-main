/** Public schedule dates only; no league/player data is sent to ESPN. Dry-run by default. */
import {createRequire} from 'node:module'
import {prisma} from '../lib/prisma'
import {getDatabaseUrlOrThrow} from '../lib/env/database-url'
import {draftBackfillOptions} from '../lib/draft-archive/backfillOptions'
import {historicalNflSchedule} from '../lib/draft-archive/historicalScheduleModel'
const {identifyTarget}=createRequire(import.meta.url)('./db-target-identity.cjs')
async function main(){
 const apply=process.argv.includes('--apply'),target=identifyTarget(getDatabaseUrlOrThrow())
 if(apply&&(target.kind==='production'?!process.argv.includes('--production'):target.kind!=='safe'))throw new Error('Verified target required')
 const {fromSeason,throughSeason}=draftBackfillOptions(process.argv.slice(2))
 if(fromSeason<2018||throughSeason>=new Date().getUTCFullYear()||throughSeason-fromSeason>9)throw new Error('Bounded completed historical seasons only')
 for(let season=fromSeason;season<=throughSeason;season++){
  const payloads=[]
  for(const calendar of [season,season+1]){
   const response=await fetch('https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates='+calendar+'&limit=400',{signal:AbortSignal.timeout(15000)})
   if(!response.ok)throw new Error('Historical schedule provider unavailable')
   payloads.push(await response.json())
  }
  const games=historicalNflSchedule(payloads,season),now=new Date()
  const result=apply?await prisma.sportsGame.createMany({skipDuplicates:true,data:games.map(g=>({...g,sport:'NFL',season,seasonType:'regular',source:'espn_draft_history_v1',fetchedAt:now,expiresAt:new Date(now.getTime()+86400000*365),raw:{version:1,provider:'ESPN scoreboard',season,observedAt:now.toISOString()}}))}):null
  console.log(JSON.stringify({mode:apply?'apply':'dry-run',target:target.kind,season,games:games.length,weeks:new Set(games.map(g=>g.week)).size,inserted:result?.count??0}))
 }
}
main().catch(e=>{console.error('Historical schedule import failed',e instanceof Error?e.message:'Unknown');process.exitCode=1}).finally(()=>prisma.$disconnect())
