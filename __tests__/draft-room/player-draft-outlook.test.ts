import { describe, expect, it } from 'vitest'

import type { LookaheadResult, LookaheadRow } from '@/lib/draft-room/draftIntelLookahead'
import { buildPlayerDraftOutlook, pickYoureUpSuggestion } from '@/lib/draft-room/playerDraftOutlook'

function row(overall: number, rosterId: string, displayName: string, needs: string[], projected: string | null, pos = 'PG'): LookaheadRow {
  return {
    overall,
    pickLabel: `3.0${overall - 32}`,
    rosterId,
    displayName,
    tendency: { kind: 'unknown', averageDelta: null, sample: 0 },
    isAuto: false,
    needs,
    projected: projected ? { name: projected, position: pos, adp: 30 } : null,
  }
}

const LOOKAHEAD: LookaheadResult = {
  startOverall: 33,
  viewerNextOverall: 40,
  windowSize: 7,
  rows: [
    row(33, 'r2', 'Steve', ['PG', 'C'], 'Ja Morant'),
    row(34, 'r3', 'Open 3', ['SF'], 'Cooper Flagg', 'SF'),
    row(35, 'r4', 'Open 4', ['PG'], 'Jamal Murray'),
    row(36, 'r2', 'Steve', ['PG', 'C'], 'Ivica Zubac', 'C'), // same manager again (turn) — counted once
  ],
}

describe('buildPlayerDraftOutlook', () => {
  it('reports survival, falling, needers and the projected taker', () => {
    const o = buildPlayerDraftOutlook({
      player: { name: 'Ja Morant', position: 'pg', adp: 31 },
      lookahead: LOOKAHEAD,
      currentOverall: 32,
      leftAtPick: { overall: 40, label: '3.08' },
    })
    expect(o.survival).not.toBeNull()
    expect(o.survival!).toBeLessThan(0.5)
    expect(o.leftAtLabel).toBe('3.08')
    expect(o.pastAdpBy).toBe(1)
    expect(o.managersBefore).toBe(3)
    expect(o.needers).toEqual(['Steve', 'Open 4'])
    expect(o.projectedBy).toEqual({ displayName: 'Steve', pickLabel: '3.01' })
  })

  it('matches the projection by name AND position, accent-insensitively', () => {
    const o = buildPlayerDraftOutlook({
      player: { name: 'Ja Morant', position: 'SG', adp: 31 },
      lookahead: LOOKAHEAD,
      currentOverall: 32,
      leftAtPick: null,
    })
    expect(o.projectedBy).toBeNull()
    const accented = buildPlayerDraftOutlook({
      player: { name: 'Ivica Zúbac', position: 'C', adp: 34 },
      lookahead: LOOKAHEAD,
      currentOverall: 32,
      leftAtPick: null,
    })
    expect(accented.projectedBy?.displayName).toBe('Steve')
  })

  it('gives no numbers it cannot back: no ADP, no next pick, no lookahead', () => {
    const o = buildPlayerDraftOutlook({
      player: { name: 'Rookie', position: 'PG', adp: null },
      lookahead: null,
      currentOverall: 32,
      leftAtPick: null,
    })
    expect(o).toEqual({
      survival: null,
      leftAtLabel: null,
      pastAdpBy: null,
      managersBefore: 0,
      needers: [],
      projectedBy: null,
    })
  })
})

describe('pickYoureUpSuggestion', () => {
  const available = [
    { name: 'B', position: 'SF', adp: 40 },
    { name: 'A', position: 'PG', adp: 33 },
    { name: 'NoAdp', position: 'C', adp: null },
  ]

  it('prefers the first queued player who is still available', () => {
    const queue = [
      { name: 'Taken', position: 'C', adp: 20 },
      { name: 'B', position: 'SF', adp: 40 },
    ]
    const s = pickYoureUpSuggestion({ queue, available, isAvailable: (p) => p.name !== 'Taken' })
    expect(s).toEqual({ player: queue[1], source: 'queue' })
  })

  it('falls back to the best market ADP, never a player without ADP', () => {
    const s = pickYoureUpSuggestion({ queue: [], available, isAvailable: () => true })
    expect(s?.player.name).toBe('A')
    expect(s?.source).toBe('best_available')
    expect(pickYoureUpSuggestion({ queue: [], available: [available[2]!], isAvailable: () => true })).toBeNull()
  })
})
