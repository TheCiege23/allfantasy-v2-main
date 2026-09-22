import { describe, expect, it } from 'vitest'

import { judgeChimmyDelivery } from '@/lib/chimmy/chargeOnDelivery'
import { CHIMMY_GENERIC_ERROR_MESSAGE } from '@/lib/chimmy-chat/response-copy'

/*
 * The shapes below are what orchestration-service actually emits: `toModelOutput` sets
 * `skipped: status !== 'ok'` with the provider's error, and the before-execution branch emits
 * `{ raw: '', error: 'Provider unavailable', skipped: true }`.
 */
const answered = { model: 'deepseek', raw: 'Start Drake London.', skipped: false }
const billingFailed = { model: 'openai', raw: '', error: '429 billing_not_active', skipped: true }
const unavailable = { model: 'grok', raw: '', error: 'Provider unavailable', skipped: true }
const FALLBACK =
  'Deterministic guidance from NFL context: week: 7. AI explanation is temporarily unavailable.'

describe('judgeChimmyDelivery', () => {
  it('charges when any model returned an answer', () => {
    expect(judgeChimmyDelivery({ modelOutputs: [billingFailed, answered], answer: 'Start Drake London.' })).toEqual({
      delivered: true,
    })
  })

  it('refunds the all-providers-failed fallback, whatever its wording', () => {
    expect(judgeChimmyDelivery({ modelOutputs: [billingFailed, unavailable], answer: FALLBACK })).toEqual({
      delivered: false,
      reason: 'no_model_answered',
    })
  })

  it('refunds when a model "succeeded" with nothing', () => {
    expect(judgeChimmyDelivery({ modelOutputs: [{ raw: '   ', skipped: false }], answer: 'x' })).toMatchObject({
      delivered: false,
    })
  })

  it('refunds an empty reply or the generic error message', () => {
    expect(judgeChimmyDelivery({ modelOutputs: [answered], answer: '  ' })).toEqual({
      delivered: false,
      reason: 'empty_answer',
    })
    expect(judgeChimmyDelivery({ modelOutputs: [answered], answer: CHIMMY_GENERIC_ERROR_MESSAGE })).toEqual({
      delivered: false,
      reason: 'empty_answer',
    })
  })

  /* Refunding every answer because a field went missing would silently zero revenue. */
  it('keeps the charge when model outputs are absent rather than guessing', () => {
    expect(judgeChimmyDelivery({ modelOutputs: undefined, answer: 'Start Drake London.' })).toEqual({ delivered: true })
  })
})
