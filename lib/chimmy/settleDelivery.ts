import type { ChimmyDeliveryVerdict } from './chargeOnDelivery'

/** Refund identity is the original spend, shared with the route's exception path. */
export async function settleUndeliveredChimmyAnswer(args: {
  delivery: ChimmyDeliveryVerdict
  ledgerId?: string | null
  included: boolean
  refund: (identity: { spendLedgerId: string; idempotencyKey: string; reason: string }) => Promise<{ balanceAfter: number } | null>
  releaseAllowance: () => Promise<void | boolean>
}): Promise<{ refund: { balanceAfter: number; reason: string } | null; allowanceReleased: boolean; refundPending: boolean }> {
  if (args.delivery.delivered) return { refund: null, allowanceReleased: false, refundPending: false }
  let refund: { balanceAfter: number; reason: string } | null = null
  if (args.ledgerId) {
    const result = await args.refund({ spendLedgerId: args.ledgerId, idempotencyKey: `refund:chimmy_chat:${args.ledgerId}`, reason: args.delivery.reason }).catch(() => null)
    if (result) refund = { balanceAfter: result.balanceAfter, reason: args.delivery.reason }
  }
  let allowanceReleased = false
  if (args.included) {
    try { allowanceReleased = (await args.releaseAllowance()) !== false } catch { /* Never claim a failed release succeeded. */ }
  }
  return { refund, allowanceReleased, refundPending: Boolean(args.ledgerId && !refund) }
}
