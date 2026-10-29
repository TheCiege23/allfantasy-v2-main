/** Read-only production audit. Supply DATABASE_URL securely through the deployment environment. */
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()
const sports = ['NFL','NBA','NHL','MLB','NCAAF','NCAAB','SOCCER','NCAABASE','WNBA']
async function main() {
  const now = Date.now()
  const runs = await prisma.syncJobRun.findMany({where:{jobName:'cron-sports-engagement',startedAt:{gte:new Date(now-10*60_000)}},orderBy:{startedAt:'desc'},take:10})
  const pending = await prisma.notificationOutbox.count({where:{status:{in:['pending','sending']},createdAt:{lt:new Date(now-120_000)},eventType:{in:['breaking_news','postseason_clinch','game_final','game_halftime','game_close','game_scoring_play','game_big_play']}}})
  const failed = await prisma.notificationOutbox.count({where:{status:'failed',createdAt:{gte:new Date(now-3600_000)}}})
  const latest = runs[0]
  const bySport = latest?.metadata?.bySport ?? {}
  const coverage = Object.fromEntries(sports.map(s=>[s,bySport[s]??{status:'not_observed'}]))
  const cadenceMs = runs.slice(1).map((r,i)=>runs[i].startedAt.getTime()-r.startedAt.getTime())
  const healthy = runs.length >= 3 && now-latest.startedAt.getTime()<180_000 && cadenceMs.every(n=>n<=180_000) && sports.every(s=>bySport[s]?.status==='success') && pending===0 && failed===0
  console.log(JSON.stringify({checkedAt:new Date().toISOString(),healthy,latestRunAt:latest?.startedAt,coverage,cadenceMs,overdueTransports:pending,failedTransports:failed,note:'Provider acceptance is not proof of display on a phone; offseason success is feed coverage, not a real event delivery.'},null,2))
  if(!healthy) process.exitCode=2
}
main().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>prisma.$disconnect())
