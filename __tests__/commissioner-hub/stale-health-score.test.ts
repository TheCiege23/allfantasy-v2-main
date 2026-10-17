import { describe, expect, it } from 'vitest'
import { resolveHubHealthScore, type HubHealthSnapshot } from '@/lib/core-app/commissioner/healthScore'

/*
 * The hub's league-health score must not judge data the hub's own staleness guard refuses to judge.
 * Measured 2026-10-01 on a Sleeper league last read 26 days earlier: the tile and the health section
 * showed "4/100 (critical). Problem: 11 inactive managers", while member activity on the same page
 * said every manager "would look idle. Re-sync it".
 */

const SNAPSHOT: HubHealthSnapshot = {
  source: 'database',
  dataConfidence: 'medium',
  healthScore: 4,
  overallStatus: 'critical',
  summary: 'League health: 4/100 (critical). No major strengths. Problem: 11 inactive managers',
  confidencePct: 80,
}

describe('resolveHubHealthScore', () => {
  it('withholds the score for a stale import, even with an otherwise usable snapshot', () => {
    const r = resolveHubHealthScore({ snapshot: SNAPSHOT, unread: false, activityStale: true, staleDays: 26 })
    expect(r.available).toBe(false)
    if (!r.available) {
      expect(r.reason).toMatch(/26 days ago/)
      expect(r.reason).toMatch(/Re-sync/)
    }
  })

  // Every case below is the hub's previous behaviour, pinned so the move cannot change it.
  it('shows a usable database snapshot for a fresh league', () => {
    const r = resolveHubHealthScore({ snapshot: SNAPSHOT, unread: false, activityStale: false, staleDays: 0 })
    expect(r).toEqual({
      available: true,
      data: { score: 4, status: 'critical', summary: SNAPSHOT.summary, confidencePct: 80 },
    })
  })

  it('does not show a low-confidence or non-database snapshot', () => {
    expect(resolveHubHealthScore({ snapshot: { ...SNAPSHOT, dataConfidence: 'low' }, unread: false, activityStale: false, staleDays: 0 }).available).toBe(false)
    expect(resolveHubHealthScore({ snapshot: { ...SNAPSHOT, source: 'computed' }, unread: false, activityStale: false, staleDays: 0 }).available).toBe(false)
  })

  it('explains an unread import and an unscoreable league differently', () => {
    const unread = resolveHubHealthScore({ snapshot: null, unread: true, activityStale: false, staleDays: 0 })
    const thin = resolveHubHealthScore({ snapshot: null, unread: false, activityStale: false, staleDays: 0 })
    expect(!unread.available && unread.reason).toMatch(/never synced/)
    expect(!thin.available && thin.reason).toMatch(/isn’t enough roster and activity data/)
  })
})
