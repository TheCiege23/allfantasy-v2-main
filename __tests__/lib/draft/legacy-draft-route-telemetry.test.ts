import { describe, expect, it } from 'vitest'
import { sessionKeyPrefixShape } from '@/lib/draft/legacy-draft-route-telemetry'

describe('legacy-draft-route-telemetry', () => {
  it('sessionKeyPrefixShape classifies session id prefixes without leaking ids', () => {
    expect(sessionKeyPrefixShape(undefined)).toBe('none')
    expect(sessionKeyPrefixShape('')).toBe('none')
    expect(sessionKeyPrefixShape('live:league-xyz')).toBe('live')
    expect(sessionKeyPrefixShape('mock:room-abc')).toBe('mock')
    expect(sessionKeyPrefixShape('not-a-prefix')).toBe('invalid')
  })
})
