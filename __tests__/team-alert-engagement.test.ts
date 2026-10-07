import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest'
const m=vi.hoisted(()=>({create:vi.fn(),group:vi.fn()}))
vi.mock('server-only',()=>({}));vi.mock('@/lib/prisma',()=>({prisma:{automationAuditLog:{create:m.create,groupBy:m.group}}}))
import {issueAlertMeasurement,verifyAlertMeasurement,recordAlertEvent,readAlertUsefulness} from '@/lib/core-app/teamAlertEngagement'
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('NEXTAUTH_SECRET','test-only-secret');m.create.mockResolvedValue({});m.group.mockResolvedValue([{action:'team_alert.opened',_count:{_all:3}}])})
afterEach(()=>vi.unstubAllEnvs())
describe('private alert usefulness',()=>{
 it('binds a measurement to its owner, league, kind and expiry',()=>{
  const now=Date.now(),token=issueAlertMeasurement('owner','league','injury:p:deadline','injury',now)!
  expect(verifyAlertMeasurement('owner','league',token,now)).toMatchObject({kind:'injury'})
  expect(verifyAlertMeasurement('foreign','league',token,now)).toBeNull()
  expect(verifyAlertMeasurement('owner','foreign',token,now)).toBeNull()
  expect(verifyAlertMeasurement('owner','league',token.replace('.injury.','.deadline.'),now)).toBeNull()
  expect(verifyAlertMeasurement('owner','league',token,now+7*86400_000)).toBeNull()
  expect(token).not.toMatch(/owner|league|injury:p/)
 })
 it('rejects forged or oversized capabilities and disables measurements without an app secret',()=>{
  expect(verifyAlertMeasurement('a','b','x'.repeat(1000))).toBeNull();vi.stubEnv('NEXTAUTH_SECRET','');vi.stubEnv('AUTH_SECRET','');expect(issueAlertMeasurement('a','b','key','injury')).toBeNull()
 })
 it('deduplicates repeated interactions and persists no provider, player name or URL',async()=>{
  const measurement={kind:'injury',digest:'a'.repeat(24)}
  await recordAlertEvent('owner','league','opened',measurement);m.create.mockRejectedValue({code:'P2002'});await recordAlertEvent('owner','league','opened',measurement)
  expect(m.create.mock.calls[0][0].data.id).toBe(m.create.mock.calls[1][0].data.id)
  expect(m.create.mock.calls[0][0].data.metadata).toEqual({kind:'injury',event:'opened'})
 })
 it('returns only authorized 30-day aggregate counts, without turning unavailable data into zero',async()=>{
  expect(await readAlertUsefulness('owner','league')).toEqual({days:30,counts:{opened:3,reviewed:0,stale:0,not_useful:0,repeat:0}})
  expect(m.group.mock.calls[0][0].where).toMatchObject({userId:'owner',leagueId:'league'})
  m.group.mockRejectedValue(new Error('unavailable'));await expect(readAlertUsefulness('owner','league')).rejects.toThrow('unavailable')
 })
})
