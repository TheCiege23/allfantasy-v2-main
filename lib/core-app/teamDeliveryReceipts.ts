import 'server-only'
import { prisma } from '@/lib/prisma'
import { dispatchNotification,type DispatchNotificationParams } from '@/lib/notifications/NotificationDispatcher'
import type { NotificationDeliveryReceipt } from '@/lib/notifications/deliveryReceipt'
export async function dispatchTeamNotification(params:DispatchNotificationParams,claimId:string) {
  return dispatchNotification({...params,onDeliveryReceipt:async receipt=>{
    const json=JSON.stringify(receipt)
    await prisma.$executeRaw`UPDATE automation_audit_logs SET metadata=COALESCE(metadata,'{}'::jsonb)||jsonb_build_object('deliveryReceipt',${json}::jsonb) WHERE id=${claimId} AND "userId"=${receipt.userId}`
  }})
}
export function publicDeliveryReceipt(value:unknown):Omit<NotificationDeliveryReceipt,'userId'>|null {
  if(!value || typeof value!=='object')return null
  const raw=value as NotificationDeliveryReceipt
  if(!raw.channels||typeof raw.channels!=='object'||typeof raw.completedAt!=='string'||Object.values(raw.channels).some(c=>!c||typeof c!=='object'||typeof c.status!=='string'||typeof c.reason!=='string'))return null
  const channels=Object.fromEntries(Object.entries(raw.channels).filter(([key])=>['inApp','email','sms','push'].includes(key)).map(([key,c])=>[key,{status:c.status,reason:c.reason,attempts:c.attempts,endpoints:c.endpoints,acceptedEndpoints:c.acceptedEndpoints,providerCheckedAt:c.providerCheckedAt,verification:c.verification}])) as NotificationDeliveryReceipt['channels']
  return {completedAt:raw.completedAt,channels}
}
export async function readTeamDeliveryReceipts(leagueId:string,userId:string){
  const rows=await prisma.automationAuditLog.findMany({where:{leagueId,userId,action:'team_alert.delivery_claimed'},orderBy:{createdAt:'desc'},take:10,select:{id:true,createdAt:true,metadata:true}})
  return rows.map(row=>{const meta=row.metadata as Record<string,unknown>|null;return {id:row.id,createdAt:row.createdAt.toISOString(),kind:meta?.kind,deadline:meta?.deadline,receipt:publicDeliveryReceipt(meta?.deliveryReceipt)}})
}
