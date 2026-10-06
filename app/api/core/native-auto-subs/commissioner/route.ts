import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertCommissioner } from '@/lib/commissioner/permissions'
import { resolveWriteAuthority } from '@/lib/league/write-authority'
export const dynamic='force-dynamic'
async function handle(req:Request){
  const session=await getServerSession(authOptions as never) as {user?:{id?:string}}|null,userId=session?.user?.id
  if(!userId)return NextResponse.json({error:'Unauthorized'},{status:401})
  const leagueId=new URL(req.url).searchParams.get('league')??''
  let league
  try{league=(await assertCommissioner(leagueId,userId)).league}catch{return NextResponse.json({error:'Commissioner only'},{status:403})}
  if(resolveWriteAuthority(league.platform)!=='NATIVE')return NextResponse.json({error:'Native leagues only'},{status:409})
  const enabled=(league.settings as Record<string,unknown>|null)?.nativeAutoSubsEnabled===true
  if(req.method==='GET')return NextResponse.json({enabled},{headers:{'Cache-Control':'private, no-store'}})
  let body:Record<string,unknown>
  try{body=await req.json()}catch{return NextResponse.json({error:'Invalid JSON'},{status:400})}
  if(typeof body.enabled!=='boolean'||typeof body.expectedEnabled!=='boolean')return NextResponse.json({error:'Explicit enabled and expectedEnabled values required'},{status:400})
  const updated=await prisma.$transaction(async tx=>{
    const count=await tx.$executeRaw`UPDATE leagues SET settings=COALESCE(settings,'{}'::jsonb)||jsonb_build_object('nativeAutoSubsEnabled',${body.enabled}::boolean),"updatedAt"=NOW() WHERE id=${leagueId} AND COALESCE(settings->>'nativeAutoSubsEnabled','false')=${String(body.expectedEnabled)}`
    if(count!==1)return false
    await tx.leagueAuditLog.create({data:{leagueId,userId,actionType:'native_autosubs.policy_changed',entityType:'league',entityId:leagueId,beforeState:{enabled:body.expectedEnabled as boolean},afterState:{enabled:body.enabled as boolean}}})
    return true
  })
  return updated?NextResponse.json({enabled:body.enabled}):NextResponse.json({error:'Policy changed. Reload before saving.'},{status:409})
}
export const GET=handle,PUT=handle
