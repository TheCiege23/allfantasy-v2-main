// @vitest-environment node
import {beforeEach,expect,it,vi} from 'vitest'
const h=vi.hoisted(()=>({transaction:vi.fn(),rule:vi.fn(),ledger:vi.fn(),create:vi.fn(),wallet:vi.fn(),read:vi.fn(),debit:vi.fn(),decision:vi.fn()}))
vi.mock('@/lib/dev-admin/access',()=>({isSubscriptionEntitlementBypassUserId:()=>false}))
vi.mock('@/lib/subscription/EntitlementResolver',()=>({EntitlementResolver:class {}}))
vi.mock('@/lib/tokens/subscription-policy',()=>({resolveTokenChargeDecisionForUser:h.decision,resolveTokenChargeDecisionForEntitlement:vi.fn()}))
vi.mock('@/lib/prisma',()=>({prisma:{$transaction:h.transaction,tokenPackage:{upsert:vi.fn()},tokenSpendRule:{upsert:vi.fn()},tokenRefundRule:{upsert:vi.fn()}}}))
import {TokenSpendService,TokenSpendPriceChangedError} from '@/lib/tokens/TokenSpendService'
const input={userId:'u1',ruleCode:'ai_chimmy_chat_message',confirmed:true,sourceType:'test',idempotencyKey:'same-receipt',expectedTokenCost:3}
beforeEach(()=>{
 vi.resetAllMocks();h.rule.mockResolvedValue({code:input.ruleCode,tokenCost:3,requiresConfirmation:true,isActive:true});h.decision.mockResolvedValue({effectiveTokenCost:3,discountPct:0});h.wallet.mockResolvedValue({id:'wallet',balance:10,reservedBalance:0});h.read.mockResolvedValue({balance:7});h.debit.mockResolvedValue(1)
 h.create.mockImplementation(async ({data})=>({id:'debit',...data,createdAt:new Date()}));h.transaction.mockImplementation(async cb=>cb({tokenSpendRule:{findUnique:h.rule},tokenLedger:{findUnique:h.ledger,create:h.create},userTokenBalance:{upsert:h.wallet,findUnique:h.read},$executeRaw:h.debit}))
})
it('rejects both a lower and higher transaction price before touching the wallet',async()=>{
 for(const price of [2,4]) {h.decision.mockResolvedValue({effectiveTokenCost:price});await expect(new TokenSpendService().spendTokensForRule(input)).rejects.toBeInstanceOf(TokenSpendPriceChangedError)}
 expect(h.wallet).not.toHaveBeenCalled();expect(h.debit).not.toHaveBeenCalled();expect(h.create).not.toHaveBeenCalled()
})
it('debits exactly three tokens and replays the ledger without another debit',async()=>{
 const result=await new TokenSpendService().spendTokensForRule(input);expect(result).toMatchObject({tokenDelta:-3,balanceBefore:10,balanceAfter:7})
 const sql=h.debit.mock.calls[0][0];expect(sql.values.slice(0,2)).toEqual([3,3]);expect(h.create.mock.calls[0][0].data.tokenDelta).toBe(-3)
 h.ledger.mockResolvedValue({id:'debit',tokenDelta:-3,balanceBefore:10,balanceAfter:7,createdAt:new Date()});await new TokenSpendService().spendTokensForRule(input)
 expect(h.debit).toHaveBeenCalledTimes(1);expect(h.create).toHaveBeenCalledTimes(1)
})
