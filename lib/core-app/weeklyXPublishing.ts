import 'server-only'
import { createHash, randomBytes } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { encrypt, decrypt } from '@/lib/league-auth-crypto'

export const WEEKLY_X_PROVIDER = 'x-weekly-publish'
/**
 * The admin newsroom's X connection: the AllFantasy BRAND account, kept apart from the admin's
 * personal weekly-recap connection so connecting one never replaces the other. Same OAuth app,
 * same callback; the purpose rides in the sealed state.
 */
export const BRAND_X_PROVIDER = 'x-brand-newsroom'
export type XConnectionPurpose = 'weekly' | 'brand'
const providerFor = (purpose:XConnectionPurpose) => purpose==='brand'?BRAND_X_PROVIDER:WEEKLY_X_PROVIDER
const CALLBACK = '/api/core/week/x/callback'
// What publishing needs. offline.access is requested on top so X issues a refresh token;
// without it the access token dies after ~2 hours and the user has to reconnect.
const SCOPES = ['tweet.read', 'tweet.write', 'users.read']
const REQUESTED_SCOPES = [...SCOPES, 'offline.access']
// Refresh this long before expiry so a token never lapses between the check and the post.
const REFRESH_MARGIN_SEC = 120
const digest = (value:string) => createHash('sha256').update(value).digest('hex')
const seal = (value:string) => 'v1:' + encrypt(value)
const unseal = (value:string) => {
  if (!value.startsWith('v1:')) throw new Error('Reconnect X')
  return decrypt(value.slice(3))
}
const hasScopes = (scope:string|null|undefined) => SCOPES.every(s=>scope?.split(' ').includes(s))
const nowSec = () => Math.floor(Date.now()/1000)
export class WeeklyXError extends Error {
  /** `detail` is for server logs only: a stage name and X's own error code, never a token or code. */
  constructor(public readonly code:string, public readonly status=400, public readonly detail?:string) { super(code) }
}
/** X's error body, reduced to its error code/title. Safe to log: it never echoes credentials. */
async function xErrorDetail(stage:string, response:Response) {
  let reason=''
  try {
    const body=await response.json() as {error?:unknown;title?:unknown;detail?:unknown}
    reason=[body.error,body.title,body.detail].filter(v=>typeof v==='string').join(' / ').slice(0,200)
  } catch {}
  return `${stage}: HTTP ${response.status}${reason?' '+reason:''}`
}
type XToken={access_token:string;refresh_token:string|null;expires_in:number;scope:string}
/** POST to X's token endpoint (code exchange or refresh) and validate what comes back. */
async function xTokenRequest(config:{clientId:string;secret:string}, params:Record<string,string>, stage:string):Promise<XToken> {
  const response=await fetch('https://api.x.com/2/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Authorization:'Basic '+Buffer.from(config.clientId+':'+config.secret).toString('base64')},body:new URLSearchParams(params),cache:'no-store',signal:AbortSignal.timeout(15000)})
  if(!response.ok)throw new WeeklyXError('connection_failed',400,await xErrorDetail(stage,response))
  const token=await response.json() as {access_token?:string;refresh_token?:string;expires_in?:number;scope?:string;token_type?:string}
  if(!token.access_token || !Number.isFinite(token.expires_in) || token.expires_in!<=0 || token.token_type?.toLowerCase()!=='bearer')throw new WeeklyXError('connection_failed',400,`${stage}: malformed token response`)
  if(!hasScopes(token.scope))throw new WeeklyXError('connection_failed',400,`${stage}: missing scopes (granted: ${String(token.scope).slice(0,100)})`)
  return {access_token:token.access_token,refresh_token:token.refresh_token||null,expires_in:Math.floor(token.expires_in!),scope:token.scope!}
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
export async function weeklyXStatus(userId:string,purpose:XConnectionPurpose='weekly') {
  const configured=!!weeklyXConfig()
  const account=await prisma.authAccount.findFirst({where:{userId,provider:providerFor(purpose)},orderBy:{expires_at:'desc'},select:{session_state:true,expires_at:true,access_token:true,refresh_token:true,scope:true}})
  // A refreshable connection stays connected past its access token's expiry: the next post refreshes it.
  const refreshable=!!account?.refresh_token?.startsWith('v1:')
  const unexpired=!!account?.expires_at && account.expires_at>nowSec()+30
  const connected=!!account?.access_token?.startsWith('v1:') && (unexpired || refreshable) && hasScopes(account.scope)
  return {configured,connected,handle:account?.session_state??null,expiresAt:account?.expires_at && !refreshable?new Date(account.expires_at*1000).toISOString():null}
}
export async function beginWeeklyXConnection(userId:string,league:string|null,purpose:XConnectionPurpose='weekly') {
  const config=weeklyXConfig()
  if(!config)throw new WeeklyXError('not_configured',503)
  const state=randomBytes(32).toString('base64url'), verifier=randomBytes(48).toString('base64url')
  await prisma.sportsDataCache.create({data:{cacheKey:weeklyXStateKey(state),expiresAt:new Date(Date.now()+10*60000),data:{user:digest(userId),verifier:seal(verifier),league,purpose}}})
  const url=new URL('https://x.com/i/oauth2/authorize')
  url.search=new URLSearchParams({response_type:'code',client_id:config.clientId,redirect_uri:config.redirectUri,scope:REQUESTED_SCOPES.join(' '),state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'}).toString()
  return url.toString()
}
export async function completeWeeklyXConnection(userId:string,state:string,code:string) {
  const config=weeklyXConfig()
  if(!config)throw new WeeklyXError('not_configured',503)
  if(!/^[A-Za-z0-9_-]{43}$/.test(state)||!code||code.length>2048)throw new WeeklyXError('invalid_callback')
  const key=weeklyXStateKey(state), now=new Date()
  const cached=await prisma.sportsDataCache.findUnique({where:{cacheKey:key}})
  const data=cached?.data as {user?:string;verifier?:string;league?:string|null;purpose?:string}|undefined
  if(!cached || cached.expiresAt<=now || data?.user!==digest(userId) || typeof data.verifier!=='string')throw new WeeklyXError('invalid_callback')
  // Consume only after user binding passes. Exactly one concurrent callback exchanges the code.
  const consumed=await prisma.sportsDataCache.deleteMany({where:{cacheKey:key,expiresAt:{gt:now}}})
  if(consumed.count!==1)throw new WeeklyXError('invalid_callback')
  const token=await xTokenRequest(config,{grant_type:'authorization_code',code,redirect_uri:config.redirectUri,code_verifier:unseal(data.verifier)},'token_exchange')
  const identity=await fetch('https://api.x.com/2/users/me',{headers:{Authorization:'Bearer '+token.access_token},cache:'no-store',signal:AbortSignal.timeout(15000)})
  if(!identity.ok)throw new WeeklyXError('connection_failed',400,await xErrorDetail('users_me',identity))
  const PROVIDER=providerFor(data.purpose==='brand'?'brand':'weekly')
  const user=(await identity.json() as {data?:{id?:string;username?:string}}).data
  if(!user?.id || !/^\d+$/.test(user.id) || !user.username || !/^[A-Za-z0-9_]{1,15}$/.test(user.username))throw new WeeklyXError('connection_failed',400,'users_me: malformed identity')
  await prisma.$transaction(async tx=>{
    const existing=await tx.authAccount.findUnique({where:{provider_providerAccountId:{provider:PROVIDER,providerAccountId:user.id!}}})
    if(existing && existing.userId!==userId)throw new WeeklyXError('account_already_connected',409)
    await tx.authAccount.deleteMany({where:{userId,provider:PROVIDER,providerAccountId:{not:user.id!}}})
    const fields={access_token:seal(token.access_token),refresh_token:token.refresh_token?seal(token.refresh_token):null,expires_at:nowSec()+token.expires_in,scope:token.scope,token_type:'bearer',session_state:user.username!}
    if(existing){
      const updated=await tx.authAccount.updateMany({where:{id:existing.id,userId,provider:PROVIDER},data:fields})
      if(updated.count!==1)throw new WeeklyXError('connection_failed')
    }else{
      // Plain create fails on a concurrent foreign-account claim; an upsert could overwrite it.
      await tx.authAccount.create({data:{userId,provider:PROVIDER,providerAccountId:user.id!,type:'oauth',...fields}})
    }
  })
  return data.league??null
}
/** Which connection a callback completed, read without consuming the state. */
export async function weeklyXStatePurpose(state:string):Promise<XConnectionPurpose> {
  if(!/^[A-Za-z0-9_-]{43}$/.test(state))return 'weekly'
  const cached=await prisma.sportsDataCache.findUnique({where:{cacheKey:weeklyXStateKey(state)},select:{data:true}}).catch(()=>null)
  return (cached?.data as {purpose?:string}|undefined)?.purpose==='brand'?'brand':'weekly'
}

/**
 * A usable access token for this user's X connection, refreshed when it is about to expire.
 *
 * X rotates refresh tokens: each refresh returns a new one and invalidates the old. So the stored
 * row is replaced only where it still holds the refresh token we used (compare-and-swap), and a
 * failed refresh re-reads the row first, because a concurrent request may have rotated it already.
 */
export async function weeklyXAccessToken(userId:string,purpose:XConnectionPurpose='weekly'):Promise<string> {
  const PROVIDER=providerFor(purpose)
  const account=await prisma.authAccount.findFirst({where:{userId,provider:PROVIDER},orderBy:{expires_at:'desc'}})
  if(!account?.access_token?.startsWith('v1:') || !hasScopes(account.scope))throw new WeeklyXError('reconnect',409)
  if(account.expires_at && account.expires_at>nowSec()+REFRESH_MARGIN_SEC)return unseal(account.access_token)
  if(!account.refresh_token?.startsWith('v1:'))throw new WeeklyXError('reconnect',409)
  const config=weeklyXConfig()
  if(!config)throw new WeeklyXError('not_configured',503)
  let token:XToken
  try {
    token=await xTokenRequest(config,{grant_type:'refresh_token',refresh_token:unseal(account.refresh_token),client_id:config.clientId},'refresh')
  } catch(error) {
    const latest=await prisma.authAccount.findFirst({where:{id:account.id,userId,provider:PROVIDER}})
    if(latest?.access_token?.startsWith('v1:') && latest.access_token!==account.access_token && latest.expires_at && latest.expires_at>nowSec()+30)return unseal(latest.access_token)
    console.warn('[weekly-x] refresh failed',error instanceof WeeklyXError?error.detail??error.code:'request_error')
    throw new WeeklyXError('reconnect',409)
  }
  await prisma.authAccount.updateMany({
    where:{id:account.id,userId,provider:PROVIDER,refresh_token:account.refresh_token},
    data:{access_token:seal(token.access_token),refresh_token:token.refresh_token?seal(token.refresh_token):account.refresh_token,expires_at:nowSec()+token.expires_in,scope:token.scope},
  })
  return token.access_token
}
export function validWeeklyXPost(value:unknown):value is {requestId:string;text:string} {
  const b=value as {requestId?:unknown;text?:unknown}|null
  return !!b && typeof b.requestId==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(b.requestId) && typeof b.text==='string' && b.text.trim().length>0 && b.text.length<=280
}
export async function publishWeeklyXPost(userId:string,request:{requestId:string;text:string},purpose:XConnectionPurpose='weekly') {
  const key=(purpose==='brand'?'brand-x:post:':'core-week-x:post:')+digest(userId+':'+request.requestId), fingerprint=digest(request.text)
  const prior=await prisma.sportsDataCache.findUnique({where:{cacheKey:key}})
  const readPrior=(raw:unknown)=>{
    const data=raw as {fingerprint?:string;state?:string;id?:string}
    if(data.fingerprint!==fingerprint)throw new WeeklyXError('request_changed',409)
    if(data.state==='published' && data.id && /^\d+$/.test(data.id))return {id:data.id,url:'https://x.com/i/status/'+data.id}
    throw new WeeklyXError(data.state==='failed'?'post_failed':'publication_unknown',409)
  }
  if(prior)return readPrior(prior.data)
  const token=await weeklyXAccessToken(userId,purpose)
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
