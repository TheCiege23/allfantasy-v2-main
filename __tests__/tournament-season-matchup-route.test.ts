import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mock=vi.hoisted(()=>({session:vi.fn(),preview:vi.fn(),publish:vi.fn()}))
vi.mock('next-auth',()=>({getServerSession:mock.session}))
vi.mock('@/lib/auth',()=>({authOptions:{}}))
vi.mock('@/lib/tournament/seasonScoreLedger',()=>({previewSeasonOpeningMatchups:mock.preview,publishSeasonOpeningMatchups:mock.publish}))
import { POST } from '@/app/api/tournament/season-matchups/route'
import { BlueprintOperationError } from '@/lib/tournament/seasonBlueprintStore'
const body={action:'preview',tournamentId:'t1',freezeId:'f1',key:'pool',period:1}
const request=(data:unknown)=>new NextRequest('https://test/api/tournament/season-matchups',{method:'POST',body:JSON.stringify(data)})
beforeEach(()=>{vi.resetAllMocks();mock.session.mockResolvedValue({user:{id:'owner'}})})
it('authenticates before previewing or publishing',async()=>{mock.session.mockResolvedValue(null);expect((await POST(request(body))).status).toBe(401);expect(mock.preview).not.toHaveBeenCalled()})
it('previews one bounded league/week privately with the session actor',async()=>{mock.preview.mockResolvedValue({pairs:[],canPublish:false});const r=await POST(request(body));expect(r.status).toBe(200);expect(r.headers.get('Cache-Control')).toBe('no-store');expect(mock.preview).toHaveBeenCalledWith('owner','t1','f1','pool',1)})
it('publishes only with a valid preview token',async()=>{expect((await POST(request({...body,action:'publish'}))).status).toBe(400);mock.publish.mockResolvedValue({repeated:false});expect((await POST(request({...body,action:'publish',previewToken:'a'.repeat(64)}))).status).toBe(200);expect(mock.publish).toHaveBeenCalledWith('owner','t1','f1','pool',1,'a'.repeat(64))})
it.each([{pairs:[]},{userId:'forged'},{source:'forged'},{lockedAt:'2026-01-01'},{period:0}])('rejects client pairing, actor and clock fields %j',async patch=>{expect((await POST(request({...body,...patch}))).status).toBe(400);expect(mock.preview).not.toHaveBeenCalled()})
it('preserves owner refusals and hides internal details',async()=>{mock.preview.mockRejectedValueOnce(new BlueprintOperationError('Owner only.',403));expect((await POST(request(body))).status).toBe(403);mock.preview.mockRejectedValueOnce(new Error('secret database'));const r=await POST(request(body));expect(r.status).toBe(409);expect(JSON.stringify(await r.json())).not.toContain('secret')})
