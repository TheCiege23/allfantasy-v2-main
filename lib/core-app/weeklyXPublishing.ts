import 'server-only'
import { createHash, randomBytes } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { encrypt, decrypt } from '@/lib/league-auth-crypto'

export const WEEKLY_X_PROVIDER = 'x-weekly-publish'
const CALLBACK = '/api/core/week/x/callback'
const SCOPES = ['tweet.read', 'tweet.write', 'users.read']
const digest = (value:string) => createHash('sha256').update(value).digest('hex')
const seal = (value:string) => 'v1:' + encrypt(value)
const unseal = (value:string) => {
  if (!value.startsWith('v1:')) throw new Error('Reconnect X')
  return decrypt(value.slice(3))
}
export class WeeklyXError extends Error {
  constructor(public readonly code:string, public readonly status=400) { super(code) }
}
export function weeklyXConfig() {
  const clientId=process.env.X_OAUTH_CLIENT_ID, secret=process.env.X_OAUTH_CLIENT_SECRET
  const raw=process.env.X_OAUTH_REDIRECT_URI
  if(!clientId || !secret || !process.env.LEAGUE_AUTH_ENCRYPTION_KEY || !raw) return null
  try {
    const callback=new URL(raw)
    if(callback.pathname!==CALLBACK || callback.search || callback.hash || callback.username || callback.password)return null
    const origin=callback.origin
    if(!origin.startsWith('https://') && !(process.env.NODE_ENV!=='production' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)))return null
    return {clientId,secret,origin,redirectUri:origin+CALLBACK}
  } catch {return null}
}
export function assertWeeklyXOrigin(req:Request) {
  const config=weeklyXConfig()
  if(!config)throw new WeeklyXError('not_configured',503)
  if(req.headers.get('origin')!==config.origin)throw new WeeklyXError('invalid_origin',403)
  return config
}
export function weeklyXStateKey(state:string) {return 'core-week-x:oauth:'+digest(state)}
export function weeklyXReturnUrl(origin:string,league:string|null,result:string) {
  const url=new URL('/core/week',origin)
  if(league)url.searchParams.set('league',league)
  url.searchParams.set('xConnection',result)
  return url.toString()
}
export async function weeklyXStatus(userId:string) {
  const configured=!!weeklyXConfig()
  const account=await prisma.authAccount.findFirst({where:{userId,provider:WEEKLY_X_PROVIDER},orderBy:{expires_at:'desc'},select:{session_state:true,expires_at:true,access_token:true,scope:true}})
  const connected=!!account?.access_token?.startsWith('v1:') && !!account.expires_at && account.expires_at>Math.floor(Date.now()/1000)+30 && SCOPES.every(s=>account.scope?.split(' ').includes(s))
  return {configured,connected,handle:account?.session_state??null,expiresAt:account?.expires_at?new Date(account.expires_at*1000).toISOString():null}
}
export async function beginWeeklyXConnection(userId:string,league:string|null) {
  const config=weeklyXConfig()
  if(!config)throw new WeeklyXError('not_configured',503)
  const state=randomBytes(32).toString('base64url'), verifier=randomBytes(48).toString('base64url')
  await prisma.sportsDataCache.create({data:{cacheKey:weeklyXStateKey(state),expiresAt:new Date(Date.now()+10*60000),data:{user:digest(userId),verifier:seal(verifier),league}}})
  const url=new URL('https://x.com/i/oauth2/authorize')
  url.search=new URLSearchParams({response_type:'code',client_id:config.clientId,redirect_uri:config.redirectUri,scope:SCOPES.join(' '),state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'}).toString()
  return url.toString()
}
export async function completeWeeklyXConnection(userId:string,state:string,code:string) {
  const config=weeklyXConfig()
  if(!config)throw new WeeklyXError('not_configured',503)
  if(!/^[A-Za-z0-9_-]{43}$/.test(state)||!code||code.length>2048)throw new WeeklyXError('invalid_callback')
  const key=weeklyXStateKey(state), now=new Date()
  const cached=await prisma.sportsDataCache.findUnique({where:{cacheKey:key}})
  const data=cached?.data as {user?:string;verifier?:string;league?:string|null}|undefined
  if(!cached || cached.expiresAt<=now || data?.user!==digest(userId) || typeof data.verifier!=='string')throw new WeeklyXError('invalid_callback')
  // Consume only after user binding passes. Exactly one concurrent callback exchanges the code.
  const consumed=await prisma.sportsDataCache.deleteMany({where:{cacheKey:key,expiresAt:{gt:now}}})
  if(consumed.count!==1)throw new WeeklyXError('invalid_callback')
  const response=await fetch('https://api.x.com/2/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Authorization:'Basic '+Buffer.from(config.clientId+':'+config.secret).toString('base64')},body:new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:config.redirectUri,code_verifier:unseal(data.verifier)}),cache:'no-store',signal:AbortSignal.timeout(15000)})
  if(!response.ok)throw new WeeklyXError('connection_failed')
  const token=await response.json() as {access_token?:string;expires_in?:number;scope?:string;token_type?:string}
  if(!token.access_token || !Number.isFinite(token.expires_in) || token.expires_in!<=0 || token.token_type?.toLowerCase()!=='bearer' || !SCOPES.every(s=>token.scope?.split(' ').includes(s)))throw new WeeklyXError('connection_failed')
  const identity=await fetch('https://api.x.com/2/users/me',{headers:{Authorization:'Bearer '+token.access_token},cache:'no-store',signal:AbortSignal.timeout(15000)})
  if(!identity.ok)throw new WeeklyXError('connection_failed')
  const user=(await identity.json() as {data?:{id?:string;username?:string}}).data
  if(!user?.id || !/^\d+$/.test(user.id) || !user.username || !/^[A-Za-z0-9_]{1,15}$/.test(user.username))throw new WeeklyXError('connection_failed')
  await prisma.$transaction(async tx=>{
    const existing=await tx.authAccount.findUnique({where:{provider_providerAccountId:{provider:WEEKLY_X_PROVIDER,providerAccountId:user.id!}}})
    if(existing && existing.userId!==userId)throw new WeeklyXError('account_already_connected',409)
    await tx.authAccount.deleteMany({where:{userId,provider:WEEKLY_X_PROVIDER,providerAccountId:{not:user.id!}}})
    const fields={access_token:seal(token.access_token!),refresh_token:null,expires_at:Math.floor(Date.now()/1000)+Math.floor(token.expires_in!),scope:token.scope!,token_type:'bearer',session_state:user.username!}
    if(existing){
      const updated=await tx.authAccount.updateMany({where:{id:existing.id,userId,provider:WEEKLY_X_PROVIDER},data:fields})
      if(updated.count!==1)throw new WeeklyXError('connection_failed')
    }else{
      // Plain create fails on a concurrent foreign-account claim; an upsert could overwrite it.
      await tx.authAccount.create({data:{userId,provider:WEEKLY_X_PROVIDER,providerAccountId:user.id!,type:'oauth',...fields}})
    }
  })
  return data.league??null
}
export function validWeeklyXPost(value:unknown):value is {requestId:string;text:string} {
  const b=value as {requestId?:unknown;text?:unknown}|null
  return !!b && typeof b.requestId==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(b.requestId) && typeof b.text==='string' && b.text.trim().length>0 && b.text.length<=280
}
export async function publishWeeklyXPost(userId:string,request:{requestId:string;text:string}) {
  const key='core-week-x:post:'+digest(userId+':'+request.requestId), fingerprint=digest(request.text)
  const prior=await prisma.sportsDataCache.findUnique({where:{cacheKey:key}})
  const readPrior=(raw:unknown)=>{
    const data=raw as {fingerprint?:string;state?:string;id?:string}
    if(data.fingerprint!==fingerprint)throw new WeeklyXError('request_changed',409)
    if(data.state==='published' && data.id && /^\d+$/.test(data.id))return {id:data.id,url:'https://x.com/i/status/'+data.id}
    throw new WeeklyXError(data.state==='failed'?'post_failed':'publication_unknown',409)
  }
  if(prior)return readPrior(prior.data)
  const account=await prisma.authAccount.findFirst({where:{userId,provider:WEEKLY_X_PROVIDER,expires_at:{gt:Math.floor(Date.now()/1000)+30}},orderBy:{expires_at:'desc'}})
  if(!account?.access_token?.startsWith('v1:') || !SCOPES.every(s=>account.scope?.split(' ').includes(s)))throw new WeeklyXError('reconnect',409)
  const token=unseal(account.access_token)
  try {await prisma.sportsDataCache.create({data:{cacheKey:key,expiresAt:new Date(Date.now()+7*86400000),data:{fingerprint,state:'pending'}}})}
  catch(error) {
    if((error as {code?:string}).code!=='P2002')throw error
    const raced=await prisma.sportsDataCache.findUnique({where:{cacheKey:key}})
    if(raced)return readPrior(raced.data)
    throw new WeeklyXError('publication_unknown',409)
  }
  // Never retry a timed-out or ambiguous request: X may have accepted it.
  let response:Response
  try {response=await fetch('https://api.x.com/2/tweets',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({text:request.text}),cache:'no-store',signal:AbortSignal.timeout(20000)})}
  catch {throw new WeeklyXError('publication_unknown',409)}
  if(!response.ok) {
    // A server error can follow an accepted write. Only definitive 4xx errors are retryable manually.
    if(response.status>=400 && response.status<500)await prisma.sportsDataCache.update({where:{cacheKey:key},data:{data:{fingerprint,state:'failed'}}})
    throw new WeeklyXError(response.status>=500?'publication_unknown':'post_failed',response.status>=500?409:400)
  }
  let id:string|undefined
  try {id=(await response.json() as {data?:{id?:string}}).data?.id} catch {throw new WeeklyXError('publication_unknown',409)}
  if(!id || !/^\d+$/.test(id))throw new WeeklyXError('publication_unknown',409)
  try {await prisma.sportsDataCache.update({where:{cacheKey:key},data:{data:{fingerprint,state:'published',id}}})}
  catch {throw new WeeklyXError('publication_unknown',409)}
  return {id,url:'https://x.com/i/status/'+id}
}
export async function disconnectWeeklyX(userId:string) {
  // Local disconnect immediately prevents further publishing from AllFantasy.
  await prisma.authAccount.deleteMany({where:{userId,provider:WEEKLY_X_PROVIDER}})
}
