// @vitest-environment node
import {beforeEach,expect,it,vi} from 'vitest'
const h=vi.hoisted(()=>({transaction:vi.fn(),findUnique:vi.fn(),findFirst:vi.fn(),create:vi.fn(),balanceUpdate:vi.fn(),proof:vi.fn()}))
vi.mock('@/lib/dev-admin/access',()=>({isSubscriptionEntitlementBypassUserId:()=>false}))
vi.mock('@/lib/prisma',()=>({prisma:{
 $transaction:h.transaction,
 tokenPackage:{upsert:vi.fn()},tokenSpendRule:{upsert:vi.fn()},tokenRefundRule:{upsert:vi.fn()},
}}))
import {TokenSpendService} from '@/lib/tokens/TokenSpendService'
const input={userId:'owner',spendLedgerId:'debit',refundRuleCode:'feature_execution_failed',idempotencyKey:'refund:debit'}
beforeEach(()=>{
 vi.resetAllMocks()
 h.findUnique.mockResolvedValue(null)
 h.findFirst.mockResolvedValueOnce({id:'debit',userTokenBalanceId:'balance',tokenDelta:-10,createdAt:new Date(Date.now()-3*60*60_000),idempotencyKey:'chimmy_request:receipt'}).mockResolvedValueOnce(null)
 h.proof.mockResolvedValue([])
 h.create.mockResolvedValue({id:'refund',entryType:'refund',tokenDelta:10,balanceBefore:90,balanceAfter:100,createdAt:new Date()})
 h.transaction.mockImplementation(async cb=>cb({
  tokenLedger:{findUnique:h.findUnique,findFirst:h.findFirst,create:h.create},
  tokenRefundRule:{findUnique:async()=>({code:'feature_execution_failed',isActive:true,maxAgeMinutes:120})},
  userTokenBalance:{update:h.balanceUpdate,findUnique:async()=>({balance:100})},$queryRaw:h.proof,
 }))
})
it('keeps the ordinary refund window enforced',async()=>{
 await expect(new TokenSpendService().refundSpendByLedger(input)).rejects.toThrow('Refund window has expired')
 expect(h.balanceUpdate).not.toHaveBeenCalled()
})
it('requires a matching recovering receipt for an aged automatic refund',async()=>{
 await expect(new TokenSpendService().refundSpendByLedger({...input,recoveryReceiptId:'receipt'})).rejects.toThrow('Refund window has expired')
 expect(h.balanceUpdate).not.toHaveBeenCalled()
})
it('recovers an interrupted debit after the ordinary window with database proof',async()=>{
 h.proof.mockResolvedValue([{id:'receipt'}])
 expect((await new TokenSpendService().refundSpendByLedger({...input,recoveryReceiptId:'receipt'})).balanceAfter).toBe(100)
 expect(h.balanceUpdate).toHaveBeenCalledTimes(1)
})
it('cannot use a different receipt to refund an aged debit',async()=>{
 h.proof.mockResolvedValue([{id:'other'}])
 await expect(new TokenSpendService().refundSpendByLedger({...input,recoveryReceiptId:'other'})).rejects.toThrow('Refund window has expired')
 expect(h.proof).not.toHaveBeenCalled();expect(h.balanceUpdate).not.toHaveBeenCalled()
})
