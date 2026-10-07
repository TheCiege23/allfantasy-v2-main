import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest'
const m=vi.hoisted(()=>({session:vi.fn(),access:vi.fn(),verify:vi.fn(),record:vi.fn(),read:vi.fn()}))
vi.mock('next-auth',()=>({getServerSession:m.session}));vi.mock('@/lib/auth',()=>({authOptions:{}}))
vi.mock('@/lib/league-access',()=>({resolveLeagueMembership:m.access}))
vi.mock('@/lib/core-app/teamAlertService',()=>({readTeamAlerts:vi.fn()}));vi.mock('@/lib/core-app/teamDeliveryReceipts',()=>({readTeamDeliveryReceipts:vi.fn()}))
vi.mock('@/lib/core-app/teamAlertEngagement',()=>({ALERT_EVENTS:['opened','reviewed','stale','not_useful','repeat'],verifyAlertMeasurement:m.verify,recordAlertEvent:m.record,readAlertUsefulness:m.read,issueAlertMeasurement:vi.fn()}))
import {POST,GET} from '@/app/api/core/team-alerts/route'
function request(body:unknown={league:'L',measurement:'signed',event:'opened'},origin='http://localhost'){return new Request('http://localhost/api/core/team-alerts',{method:'POST',headers:{'content-type':'application/json',origin},body:JSON.stringify(body)})}
afterEach(()=>vi.unstubAllEnvs())
beforeEach(()=>{vi.stubEnv('NEXTAUTH_URL','http://localhost');vi.stubEnv('NEXT_PUBLIC_APP_URL','http://localhost');vi.clearAllMocks();m.session.mockResolvedValue({user:{id:'owner'}});m.access.mockResolvedValue({ok:true});m.verify.mockReturnValue({kind:'injury',digest:'verified'});m.record.mockResolvedValue(undefined);m.read.mockResolvedValue({days:30,counts:{opened:1}})})
describe('alert measurement write boundary',()=>{
 it('uses session ownership and verified context instead of client identities',async()=>{
  expect((await POST(request({league:'L',measurement:'signed',event:'opened',userId:'foreign'}))).status).toBe(200)
  expect(m.verify).toHaveBeenCalledWith('owner','L','signed');expect(m.record).toHaveBeenCalledWith('owner','L','opened',{kind:'injury',digest:'verified'})
 })
 it('accepts the configured public origin behind a proxy without trusting client forwarding headers',async()=>{
  vi.stubEnv('NEXTAUTH_URL','https://www.allfantasy.ai')
  expect((await POST(request(undefined,'https://www.allfantasy.ai'))).status).toBe(200)
  const forged=request(undefined,'https://other.test');forged.headers.set('x-forwarded-host','other.test')
  expect((await POST(forged)).status).toBe(403)
 })
 it.each(['anonymous','foreign','forged','cross-site','oversized','invalid-event'])('rejects %s measurement writes',async scenario=>{
  let r=request()
  if(scenario==='anonymous')m.session.mockResolvedValue(null)
  if(scenario==='foreign')m.access.mockResolvedValue({ok:false,status:403})
  if(scenario==='forged')m.verify.mockReturnValue(null)
  if(scenario==='cross-site')r=request(undefined,'https://other.test')
  if(scenario==='oversized')r=request({league:'L',measurement:'x'.repeat(3000),event:'opened'})
  if(scenario==='invalid-event')r=request({league:'L',measurement:'signed',event:'lineup_submit'})
  expect((await POST(r)).status).toBeGreaterThanOrEqual(400);expect(m.record).not.toHaveBeenCalled()
 })
 it('reads only session-owned league aggregates with private no-store headers',async()=>{
  const r=await GET(new Request('http://localhost/api/core/team-alerts?league=L&metrics=1&userId=foreign'))
  expect(r.status).toBe(200);expect(r.headers.get('cache-control')).toBe('private, no-store');expect(m.read).toHaveBeenCalledWith('owner','L')
 })
})
