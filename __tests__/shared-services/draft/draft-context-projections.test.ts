import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * Projections reach the Decision OS card and Chimmy (2026-11-14). They come from the league's WARM
 * draft pool — the rows the draft room itself reads — with the room's rule (projectedPoints, else
 * nflDraftProjectionSplits.projectedPoints). A cold pool is never built: no projections, as before.
 */

const warm = vi.hoisted(() => vi.fn())
vi.mock('@/lib/draft-room/ensureDraftPoolReady', () => ({ getWarmDraftPoolSnapshotFast: warm }))

import { projectionKey, projectionsFromPoolEntries } from '@/lib/draft-room/poolProjections'
import { assembleEngineInputFromPicks, loadWarmPoolProjections } from '@/lib/shared-services/draft/DraftContextAssembler'
import { computeDraftPlayerRankings } from '@/lib/draft-helper/RecommendationEngine'

describe('projectionsFromPoolEntries', () => {
  it('takes projectedPoints, else the NFL splits, and skips missing or zero lines', () => {
    const map = projectionsFromPoolEntries([
      { name: 'Ja’Marr Chase', position: 'WR', projectedPoints: 310 },
      { name: 'Bijan Robinson', position: 'RB', nflDraftProjectionSplits: { projectedPoints: 295 } },
      { name: 'No Line', position: 'TE', nflDraftProjectionSplits: { projectedPoints: null } },
      { name: 'Zero', position: 'K', projectedPoints: 0 },
      { position: 'QB', projectedPoints: 300 },
    ])
    expect(map.get(projectionKey('Ja’Marr Chase', 'WR'))).toBe(310)
    expect(map.get(projectionKey(' bijan robinson ', 'rb'))).toBe(295)
    expect(map.size).toBe(2)
  })
})

describe('loadWarmPoolProjections', () => {
  beforeEach(() => warm.mockReset())

  it('reads a warm (or stale-allowed) pool and never asks for a cold build', async () => {
    warm.mockResolvedValue({ warm: true, payload: { entries: [{ name: 'A', position: 'RB', projectedPoints: 200 }] } })
    const map = await loadWarmPoolProjections('lg')
    expect(map.get(projectionKey('A', 'RB'))).toBe(200)
    expect(warm).toHaveBeenCalledWith('lg', { allowStale: true })
  })

  it('is empty when the pool is cold or the read fails', async () => {
    warm.mockResolvedValueOnce({ warm: false })
    expect((await loadWarmPoolProjections('lg')).size).toBe(0)
    warm.mockRejectedValueOnce(new Error('db down'))
    expect((await loadWarmPoolProjections('lg')).size).toBe(0)
  })
})

describe('the decision context with projections', () => {
  it('replacement value runs on the projection signal instead of having none', () => {
    const adpEntries = [
      { playerName: 'QB One', position: 'QB', team: 'AAA', adp: 20 },
      { playerName: 'QB Two', position: 'QB', team: 'BBB', adp: 40 },
      { playerName: 'QB Three', position: 'QB', team: 'CCC', adp: 60 },
      { playerName: 'QB Four', position: 'QB', team: 'DDD', adp: 80 },
    ]
    const base = {
      picksSoFar: [],
      targetRosterId: 'me',
      adpEntries,
      poolByKey: new Map(),
      rosterSlots: ['QB', 'RB', 'WR'],
      round: 2,
      pick: 1,
      totalTeams: 12,
      sport: 'NFL',
      isDynasty: false,
      isSF: false,
      mode: 'needs' as const,
    }
    const without = assembleEngineInputFromPicks(base).engineInput
    const withProj = assembleEngineInputFromPicks({
      ...base,
      projectionByKey: new Map([
        [projectionKey('QB One', 'QB'), 330],
        [projectionKey('QB Two', 'QB'), 300],
        [projectionKey('QB Three', 'QB'), 270],
        [projectionKey('QB Four', 'QB'), 250],
      ]),
    }).engineInput

    const rowsWithout = computeDraftPlayerRankings({ ...without, vorpMode: 'active' })!.scored
    const rowsWith = computeDraftPlayerRankings({ ...withProj, vorpMode: 'active' })!.scored
    expect(rowsWithout.find((r) => r.player.name === 'QB One')!.valueSignal).not.toBe('projection')
    const one = rowsWith.find((r) => r.player.name === 'QB One')!
    expect(one.valueSignal).toBe('projection')
    expect(one.vorp).not.toBeNull()
    expect(one.vorpScore).toBeGreaterThan(0)
  })
})
