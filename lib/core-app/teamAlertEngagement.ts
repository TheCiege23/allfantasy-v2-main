import 'server-only'
import {createHash,createHmac,timingSafeEqual} from 'node:crypto'
import {prisma} from '@/lib/prisma'
export const ALERT_EVENTS=['opened','reviewed','stale','not_useful','repeat'] as const
export type AlertEvent=typeof ALERT_EVENTS[number]
const TTL=7*86400_000
function secret(){return process.env.NEXTAUTH_SECRET||process.env.AUTH_SECRET}
function sign(userId:string,leagueId:string,payload:string){return createHmac('sha256',secret()!).update(JSON.stringify([userId,leagueId,payload])).digest('hex')}
/** A measurement capability is bound to the signed-in account and league; it cannot authorize a lineup write. */
export function issueAlertMeasurement(userId:string,leagueId:string,key:string,kind:'injury'|'deadline',now=Date.now()):string|null{
 if(!secret())return null
 const digest=createHash('sha256').update(key).digest('hex').slice(0,24)
 const payload=`${now+TTL}.${kind}.${digest}`
 return `${payload}.${sign(userId,leagueId,payload)}`
}
export function verifyAlertMeasurement(userId:string,leagueId:string,token:unknown,now=Date.now()){
 if(!secret()||typeof token!=='string'||token.length>160)return null
 const match=/^(\d{13})\.(injury|deadline)\.([a-f0-9]{24})\.([a-f0-9]{64})$/.exec(token)
 if(!match)return null
 const expiry=Number(match[1]);if(expiry<=now||expiry>now+TTL)return null
 const signature=sign(userId,leagueId,token.slice(0,token.lastIndexOf('.')))
 if(!timingSafeEqual(Buffer.from(signature,'hex'),Buffer.from(match[4],'hex')))return null
 return {kind:match[2],digest:match[3]}
}
export async function recordAlertEvent(userId:string,leagueId:string,event:AlertEvent,measurement:{kind:string;digest:string}){
 // One event of each kind per account/league/alert. Refreshes, double taps and retry cannot inflate counts.
 const id='team-engagement:'+createHash('sha256').update(JSON.stringify([userId,leagueId,measurement.digest,event])).digest('hex')
 try{await prisma.automationAuditLog.create({data:{id,userId,leagueId,action:`team_alert.${event}`,entityType:'notification',entityId:measurement.digest,message:'Alert usefulness recorded.',metadata:{kind:measurement.kind,event}}})}
 catch(error){if((error as {code?:string}).code!=='P2002')throw error}
}
export async function readAlertUsefulness(userId:string,leagueId:string){
 const counts={opened:0,reviewed:0,stale:0,not_useful:0,repeat:0}
 const rows=await prisma.automationAuditLog.groupBy({by:['action'],where:{userId,leagueId,action:{in:ALERT_EVENTS.map(event=>`team_alert.${event}`)},createdAt:{gte:new Date(Date.now()-30*86400_000)}},_count:{_all:true}})
 for(const row of rows){const event=row.action.slice('team_alert.'.length) as AlertEvent;if(ALERT_EVENTS.includes(event))counts[event]=row._count._all}
 return {days:30,counts}
}
