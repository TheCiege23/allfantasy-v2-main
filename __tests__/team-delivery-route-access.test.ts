import {beforeEach,describe,it,expect,vi} from 'vitest'
const m=vi.hoisted(()=>({session:vi.fn(),access:vi.fn(),alerts:vi.fn(),receipts:vi.fn()}))
vi.mock('next-auth',()=>({getServerSession:m.session}));vi.mock('@/lib/auth',()=>({authOptions:{}}));vi.mock('@/lib/league-access',()=>({resolveLeagueMembership:m.access}));vi.mock('@/lib/core-app/teamAlertService',()=>({readTeamAlerts:m.alerts}));vi.mock('@/lib/core-app/teamDeliveryReceipts',()=>({readTeamDeliveryReceipts:m.receipts}))
import {GET} from '@/app/api/core/team-alerts/route'
beforeEach(()=>{vi.clearAllMocks();m.session.mockResolvedValue({user:{id:'owner'}});m.access.mockResolvedValue({ok:true});m.alerts.mockResolvedValue({available:true,alerts:[]});m.receipts.mockResolvedValue([{id:'receipt',receipt:null}])})
describe('private league delivery receipts',()=>{
 it('denies anonymous reads before receipt access',async()=>{m.session.mockResolvedValue(null);expect((await GET(new Request('http://localhost/api/core/team-alerts?league=L'))).status).toBe(401);expect(m.receipts).not.toHaveBeenCalled()})
 it('denies foreign league reads before receipt access',async()=>{m.access.mockResolvedValue({ok:false,status:403});expect((await GET(new Request('http://localhost/api/core/team-alerts?league=foreign'))).status).toBe(403);expect(m.receipts).not.toHaveBeenCalled()})
 it('uses session owner and authorized league and returns a private no-store response',async()=>{const r=await GET(new Request('http://localhost/api/core/team-alerts?league=L&userId=foreign'));expect(r.status).toBe(200);expect(m.receipts).toHaveBeenCalledWith('L','owner');expect(r.headers.get('Cache-Control')).toBe('private, no-store');expect(await r.json()).toMatchObject({delivery:[{id:'receipt',receipt:null}]})})
})


describe('authorized alert request timing', () => {
 it('reports independent parallel phases without exposing account or league identities', async () => {
   let now = 0
   const clock = vi.spyOn(performance, 'now').mockImplementation(() => now)
   m.session.mockImplementation(async () => { now = 10; return { user: { id: 'owner-secret' } } })
   m.access.mockImplementation(async () => { now = 30; return { ok: true } })
   let finishAlerts!: (value: unknown) => void
   let finishReceipts!: (value: unknown) => void
   m.alerts.mockImplementation(() => new Promise(resolve => { finishAlerts = resolve }))
   m.receipts.mockImplementation(() => new Promise(resolve => { finishReceipts = resolve }))
   try {
     const pending = GET(new Request('http://localhost/api/core/team-alerts?league=league-secret'))
     await vi.waitFor(() => expect(m.receipts).toHaveBeenCalled())
     expect(m.alerts).toHaveBeenCalledWith('league-secret', 'owner-secret')
     now = 70; finishAlerts({ available: true, alerts: [] })
     await Promise.resolve(); await Promise.resolve()
     now = 100; finishReceipts([])
     const response = await pending
     const timing = response.headers.get('Server-Timing')!
     expect(timing).toBe('auth;dur=10.0, access;dur=20.0, alerts;dur=40.0, delivery;dur=70.0, total;dur=100.0')
     expect(timing).not.toMatch(/owner-secret|league-secret/)
     expect(response.headers.get('Cache-Control')).toBe('private, no-store')
   } finally { clock.mockRestore() }
 })
 it.each([401, 403])('does not expose phase metrics to an unauthorized %s reader', async status => {
   if (status === 401) m.session.mockResolvedValue(null)
   else m.access.mockResolvedValue({ ok: false, status })
   const response = await GET(new Request('http://localhost/api/core/team-alerts?league=foreign'))
   expect(response.status).toBe(status)
   expect(response.headers.has('Server-Timing')).toBe(false)
   expect(m.alerts).not.toHaveBeenCalled()
   expect(m.receipts).not.toHaveBeenCalled()
 })
})

