// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'
const h = vi.hoisted(() => ({ rows: new Map<string, any>(), read: vi.fn(), claim: vi.fn(), intent: vi.fn(), finish: vi.fn(), reconcile: vi.fn(), spend: vi.fn(), preview: vi.fn(), work: vi.fn(), authorized: true, refunds: new Set<string>() }))
vi.mock('@/lib/chimmy/requestReceipts', () => ({
 validChimmyRequestId: (id:string) => /^[A-Za-z0-9_-]{8,128}$/.test(id), receiptSpendKey: (id:string) => 'chimmy_request:' + id,
 readRequestReceipt: h.read, claimRequestReceipt: h.claim, recordReceiptTokenIntent: h.intent,
 assertReceiptTokenSpend: vi.fn(), finishRequestReceipt: h.finish, reconcileRequestCharge: h.reconcile,
 recoverExpiredReceipt: async (r:unknown) => r,
}))
vi.mock('@/lib/tokens/TokenSpendService', async original => {
 const actual = await original<typeof import('@/lib/tokens/TokenSpendService')>()
 return { ...actual, TokenSpendService: class { spendTokensForRule = h.spend; previewSpend = h.preview } }
})
import { paidToolFingerprint, paidToolNotDelivered, preparePaidToolCharge, replayPaidToolRequest, withPaidToolBilling } from '@/lib/tokens/paidToolBilling'
import { TokenSpendPriceChangedError } from '@/lib/tokens/TokenSpendService'
const preview = { ruleCode:'ai_waiver_engine_run', tokenCost:3, currentBalance:10, canSpend:true } as any
const post = withPaidToolBilling(async (req:Request) => {
 if (!h.authorized) return NextResponse.json({error:'Forbidden'}, {status:403})
 const body = await req.json()
 const replay = await replayPaidToolRequest('u1'); if (replay) return replay
 const p = await h.preview()
 const access = await preparePaidToolCharge({userId:'u1',ruleCode:p.ruleCode,preview:p,confirmed:body.confirmTokenSpend === true,sourceType:'test'})
 if (!access.ok) return access.response
 const ledger = await access.commit()
 const result = await h.work()
 if (result === 'fallback') paidToolNotDelivered()
 return NextResponse.json({ok:true, result, tokenSpend:{ledgerId:ledger.id, tokenCost:Math.abs(ledger.tokenDelta)}})
})
function request(body:Record<string,unknown> = {}, offer?:any) {
 const headers:Record<string,string> = {'Content-Type':'application/json'}
 if (offer) { headers['x-paid-tool-request-id'] = offer.paidToolRequestId; headers['x-paid-tool-quote'] = offer.tokenQuote }
 return new Request('https://test/api/waiver-ai/engine', {method:'POST',headers,body:JSON.stringify({question:'pick a waiver',...body})})
}
async function offer() { const res = await post(request()); expect(res.status).toBe(409); return res.json() }
beforeEach(() => {
 vi.clearAllMocks(); h.rows.clear(); h.refunds.clear(); h.authorized = true
 process.env.NEXTAUTH_SECRET = 'test-only-tool-billing-key'
 h.read.mockImplementation(async (userId,id) => h.rows.get(userId+id) ?? null)
 h.claim.mockImplementation(async ({userId,requestId,fingerprint}) => {
  const key=userId+requestId, existing=h.rows.get(key)
  if (existing && existing.status !== 'awaiting_confirmation') return {kind:'existing',receipt:existing}
  const row={id:key,user_id:userId,fingerprint,status:'processing',expires_at:new Date(Date.now()+900000)}
  h.rows.set(key,row); return {kind:'execute',context:{id:key,userId,ownerToken:'owner'}}
 })
 h.intent.mockResolvedValue(undefined)
 h.finish.mockImplementation(async (ctx,payload,status,awaiting) => { Object.assign(h.rows.get(ctx.id), {response:payload,http_status:status,status:awaiting?'awaiting_confirmation':'completed'}) })
 h.reconcile.mockImplementation(async ctx => {if (h.spend.mock.results.some(r=>r.type==='return')) h.refunds.add(ctx.id)})
 h.preview.mockResolvedValue({...preview}); h.spend.mockResolvedValue({id:'ledger',tokenDelta:-3,balanceAfter:7}); h.work.mockResolvedValue('paid detail')
})
describe('remaining paid tool boundary', () => {
 it('a boolean alone never charges, and a changed question cannot use a quote', async () => {
  expect((await post(request({confirmTokenSpend:true}))).status).toBe(409)
  const quote=await offer()
  expect((await post(request({question:'different',confirmTokenSpend:true},quote))).status).toBe(409)
  expect(h.spend).not.toHaveBeenCalled(); expect(h.work).not.toHaveBeenCalled()
 })
 it('charges the exact quote once and replays a delivered result', async () => {
  const quote=await offer()
  const first=await post(request({confirmTokenSpend:true},quote)); expect(first.status).toBe(200)
  const replay=await post(request({confirmTokenSpend:true},quote)); expect(await replay.json()).toEqual(await first.json())
  expect(h.spend).toHaveBeenCalledTimes(1);expect(h.work).toHaveBeenCalledTimes(1)
  expect(h.spend).toHaveBeenCalledWith(expect.objectContaining({expectedTokenCost:3,idempotencyKey:expect.stringContaining('chimmy_request:'),assertWithinTransaction:expect.any(Function)}))
  expect(h.reconcile).not.toHaveBeenCalled()
 })
 it('two simultaneous approved requests execute only one provider call', async () => {
  let release!:()=>void; h.work.mockImplementation(()=>new Promise(resolve=>{release=()=>resolve('paid detail')}))
  const quote=await offer();const first=post(request({confirmTokenSpend:true},quote))
  await vi.waitFor(()=>expect(h.work).toHaveBeenCalledTimes(1))
  expect((await post(request({confirmTokenSpend:true},quote))).status).toBe(202)
  release(); expect((await first).status).toBe(200);expect(h.spend).toHaveBeenCalledTimes(1)
 })
 it('refunds a failed provider once and seals the request instead of executing it free on retry', async () => {
  h.work.mockRejectedValue(new Error('provider down'));const quote=await offer()
  expect((await post(request({confirmTokenSpend:true},quote))).status).toBe(503)
  expect((await post(request({confirmTokenSpend:true},quote))).status).toBe(503)
  expect(h.refunds.size).toBe(1);expect(h.spend).toHaveBeenCalledTimes(1);expect(h.work).toHaveBeenCalledTimes(1)
 })
 it('returns useful fallback data free with refunded billing metadata', async () => {
  h.work.mockResolvedValue('fallback');const quote=await offer();const response=await post(request({confirmTokenSpend:true},quote))
  expect(await response.json()).toMatchObject({result:'fallback',tokenSpend:null,billing:{status:'refunded',tokenCharged:false}})
  expect(h.refunds.size).toBe(1)
 })
 it('withholds detail while a refund is pending', async () => {
  h.work.mockResolvedValue('fallback');h.reconcile.mockRejectedValue(new Error('database unavailable'))
  const response=await post(request({confirmTokenSpend:true},await offer()))
  expect(response.status).toBe(503);expect(await response.json()).toMatchObject({code:'paid_tool_recovery_pending'})
  expect(h.finish).not.toHaveBeenCalled()
 })
 it.each([2,4])('requires fresh consent when the transaction price becomes %i', async cost => {
  const quote=await offer();h.spend.mockRejectedValueOnce(new TokenSpendPriceChangedError(3,cost));h.preview.mockResolvedValue({...preview,tokenCost:cost})
  // Quote was issued at 3; emulate a change inside the transaction, after the server's preflight read.
  h.preview.mockResolvedValueOnce({...preview}).mockResolvedValue({...preview,tokenCost:cost})
  const response=await post(request({confirmTokenSpend:true},quote));expect(response.status).toBe(409)
  expect(await response.json()).toMatchObject({preview:{tokenCost:cost},code:'token_confirmation_required'})
  expect(h.work).not.toHaveBeenCalled()
 })
 it('checks current resource access before returning an old private result', async () => {
  const quote=await offer();await post(request({confirmTokenSpend:true},quote));h.authorized=false;h.read.mockClear()
  expect((await post(request({confirmTokenSpend:true},quote))).status).toBe(403);expect(h.read).not.toHaveBeenCalled()
 })
 it('fingerprints content and query parameters, excluding only consent fields', () => {
  const url='https://test/api/tool?week=1'
  expect(paidToolFingerprint(url,'POST',{b:2,a:1})).toBe(paidToolFingerprint(url,'POST',{a:1,b:2,confirmed:true,tokenQuote:'x'}))
  expect(paidToolFingerprint(url,'POST',{a:1})).not.toBe(paidToolFingerprint(url.replace('week=1','week=2'),'POST',{a:1}))
 })
})

it('cannot debit through a detached boolean-only guard without a request receipt', async () => {
 const access=await preparePaidToolCharge({userId:'u1',ruleCode:preview.ruleCode,preview,confirmed:true,sourceType:'test'})
 expect(access.ok).toBe(false);if (!access.ok) expect(access.response.status).toBe(503)
 expect(h.spend).not.toHaveBeenCalled()
})
