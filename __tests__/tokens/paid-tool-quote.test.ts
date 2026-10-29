// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { issuePaidToolQuote, verifyPaidToolQuote } from '@/lib/tokens/paidToolQuote'
const input = { userId: 'u1', requestId: 'request-1', fingerprint: 'question-hash', ruleCode: 'ai_waiver_engine_run', tokenCost: 3 }
const deps = { secret: 'test-only-quote-signing-key', now: () => 1000000 }
describe('paid tool price authorization', () => {
 it('accepts only the exact account, request, content, rule and price', () => {
  const { tokenQuote } = issuePaidToolQuote(input, deps)
  expect(verifyPaidToolQuote(tokenQuote, input, deps)).toBe(true)
  for (const change of [{userId:'u2'}, {requestId:'request-2'}, {fingerprint:'changed'}, {ruleCode:'different'}, {tokenCost:2}, {tokenCost:4}]) expect(verifyPaidToolQuote(tokenQuote, {...input, ...change}, deps)).toBe(false)
 })
 it('rejects tampering, expiration and unreasonable expiry', () => {
  const {tokenQuote} = issuePaidToolQuote(input, deps)
  expect(verifyPaidToolQuote(tokenQuote + 'x', input, deps)).toBe(false)
  expect(verifyPaidToolQuote(tokenQuote, input, {...deps, now: () => 1600000})).toBe(false)
  expect(verifyPaidToolQuote(tokenQuote, input, {...deps, now: () => 0})).toBe(false)
 })
})
