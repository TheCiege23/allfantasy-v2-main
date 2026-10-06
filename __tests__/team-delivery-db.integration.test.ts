// @vitest-environment node
import {beforeAll,afterAll,describe,it,expect,vi} from 'vitest'
const m=vi.hoisted(()=>({dispatch:vi.fn()}));vi.mock('@/lib/notifications/NotificationDispatcher',()=>({dispatchNotification:m.dispatch}))
import {prisma} from '@/lib/prisma'
import {dispatchTeamNotification,readTeamDeliveryReceipts} from '@/lib/core-app/teamDeliveryReceipts'
const safe=process.env.TEAM_WORKSPACE_DB_SPECS==='1'&&/^postgresql:\/\/postgres@127\.0\.0\.1:5446\//.test(process.env.DATABASE_URL??'')
const id='delivery-db-'+Date.now(),user=id+'-owner',league=id+'-league'
const receipt=(owner=user)=>({userId:owner,completedAt:new Date().toISOString(),channels:{inApp:{status:'stored',reason:'in_app_saved'},email:{status:'accepted',reason:'provider_accepted',providerId:'private-provider-id'},sms:{status:'suppressed',reason:'channel_off'},push:{status:'suppressed',reason:'no_subscriptions'}}})
describe.skipIf(!safe)('delivery receipts real isolated database',()=>{
 beforeAll(async()=>{await prisma.automationAuditLog.create({data:{id,userId:user,leagueId:league,action:'team_alert.delivery_claimed',message:'Isolated transaction QA',metadata:{kind:'injury',keep:'original'}}});m.dispatch.mockImplementation(async params=>params.onDeliveryReceipt(receipt()))})
 afterAll(async()=>{await prisma.automationAuditLog.deleteMany({where:{id}});await prisma.$disconnect()})
 it('merges a receipt while preserving claim evidence',async()=>{await dispatchTeamNotification({userIds:[user],category:'injury_alerts',type:'team_workspace_alert',title:'QA'},id);const saved=await prisma.automationAuditLog.findUnique({where:{id}});expect(saved?.metadata).toMatchObject({keep:'original',kind:'injury',deliveryReceipt:{channels:{email:{providerId:'private-provider-id',status:'accepted'}}}})})
 it('returns only the owner league receipts and strips provider identifiers',async()=>{const own=await readTeamDeliveryReceipts(league,user);expect(own).toHaveLength(1);expect(JSON.stringify(own)).not.toContain('private-provider-id');expect(await readTeamDeliveryReceipts(league,'foreign')).toEqual([]);expect(await readTeamDeliveryReceipts('foreign',user)).toEqual([])})
 it('cannot attach a receipt under another user identity',async()=>{m.dispatch.mockImplementation(async params=>params.onDeliveryReceipt(receipt('foreign')));await dispatchTeamNotification({userIds:['foreign'],category:'injury_alerts',type:'team_workspace_alert',title:'QA'},id);const saved=await prisma.automationAuditLog.findUnique({where:{id}});expect((saved?.metadata as Record<string,any>).deliveryReceipt.userId).toBe(user)})
})
