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
