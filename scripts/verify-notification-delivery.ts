/** Operator-only verification. No send without an explicit username and --send. */
import { randomUUID } from 'node:crypto'
import { prisma } from '../lib/prisma'
import { dispatchNotification } from '../lib/notifications/NotificationDispatcher'
import { getLiveScoresForSport } from '../lib/sports-live-scores-service'
import { SUPPORTED_SPORTS, LIVE_ONLY_SPORTS } from '../lib/sport-scope'
import type { NotificationDeliveryReceipt } from '../lib/notifications/deliveryReceipt'
async function main() {
  const username = process.argv.find(a => a.startsWith('--username='))?.slice(11)
  if (process.argv.includes('--feeds')) {
    const feeds = await Promise.all([...SUPPORTED_SPORTS, ...LIVE_ONLY_SPORTS].map(async sport => {
      const start = Date.now()
      try { const r = await getLiveScoresForSport({sport, forceRefresh:true}); return {sport,source:r.source,games:r.scores.length,durationMs:Date.now()-start} }
      catch { return {sport,error:'feed_failed',durationMs:Date.now()-start} }
    }))
    console.log(JSON.stringify({feeds}))
  }
  if (!username) return
  const user = await prisma.appUser.findFirst({where:{username:{equals:username,mode:'insensitive'}},select:{id:true,username:true}})
  if (!user) throw new Error('Account not found')
  const devices = await prisma.webPushSubscription.findMany({where:{userId:user.id},select:{endpoint:true}})
  console.log(JSON.stringify({username:user.username,iosDevices:devices.filter(d=>d.endpoint.startsWith('apns:')).length,webDevices:devices.filter(d=>!d.endpoint.startsWith('apns:')).length}))
  if (!process.argv.includes('--send')) return
  const id = 'delivery-check:'+randomUUID(), started=Date.now()
  const receipts:NotificationDeliveryReceipt[]=[]
  const result=await dispatchNotification({userIds:[user.id],category:'lineup_alerts',type:'notification_delivery_check',
    title:'AllFantasy notification delivery test',body:'This is your requested email and phone delivery test. No player status or lineup has changed.',
    dedupePrefix:id,meta:{eventKey:id,pushTag:id},skipChannels:{sms:true},severity:'high',actionHref:'/settings?tab=notifications',
    onDeliveryReceipt:async r=>{receipts.push(r)},
  })
  console.log(JSON.stringify({testId:id,result,durationMs:Date.now()-started,receipts}))
  const rows=await prisma.notificationOutbox.findMany({where:{userId:user.id,eventType:'notification_delivery_check',createdAt:{gte:new Date(started)}},select:{id:true,channel:true,status:true,attemptCount:true,sentAt:true,lastError:true}})
  console.log(JSON.stringify({outbox:rows}))
  const emailId=receipts[0]?.channels.email.providerId
  if (emailId && process.env.RESEND_API_KEY) {
    const response=await fetch('https://api.resend.com/emails/'+encodeURIComponent(emailId),{headers:{Authorization:'Bearer '+process.env.RESEND_API_KEY},signal:AbortSignal.timeout(8000)})
    const data=await response.json()
    console.log(JSON.stringify({emailProviderId:emailId,verificationHttpStatus:response.status,lastEvent:data.last_event??null}))
  }
}
main().catch(e=>{console.error(e instanceof Error?e.message:'Verification failed');process.exitCode=1}).finally(()=>prisma.$disconnect())
