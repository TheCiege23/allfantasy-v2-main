import { describe, expect, it } from 'vitest'
import { withTimeout } from '../lib/async-utils'

/**
 * Added alongside the draft-pool-prewarm fix: one hung league used to block an entire cron batch
 * until the platform killed the whole request at maxDuration. withTimeout is the primitive that
 * stops any one caller from doing that to a shared batch again.
 */
describe('withTimeout', () => {
  it('resolves with the real value when work finishes before the timeout', async () => {
    const outcome = await withTimeout(Promise.resolve('done'), 50)
    expect(outcome).toEqual({ ok: true, value: 'done' })
  })

  it('resolves with a timeout marker, not a rejection, when work never settles in time', async () => {
    const neverSettles = new Promise(() => {})
    const outcome = await withTimeout(neverSettles, 20)
    expect(outcome).toEqual({ ok: false, timedOut: true })
  })

  it('does not swallow a genuine rejection from work that finishes before the timeout', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 50)).rejects.toThrow('boom')
  })
})
