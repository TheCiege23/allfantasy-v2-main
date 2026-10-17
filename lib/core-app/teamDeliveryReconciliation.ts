import 'server-only'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { DeliveryChannelOutcome,NotificationDeliveryReceipt } from '@/lib/notifications/deliveryReceipt'
export function providerDeliveryOutcome(channel:'email'|'sms',event:string):Pick<DeliveryChannelOutcome,'status'|'reason'|'verification'> {
  if(['delivered',...(channel==='email'?['opened','clicked']:['read'])].includes(event))return {status:'delivered',reason:channel==='email'?'recipient_server_delivered':'carrier_delivered',verification:'confirmed'}
  if(['bounced','failed','undelivered','canceled','complained','suppressed'].includes(event))return {status:'failed',reason:'provider_'+event,verification:'confirmed'}
  if(event==='delivery_delayed')return {status:'delayed',reason:'provider_delayed',verification:'pending'}
  if(['sent','queued','accepted','sending','scheduled'].includes(event))return {status:'accepted',reason:'provider_accepted',verification:'pending'}
  return {status:'accepted',reason:'provider_accepted',verification:'unavailable'}
}
async function checkProvider(channel:'email'|'sms',id:string,timeout:number){
  let url:string,authorization:string
  if(channel==='email'){
    if(!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id)||!process.env.RESEND_API_KEY)return null
    url=`https://api.resend.com/emails/${id}`;authorization=`Bearer ${process.env.RESEND_API_KEY}`
  }else{
    const account=process.env.TWILIO_ACCOUNT_SID,key=process.env.TWILIO_API_KEY,secret=process.env.TWILIO_API_SECRET,token=process.env.TWILIO_AUTH_TOKEN
    if(!/^SM[0-9a-f]{32}$/i.test(id)||!account||!/^AC[0-9a-f]{32}$/i.test(account)||!(key&&secret||token))return null
    url=`https://api.twilio.com/2010-04-01/Accounts/${account}/Messages/${id}.json`
    authorization=`Basic ${Buffer.from(key&&secret?`${key}:${secret}`:`${account}:${token}`).toString('base64')}`
  }
  try{
    const response=await fetch(url,{headers:{Authorization:authorization},cache:'no-store',signal:AbortSignal.timeout(Math.max(1,timeout))})
    if(!response.ok)return null
    const body=await response.json()
    if((channel==='email'?body.id:body.sid)!==id)return null
    const event=channel==='email'?body.last_event:body.status
    return typeof event==='string'?providerDeliveryOutcome(channel,event):null
  }catch{return null}
}
/** At most two read-only provider lookups, 15-minute cooldown, 48-hour horizon; no retries or re-sends. */
export async function reconcileTeamDeliveryReceipts(deadline:number){
  const rows=await prisma.automationAuditLog.findMany({where:{action:{in:['team_alert.delivery_claimed','native_autosub.applied']},createdAt:{gte:new Date(Date.now()-48*3600_000)},OR:['email','sms'].map(channel=>({metadata:{path:['deliveryReceipt','channels',channel,'status'],string_contains:'accepted'}})).concat(['email','sms'].map(channel=>({metadata:{path:['deliveryReceipt','channels',channel,'status'],string_contains:'delayed'}})))},orderBy:{createdAt:'asc'},take:100})
  let checked=0
  for(const row of rows){
    if(checked>=2||Date.now()>=deadline)break
    const metadata=row.metadata as Record<string,unknown>|null,receipt=metadata?.deliveryReceipt as NotificationDeliveryReceipt|undefined
    if(!receipt?.channels)continue
    for(const channel of ['email','sms'] as const){
      if(checked>=2||Date.now()>=deadline)break
      const outcome=receipt.channels[channel]
      if(!outcome?.providerId||!['accepted','delayed'].includes(outcome.status)||Date.now()-new Date(outcome.providerCheckedAt??0).getTime()<15*60_000)continue
      const stamp=new Date().toISOString(),next={...outcome,providerCheckedAt:stamp}
      const currentMetadata={...metadata,deliveryReceipt:{...receipt,channels:{...receipt.channels,[channel]:next}}}
      const claim=await prisma.automationAuditLog.updateMany({where:{id:row.id,userId:row.userId,metadata:{equals:row.metadata as Prisma.InputJsonValue}},data:{metadata:currentMetadata as never}})
      if(!claim.count)break
      checked++
      const update=await checkProvider(channel,outcome.providerId,Math.min(1500,Math.max(1,deadline-Date.now())))
      const json=JSON.stringify({...next,...(update??{verification:'unavailable'})})
      await prisma.$executeRaw`UPDATE automation_audit_logs SET metadata=jsonb_set(metadata,ARRAY['deliveryReceipt','channels',${channel}]::text[],${json}::jsonb) WHERE id=${row.id} AND "userId"=${row.userId}`
      // Each row's next channel is reconsidered on a later sweep with a fresh CAS snapshot.
      break
    }
  }
  return {checked}
}
