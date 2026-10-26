// @vitest-environment node
import {expect,it} from 'vitest'
import {requireQuotedChimmyReceipt} from '@/lib/chimmy/quotedReceiptGuard'
const receipt={id:'receipt',userId:'u1',ownerToken:'owner'}
it('refuses a paid request without both the verified quote price and durable receipt',async()=>{
 for(const [context,cost] of [[undefined,3],[receipt,undefined],[receipt,-1],[receipt,1.5]] as const) {
  const response=requireQuotedChimmyReceipt(context,cost)
  expect(response?.status).toBe(409);expect(await response?.json()).toMatchObject({code:'chimmy_client_update_required'})
 }
})
it('accepts exact quoted prices, including a server-authorized zero-cost admin action',()=>{
 expect(requireQuotedChimmyReceipt(receipt,3)).toBeNull();expect(requireQuotedChimmyReceipt(receipt,0)).toBeNull()
 expect(requireQuotedChimmyReceipt(undefined,0)).toBeNull()
})
