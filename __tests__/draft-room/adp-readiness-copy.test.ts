import { describe, expect, it } from 'vitest'

import { AI_ADP_NOT_ENOUGH_DATA, formatAiAdpUnavailableBanner } from '@/lib/draft-room/adpReadinessCopy'
import { resolvePlayerPoolAdpColumns } from '@/lib/draft-room/playerPoolAdpColumns'

describe('resolvePlayerPoolAdpColumns — separation', () => {
  it('keeps system ADP and AI ADP distinct', () => {
    const cols = resolvePlayerPoolAdpColumns({ adp: 12.4, aiAdp: 18.2, aiAdpSampleSize: 4 })
    expect(cols.systemAdp).toBe(12.4)
    expect(cols.aiAdp).toBe(18.2)
    expect(cols.labels.system).toBe('ADP')
    expect(cols.labels.ai).toBe('AI ADP')
  })

  it('does not mix values when one side missing', () => {
    const cols = resolvePlayerPoolAdpColumns({ adp: 5, aiAdp: null })
    expect(cols.systemAdp).toBe(5)
    expect(cols.aiAdp).toBeNull()
  })
})

describe('formatAiAdpUnavailableBanner', () => {
  it('maps alarming server copy to friendly aggregate message', () => {
    expect(formatAiAdpUnavailableBanner('AI ADP unavailable')).toBe(AI_ADP_NOT_ENOUGH_DATA)
    expect(formatAiAdpUnavailableBanner('No snapshot ready')).toBe(AI_ADP_NOT_ENOUGH_DATA)
  })

  it('passes through specific non-generic messages', () => {
    expect(formatAiAdpUnavailableBanner('Segment rebuild scheduled')).toContain('Segment')
  })
})
