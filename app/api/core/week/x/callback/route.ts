import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { completeWeeklyXConnection, weeklyXConfig, weeklyXReturnUrl } from '@/lib/core-app/weeklyXPublishing'
export const dynamic='force-dynamic'
export async function GET(req:Request) {
  const config=weeklyXConfig()
  if(!config)return NextResponse.json({error:'not_configured'},{status:503,headers:{'Cache-Control':'no-store'}})
  const session=await getServerSession(authOptions as never) as {user?:{id?:string}}|null
  if(!session?.user?.id)return NextResponse.redirect(weeklyXReturnUrl(config.origin,null,'sign_in'))
  const url=new URL(req.url)
  try {
    const league=await completeWeeklyXConnection(session.user.id,url.searchParams.get('state')??'',url.searchParams.get('code')??'')
    return NextResponse.redirect(weeklyXReturnUrl(config.origin,league,'connected'))
  }catch {
    return NextResponse.redirect(weeklyXReturnUrl(config.origin,null,'failed'))
  }
}
