import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { WeeklyXError, completeWeeklyXConnection, weeklyXConfig, weeklyXReturnUrl, weeklyXStatePurpose } from '@/lib/core-app/weeklyXPublishing'

/** The brand (newsroom) connection returns to the newsroom, not the weekly page. */
function brandReturnUrl(origin:string,result:string) {
  const url=new URL('/admin/social-newsroom',origin)
  url.searchParams.set('xConnection',result)
  return url.toString()
}
export const dynamic='force-dynamic'
export async function GET(req:Request) {
  const config=weeklyXConfig()
  if(!config)return NextResponse.json({error:'not_configured'},{status:503,headers:{'Cache-Control':'no-store'}})
  const session=await getServerSession(authOptions as never) as {user?:{id?:string}}|null
  if(!session?.user?.id)return NextResponse.redirect(weeklyXReturnUrl(config.origin,null,'sign_in'))
  const url=new URL(req.url)
  // Read before completing: completion consumes the state that records which connection this is.
  const brand=(await weeklyXStatePurpose(url.searchParams.get('state')??''))==='brand'
  const back=(league:string|null,result:string)=>brand?brandReturnUrl(config.origin,result):weeklyXReturnUrl(config.origin,league,result)
  // X sends ?error=access_denied (and no code) when the user cancels on its consent screen.
  if(url.searchParams.get('error'))return NextResponse.redirect(back(null,'denied'))
  try {
    const league=await completeWeeklyXConnection(session.user.id,url.searchParams.get('state')??'',url.searchParams.get('code')??'')
    return NextResponse.redirect(back(league,'connected'))
  }catch(error) {
    // Never log the request URL: it carries the one-time code and state.
    console.warn('[weekly-x] connection failed',error instanceof WeeklyXError?`${error.code}${error.detail?' ('+error.detail+')':''}`:error instanceof Error?error.name+': '+error.message.slice(0,200):'unknown')
    return NextResponse.redirect(back(null,'failed'))
  }
}
