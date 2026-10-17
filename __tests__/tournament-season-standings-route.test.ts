import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mock=vi.hoisted(()=>({session:vi.fn(),review:vi.fn()}))
vi.mock('next-auth',()=>({getServerSession:mock.session}))
vi.mock('@/lib/auth',()=>({authOptions:{}}))
vi.mock('@/lib/tournament/seasonScoreLedger',()=>({reviewSeasonOpeningStandings:mock.review}))
import { POST } from '@/app/api/tournament/season-standings/route'
import { BlueprintOperationError } from '@/lib/tournament/seasonBlueprintStore'
const body={tournamentId:'t1',freezeId:'f1',throughPeriod:1}
const request=(data:unknown)=>new NextRequest('https://test/api/tournament/season-standings',{method:'POST',body:JSON.stringify(data)})
beforeEach(()=>{vi.resetAllMocks();mock.session.mockResolvedValue({user:{id:'owner'}})})
it('authenticates before reading the frozen field',async()=>{mock.session.mockResolvedValue(null);expect((await POST(request(body))).status).toBe(401);expect(mock.review).not.toHaveBeenCalled()})
it('uses session ownership and private cache headers',async()=>{mock.review.mockResolvedValue({rows:[],canAdvance:false});const r=await POST(request(body));expect(r.status).toBe(200);expect(r.headers.get('Cache-Control')).toBe('no-store');expect(mock.review).toHaveBeenCalledWith('owner','t1','f1',1)})
it.each([{scores:[]},{userId:'forged'},{throughPeriod:0},{throughPeriod:31},{freezeId:undefined}])('rejects unsafe input %j',async patch=>{expect((await POST(request({...body,...patch}))).status).toBe(400);expect(mock.review).not.toHaveBeenCalled()})
it('preserves owner errors and hides storage details',async()=>{mock.review.mockRejectedValueOnce(new BlueprintOperationError('Owner only.',403));expect((await POST(request(body))).status).toBe(403);mock.review.mockRejectedValueOnce(new Error('secret connection'));const r=await POST(request(body));expect(r.status).toBe(409);expect(JSON.stringify(await r.json())).not.toContain('secret')})
