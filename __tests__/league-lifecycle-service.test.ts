import { describe, expect, it } from 'vitest'

import {
  normalizeLifecycleState,
  parseLifecycleStateForWrite,
  validateTransition,
} from '@/server/services/leagueLifecycleService'

describe('leagueLifecycleService', () => {
  it('validateTransition rejects duplicate state', () => {
    const r = validateTransition('in_season', 'in_season')
    expect(r.ok).toBe(false)
  })

  it('validateTransition allows in_season -> playoffs', () => {
    const r = validateTransition('in_season', 'playoffs')
    expect(r.ok).toBe(true)
  })

  it('compatibility reads preserve the legacy fallback', () => {
    expect(normalizeLifecycleState('not_a_state')).toBe('in_season')
  })

  it('mutation parsing rejects unknown, blank, and non-string values', () => {
    expect(parseLifecycleStateForWrite('not_a_state')).toBeNull()
    expect(parseLifecycleStateForWrite('')).toBeNull()
    expect(parseLifecycleStateForWrite(undefined)).toBeNull()
    expect(parseLifecycleStateForWrite(123)).toBeNull()
  })

  it('mutation parsing accepts only persisted lifecycle values', () => {
    expect(parseLifecycleStateForWrite(' setup ')).toBe('setup')
    expect(parseLifecycleStateForWrite('renewal_pending')).toBe('renewal_pending')
  })
})
