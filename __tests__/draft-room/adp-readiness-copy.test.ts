import { describe, expect, it } from 'vitest'

import { AI_ADP_NOT_ENOUGH_DATA, formatAiAdpUnavailableBanner } from '@/lib/draft-room/adpReadinessCopy'

describe('formatAiAdpUnavailableBanner', () => {
  it('maps alarming server copy to friendly aggregate message', () => {
    expect(formatAiAdpUnavailableBanner('AI ADP unavailable')).toBe(AI_ADP_NOT_ENOUGH_DATA)
    expect(formatAiAdpUnavailableBanner('No snapshot ready')).toBe(AI_ADP_NOT_ENOUGH_DATA)
  })

  it('passes through specific non-generic messages', () => {
    expect(formatAiAdpUnavailableBanner('Segment rebuild scheduled')).toContain('Segment')
  })
})
