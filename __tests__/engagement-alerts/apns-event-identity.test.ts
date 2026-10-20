import { describe, expect, it } from 'vitest'
import { apnsCollapseId } from '@/lib/push-notifications/apns'
describe('APNs event identity', () => {
 it('keeps distinct plays distinct when their first 64 bytes match', () => {
  const prefix = 'x'.repeat(70)
  expect(apnsCollapseId(prefix+'play1')).not.toBe(apnsCollapseId(prefix+'play2'))
  expect(Buffer.byteLength(apnsCollapseId(prefix+'play1'))).toBeLessThanOrEqual(64)
 })
})
