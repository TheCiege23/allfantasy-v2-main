// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const h = vi.hoisted(() => ({ session:vi.fn(), claim:vi.fn(), fingerprint:vi.fn(), finish:vi.fn(), read:vi.fn(), reconcile:vi.fn(), recover:vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession:h.session }))
vi.mock('@/lib/auth', () => ({ authOptions:{} }))
vi.mock('@/lib/chimmy/requestReceipts', () => ({
  claimRequestReceipt:h.claim, fingerprintChimmyRequest:h.fingerprint, finishRequestReceipt:h.finish,
  readRequestReceipt:h.read, reconcileRequestCharge:h.reconcile, recoverExpiredReceipt:h.recover,
  reconcileUnreportedTokenCharge:vi.fn(),
  validChimmyRequestId:(id:string) => /^[A-Za-z0-9_-]{8,128}$/.test(id),
}))
import { withChimmyRequestReceipt, getChimmyRequestResponse } from '@/lib/chimmy/requestDelivery'

const context = { id:'receipt', userId:'owner', ownerToken:'lease' }
const request = (confirmed=false) => {
  const form = new FormData()
  form.set('requestId','request-1234'); form.set('message','Analyze this trade')
  if (confirmed) form.set('confirmTokenSpend','true')
  return new NextRequest('https://example.test/api/chat/chimmy', { method:'POST', body:form })
}
beforeEach(() => {
  vi.resetAllMocks()
  h.session.mockResolvedValue({ user:{id:'owner'} })
  h.fingerprint.mockResolvedValue('fingerprint')
  h.claim.mockResolvedValue({kind:'execute',context})
  h.finish.mockResolvedValue(undefined); h.reconcile.mockResolvedValue(undefined)
  h.recover.mockImplementation(async r => r)
})
describe('durable Chimmy delivery boundary', () => {
  it('applies request protection before creating a receipt', async () => {
    const execute = vi.fn()
    const protection = vi.fn(async () => NextResponse.json({error:'Rate limited'},{status:429}))
    expect((await withChimmyRequestReceipt(request(),execute,protection)).status).toBe(429)
    expect(h.claim).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
  })
  it('replays a lost response without executing or billing again', async () => {
    const receipt = {response:{response:'YES — the trade improves your starters'},http_status:200}
    h.claim.mockResolvedValue({kind:'existing',receipt})
    const execute = vi.fn()
    const response = await withChimmyRequestReceipt(request(),execute)
    expect(await response.json()).toEqual(receipt.response)
    expect(execute).not.toHaveBeenCalled()
    expect(h.reconcile).not.toHaveBeenCalled()
  })
  it('returns processing for a concurrent retry', async () => {
    h.claim.mockResolvedValue({kind:'existing',receipt:{response:null,http_status:null}})
    const execute = vi.fn()
    expect((await withChimmyRequestReceipt(request(),execute)).status).toBe(202)
    expect(execute).not.toHaveBeenCalled()
  })
  it('refuses the same identity with a changed question', async () => {
    h.claim.mockResolvedValue({kind:'conflict'})
    const execute = vi.fn()
    expect((await withChimmyRequestReceipt(request(),execute)).status).toBe(409)
    expect(execute).not.toHaveBeenCalled()
  })
  it('does not execute when receipt persistence is unavailable', async () => {
    h.claim.mockRejectedValue(new Error('database unavailable'))
    const execute = vi.fn()
    expect((await withChimmyRequestReceipt(request(),execute)).status).toBe(503)
    expect(execute).not.toHaveBeenCalled()
  })
  it('requires recovery before returning an undelivered fallback', async () => {
    const response = NextResponse.json({response:'Unavailable',meta:{delivery:{delivered:false}}})
    await withChimmyRequestReceipt(request(),async () => response)
    expect(h.reconcile).toHaveBeenCalledWith(context)
    expect(h.finish).toHaveBeenCalledWith(context,await response.json(),200,false)
  })
  it('preserves confirmation as a resumable receipt', async () => {
    await withChimmyRequestReceipt(request(),async () => NextResponse.json({code:'token_confirmation_required'},{status:409}))
    expect(h.finish).toHaveBeenCalledWith(context,{code:'token_confirmation_required'},409,true)
    await withChimmyRequestReceipt(request(true),async () => NextResponse.json({response:'Answer'}))
    expect(h.claim).toHaveBeenLastCalledWith({userId:'owner',requestId:'request-1234',fingerprint:'fingerprint',confirmed:true})
  })
  it('scopes receipt reads to the authenticated owner', async () => {
    h.read.mockResolvedValue(null)
    expect((await getChimmyRequestResponse('different-user','request-1234')).status).toBe(404)
    expect(h.read).toHaveBeenCalledWith('different-user','request-1234')
  })
  it('does not expose a response when its durable save fails', async () => {
    h.finish.mockRejectedValue(new Error('save failed'))
    const response = await withChimmyRequestReceipt(request(),async () => NextResponse.json({response:'Paid answer'}))
    expect(response.status).toBe(503)
    expect(h.reconcile).toHaveBeenCalledWith(context)
  })
})
