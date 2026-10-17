import { consumeRateLimit } from '@/lib/rate-limit'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { WeeklyXError, assertWeeklyXOrigin, beginWeeklyXConnection, disconnectWeeklyX, publishWeeklyXPost, validWeeklyXPost, weeklyXStatus } from '@/lib/core-app/weeklyXPublishing'
export const dynamic='force-dynamic'
const headers={'Cache-Control':'private, no-store'}
async function handle(req:Request) {
  const session=await getServerSession(authOptions as never) as {user?:{id?:string}}|null
  const userId=session?.user?.id
  if(!userId)return NextResponse.json({error:'unauthorized'},{status:401,headers})
  try {
    if(req.method==='GET')return NextResponse.json(await weeklyXStatus(userId),{headers})
    assertWeeklyXOrigin(req)
    const limit=consumeRateLimit({scope:'weekly-x',action:req.method,sleeperUsername:userId,maxRequests:5,windowMs:60000})
    if(!limit.success)return NextResponse.json({error:'rate_limited'},{status:429,headers:{...headers,'Retry-After':String(limit.retryAfterSec)}})
    if(req.method==='DELETE'){await disconnectWeeklyX(userId);return NextResponse.json({disconnected:true},{headers})}
    const body=await req.json().catch(()=>null) as Record<string,unknown>|null
    if(body?.action==='connect') {
      const league=typeof body.league==='string' && /^[0-9a-f-]{36}$/i.test(body.league)?body.league:null
      return NextResponse.json({url:await beginWeeklyXConnection(userId,league)},{headers})
    }
    if(body?.action==='publish' && validWeeklyXPost(body))return NextResponse.json(await publishWeeklyXPost(userId,body),{headers})
    return NextResponse.json({error:'invalid_post'},{status:400,headers})
  }catch(error) {
    return NextResponse.json({error:error instanceof WeeklyXError?error.code:'service_unavailable'},{status:error instanceof WeeklyXError?error.status:503,headers})
  }
}
export const GET=handle,POST=handle,DELETE=handle
