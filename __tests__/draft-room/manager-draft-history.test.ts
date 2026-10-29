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

describe('buildManagerHistoryByRoster', async () => {
  const { buildManagerHistoryByRoster, managerIdentity, adpFromPickMetadata } = await import(
    '@/lib/draft-room/managerHistoryReads'
  )
  const { buildAdpLookup } = await import('@/lib/draft-room/draftPulse')

  const day = (n: number) => new Date(Date.UTC(2026, 0, n))
  const roster = (id: string, leagueId: string, platformUserId: string) => ({ id, leagueId, platformUserId })
  const pick = (sessionId: string, rosterId: string, overall: number, adp: number | null, name = `P${overall}`) => ({
    sessionId,
    rosterId,
    overall,
    playerId: null,
    playerName: name,
    position: 'RB',
    pickMetadata: adp == null ? { archive: {} } : { adpAtPick: adp },
  })

  it('links a manager across leagues by platform user id and maps it back to this draft’s roster', () => {
    const out = buildManagerHistoryByRoster({
      currentRosters: [roster('cur-1', 'L0', 'u-alice'), roster('cur-2', 'L0', 'u-bob')],
      identityRosters: [roster('old-a', 'L1', 'u-alice'), roster('old-b', 'L1', 'u-bob')],
      pastSessions: [{ id: 's1', leagueId: 'L1', updatedAt: day(1) }],
      picks: [pick('s1', 'old-a', 10, 16), pick('s1', 'old-a', 20, 24), pick('s1', 'old-b', 11, 8)],
      lookupByLeague: new Map(),
    })
    expect(out['cur-1']).toEqual({ averageDelta: -5, sample: 2, drafts: 1 })
    expect(out['cur-2']).toEqual({ averageDelta: 3, sample: 1, drafts: 1 })
  })

  it('falls back to the league pool when a past pick did not record its ADP, and skips it when neither exists', () => {
    const out = buildManagerHistoryByRoster({
      currentRosters: [roster('cur', 'L0', 'u')],
      identityRosters: [roster('old', 'L1', 'u'), roster('old2', 'L2', 'u')],
      pastSessions: [
        { id: 's1', leagueId: 'L1', updatedAt: day(1) },
        { id: 's2', leagueId: 'L2', updatedAt: day(2) },
      ],
      picks: [pick('s1', 'old', 10, null, 'Pooled Guy'), pick('s2', 'old2', 30, null, 'Nobody')],
      lookupByLeague: new Map([['L1', buildAdpLookup([{ name: 'Pooled Guy', position: 'RB', adp: 4 }])]]),
    })
    expect(out.cur).toEqual({ averageDelta: 6, sample: 1, drafts: 1 })
  })

  it('keeps only the newest drafts per manager', () => {
    const out = buildManagerHistoryByRoster({
      currentRosters: [roster('cur', 'L0', 'u')],
      identityRosters: [roster('old', 'L1', 'u')],
      pastSessions: [
        { id: 'old-draft', leagueId: 'L1', updatedAt: day(1) },
        { id: 'new-draft', leagueId: 'L1', updatedAt: day(9) },
      ],
      picks: [pick('old-draft', 'old', 10, 30), pick('new-draft', 'old', 10, 6)],
      lookupByLeague: new Map(),
      maxDraftsPerManager: 1,
    })
    expect(out.cur).toEqual({ averageDelta: 4, sample: 1, drafts: 1 })
  })

  it('never builds history for orphan or AI-manager rosters, whose ids are generated', () => {
    expect(managerIdentity('orphan-3')).toBeNull()
    expect(managerIdentity('ai-manager-7')).toBeNull()
    expect(managerIdentity('  ')).toBeNull()
    expect(managerIdentity('u-real')).toBe('u-real')
    const out = buildManagerHistoryByRoster({
      currentRosters: [roster('cur', 'L0', 'orphan-1')],
      identityRosters: [roster('old', 'L1', 'orphan-1')],
      pastSessions: [{ id: 's1', leagueId: 'L1', updatedAt: day(1) }],
      picks: [pick('s1', 'old', 10, 2)],
      lookupByLeague: new Map(),
    })
    expect(out.cur).toBeNull()
  })

  it('reads adpAtPick from pick metadata only when it is a positive number', () => {
    expect(adpFromPickMetadata({ adpAtPick: 12.5 })).toBe(12.5)
    expect(adpFromPickMetadata({ adpAtPick: 0 })).toBeNull()
    expect(adpFromPickMetadata({ adpAtPick: '12' })).toBeNull()
    expect(adpFromPickMetadata(null)).toBeNull()
  })
})

describe('poolEntriesFromPayload', async () => {
  const { poolEntriesFromPayload } = await import('@/lib/draft-room/adpAtPick')
  it('reads name / position / playerId / adp and drops malformed entries', () => {
    expect(
      poolEntriesFromPayload({
        entries: [{ name: 'A', position: 'QB', playerId: 'p1', adp: 3 }, { name: 'B' }, null, { name: 'C', position: 'WR', adp: 'x' }],
      }),
    ).toEqual([
      { name: 'A', position: 'QB', playerId: 'p1', adp: 3 },
      { name: 'C', position: 'WR', playerId: null, adp: null },
    ])
    expect(poolEntriesFromPayload(null)).toEqual([])
    expect(poolEntriesFromPayload({ entries: 'nope' })).toEqual([])
  })
})
