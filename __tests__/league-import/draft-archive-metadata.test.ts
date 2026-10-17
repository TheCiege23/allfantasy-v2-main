import { describe, expect, it } from 'vitest'
import { sleeperDraftArchiveMetadata } from '@/lib/league-import/sleeper/draftArchiveMetadata'
const base = { sourceDraftId: 'startup', sourceLeagueId: 'historical-league', season: 2024,
  draft: { type: 'snake', status: 'complete', start_time: 1700000000000, last_picked: 1700000120000,
    settings: { teams: 12, rounds: 20 }, slot_to_roster_id: { '1': 8 } },
  league: { name: 'Historical name', scoring_settings: { rec: 1 } },
  pick: { roster_id: 3, picked_by: 'user-original', draft_slot: 1,
    metadata: { first_name: 'Original', last_name: 'Name', position: 'WR', team: 'OLD' } },
  tradedPicks: [{ round: 1, roster_id: 8, previous_owner_id: 8, owner_id: 3 }], includeDraftSnapshot: true }
describe('draft archive provenance', () => {
  it('keeps multiple drafts in a season distinct and selection ownership immutable', () => {
    const startup = sleeperDraftArchiveMetadata(base)
    const rookie = sleeperDraftArchiveMetadata({ ...base, sourceDraftId: 'rookie' })
    expect(startup.sourceDraftId).not.toBe(rookie.sourceDraftId)
    expect(startup.selectionRosterId).toBe('3')
    expect(startup.providerPickedBy).toBe('user-original')
    expect(startup.originalDraftSlot).toBe(1)
    expect(startup.playerSnapshot).toEqual({ name: 'Original Name', position: 'WR', team: 'OLD', sport: null })
  })
  it('preserves provider traded records and labels them as ownership snapshots', () => {
    const result = sleeperDraftArchiveMetadata(base)
    expect(result.archiveDraft).toMatchObject({ tradedPicks: base.tradedPicks, tradeCoverage: 'provider_ownership_snapshot' })
    expect(sleeperDraftArchiveMetadata({ ...base, tradedPicks: null }).archiveDraft).toMatchObject({ tradedPicks: null, tradeCoverage: 'unavailable' })
  })
  it('does not fabricate completion, selection or active OTC times', () => {
    const result = sleeperDraftArchiveMetadata(base)
    expect(result.timingCoverage).toBe('not_supplied_by_provider')
    expect(result.archiveDraft).toMatchObject({ startTime: '2023-11-14T22:13:20.000Z', lastPickedTime: '2023-11-14T22:15:20.000Z' })
    expect(result.archiveDraft).not.toHaveProperty('completedAt')
    expect(result).not.toHaveProperty('selectedAt')
    expect(result).not.toHaveProperty('activeOtcSeconds')
  })
  it('keeps the draft snapshot on only one pick and handles missing values', () => {
    expect(sleeperDraftArchiveMetadata({ ...base, includeDraftSnapshot: false })).not.toHaveProperty('archiveDraft')
    expect(sleeperDraftArchiveMetadata({ ...base, draft: {}, pick: {} }).archiveDraft).toMatchObject({ startTime: null, lastPickedTime: null })
  })
})
