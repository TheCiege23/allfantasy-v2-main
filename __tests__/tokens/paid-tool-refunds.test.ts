// @vitest-environment node
import {beforeEach,expect,it,vi} from 'vitest'
const h=vi.hoisted(()=>({transaction:vi.fn(),unique:vi.fn(),first:vi.fn(),create:vi.fn(),query:vi.fn(),update:vi.fn(),balance:10,rows:[] as any[]}))
vi.mock('@/lib/dev-admin/access',()=>({isSubscriptionEntitlementBypassUserId:()=>false}))
vi.mock('@/lib/prisma',()=>({prisma:{$transaction:h.transaction,tokenPackage:{upsert:vi.fn()},tokenSpendRule:{upsert:vi.fn()},tokenRefundRule:{upsert:vi.fn()}}}))
import {TokenSpendService} from '@/lib/tokens/TokenSpendService'
const original={id:'spend-1',userId:'u1',userTokenBalanceId:'wallet',entryType:'spend',tokenDelta:-3,createdAt:new Date(),idempotencyKey:'tool-receipt'}
beforeEach(()=>{
 vi.clearAllMocks();h.balance=10;h.rows=[];h.query.mockResolvedValue([{id:'spend-1'}])
 h.unique.mockImplementation(async({where})=>h.rows.find(r=>r.idempotencyKey===where.idempotencyKey||r.id===where.id)??null)
 h.first.mockImplementation(async({where})=>where.entryType==='spend'?(where.userId===original.userId?original:null):h.rows.find(r=>r.userId===where.userId&&r.entryType===where.entryType&&r.sourceId===where.sourceId)??null)
 h.update.mockImplementation(async({data})=>{h.balance+=data.balance.increment})
 h.create.mockImplementation(async({data})=>{const row={id:'refund-'+h.rows.length,...data,createdAt:new Date()};h.rows.push(row);return row})
 h.transaction.mockImplementation(async cb=>cb({$queryRaw:h.query,tokenLedger:{findUnique:h.unique,findFirst:h.first,create:h.create},tokenRefundRule:{findUnique:async()=>({code:'feature_execution_failed',isActive:true,maxAgeMinutes:60})},userTokenBalance:{update:h.update,findUnique:async()=>({balance:h.balance})}}))
})
it('refunds exactly the original three tokens once across different failure handlers and retry keys',async()=>{
 const service=new TokenSpendService()
 const first=await service.refundSpendByLedger({userId:'u1',spendLedgerId:'spend-1',refundRuleCode:'feature_execution_failed',sourceType:'context_failed',idempotencyKey:'handler-a'})
 const again=await service.refundSpendByLedger({userId:'u1',spendLedgerId:'spend-1',refundRuleCode:'feature_execution_failed',sourceType:'provider_failed',idempotencyKey:'handler-b'})
 expect(first).toMatchObject({tokenDelta:3,balanceBefore:10,balanceAfter:13,sourceType:'refund_for_spend',sourceId:'spend-1'});expect(again.id).toBe(first.id)
 expect(h.update).toHaveBeenCalledTimes(1);expect(h.create).toHaveBeenCalledTimes(1);expect(h.balance).toBe(13)
 expect(h.query.mock.calls[0][0].sql).toContain('FOR UPDATE')
})
it('recognizes a historical refund with a custom source label',async()=>{
 h.rows.push({id:'historic',userId:'u1',entryType:'refund',tokenDelta:3,balanceBefore:7,balanceAfter:10,sourceType:'custom_old_refund',sourceId:'spend-1',idempotencyKey:'old-refund-key',createdAt:new Date()})
 expect((await new TokenSpendService().refundSpendByLedger({userId:'u1',spendLedgerId:'spend-1',refundRuleCode:'feature_execution_failed'})).id).toBe('historic')
 expect(h.update).not.toHaveBeenCalled()
})
it('cannot refund another account’s charge',async()=>{
 await expect(new TokenSpendService().refundSpendByLedger({userId:'u2',spendLedgerId:'spend-1',refundRuleCode:'feature_execution_failed'})).rejects.toThrow('Original spend')
 expect(h.update).not.toHaveBeenCalled()
})
