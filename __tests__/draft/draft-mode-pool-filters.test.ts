import { describe, it, expect } from 'vitest'
import type { NormalizedDraftEntry } from '@/lib/draft-asset-pipeline'
import {
  applyDraftModePoolFilters,
  applyDraftModePoolFiltersWithState,
  isFollowUpDraftMode,
  resolveRookieFilterState,
} from '@/lib/draft-room/getResolvedDraftPoolForLeague'
import { parseRookieFilterState } from '@/lib/draft-room/rookieFilterState'

/**
 * A rookie draft offered every player already on a dynasty roster, and "rookies only" was never
 * applied to the board — only refused pick by pick.
 */

const entry = (name: string, playerId: string, isRookie: boolean | undefined) =>
  ({ name, playerId, position: 'WR', team: 'DAL', isRookie, display: { playerId } }) as unknown as NormalizedDraftEntry

const pool = [
  entry('Rostered Vet', 'p-vet', false),
  entry('Free Vet', 'p-free', false),
  entry('Rookie One', 'p-rk1', true),
  entry('Rostered Rookie', 'p-rk2', true),
  entry('Renamed Guy', 'other-id', false),
]
const rostered = [
  { playerId: 'p-vet', playerName: 'Rostered Vet' },
  { playerId: 'p-rk2', playerName: 'Rostered Rookie' },
  // Different id space on the roster; matched by name.
  { playerId: 'sleeper-123', playerName: 'Renamed Guy' },
]
const names = (list: NormalizedDraftEntry[]) => list.map((e) => e.name)

describe('applyDraftModePoolFilters', () => {
  it('a rookie draft takes rostered players out and shows only rookies', () => {
    expect(names(applyDraftModePoolFilters(pool, { draftModeLabel: 'rookie', playerPool: 'rookies_only' }, rostered))).toEqual([
      'Rookie One',
    ])
  })

  it('a supplemental draft takes rostered players out and keeps everyone else', () => {
    expect(names(applyDraftModePoolFilters(pool, { draftModeLabel: 'supplemental', playerPool: 'all' }, rostered))).toEqual([
      'Free Vet',
      'Rookie One',
    ])
  })

  it("a startup draft never removes rostered players — it is the draft that builds the rosters", () => {
    expect(applyDraftModePoolFilters(pool, { draftModeLabel: 'standard', playerPool: 'all' }, rostered)).toHaveLength(5)
    expect(applyDraftModePoolFilters(pool, null, rostered)).toHaveLength(5)
  })

  it('veterans only drops the rookies', () => {
    expect(names(applyDraftModePoolFilters(pool, { playerPool: 'veterans_only' }, []))).toEqual([
      'Rostered Vet',
      'Free Vet',
      'Renamed Guy',
    ])
  })

  it('rookies only keeps the full pool when nothing is flagged a rookie, rather than an empty board', () => {
    const unflagged = pool.map((e) => ({ ...e, isRookie: undefined }))
    expect(applyDraftModePoolFilters(unflagged, { playerPool: 'rookies_only' }, [])).toHaveLength(5)
  })

  it('reports whether a rookies-only filter was applied, fell back, or was not requested', () => {
    const unflagged = pool.map((e) => ({ ...e, isRookie: undefined }))
    const applied = applyDraftModePoolFiltersWithState(pool, { playerPool: 'rookies_only' }, [])
    expect(applied.rookieFilterState).toBe('applied')
    expect(names(applied.entries)).toEqual(['Rookie One', 'Rostered Rookie'])

    // The fallback keeps the full board — unchanged — and says so.
    const fallback = applyDraftModePoolFiltersWithState(unflagged, { playerPool: 'ROOKIES_ONLY' }, [])
    expect(fallback.rookieFilterState).toBe('fallback_no_rookie_data')
    expect(fallback.entries).toHaveLength(5)
    // Explicit `false` flags are not rookie data either.
    expect(applyDraftModePoolFiltersWithState(pool.filter((e) => e.isRookie === false), { playerPool: 'rookies_only' }, []).rookieFilterState).toBe('fallback_no_rookie_data')

    for (const session of [{ playerPool: 'all' }, { playerPool: 'veterans_only' }, { playerPool: null }, null]) {
      expect(applyDraftModePoolFiltersWithState(unflagged, session, []).rookieFilterState).toBe('not_requested')
    }
  })

  it('judges the fallback after rostered players are removed', () => {
    // The only flagged rookie is already rostered, so the follow-up draft has no rookie data left.
    const onlyRosteredRookie = pool.map((e) => (e.name === 'Rookie One' ? { ...e, isRookie: false } : e))
    const out = applyDraftModePoolFiltersWithState(onlyRosteredRookie, { draftModeLabel: 'rookie', playerPool: 'rookies_only' }, rostered)
    expect(out.rookieFilterState).toBe('fallback_no_rookie_data')
    expect(names(out.entries)).toEqual(['Free Vet', 'Rookie One'])
  })

  it('the state helper and the pure entry list agree', () => {
    expect(resolveRookieFilterState([], { playerPool: 'rookies_only' })).toBe('fallback_no_rookie_data')
    expect(resolveRookieFilterState([{ isRookie: true }], { playerPool: 'rookies_only' })).toBe('applied')
    expect(resolveRookieFilterState([{ isRookie: true }], undefined)).toBe('not_requested')
    expect(parseRookieFilterState('fallback_no_rookie_data')).toBe('fallback_no_rookie_data')
    expect(parseRookieFilterState('something_else')).toBeUndefined()
    expect(parseRookieFilterState(undefined)).toBeUndefined()
  })

  it('knows which drafts follow up on existing rosters', () => {
    expect(['rookie', 'Supplemental', 'dispersal'].every(isFollowUpDraftMode)).toBe(true)
    expect([null, undefined, 'standard', 'startup'].some(isFollowUpDraftMode)).toBe(false)
  })
})
