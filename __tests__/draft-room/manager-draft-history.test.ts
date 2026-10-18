import { describe, expect, it } from 'vitest'

import {
  blendManagerTendency,
  summarizeManagerHistory,
  type HistoryPick,
} from '@/lib/draft-room/managerDraftHistory'
import type { ManagerTendency } from '@/lib/draft-room/draftPulse'

const hp = (sessionId: string, overall: number, adpAtPick: number): HistoryPick => ({ sessionId, overall, adpAtPick })
const NONE: ManagerTendency = { kind: 'unknown', averageDelta: null, sample: 0 }

describe('summarizeManagerHistory', () => {
  it('averages pick-minus-ADP across past drafts and counts distinct drafts', () => {
    const s = summarizeManagerHistory([hp('a', 10, 14), hp('a', 30, 36), hp('b', 5, 7)])
    expect(s).toEqual({ averageDelta: (-4 - 6 - 2) / 3, sample: 3, drafts: 2 })
  })

  it('ignores picks without ADP and deep picks past maxAdp', () => {
    const s = summarizeManagerHistory([hp('a', 10, 0), hp('a', 200, 190), hp('b', 20, 18)], { maxAdp: 150 })
    expect(s).toEqual({ averageDelta: 2, sample: 1, drafts: 1 })
  })

  it('returns null when nothing qualifies', () => {
    expect(summarizeManagerHistory([])).toBeNull()
    expect(summarizeManagerHistory([hp('a', 10, Number.NaN)])).toBeNull()
  })
})

describe('blendManagerTendency', () => {
  const reacherHistory = { averageDelta: -5, sample: 30, drafts: 3 }

  it('reads a manager from history before they have picked in this draft', () => {
    const t = blendManagerTendency(NONE, reacherHistory)
    expect(t.kind).toBe('reacher')
    expect(t.basis).toBe('history')
    expect(t.historyDrafts).toBe(3)
    expect(t.averageDelta).toBeCloseTo(-5, 5)
  })

  it('falls back to this draft alone without history', () => {
    const t = blendManagerTendency({ kind: 'value_hunter', averageDelta: 4, sample: 3 }, null)
    expect(t).toMatchObject({ kind: 'value_hunter', basis: 'draft', historyDrafts: 0 })
    expect(t.averageDelta).toBeCloseTo(4, 5)
  })

  it('weights a live pick double a past one, so this draft can overturn history', () => {
    // history: 4 picks at -5 (weight 0.5 → 2 effective); live: 4 picks at +6.
    const t = blendManagerTendency({ kind: 'value_hunter', averageDelta: 6, sample: 4 }, { averageDelta: -5, sample: 4, drafts: 1 })
    expect(t.basis).toBe('blend')
    expect(t.averageDelta).toBeCloseTo((24 - 10) / 6, 5)
    expect(t.kind).toBe('value_hunter')
  })

  it('stays unknown below the minimum combined sample', () => {
    expect(blendManagerTendency(NONE, { averageDelta: -9, sample: 1, drafts: 1 })).toMatchObject({
      kind: 'unknown',
      basis: 'none',
      averageDelta: null,
    })
  })

  it('treats a current tendency with no ADP picks as empty, not as zero', () => {
    const t = blendManagerTendency({ kind: 'unknown', averageDelta: null, sample: 1 }, reacherHistory)
    expect(t.basis).toBe('history')
    expect(t.averageDelta).toBeCloseTo(-5, 5)
  })
})
