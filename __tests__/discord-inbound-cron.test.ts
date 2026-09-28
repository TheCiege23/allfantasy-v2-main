// @vitest-environment node
import {beforeEach,describe,expect,it,vi} from 'vitest'
import {NextRequest} from 'next/server'
const h=vi.hoisted(()=>({auth:vi.fn(),relay:vi.fn(),inbound:vi.fn(),job:vi.fn()}))
vi.mock('@/app/api/cron/_auth',()=>({requireCronAuth:h.auth}))
vi.mock('@/lib/notifications/outboxRelay',()=>({relayNotificationOutbox:h.relay}))
vi.mock('@/lib/discord/inboundPass',()=>({runDiscordInboundPass:h.inbound}))
vi.mock('@/lib/production-health/syncJobRunTelemetry',()=>({withSyncJobRun:h.job}))
import {GET} from '@/app/api/cron/notification-outbox-relay/route'
const req=(query='')=>new NextRequest(`https://example.test/api/cron/notification-outbox-relay${query}`)
beforeEach(()=>{
 vi.resetAllMocks();h.auth.mockReturnValue(true)
 h.inbound.mockResolvedValue({channels:1,deferred:0,imported:1,errors:0})
 h.relay.mockResolvedValue({claimed:0,sent:0,skipped:0,retried:0,failed:0})
 h.job.mockImplementation(async (_info,run)=>run())
})
describe('authenticated five-minute Discord inbound host',()=>{
 it('runs a bounded pass independently before the notification relay',async()=>{
  const result=await GET(req());expect(result.status).toBe(200)
  expect(h.inbound).toHaveBeenCalledWith({budgetMs:8_000})
  expect(h.job.mock.calls[0][0]).toMatchObject({jobName:'cron-discord-inbound'})
  expect((await result.json()).discordInbound).toMatchObject({imported:1,errors:0})
  expect(h.relay).toHaveBeenCalledTimes(1)
 })
 it('never imports messages on dry run',async()=>{
  const result=await GET(req('?dryRun=1'))
  expect(result.status).toBe(200);expect(h.inbound).not.toHaveBeenCalled()
  expect(h.relay).toHaveBeenCalledWith({limit:undefined,dryRun:true})
 })
 it('never starts either pass without cron auth',async()=>{
  h.auth.mockReturnValue(false)
  expect((await GET(req())).status).toBe(401)
  expect(h.inbound).not.toHaveBeenCalled();expect(h.relay).not.toHaveBeenCalled()
 })
 it('reports Discord failure without preventing the notification relay',async()=>{
  h.inbound.mockRejectedValue(new Error('Discord unavailable'))
  const result=await GET(req())
  expect(result.status).toBe(200)
  expect((await result.json()).discordInbound).toMatchObject({errors:1})
  expect(h.relay).toHaveBeenCalledTimes(1)
 })
})
