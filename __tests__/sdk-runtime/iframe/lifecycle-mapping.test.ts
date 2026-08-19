import { describe, expect, it } from 'vitest'
import { mapLifecycleToIframeState, mapErrorToIframePayload } from '../../../sdk-runtime/iframe/src/index'
import { ALL_LIFECYCLE_STATES, buildSDKError } from '../../../lib/decision-os/sdk/index'
import type { SDKLifecycleState } from '../../../lib/decision-os/sdk/types'
import type { IframeLifecycleState } from '../../../sdk-runtime/iframe/src/index'

describe('mapLifecycleToIframeState', () => {
  const cases: Array<[SDKLifecycleState, IframeLifecycleState]> = [
    ['initializing', 'loading'],
    ['authenticating', 'loading'],
    ['loading', 'loading'],
    ['rendering', 'loading'],
    ['ready', 'ready'],
    ['refreshing', 'ready'],
    ['error', 'error'],
    ['offline', 'offline'],
    ['rate_limited', 'rate_limited'],
    ['disposed', 'disposed'],
  ]

  for (const [state, expected] of cases) {
    it(`${state} → ${expected}`, () => {
      expect(mapLifecycleToIframeState(state)).toBe(expected)
    })
  }

  it('covers every SDKLifecycleState with no gaps', () => {
    for (const state of ALL_LIFECYCLE_STATES) {
      expect(() => mapLifecycleToIframeState(state)).not.toThrow()
    }
  })

  it('is deterministic', () => {
    expect(mapLifecycleToIframeState('ready')).toBe(mapLifecycleToIframeState('ready'))
  })
})

describe('mapErrorToIframePayload', () => {
  it('extracts code/message/retryable only', () => {
    const error = buildSDKError('NETWORK', { widgetId: 'w1', timestamp: '2026-07-01T00:00:00.000Z' })
    const payload = mapErrorToIframePayload(error)
    expect(payload).toEqual({ code: 'NETWORK', message: error.message, retryable: true })
  })

  it('omits widgetId and timestamp (already carried by the message envelope)', () => {
    const error = buildSDKError('UNAUTHORIZED', { widgetId: 'w1' })
    const payload = mapErrorToIframePayload(error) as Record<string, unknown>
    expect(payload).not.toHaveProperty('widgetId')
    expect(payload).not.toHaveProperty('timestamp')
  })

  it('is deterministic', () => {
    const error = buildSDKError('RATE_LIMITED')
    expect(mapErrorToIframePayload(error)).toEqual(mapErrorToIframePayload(error))
  })
})
