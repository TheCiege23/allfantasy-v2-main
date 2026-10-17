// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({query:vi.fn(),execute:vi.fn(),transaction:vi.fn(),counter:vi.fn(),refund:vi.fn(),ledger:vi.fn()}))
vi.mock('@/lib/prisma', () => ({prisma:{$queryRaw:h.query,$executeRaw:h.execute,$transaction:h.transaction,tokenLedger:{findFirst:h.ledger}}}))
vi.mock('@/lib/tokens/TokenSpendService', () => ({TokenSpendService:class {refundSpendByLedger=h.refund}}))
import { assertReceiptTokenSpend, fingerprintChimmyRequest, receiptId, releaseReceiptAllowance, reconcileRequestCharge } from '@/lib/chimmy/requestReceipts'
const context={id:'r',userId:'u',ownerToken:'lease'}
const tx={$queryRaw:h.query,$executeRaw:h.execute,apiRateLimitRecord:{updateMany:h.counter}} as any
const row=(over:Record<string,unknown>={})=>({id:'r',user_id:'u',owner_token:'lease',status:'processing',expires_at:new Date(Date.now()+60_000),bill_kind:'token',bill_state:'reserved',...over})
beforeEach(()=>{
 vi.resetAllMocks();h.transaction.mockImplementation(async cb=>cb(tx));h.execute.mockResolvedValue(1);h.counter.mockResolvedValue({count:1})
})
describe('receipt billing ownership and fencing',()=>{
 it('separates the same client identity across accounts',()=>expect(receiptId('alice','same-id')).not.toBe(receiptId('bob','same-id')))
 it.each([{owner_token:'other'},{status:'recovering'},{status:'completed'},{expires_at:new Date(0)},{bill_state:'released'}])('refuses a debit after lease or billing ownership is lost: %j',async over=>{
  h.query.mockResolvedValue([row(over)])
  await expect(assertReceiptTokenSpend(tx,context)).rejects.toThrow()
 })
 it('allows a debit only inside the current billing lease',async()=>{
  h.query.mockResolvedValue([row()]);await expect(assertReceiptTokenSpend(tx,context)).resolves.toBeUndefined()
 })
 it('never decrements again after a committed release',async()=>{
  h.query.mockResolvedValue([row({bill_kind:'allowance',bill_state:'released'})])
  expect(await releaseReceiptAllowance(context)).toBe(true);expect(h.counter).not.toHaveBeenCalled()
 })
 it('releases the recorded day rather than the current day',async()=>{
  const start=new Date('2026-09-26T00:00:00Z'),end=new Date('2026-09-27T00:00:00Z')
  h.query.mockResolvedValue([row({bill_kind:'allowance',allowance_endpoint:'counter',window_start:start,window_end:end})])
  await releaseReceiptAllowance(context)
  expect(h.counter).toHaveBeenCalledWith({where:{provider:'ai_daily',endpoint:'counter',windowStart:start,windowEnd:end,callsMade:{gt:0}},data:{callsMade:{decrement:1}}})
 })
 it('fences recovery before looking up a possibly committed token debit',async()=>{
  h.query.mockResolvedValue([row()]);h.ledger.mockImplementation(async()=>{
   expect(h.execute).toHaveBeenCalled();return {id:'debit'}
  });h.refund.mockResolvedValue({})
  await reconcileRequestCharge(context)
  expect(h.refund).toHaveBeenCalledWith(expect.objectContaining({spendLedgerId:'debit',idempotencyKey:'refund:chimmy_chat:debit',recoveryReceiptId:'r'}))
 })
})
it('confirmation preserves the fingerprint while changed screenshot bytes do not',async()=>{
 const first=new FormData();first.set('requestId','one');first.set('message','trade');first.set('image',new Blob(['image-one'],{type:'image/png'}),'trade.png')
 const hash=await fingerprintChimmyRequest(first)
 first.set('requestId','two');first.set('confirmTokenSpend','true')
 expect(await fingerprintChimmyRequest(first)).toBe(hash)
 first.set('image',new Blob(['image-two'],{type:'image/png'}),'trade.png')
 expect(await fingerprintChimmyRequest(first)).not.toBe(hash)
})
