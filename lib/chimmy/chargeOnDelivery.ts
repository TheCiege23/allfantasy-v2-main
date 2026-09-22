import { CHIMMY_GENERIC_ERROR_MESSAGE } from '@/lib/chimmy-chat/response-copy'

/**
 * Did this Chimmy turn DELIVER an answer — the thing the user paid for?
 *
 * 🛑 THE USER WAS BILLED FOR "AI EXPLANATION IS TEMPORARILY UNAVAILABLE". The chat route
 * charges before the answer is produced and refunded only when the request THREW. When every AI
 * provider failed, orchestration did not throw: it returned the deterministic fallback as a
 * normal success, so the charge stood. Measured 2026-09-22 with two of three provider accounts
 * out of credit, that was a live path.
 *
 * This decides from what the models actually RETURNED, not from the reply text: a fallback's
 * wording can change, a model output's error field cannot pretend to be an answer.
 *
 * ⚠ AN ABSENT `modelOutputs` KEEPS THE CHARGE. Refunding every answer because a field went
 * missing would silently zero revenue while looking like generosity; the explicit cases below
 * are the ones this exists for, and each is pinned by a test.
 */
export type ChimmyModelOutputLike = {
  raw?: string | null
  error?: string | null
  skipped?: boolean | null
}

export type ChimmyDeliveryVerdict =
  | { delivered: true }
  | { delivered: false; reason: 'no_model_answered' | 'empty_answer' }

export function judgeChimmyDelivery(args: {
  modelOutputs: readonly ChimmyModelOutputLike[] | null | undefined
  answer: string | null | undefined
}): ChimmyDeliveryVerdict {
  const answer = (args.answer ?? '').trim()
  if (!answer || answer === CHIMMY_GENERIC_ERROR_MESSAGE) {
    return { delivered: false, reason: 'empty_answer' }
  }
  if (args.modelOutputs == null) return { delivered: true }
  const answered = args.modelOutputs.some(
    (o) => !o.skipped && !o.error && typeof o.raw === 'string' && o.raw.trim().length > 0,
  )
  return answered ? { delivered: true } : { delivered: false, reason: 'no_model_answered' }
}
