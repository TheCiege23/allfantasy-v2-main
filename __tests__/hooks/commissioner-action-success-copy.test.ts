import { describe, expect, it } from 'vitest'

import { commissionerActionSuccessCopy } from '@/hooks/useCommissionerActions'

describe('commissionerActionSuccessCopy — Phase 5H commissioner UX strings', () => {
  it('covers pause / resume / timer / undo / autopick', () => {
    expect(commissionerActionSuccessCopy('pause')).toContain('paused')
    expect(commissionerActionSuccessCopy('resume')).toContain('resumed')
    expect(commissionerActionSuccessCopy('reset_timer')).toContain('timer reset')
    expect(commissionerActionSuccessCopy('undo_pick')).toContain('removed')
    expect(commissionerActionSuccessCopy('force_autopick')).toContain('Auto-pick')
  })

  it('has a generic fallback for unknown actions', () => {
    expect(commissionerActionSuccessCopy('custom_action')).toBe('Commissioner action completed.')
  })
})
