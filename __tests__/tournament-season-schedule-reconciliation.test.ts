import { describe, expect, it } from 'vitest'
import { previewSeasonScheduleReconciliation } from '@/lib/tournament/seasonScheduleReconciliation'
import type { SeasonScheduleChange } from '@/lib/tournament/seasonScheduleDrift'

const change = (kind: SeasonScheduleChange['kind'], currentScheduledPeriod: number | null = 1): SeasonScheduleChange => ({ gameId: 'g1', kind, publishedStartsAt: '2026-10-21T00:00:00Z', currentScheduledAt: '2026-10-22T00:00:00Z', publishedPeriod: 1, currentScheduledPeriod, status: null, replacedBy: null })

describe('postponement reconciliation preview', () => {
  it('holds a cross-period move for actual-start, lineup-lock, and prior-receipt review', () => {
    const result = previewSeasonScheduleReconciliation(change('postponed', 2))
    expect(result).toMatchObject({ case: 'period_change', canApplyAutomatically: false, requiresActualStartEvidence: true, requiresReceiptReview: true })
    expect(result.steps.join(' ')).toMatch(/both periods.*lineup-lock/)
  })
  it('distinguishes a same-period time change from a cancellation or new identity', () => {
    expect(previewSeasonScheduleReconciliation(change('rescheduled')).case).toBe('time_change')
    expect(previewSeasonScheduleReconciliation(change('canceled')).case).toBe('cancellation')
    expect(previewSeasonScheduleReconciliation(change('replaced')).case).toBe('identity_change')
    expect(previewSeasonScheduleReconciliation(change('new_game')).case).toBe('identity_change')
    expect(previewSeasonScheduleReconciliation(change('conflict')).case).toBe('feed_conflict')
  })
})
