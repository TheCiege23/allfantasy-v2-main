/**
 * Fantasy OS Suite — Phase D Increment 7.
 *
 * Pure unit tests for the Sleeper activity-ingestion orchestration script's helpers — the clean
 * testable seam this increment's own instruction asks for ("add unit tests around parsing, safety
 * guards, and orchestration helpers"), mirroring
 * `scripts/decision-os-suite-conformance-helpers.ts`'s own established test pattern.
 */
import { describe, it, expect, vi } from 'vitest'
import {
  buildWeekRange,
  mapSleeperTransactionToRaw,
  mapSleeperDraftPickResponseItem,
  resolveDraftOccurredAt,
  getDraftId,
  buildSleeperManagerMapping,
  collectRosterOwnerIds,
  shouldWarnPossibleSilentFetchFailure,
} from '@/scripts/decision-os-ingest-sleeper-activity-helpers'
import type { SleeperTransaction } from '@/lib/sleeper-client'

describe('buildWeekRange', () => {
  it('generates 1..N for a normal week count', () => {
    expect(buildWeekRange(3)).toEqual([1, 2, 3])
  })

  it('clamps to a minimum of 1 week', () => {
    expect(buildWeekRange(0)).toEqual([1])
    expect(buildWeekRange(-5)).toEqual([1])
  })

  it('clamps to a maximum of 18 weeks — a fixed, honest NFL-season upper bound, not a guess', () => {
    expect(buildWeekRange(30)).toHaveLength(18)
    expect(buildWeekRange(30)[17]).toBe(18)
  })
})

describe('mapSleeperTransactionToRaw', () => {
  function makeTransaction(o: Partial<SleeperTransaction> = {}): SleeperTransaction {
    return {
      type: 'trade', transaction_id: 'txn-1', status: 'complete', roster_ids: [1, 2],
      adds: { 'player-a': 1 }, drops: { 'player-b': 2 },
      draft_picks: [], waiver_budget: [], leg: 1, created: 1720000000000,
      ...o,
    }
  }

  it('maps every real field through unchanged', () => {
    const raw = mapSleeperTransactionToRaw(makeTransaction())
    expect(raw.transaction_id).toBe('txn-1')
    expect(raw.type).toBe('trade')
    expect(raw.status).toBe('complete')
    expect(raw.created).toBe(1720000000000)
    expect(raw.roster_ids).toEqual([1, 2])
  })

  it('remaps adds/drops values to strings, preserving keys, without inventing data', () => {
    const raw = mapSleeperTransactionToRaw(makeTransaction({ adds: { 'player-a': 7 }, drops: null }))
    expect(raw.adds).toEqual({ 'player-a': '7' })
    expect(raw.drops).toBeUndefined()
  })
})

describe('mapSleeperDraftPickResponseItem', () => {
  it('maps a well-formed real pick response item', () => {
    const pick = mapSleeperDraftPickResponseItem(
      { round: 2, roster_id: 3, player_id: 'player-x', pick_no: 14, picked_by: 'sleeper-user-1' },
      'draft-2026',
      '2026',
    )
    expect(pick).toEqual({
      round: 2, roster_id: 3, player_id: 'player-x', picked_by: 'sleeper-user-1',
      pick_no: 14, season: '2026', draft_id: 'draft-2026',
    })
  })

  it('returns null (never a fabricated pick) when required fields are missing or malformed', () => {
    expect(mapSleeperDraftPickResponseItem({ round: 2 }, 'draft-2026', '2026')).toBeNull()
    expect(mapSleeperDraftPickResponseItem(null, 'draft-2026', '2026')).toBeNull()
    expect(mapSleeperDraftPickResponseItem('not an object', 'draft-2026', '2026')).toBeNull()
  })

  it('omits picked_by honestly when absent, rather than inventing a manager', () => {
    const pick = mapSleeperDraftPickResponseItem(
      { round: 1, roster_id: 1, player_id: 'player-y', pick_no: 1 },
      'draft-2026',
      '2026',
    )
    expect(pick?.picked_by).toBeUndefined()
  })
})

describe('resolveDraftOccurredAt', () => {
  it('extracts a real start_time as an ISO string', () => {
    expect(resolveDraftOccurredAt({ start_time: 1720000000000 })).toBe(new Date(1720000000000).toISOString())
  })

  it('returns null (never invented) when start_time is absent or invalid', () => {
    expect(resolveDraftOccurredAt({})).toBeNull()
    expect(resolveDraftOccurredAt({ start_time: 'not a number' })).toBeNull()
    expect(resolveDraftOccurredAt({ start_time: -1 })).toBeNull()
    expect(resolveDraftOccurredAt(null)).toBeNull()
  })
})

describe('getDraftId', () => {
  it('extracts a real draft_id string', () => {
    expect(getDraftId({ draft_id: 'draft-2026' })).toBe('draft-2026')
  })

  it('returns null when absent or malformed', () => {
    expect(getDraftId({})).toBeNull()
    expect(getDraftId({ draft_id: 123 })).toBeNull()
  })
})

describe('buildSleeperManagerMapping', () => {
  it('resolves a real af_id when the injected lookup finds a linked AllFantasy account', async () => {
    const resolveAfUserId = vi.fn().mockResolvedValue('af-user-1')
    const mapping = await buildSleeperManagerMapping('sleeper-user-1', resolveAfUserId)
    expect(mapping).toEqual({
      source_provider: 'sleeper',
      source_id: 'sleeper-user-1',
      entity_type: 'manager',
      af_id: 'af-user-1',
      stable_key: 'sleeper:sleeper-user-1',
    })
    expect(resolveAfUserId).toHaveBeenCalledWith('sleeper-user-1')
  })

  it('falls back to an honest stable_key-only mapping when no AF account is linked', async () => {
    const resolveAfUserId = vi.fn().mockResolvedValue(null)
    const mapping = await buildSleeperManagerMapping('sleeper-user-2', resolveAfUserId)
    expect(mapping.af_id).toBeNull()
    expect(mapping.stable_key).toBe('sleeper:sleeper-user-2')
  })
})

describe('shouldWarnPossibleSilentFetchFailure', () => {
  it('warns when rosters resolved but both transactions and draft picks came back empty', () => {
    expect(shouldWarnPossibleSilentFetchFailure(10, 0, 0)).toBe(true)
  })

  it('does not warn when there is real transaction or draft-pick activity', () => {
    expect(shouldWarnPossibleSilentFetchFailure(10, 5, 0)).toBe(false)
    expect(shouldWarnPossibleSilentFetchFailure(10, 0, 3)).toBe(false)
  })

  it('does not warn when there are no rosters at all — a different, already-refused case', () => {
    expect(shouldWarnPossibleSilentFetchFailure(0, 0, 0)).toBe(false)
  })
})

describe('collectRosterOwnerIds', () => {
  it('de-duplicates and preserves order', () => {
    expect(
      collectRosterOwnerIds([{ owner_id: 'a' }, { owner_id: 'b' }, { owner_id: 'a' }]),
    ).toEqual(['a', 'b'])
  })

  it('skips orphan rosters (no owner) honestly, never fabricating an owner', () => {
    expect(collectRosterOwnerIds([{ owner_id: null }, { owner_id: 'a' }, {}])).toEqual(['a'])
  })
})
