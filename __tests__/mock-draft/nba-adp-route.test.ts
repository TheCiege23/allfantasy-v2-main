// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks=vi.hoisted(()=>({signedIn:true,pool:vi.fn()}))
vi.mock('next-auth',()=>({getServerSession:async()=>mocks.signedIn?{user:{id:'viewer'}}:null}))
vi.mock('@/lib/auth',()=>({authOptions:{}}))
vi.mock('@/lib/mock-draft/mock-draft-pool-cache',()=>({getCachedMockDraftPool:mocks.pool}))
import { GET } from '@/app/api/mock-draft/adp/route'
beforeEach(()=>{vi.clearAllMocks();mocks.signedIn=true;mocks.pool.mockResolvedValue({payload:{entries:[],count:0}})})
describe('sport-aware mock pool API budget',()=>{
  it.each([['NBA',1000],['NFL',500],['NHL',500]])('bounds %s requests at %s players',async(sport,limit)=>{
    const response=await GET(new NextRequest(`https://allfantasy.ai/api/mock-draft/adp?sport=${sport}&limit=10000`))
    expect(response.status).toBe(200);expect(mocks.pool).toHaveBeenCalledWith(expect.objectContaining({sport,limit}))
  })
  it('requires a signed-in viewer before loading any pool',async()=>{
    mocks.signedIn=false
    expect((await GET(new NextRequest('https://allfantasy.ai/api/mock-draft/adp?sport=NBA&limit=1000'))).status).toBe(401)
    expect(mocks.pool).not.toHaveBeenCalled()
  })
})
