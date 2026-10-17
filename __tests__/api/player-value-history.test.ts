import {beforeEach,describe,it,expect,vi} from 'vitest'
const m=vi.hoisted(()=>({session:vi.fn(),membership:vi.fn(),depth:vi.fn(),history:vi.fn(),league:vi.fn()}))
vi.mock('next-auth',()=>({getServerSession:m.session}))
vi.mock('@/lib/auth',()=>({authOptions:{}}))
vi.mock('@/lib/league-access',()=>({resolveLeagueMembership:m.membership}))
vi.mock('@/lib/core-app/corePaywall',()=>({resolveCoreDepth:m.depth}))
vi.mock('@/lib/player-values/playerValueHistory',()=>({loadPlayerValueHistory:m.history}))
vi.mock('@/lib/prisma',()=>({prisma:{league:{findUnique:m.league}}}))
vi.mock('@/lib/rate-limit',()=>({consumeRateLimit:()=>({success:true}),getClientIp:()=> 'ip'}))
import {GET} from '@/app/api/core/player-value-history/route'
const req=(query:string)=>new Request(`https://allfantasy.ai/api/core/player-value-history?${query}`)
beforeEach(()=>{vi.clearAllMocks();m.session.mockResolvedValue({user:{id:'u'}});m.membership.mockResolvedValue({ok:true});m.depth.mockResolvedValue({unlocked:true});m.history.mockResolvedValue([]);m.league.mockResolvedValue({sport:'NFL',leagueType:'redraft',settings:{roster_positions:['QB','RB']}})})
describe('value history access and book isolation',()=>{
  it('refuses a foreign sport or ambiguous id before reading prices',async()=>{
    expect((await GET(req('sleeperId=1&sport=NBA'))).status).toBe(400);expect((await GET(req('sleeperId=nfl-slug&sport=NFL'))).status).toBe(400);expect(m.history).not.toHaveBeenCalled()
  })
  it('enforces membership and the existing player-depth entitlement on the server',async()=>{
    m.membership.mockResolvedValue({ok:false});expect((await GET(req('sleeperId=1&sport=NFL&leagueId=private'))).status).toBe(403);expect(m.history).not.toHaveBeenCalled();expect(m.league).not.toHaveBeenCalled()
    m.membership.mockResolvedValue({ok:true});m.depth.mockResolvedValue({unlocked:false});expect((await GET(req('sleeperId=1&sport=NFL'))).status).toBe(403);expect(m.history).not.toHaveBeenCalled()
  })
  it('selects the league’s own book and labels the universal default separately',async()=>{
    expect((await GET(req('sleeperId=1&sport=NFL&leagueId=l'))).status).toBe(200);expect(m.history).toHaveBeenLastCalledWith(expect.objectContaining({book:{source:'FANTASYCALC',format:'REDRAFT',qbFormat:'ONE_QB'}}))
    const res=await GET(req('sleeperId=1&sport=NFL'));expect(await res.json()).toMatchObject({scope:'universal-market',book:{format:'DYNASTY',qbFormat:'SUPERFLEX'}})
  })
})
