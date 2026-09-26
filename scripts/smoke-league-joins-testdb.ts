/** Real cookie-authenticated joins; known test DB and local server only.
 * Server on 3249 must have Meta/email/shared Redis credentials disabled.
 */
import {randomUUID} from 'node:crypto'
import bcrypt from 'bcryptjs'
import {prisma} from '../lib/prisma'
import {getOrCreateLeagueFinance} from '../lib/league-finance/leagueFinanceService'
async function main(){
  const host=new URL(process.env.DATABASE_URL??'').hostname
  if(!host.startsWith('ep-muddy-leaf-')||!host.endsWith('.neon.tech'))throw new Error('KNOWN_TEST_DATABASE_REQUIRED')
  const base='http://127.0.0.1:3249',marker='join-smoke-'+randomUUID(),password=randomUUID()+randomUUID()
  const users:string[]=[],jars=Array.from({length:3},()=>new Map<string,string>())
  let leagueId:string|undefined
  async function request(actor:number,path:string,init:RequestInit={}){
    const jar=jars[actor]
    const res=await fetch(base+path,{...init,redirect:'manual',headers:{...Object.fromEntries(new Headers(init.headers)),cookie:[...jar].map(([k,v])=>k+'='+v).join('; ')},signal:AbortSignal.timeout(180000)})
    for(const cookie of res.headers.getSetCookie()){const pair=cookie.split(';')[0],i=pair.indexOf('=');jar.set(pair.slice(0,i),pair.slice(i+1))}return res
  }
  const json=(body:unknown)=>({method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})
  try{
    const hash=await bcrypt.hash(password,6)
    for(let i=0;i<3;i++){
      const user=await prisma.appUser.create({data:{username:marker+'-'+i,email:marker+'-'+i+'@example.invalid',passwordHash:hash,emailVerified:new Date()}});users.push(user.id)
      const csrf=await(await request(i,'/api/auth/csrf')).json() as {csrfToken:string}
      await request(i,'/api/auth/callback/credentials',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({csrfToken:csrf.csrfToken,login:user.email!,password,json:'true',callbackUrl:base}).toString()})
      const session=await(await request(i,'/api/auth/session')).json() as {user?:{id?:string}}
      if(session.user?.id!==user.id)throw new Error('COOKIE_LOGIN_'+i)
    }
    const res=await request(0,'/api/leagues',json({concept:'redraft',sport:'NFL',teamCount:2,draftType:'snake',scoringPreset:'fb_ppr',leagueName:marker,timezone:'America/Chicago'}))
    const created=await res.json() as {league?:{id:string}}
    if(!res.ok||!created.league?.id)throw new Error('CREATE_'+res.status)
    leagueId=created.league.id
    const league=await prisma.league.findUniqueOrThrow({where:{id:leagueId}})
    const code=(league.settings as {inviteCode?:string})?.inviteCode
    if(!code)throw new Error('NO_INVITE')
    const finance = await Promise.all([getOrCreateLeagueFinance(leagueId), getOrCreateLeagueFinance(leagueId)])
    if (!finance[0] || finance[0].id !== finance[1]?.id) throw new Error('FINANCE_INIT_RACE')
    // Warm compilation without joining or consuming the invitation.
    await request(1,'/api/leagues/join',json({}))
    const responses=await Promise.all([request(1,'/api/leagues/join',json({code})),request(2,'/api/leagues/join',json({code}))])
    const statuses=responses.map(r=>r.status)
    const bodies=await Promise.all(responses.map(async r=>{const text=await r.text();try{return JSON.parse(text)}catch{return {nonJsonStatus:r.status}}}))
    const rosters=await prisma.roster.findMany({where:{leagueId}})
    const owners=rosters.filter(r=>users.includes(r.platformUserId))
    console.log(JSON.stringify({concurrentJoinStatuses:statuses,bodies,rosters:rosters.length,claimedRosters:owners.length}))
    if(statuses.filter(s=>s===200).length!==1||statuses.filter(s=>s===409).length!==1||rosters.length!==2||owners.length!==2)throw new Error('JOIN_CAPACITY_RACE')
    const winner=statuses[0]===200?1:2
    const repeat=await request(winner,'/api/leagues/join',json({code}))
    if(repeat.status!==200||await prisma.roster.count({where:{leagueId}})!==2)throw new Error('REJOIN_NOT_IDEMPOTENT')
    const memberEdit=await request(winner,'/api/leagues/'+leagueId+'/draft/settings',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({timer_seconds:75})})
    if(memberEdit.status!==403)throw new Error('MEMBER_EDIT_'+memberEdit.status)
    const commissionerEdit=await request(0,'/api/leagues/'+leagueId+'/draft/settings',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({timer_seconds:75,thirdRoundReversal:true})})
    if(commissionerEdit.status!==200)throw new Error('COMMISSIONER_EDIT_'+commissionerEdit.status)
    const draft=await prisma.draftSession.findFirstOrThrow({where:{leagueId}})
    if(!draft.thirdRoundReversal)throw new Error('SETTINGS_NOT_PERSISTED')
    console.log(JSON.stringify({target:'known test database',joinCapacityVerified:true,rejoinIdempotent:true,memberSettingsDenied:true,commissionerSettingsSaved:true}))
  }finally{
    if(leagueId)await prisma.league.deleteMany({where:{id:leagueId}})
    await prisma.analyticsEvent.deleteMany({where:{userId:{in:users}}})
    await prisma.appUser.deleteMany({where:{id:{in:users}}})
    console.log(JSON.stringify({cleanup:{remainingLeagues:leagueId?await prisma.league.count({where:{id:leagueId}}):0,remainingUsers:await prisma.appUser.count({where:{id:{in:users}}})}}));await prisma.$disconnect()
  }
}
main().catch(error=>{console.error('Join smoke failed:',error.code??error.message?.slice(0,150));process.exitCode=1})
