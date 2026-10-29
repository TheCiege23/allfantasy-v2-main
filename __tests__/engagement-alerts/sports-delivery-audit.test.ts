import { expect, it, vi } from 'vitest'
const save = vi.hoisted(()=>vi.fn())
vi.mock('@/lib/prisma',()=>({prisma:{sportsDataCache:{upsert:save}}}))
import { recordSportsDelivery } from '@/lib/notifications/sportsDeliveryAudit'
it('records event delay and policy skips without presenting acceptance as delivery',async()=>{
  await recordSportsDelivery({eventKey:'event',type:'breaking_news',sport:'MLB',occurredAt:'2026-10-20T03:00:00Z',detectedAt:'2026-10-20T03:01:00Z'},{userId:'user',completedAt:'2026-10-20T03:01:02Z',channels:{inApp:{status:'stored',reason:'in_app_saved'},email:{status:'accepted',reason:'provider_accepted'},push:{status:'suppressed',reason:'quiet_hours'},sms:{status:'suppressed',reason:'caller_excluded'}}})
  expect(save.mock.calls[0][0].create.data).toMatchObject({detectionLagMs:60000,processingMs:2000,channels:{email:{status:'accepted'},push:{reason:'quiet_hours'}}})
})
