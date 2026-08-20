import { describe, it, expect } from 'vitest'
import {
  tallyManagersFromImportedActivity,
  isExternalManagerKey,
} from '@/lib/intelligence/projections/importedManagerProjection'

/**
 * Production 2026-08-20: exactly ONE `intelligence_manager_snapshot` row existed, because 24 of the
 * 26 user-attributed events were registrations carrying no `leagueId`. Chimmy grounding and the
 * StoryEngine read that table — so they were grounded on a single manager.
 */
const row = (
  leagueId: string | null,
  activityType: string,
  occurredAt: string,
  managerKeys: unknown = ['m1'],
) => ({ afLeagueId: leagueId, activityType, occurredAt: new Date(occurredAt), normalized: { managerKeys } })

describe('imported manager tally', () => {
  it('produces one row per (league, manager)', () => {
    const t = tallyManagersFromImportedActivity([
      row('L1', 'trade', '2026-08-01', ['a', 'b']),
      row('L1', 'waiver', '2026-08-02', ['a']),
      row('L2', 'waiver', '2026-08-03', ['a']),
    ])
    expect(t).toHaveLength(3)
    expect(t.find((x) => x.leagueId === 'L1' && x.managerKey === 'a')!.totalActions).toBe(2)
    expect(t.find((x) => x.leagueId === 'L1' && x.managerKey === 'b')!.totalActions).toBe(1)
    // The same manager in a DIFFERENT league is a different row — the table is keyed that way.
    expect(t.find((x) => x.leagueId === 'L2' && x.managerKey === 'a')!.totalActions).toBe(1)
  })

  it('attributes EVERY manager on a multi-party trade, not just the initiator', () => {
    const t = tallyManagersFromImportedActivity([row('L1', 'trade', '2026-08-01', ['a', 'b', 'c'])])
    expect(t.map((x) => x.managerKey).sort()).toEqual(['a', 'b', 'c'])
    for (const x of t) expect(x.tradeActions).toBe(1)
  })

  it('maps activity types to the columns native events use', () => {
    const t = tallyManagersFromImportedActivity([
      row('L1', 'trade', '2026-08-01'),
      row('L1', 'waiver', '2026-08-02'),
      row('L1', 'roster_move', '2026-08-03'),
      row('L1', 'draft_pick', '2026-08-04'),
    ])[0]
    expect(t.tradeActions).toBe(1)
    expect(t.waiverActions).toBe(1)
    expect(t.lineupActions).toBe(1)   // roster_move — same mapping native roster events get
    expect(t.otherActions).toBe(1)    // draft_pick — no dedicated column exists
    expect(t.totalActions).toBe(4)
  })

  it('drops rows with no league, rather than inventing one', () => {
    // An unlinked row cannot be attributed. Guessing a league would put a real manager's activity
    // in the wrong place, which is worse than omitting it.
    expect(tallyManagersFromImportedActivity([row(null, 'trade', '2026-08-01')])).toHaveLength(0)
  })

  it('drops rows with no usable manager keys', () => {
    expect(tallyManagersFromImportedActivity([
      row('L1', 'trade', '2026-08-01', []),
      row('L1', 'trade', '2026-08-02', 'not-an-array'),
      row('L1', 'trade', '2026-08-03', [1, '', null]),
    ])).toHaveLength(0)
  })

  it('tracks the latest activity regardless of row order', () => {
    const t = tallyManagersFromImportedActivity([
      row('L1', 'waiver', '2026-08-09'),
      row('L1', 'waiver', '2026-08-01'),
      row('L1', 'waiver', '2026-08-05'),
    ])[0]
    expect(t.lastActiveAt?.toISOString()).toBe(new Date('2026-08-09').toISOString())
  })

  it('is a pure fold — the same input yields the same tally', () => {
    // The projection upserts ABSOLUTE values computed from this fold, which is what makes a re-run
    // idempotent instead of inflating counts the way the waiver heartbeat inflated waiverCount.
    const rows = [row('L1', 'trade', '2026-08-01'), row('L1', 'waiver', '2026-08-02')]
    expect(tallyManagersFromImportedActivity(rows)).toEqual(tallyManagersFromImportedActivity(rows))
  })
})

describe('external manager keys', () => {
  it('recognises provider ids as external', () => {
    expect(isExternalManagerKey('sleeper:519351975870943232')).toBe(true)
  })

  it('treats an AllFantasy uuid as internal', () => {
    expect(isExternalManagerKey('9791bae0-e47f-418a-ae40-285f6a2e7887')).toBe(false)
  })
})
