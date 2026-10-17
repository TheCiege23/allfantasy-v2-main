import {beforeEach,describe,expect,it,vi} from 'vitest'
const mocks = vi.hoisted(() => ({gate:vi.fn(),importBoard:vi.fn()}))
vi.mock('@/lib/adminAuth', () => ({requireAdmin:mocks.gate}))
vi.mock('@/lib/workers/importObservedMarketAdp', () => ({importObservedMarketAdpBoard:mocks.importBoard}))
import {POST} from '@/app/api/admin/fantasy-data/adp-import/route'
beforeEach(() => {vi.resetAllMocks();mocks.gate.mockResolvedValue({ok:true,user:{role:'admin'}});mocks.importBoard.mockResolvedValue({dryRun:true,accepted:1})})
describe('licensed ADP admin import access', () => {
 it('refuses unauthenticated writes before parsing',async () => {mocks.gate.mockResolvedValue({ok:false,res:new Response('',{status:401})});expect((await POST(new Request('http://localhost',{method:'POST'}))).status).toBe(401);expect(mocks.importBoard).not.toHaveBeenCalled()})
 it('requires explicit dry-run choice',async () => {expect((await POST(new Request('http://localhost',{method:'POST',body:JSON.stringify({expected:{sport:'NBA'},board:{}})}))).status).toBe(400);expect(mocks.importBoard).not.toHaveBeenCalled()})
 it('passes the admin dry-run choice through',async () => {const expected={sport:'NBA',season:2026,scoring:'points',format:'redraft'};expect((await POST(new Request('http://localhost',{method:'POST',body:JSON.stringify({expected,board:{},dryRun:true})}))).status).toBe(200);expect(mocks.importBoard).toHaveBeenCalledWith({},expected,true)})
 it('rejects invalid exports without exposing internal errors',async () => {mocks.importBoard.mockRejectedValue(new Error('sensitive internal failure'));const response=await POST(new Request('http://localhost',{method:'POST',body:JSON.stringify({expected:{},board:{},dryRun:false})}));expect(response.status).toBe(400);expect(await response.text()).not.toContain('sensitive')})
})
