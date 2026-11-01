import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getZombieReadiness, ZombieReadinessError } from '@/lib/zombie/ZombieReadinessService'
export const dynamic='force-dynamic'
export const maxDuration=60
export async function GET(req: Request) {
  const session=await getServerSession(authOptions as never) as {user?:{id?:string}}|null
  if(!session?.user?.id) return NextResponse.json({error:'Unauthorized'},{status:401})
  const params=new URL(req.url).searchParams,leagueId=params.get('leagueId')||undefined,universeId=params.get('universeId')||undefined
  if(Boolean(leagueId)===Boolean(universeId)) return NextResponse.json({error:'Choose one league or universe.'},{status:400})
  try {
    return NextResponse.json(await getZombieReadiness({leagueId,universeId},session.user.id),{headers:{'Cache-Control':'private, no-store'}})
  } catch(error) {
    if(error instanceof ZombieReadinessError) return NextResponse.json({error:error.message==='OWNER_REQUIRED'?'Only the commissioner can view readiness.':error.message==='TOO_MANY_LEAGUES'?'Review leagues individually for universes above 24 leagues.':'Zombie league or universe not found.'},{status:error.message==='OWNER_REQUIRED'?403:error.message==='TOO_MANY_LEAGUES'?409:404})
    return NextResponse.json({error:'Readiness could not be checked. Try again.'},{status:500})
  }
}
