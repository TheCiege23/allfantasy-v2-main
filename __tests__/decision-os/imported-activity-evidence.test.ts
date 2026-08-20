import { describe, it, expect, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { loadImportedActivityEvidence } from '@/lib/decision-os/three-brain/phase2/importedActivityEvidence'

/**
 * Imported leagues emit almost no native `DomainEvent`s, so they never produce an
 * `intelligence_league_snapshot` and could never reach the evidence stage. Measured on production
 * 2026-08-20: 4 of 98 leagues resolved evidence. Their behaviour existed the whole time — 6,436
 * rows across 42 leagues — one join away.
 */
const row = (activityType: string, occurredAt: string, managerKeys: string[] = ['m1']) => ({
  activityType,
  occurredAt: new Date(occurredAt),
  normalized: { managerKeys },
})

function dbWith(rows: unknown[] | null) {
  if (rows === null) return {} as never // delegate absent
  return { decisionOsImportedActivity: { findMany: async () => rows } } as never
}

describe('imported activity evidence', () => {
  it('returns null when the league has no imported activity', async () => {
    expect(await loadImportedActivityEvidence(dbWith([]), 'L1')).toBeNull()
  })

  it('returns null when the Prisma delegate is absent, rather than throwing', async () => {
    // Same honest-refusal precedent as the activity-ingest cron: without the generated delegate we
    // cannot read imported activity at all, and the caller must refuse rather than fabricate.
    expect(await loadImportedActivityEvidence(dbWith(null), 'L1')).toBeNull()
  })

  it('counts each activity type into its OWN bucket', async () => {
    const e = await loadImportedActivityEvidence(dbWith([
      row('trade', '2026-08-01'), row('trade', '2026-08-02'),
      row('waiver', '2026-08-03'),
      row('roster_move', '2026-08-04'), row('roster_move', '2026-08-05'), row('roster_move', '2026-08-06'),
      row('draft_pick', '2026-08-07'),
    ]), 'L1')
    expect(e).not.toBeNull()
    expect(e!.total).toBe(7)
    expect(e!.trades).toBe(2)
    expect(e!.waivers).toBe(1)
    expect(e!.rosterMoves).toBe(3)
    expect(e!.draftPicks).toBe(1)
  })

  it('does NOT fold roster moves into any other bucket', async () => {
    // A provider roster_move is an add/drop, not a starting-lineup change. Mapping it onto the
    // native snapshot's `lineupCount` would overstate lineup engagement to a model that cannot
    // tell the difference — the same class of fabrication as counting a heartbeat as a waiver.
    const e = await loadImportedActivityEvidence(dbWith([row('roster_move', '2026-08-01')]), 'L1')
    expect(e!.rosterMoves).toBe(1)
    expect(e!.waivers).toBe(0)
    expect(e!.trades).toBe(0)
    expect(e!.draftPicks).toBe(0)
  })

  it('counts unrecognised activity types rather than silently dropping them', async () => {
    const e = await loadImportedActivityEvidence(dbWith([row('something_new', '2026-08-01')]), 'L1')
    expect(e!.other).toBe(1)
    expect(e!.total).toBe(1)
  })

  it('counts DISTINCT managers from normalized.managerKeys', async () => {
    const e = await loadImportedActivityEvidence(dbWith([
      row('trade', '2026-08-01', ['a', 'b']),
      row('waiver', '2026-08-02', ['a']),
      row('waiver', '2026-08-03', ['sleeper:123']),
    ]), 'L1')
    expect(e!.managerCount).toBe(3)
  })

  it('tolerates malformed or missing managerKeys without throwing', async () => {
    const e = await loadImportedActivityEvidence(dbWith([
      { activityType: 'trade', occurredAt: new Date('2026-08-01'), normalized: null },
      { activityType: 'waiver', occurredAt: new Date('2026-08-02'), normalized: { managerKeys: 'nope' } },
      { activityType: 'waiver', occurredAt: new Date('2026-08-03'), normalized: { managerKeys: [1, '', 'ok'] } },
    ]), 'L1')
    expect(e!.total).toBe(3)
    expect(e!.managerCount).toBe(1)
  })
})

describe('imported activity evidence — version identity', () => {
  const rows = [row('trade', '2026-08-01'), row('waiver', '2026-08-02')]

  it('is stable when the content is unchanged', async () => {
    // Identity drives cache reuse. If an unchanged re-ingest produced a new version, every cached
    // analysis would be invalidated and re-paid for evidence that never moved.
    const a = await loadImportedActivityEvidence(dbWith(rows), 'L1')
    const b = await loadImportedActivityEvidence(dbWith(rows), 'L1')
    expect(a!.version).toBe(b!.version)
  })

  it('changes when a new row arrives', async () => {
    const a = await loadImportedActivityEvidence(dbWith(rows), 'L1')
    const b = await loadImportedActivityEvidence(dbWith([...rows, row('trade', '2026-08-09')]), 'L1')
    expect(a!.version).not.toBe(b!.version)
  })

  it('changes when the MIX changes even at the same total', async () => {
    const a = await loadImportedActivityEvidence(dbWith([row('trade', '2026-08-01'), row('waiver', '2026-08-02')]), 'L1')
    const b = await loadImportedActivityEvidence(dbWith([row('trade', '2026-08-01'), row('trade', '2026-08-02')]), 'L1')
    expect(a!.version).not.toBe(b!.version)
  })

  it('tracks the LATEST activity timestamp regardless of row order', async () => {
    const e = await loadImportedActivityEvidence(dbWith([
      row('trade', '2026-08-09'), row('waiver', '2026-08-01'), row('waiver', '2026-08-05'),
    ]), 'L1')
    expect(e!.lastActivityAt?.toISOString()).toBe(new Date('2026-08-09').toISOString())
  })

  it('is namespaced so it can never collide with a native source version', async () => {
    const e = await loadImportedActivityEvidence(dbWith(rows), 'L1')
    expect(e!.version.startsWith('imported-v1:')).toBe(true)
  })
})
