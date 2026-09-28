/** Known test DB only. Requires the local server on 3249 to use the same test DB.
 * Start that server with META_CONVERSIONS_API_TOKEN, META_PIXEL_ID,
 * NEXT_PUBLIC_META_PIXEL_ID, RESEND_API_KEY and shared Redis credentials disabled.
 * Uses seeded synthetic identities rather than signup, and cleans them afterward.
 */
import { randomUUID } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { prisma } from '../lib/prisma'
import { getLeagueRosterConfig } from '../lib/roster-engine/UnifiedRosterConfigService'
async function main() {
  const host = new URL(process.env.DATABASE_URL ?? '').hostname
  if (!host.startsWith('ep-muddy-leaf-') || !host.endsWith('.neon.tech')) throw new Error('KNOWN_TEST_DATABASE_REQUIRED')
  const base='http://127.0.0.1:3249'
  const marker='auth-league-smoke-'+randomUUID(), password=randomUUID()+randomUUID()
  let userId: string | undefined, leagueId: string | undefined
  const cookies=new Map<string,string>()
  async function request(path:string,init:RequestInit={}) {
    const res=await fetch(base+path,{...init,redirect:'manual',headers:{...Object.fromEntries(new Headers(init.headers)),cookie:[...cookies].map(([k,v])=>k+'='+v).join('; ')},signal:AbortSignal.timeout(180000)})
    for(const cookie of res.headers.getSetCookie()){const pair=cookie.split(';')[0],i=pair.indexOf('=');cookies.set(pair.slice(0,i),pair.slice(i+1))}
    return res
  }
  try {
    const user=await prisma.appUser.create({data:{username:marker,email:marker+'@example.invalid',emailVerified:new Date(),passwordHash:await bcrypt.hash(password,6)}})
    userId=user.id
    const anonymous=await request('/api/leagues',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})
    if(anonymous.status!==401)throw new Error('ANONYMOUS_CREATE_'+anonymous.status)
    const csrf=await(await request('/api/auth/csrf')).json() as {csrfToken:string}
    const login=await request('/api/auth/callback/credentials',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({csrfToken:csrf.csrfToken,login:user.email!,password,callbackUrl:base,json:'true'}).toString()})
    if(login.status>=400)throw new Error('LOGIN_'+login.status)
    const session=await(await request('/api/auth/session')).json() as {user?:{id?:string}}
    if(session.user?.id!==userId)throw new Error('COOKIE_SESSION')
    const response=await request('/api/leagues',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({concept:'redraft',sport:'NFL',teamCount:2,draftType:'snake',scoringPreset:'fb_ppr',leagueName:marker,timezone:'America/Chicago',tradeReviewMode:'none',conceptSetup:{medianGame:true},commissionerId:'untrusted-fixture-id'})})
    const created=await response.json() as {league?:{id:string};error?:string}
    if(!response.ok||!created.league?.id)throw new Error('CREATE_'+response.status+'_'+created.error)
    leagueId=created.league.id
    const league=await prisma.league.findUniqueOrThrow({where:{id:leagueId}})
    const draft=await prisma.draftSession.findFirstOrThrow({where:{leagueId}})
    const rosterCount=await prisma.roster.count({where:{leagueId}})
    const config=await getLeagueRosterConfig(leagueId)
    if(league.userId!==userId||rosterCount!==2||!config||draft.teamCount!==2)throw new Error('AUTH_CREATE_PERSISTENCE')
    console.log(JSON.stringify({target:'known test database',anonymousRejected:true,realCookieLogin:true,commissionerSpoofIgnored:true,canonicalApiCreate:true,rosterCount,rosterConfigurationInstalled:true,draftCreated:true}))
  } finally {
    if(leagueId)await prisma.league.deleteMany({where:{id:leagueId}})
    if(userId){await prisma.analyticsEvent.deleteMany({where:{userId}});await prisma.appUser.deleteMany({where:{id:userId}})}
    console.log(JSON.stringify({cleanup:{remainingLeagues:leagueId?await prisma.league.count({where:{id:leagueId}}):0,remainingUsers:userId?await prisma.appUser.count({where:{id:userId}}):0}}))
    await prisma.$disconnect()
  }
}
main().catch(error=>{console.error('Authenticated smoke failed:',error.code??error.message?.slice(0,160));process.exitCode=1})
