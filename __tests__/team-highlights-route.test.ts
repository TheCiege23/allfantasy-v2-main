import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks=vi.hoisted(()=>({session:vi.fn(),players:vi.fn(),highlights:vi.fn(),limit:vi.fn()}))
vi.mock('next-auth',()=>({getServerSession:mocks.session}))
vi.mock('@/lib/auth',()=>({authOptions:{}}))
vi.mock('@/lib/prisma',()=>({prisma:{sportsPlayer:{findMany:mocks.players}}}))
vi.mock('@/lib/highlights/youtube',()=>({getPlayerHighlights:mocks.highlights}))
vi.mock('@/lib/rate-limit',()=>({consumeRateLimit:mocks.limit,getClientIp:()=> 'local',buildRateLimit429:()=>({error:'Rate limited'})}))
import { POST } from '@/app/api/core/my-team/highlights/route'
const request=(body:unknown)=>new Request('https://allfantasy.ai/api/core/my-team/highlights',{method:'POST',body:JSON.stringify(body)})
beforeEach(()=>{vi.clearAllMocks();mocks.session.mockResolvedValue({user:{id:'me'}});mocks.limit.mockReturnValue({success:true});mocks.players.mockResolvedValue([{sleeperId:'1',name:'Josh Allen',sport:'NFL',team:'BUF',position:'QB',source:'sleeper',fetchedAt:new Date()}]);mocks.highlights.mockResolvedValue({status:'ready',videos:[],message:null,checkedAt:null})})
describe('team highlights API',()=>{
  it('requires authentication before reading any data',async()=>{mocks.session.mockResolvedValue(null);expect((await POST(request({playerIds:['1']}))).status).toBe(401);expect(mocks.players).not.toHaveBeenCalled()})
  it('rejects oversized or arbitrary name requests',async()=>{expect((await POST(request({playerIds:Array(61).fill('1')}))).status).toBe(400);expect((await POST(request({playerIds:['1'],name:'Someone else'}))).status).toBe(400);expect(mocks.highlights).not.toHaveBeenCalled()})
  it('uses canonical NFL identities, throttles requests and never caches roster responses',async()=>{const response=await POST(request({playerIds:['1','1']}));expect(response.status).toBe(200);expect(response.headers.get('Cache-Control')).toBe('private, no-store');expect(mocks.players.mock.calls[0][0].where.sleeperId.in).toEqual(['1']);expect(mocks.highlights).toHaveBeenCalledWith({sleeperId:'1',name:'Josh Allen',sport:'NFL',team:'BUF'});mocks.limit.mockReturnValue({success:false,retryAfterSec:60});expect((await POST(request({playerIds:['1']}))).status).toBe(429)})
  it('names each Sleeper id by its Sleeper row, not a newer namesake row carrying the same id',async()=>{
    // Production 2026-10-11: TheSportsDB's "Elgton Jenkins" (G, CLE) carries TE E.J. Jenkins's 11304.
    mocks.players.mockResolvedValue([
      {sleeperId:'11304',name:'Elgton Jenkins',sport:'NFL',team:'Cleveland Browns',position:'G',source:'thesportsdb',fetchedAt:new Date('2026-10-11T08:42:36Z')},
      {sleeperId:'11304',name:'E.J. Jenkins',sport:'NFL',team:'Philadelphia Eagles',position:'TE',source:'sleeper',fetchedAt:new Date('2026-10-10T18:07:45Z')},
    ])
    expect((await POST(request({playerIds:['11304']}))).status).toBe(200)
    expect(mocks.highlights).toHaveBeenCalledTimes(1)
    expect(mocks.highlights).toHaveBeenCalledWith({sleeperId:'11304',name:'E.J. Jenkins',sport:'NFL',team:'Philadelphia Eagles'})
  })
})
