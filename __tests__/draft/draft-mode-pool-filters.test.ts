import { describe, it, expect } from 'vitest'
import type { NormalizedDraftEntry } from '@/lib/draft-asset-pipeline'
import { applyDraftModePoolFilters, isFollowUpDraftMode } from '@/lib/draft-room/getResolvedDraftPoolForLeague'

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

  it('knows which drafts follow up on existing rosters', () => {
    expect(['rookie', 'Supplemental', 'dispersal'].every(isFollowUpDraftMode)).toBe(true)
    expect([null, undefined, 'standard', 'startup'].some(isFollowUpDraftMode)).toBe(false)
  })
})
