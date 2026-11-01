// @vitest-environment node
import {beforeEach,expect,it,vi} from 'vitest'
const h=vi.hoisted(()=>({read:vi.fn(),recover:vi.fn()}))
vi.mock('next-auth',()=>({getServerSession:vi.fn()}))
vi.mock('@/lib/auth',()=>({authOptions:{}}))
vi.mock('@/lib/chimmy/requestReceipts',()=>({readRequestReceipt:h.read,recoverExpiredReceipt:h.recover,
 validChimmyRequestId:()=>true,claimRequestReceipt:vi.fn(),fingerprintChimmyRequest:vi.fn(),finishRequestReceipt:vi.fn(),reconcileRequestCharge:vi.fn(),reconcileUnreportedTokenCharge:vi.fn()}))
import {getChimmyRequestResponse} from '@/lib/chimmy/requestDelivery'
beforeEach(()=>{vi.clearAllMocks();h.recover.mockImplementation(async r=>r)})
it('does not expose a paid-tool receipt through the Chimmy status endpoint',async()=>{
 h.read.mockResolvedValue({fingerprint:'paid-tool-v1:hash',response:{privateReport:'locked'},http_status:200})
 const response=await getChimmyRequestResponse('u1','request-id')
 expect(response.status).toBe(404);expect(h.recover).not.toHaveBeenCalled()
})
it('still returns the account’s ordinary Chimmy response',async()=>{
 h.read.mockResolvedValue({fingerprint:'ordinary-chimmy-hash',response:{response:'answer'},http_status:200})
 const response=await getChimmyRequestResponse('u1','request-id')
 expect(response.status).toBe(200);expect(await response.json()).toEqual({response:'answer'})
})
