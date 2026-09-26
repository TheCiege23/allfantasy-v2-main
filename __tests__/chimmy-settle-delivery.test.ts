import { describe, expect, it, vi } from 'vitest'
import { settleUndeliveredChimmyAnswer } from '@/lib/chimmy/settleDelivery'

describe('Chimmy non-delivery settlement', () => {
  it('does not refund or release a successfully delivered answer', async () => {
    const refund = vi.fn(), releaseAllowance = vi.fn()
    expect(await settleUndeliveredChimmyAnswer({ delivery: { delivered: true }, ledgerId: 'paid', included: true, refund, releaseAllowance })).toEqual({ refund: null, allowanceReleased: false, refundPending: false })
    expect(refund).not.toHaveBeenCalled()
    expect(releaseAllowance).not.toHaveBeenCalled()
  })
  it('uses the same ledger-based refund identity on a retry', async () => {
    const refund = vi.fn().mockResolvedValue({ balanceAfter: 100 })
    const args = { delivery: { delivered: false as const, reason: 'empty_answer' as const }, ledgerId: 'paid', included: false, refund, releaseAllowance: vi.fn() }
    const result = await settleUndeliveredChimmyAnswer(args)
    await settleUndeliveredChimmyAnswer(args)
    expect(refund.mock.calls[0][0]).toEqual({ spendLedgerId: 'paid', idempotencyKey: 'refund:chimmy_chat:paid', reason: 'empty_answer' })
    expect(refund.mock.calls[1][0]).toEqual(refund.mock.calls[0][0])
    expect(result).toMatchObject({ refund: { balanceAfter: 100 }, refundPending: false })
  })
  it('releases an included non-answer without touching tokens', async () => {
    const refund = vi.fn(), releaseAllowance = vi.fn().mockResolvedValue(undefined)
    expect(await settleUndeliveredChimmyAnswer({ delivery: { delivered: false, reason: 'no_model_answered' }, included: true, refund, releaseAllowance })).toMatchObject({ allowanceReleased: true, refundPending: false })
    expect(refund).not.toHaveBeenCalled()
    expect(releaseAllowance).toHaveBeenCalledTimes(1)
  })
  it('reports a pending refund rather than claiming zero cost when the refund fails', async () => {
    const result = await settleUndeliveredChimmyAnswer({ delivery: { delivered: false, reason: 'empty_answer' }, ledgerId: 'paid', included: false,
      refund: vi.fn().mockRejectedValue(new Error('db down')), releaseAllowance: vi.fn() })
    expect(result).toEqual({ refund: null, allowanceReleased: false, refundPending: true })
  })
  it('does not claim an allowance release succeeded when the release fails', async () => {
    const result = await settleUndeliveredChimmyAnswer({ delivery: { delivered: false, reason: 'empty_answer' }, included: true,
      refund: vi.fn(), releaseAllowance: vi.fn().mockRejectedValue(new Error('db down')) })
    expect(result.allowanceReleased).toBe(false)
  })
  it('honors the allowance service reporting a failed release without throwing', async () => {
    const result = await settleUndeliveredChimmyAnswer({ delivery: { delivered: false, reason: 'empty_answer' }, included: true,
      refund: vi.fn(), releaseAllowance: vi.fn().mockResolvedValue(false) })
    expect(result.allowanceReleased).toBe(false)
  })
})
