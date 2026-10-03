/** Read-only replay of completed-trade originals; outputs aggregate counts, never manager details. */
import { PrismaClient } from '@prisma/client'
import { gradeTrade, mirrorTradeGrade, type TradeGradeView } from '../lib/decision-os/trade/tradeGrade'

async function main() {
  const wanted=process.argv.find(arg=>arg.startsWith('--db-host='))?.slice(10)
  const host=process.env.DATABASE_URL?new URL(process.env.DATABASE_URL).hostname:null
  if(!wanted||!host?.includes(wanted))throw new Error('Name the intended database host with --db-host before reading.')
  const prisma=new PrismaClient()
  try {
    const snapshots=await prisma.tradeAnalysisSnapshot.findMany({
      where:{snapshotType:'completed_trade_grade_v1',sleeperUsername:'system:completed-trade-grade'},
      select:{leagueId:true,contextKey:true,payloadJson:true},orderBy:{createdAt:'asc'},take:5000,
    })
    const originals=new Map<string,{grade:TradeGradeView;give:string[];get:string[];frozenAt:string;tradeId:string}>()
    let malformed=0
    for(const row of snapshots){
      const p=row.payloadJson as unknown as {grade:TradeGradeView;give:string[];get:string[];frozenAt:string;tradeId:string}
      if(!p?.grade?.graded||!Array.isArray(p.give)||!Array.isArray(p.get)){malformed++;continue}
      const key=`${row.leagueId}:${row.contextKey}`
      if(!originals.has(key))originals.set(key,p)
    }
    const tradeDates=await prisma.leagueTrade.findMany({where:{transactionId:{in:[...new Set([...originals.values()].map(row=>row.tradeId))]}},select:{transactionId:true,tradeDate:true},take:10000})
    const dates=new Map(tradeDates.filter(row=>row.tradeDate).map(row=>[row.transactionId,row.tradeDate!]))
    let replayed=0,mismatched=0,mirrorFailures=0,preservedLaterThanTradeDay=0,tradeDateMissing=0
    const letters:Record<string,number>={}
    for(const row of originals.values()){
      const g=row.grade;if(!g.graded)continue
      const replay=gradeTrade({...g,unpriced:g.lines.filter(line=>line.leagueValue==null).length,giveCount:row.give.length,getCount:row.get.length})
      replayed++;letters[g.letter]=(letters[g.letter]??0)+1
      if(!replay.graded||replay.letter!==g.letter||replay.partnerLetter!==g.partnerLetter)mismatched++
      const mirrored=mirrorTradeGrade(g)
      if(!mirrored.graded||mirrored.letter!==g.partnerLetter||mirrored.partnerLetter!==g.letter)mirrorFailures++
      const executed=dates.get(row.tradeId)
      if(!executed)tradeDateMissing++
      else if(new Date(row.frozenAt).getTime()-executed.getTime()>86_400_000)preservedLaterThanTradeDay++
    }
    console.log(JSON.stringify({auditedAt:new Date().toISOString(),snapshotLimit:5000,limitReached:snapshots.length===5000,rowsRead:snapshots.length,originals:originals.size,malformed,replayed,mismatched,mirrorFailures,letters,preservedLaterThanTradeDay,tradeDateMissing,
      interpretation:'Replay checks consistency, not predictive accuracy. Later preservation is not trade-day knowledge. Completed-only data cannot calibrate acceptance probability; current prices cannot substitute for historical quotes.'},null,2))
    if(mismatched||mirrorFailures||malformed)process.exitCode=1
  } finally {await prisma.$disconnect()}
}
main().catch(()=>{console.error('Completed-trade audit failed; no writes were performed.');process.exitCode=1})
