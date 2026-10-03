import {beforeEach,describe,it,expect,vi} from 'vitest'
const m=vi.hoisted(()=>({session:vi.fn(),membership:vi.fn(),load:vi.fn(),evaluate:vi.fn(),impact:vi.fn(),archive:vi.fn()}))
vi.mock('next-auth',()=>({getServerSession:m.session}))
vi.mock('@/lib/auth',()=>({authOptions:{}}))
vi.mock('@/lib/league-access',()=>({resolveLeagueMembership:m.membership}))
vi.mock('@/lib/decision-os/trade/loadTrade',()=>({loadTrade:m.load}))
vi.mock('@/lib/decision-os/trade/evaluateStoredTrade',()=>({gradeInputsOf:(assets:unknown)=>({assets,unpriceable:[]})}))
vi.mock('@/lib/decision-os/trade/evaluateTrade',()=>({evaluateTrade:m.evaluate}))
vi.mock('@/lib/decision-os/trade/loadVisualImpact',()=>({loadVisualImpact:m.impact}))
vi.mock('@/lib/core-app/archivedTradeGrade',()=>({gradeArchivedTradeRows:m.archive}))
vi.mock('@/lib/prisma',()=>({prisma:{}}))
import {POST} from '@/app/api/trades/impact-now/route'
const request=(body:unknown)=>({json:async()=>body}) as Request
let count=0
const body={leagueId:'l',trade:{kind:'af',tradeId:'t'}}
beforeEach(()=>{vi.clearAllMocks();m.session.mockResolvedValue({user:{id:`user${++count}`}});m.membership.mockResolvedValue({ok:true});m.impact.mockResolvedValue({impact:null,reason:'Missing feed',moved:[],returned:[],evaluatedAt:'2026-10-03',rostersStale:false});m.evaluate.mockResolvedValue({grade:{graded:false,reason:'Missing quotes'}});m.load.mockResolvedValue({ok:true,viewer:{side:'A'},trade:{status:'completed',sideA:{gives:[{kind:'player',playerId:'1',name:'Sent'}]},sideB:{gives:[{kind:'player',playerId:'2',name:'Received'}]}}})})
describe('Impact now privacy and original preservation',()=>{
  it('requires a session and membership before loading any trade assets',async()=>{
    m.session.mockResolvedValue(null);expect((await POST(request(body))).status).toBe(401)
    m.session.mockResolvedValue({user:{id:'member'}});m.membership.mockResolvedValue({ok:false});expect((await POST(request(body))).status).toBe(403);expect(m.load).not.toHaveBeenCalled();expect(m.archive).not.toHaveBeenCalled()
  })
  it('rejects a pending trade or a completed trade the viewer did not participate in',async()=>{
    const loaded=await m.load();loaded.trade.status='proposed';m.load.mockResolvedValue(loaded);expect((await POST(request(body))).status).toBe(400)
    loaded.trade.status='completed';loaded.viewer.side=null;expect((await POST(request(body))).status).toBe(400);expect(m.evaluate).not.toHaveBeenCalled()
  })
  it('uses stored assets and session identity and never overwrites an evaluation',async()=>{
    expect((await POST(request({...body,userId:'intruder',sent:['fake']}))).status).toBe(200)
    expect(m.impact).toHaveBeenCalledWith({leagueId:'l',userId:`user${count}`,sent:['1'],received:['2'],completed:true})
    expect(m.evaluate).toHaveBeenCalledWith(expect.objectContaining({viewerSide:false,persist:false,surface:'impact-now'}))
  })
})
