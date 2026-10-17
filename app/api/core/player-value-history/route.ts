import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { consumeRateLimit, getClientIp } from '@/lib/rate-limit'
import { resolveLeagueMembership } from '@/lib/league-access'
import { resolveCoreDepth } from '@/lib/core-app/corePaywall'
import { valueBookFor, describeValueBook, CROSS_LEAGUE_BOOK } from '@/lib/core-app/valueBook'
import { loadPlayerValueHistory } from '@/lib/player-values/playerValueHistory'
export const dynamic = 'force-dynamic'
const Query = z.object({sleeperId:z.string().regex(/^\d+$/).max(64),sport:z.literal('NFL'),leagueId:z.string().min(1).max(64).optional()})
export async function GET(req: Request) {
  const limit = consumeRateLimit({scope:'players',action:'value-history',ip:getClientIp(req),includeIpInKey:true,maxRequests:30,windowMs:60_000})
  if (!limit.success) return NextResponse.json({error:'Too many requests'}, {status:429})
  const query = Query.safeParse(Object.fromEntries(new URL(req.url).searchParams))
  if (!query.success) return NextResponse.json({error:'Recorded value history is available for verified NFL players only.'},{status:400})
  const session = await getServerSession(authOptions as never) as {user?:{id?:string;email?:string|null}}|null
  const userId = session?.user?.id ?? null
  if (query.data.leagueId && !(await resolveLeagueMembership(query.data.leagueId,userId)).ok) return NextResponse.json({error:'League access required'},{status:403})
  const depth = await resolveCoreDepth(userId,'player_depth',{email:session?.user?.email??null})
  if (!depth.unlocked) return NextResponse.json({error:'Player value history requires AF Pro',depth},{status:403})
  const league = query.data.leagueId ? await prisma.league.findUnique({where:{id:query.data.leagueId},select:{settings:true,leagueType:true,sport:true}}) : null
  if (query.data.leagueId && (!league || String(league.sport).toUpperCase() !== 'NFL')) return NextResponse.json({error:'NFL league history unavailable'},{status:400})
  const book = league ? valueBookFor(league.settings,league.leagueType) : CROSS_LEAGUE_BOOK
  try {
    const points = await loadPlayerValueHistory({sleeperIds:[query.data.sleeperId],book,since:new Date('2020-01-01T00:00:00Z')})
    return NextResponse.json({points,book,description:describeValueBook(book),scope:league?'league-market':'universal-market',note:'Recorded market prices, not fantasy points or league scoring adjustments. Missing capture weeks remain gaps.'},{headers:{'Cache-Control':'private, no-store'}})
  } catch { return NextResponse.json({error:'Value history temporarily unavailable'},{status:503}) }
}
