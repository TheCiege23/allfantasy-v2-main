import { describe, expect, it } from 'vitest'
import { isLeaguePredraftLifecycle } from '@/lib/league/league-predraft-lifecycle'

describe('isLeaguePredraftLifecycle', () => {
  it('matches known predraft states', () => {
    expect(isLeaguePredraftLifecycle('pre_draft')).toBe(true)
    expect(isLeaguePredraftLifecycle('draft_setup')).toBe(true)
  })

  it('rejects in-season style states', () => {
    expect(isLeaguePredraftLifecycle('in_season')).toBe(false)
    expect(isLeaguePredraftLifecycle('')).toBe(false)
  })
})
