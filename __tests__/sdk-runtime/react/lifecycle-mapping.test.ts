import { describe, expect, it } from 'vitest'
import { mapLifecycleToRenderState } from '../../../sdk-runtime/react/src/lifecycleMapping'
import { ALL_LIFECYCLE_STATES } from '../../../lib/decision-os/sdk/index'
import type { SDKLifecycleState } from '../../../lib/decision-os/sdk/types'
import type { WidgetRenderState } from '../../../sdk-runtime/react/src/types'

describe('mapLifecycleToRenderState', () => {
  const cases: Array<[SDKLifecycleState, WidgetRenderState]> = [
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
      expect(mapLifecycleToRenderState(state)).toBe(expected)
    })
  }

  it('covers every SDKLifecycleState with no gaps', () => {
    for (const state of ALL_LIFECYCLE_STATES) {
      expect(() => mapLifecycleToRenderState(state)).not.toThrow()
      expect(mapLifecycleToRenderState(state)).toBeDefined()
    }
  })

  it('is deterministic', () => {
    expect(mapLifecycleToRenderState('ready')).toBe(mapLifecycleToRenderState('ready'))
  })
})
