import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { rateLimit } from '@/lib/rate-limit'
import { resolveLeagueMembership } from '@/lib/league-access'
import { resolveViewerLeagueRoster } from '@/lib/trade-intel/viewerLeagueRoster'
import { loadTrade } from '@/lib/decision-os/trade/loadTrade'
import { gradeInputsOf } from '@/lib/decision-os/trade/evaluateStoredTrade'
import { evaluateTrade } from '@/lib/decision-os/trade/evaluateTrade'
import { loadVisualImpact } from '@/lib/decision-os/trade/loadVisualImpact'
import { resolveTradePlayers } from '@/lib/decision-os/trade/tradePlayers'
import { gradeArchivedTradeRows } from '@/lib/core-app/archivedTradeGrade'
import type { TradeGradeView } from '@/lib/decision-os/trade/tradeGrade'
export const dynamic = 'force-dynamic'
const Ref = z.discriminatedUnion('kind',[
  z.object({kind:z.literal('af'),tradeId:z.string().min(1).max(128)}),
  z.object({kind:z.literal('redraft'),proposalId:z.string().min(1).max(128)}),
  z.object({kind:z.literal('provider'),provider:z.literal('sleeper'),providerTradeId:z.string().min(1).max(128)}),
  z.object({kind:z.literal('archive'),transactionId:z.string().min(1).max(128)}),
])
const Body = z.object({leagueId:z.string().min(1).max(64),trade:Ref})
export async function POST(req:Request) {
  const session = await getServerSession(authOptions as never) as {user?:{id?:string}}|null
  const userId=session?.user?.id
  if (!userId) return NextResponse.json({error:'Sign in required'},{status:401})
  if (!rateLimit(`trade-impact-now:${userId}`,10,60_000).success) return NextResponse.json({error:'Too many reviews; try again shortly.'},{status:429})
  const parsed = Body.safeParse(await req.json().catch(()=>null))
  if (!parsed.success) return NextResponse.json({error:'Invalid trade reference'},{status:400})
  const {leagueId,trade:ref}=parsed.data
  if (!(await resolveLeagueMembership(leagueId,userId)).ok) return NextResponse.json({error:'League access required'},{status:403})
  try {
    let sent:string[]=[],received:string[]=[],grade:TradeGradeView|null=null
    const names=new Map<string,string>()
    let nonPlayers=false
    if (ref.kind==='archive') {
      const [league,viewer] = await Promise.all([prisma.league.findUnique({where:{id:leagueId},select:{platformLeagueId:true,platform:true,sport:true}}),resolveViewerLeagueRoster(leagueId,userId)])
      if (!viewer.ok || !league?.platformLeagueId || league.platform?.toLowerCase()!=='sleeper') return NextResponse.json({error:'Claim your team in this imported league before reviewing its trades.'},{status:403})
      // Exact league + manager + transaction: never accepts a client-supplied list of historical assets.
      const row=await prisma.leagueTrade.findFirst({where:{transactionId:ref.transactionId,history:{sleeperLeagueId:league.platformLeagueId,sleeperUsername:viewer.team.platformUserId}},select:{transactionId:true,playersGiven:true,playersReceived:true,picksGiven:true,picksReceived:true,partnerRosterId:true}})
      if (!row) return NextResponse.json({error:'This completed trade was not found in your archived league history.'},{status:404})
      sent=Array.isArray(row.playersGiven)?row.playersGiven.map(String):[]
      received=Array.isArray(row.playersReceived)?row.playersReceived.map(String):[]
      nonPlayers=(Array.isArray(row.picksGiven)&&row.picksGiven.length>0)||(Array.isArray(row.picksReceived)&&row.picksReceived.length>0)
      const resolved=await resolveTradePlayers([...sent,...received],{space:'sleeper',sport:league.sport})
      for (const [id,p] of resolved) if (p.ok) names.set(id,p.name)
      const grades=await gradeArchivedTradeRows({afLeagueId:leagueId,platformLeagueId:league.platformLeagueId,rows:[row],nameOf:id=>names.get(id)??null,freezeOriginal:false})
      grade=grades.get(row.transactionId)?.grade??null
    } else {
      const loaded=await loadTrade({leagueId,ref,userId})
      if (!loaded.ok) return NextResponse.json({error:loaded.refusal.reason},{status:loaded.refusal.code==='not_found'?404:403})
      if (loaded.trade.status!=='completed' || loaded.viewer.side===null) return NextResponse.json({error:'Impact now is for your completed trades only.'},{status:400})
      const [me,them]=loaded.viewer.side==='B'?[loaded.trade.sideB,loaded.trade.sideA]:[loaded.trade.sideA,loaded.trade.sideB]
      sent=me.gives.flatMap(a=>a.kind==='player'?[a.playerId]:[])
      received=them.gives.flatMap(a=>a.kind==='player'?[a.playerId]:[])
      for (const a of [...me.gives,...them.gives]) if (a.kind==='player') names.set(a.playerId,a.name)
      nonPlayers=[...me.gives,...them.gives].some(a=>a.kind!=='player')
      const receipt=await evaluateTrade({surface:'impact-now',leagueId,userId,give:gradeInputsOf(me.gives),get:gradeInputsOf(them.gives),viewerSide:false,canonical:null,persist:false})
      grade=receipt.grade
    }
    const result=await loadVisualImpact({leagueId,userId,sent,received,completed:true})
    return NextResponse.json({ok:true,grade,...result,moved:result.moved.map(id=>names.get(id)??id),returned:result.returned.map(id=>names.get(id)??id),nonPlayers,note:'Today’s prices and current roster fit. This hypothetical undo does not measure actual points earned since the trade or predict a championship. Original evaluations remain unchanged.'},{headers:{'Cache-Control':'private, no-store'}})
  } catch {return NextResponse.json({error:'Current impact is temporarily unavailable. Your original evaluation is unchanged.'},{status:503})}
}
