import { describe, it, expect } from 'vitest'
import {
  foldOptimizerIntoApplyLineupPayload,
  type OptimizerResultLike,
} from '@/lib/lineup-optimizer/foldOptimizerIntoApplyLineupPayload'

const persisted = {
  lineup_sections: {
    starters: [
      { id: 'qb1', name: 'Allen', team: 'BUF', position: 'QB', projection: 24, status: 'healthy' },
      { id: 'rb1', name: 'Bijan', team: 'ATL', position: 'RB', projection: 18, status: 'healthy' },
      { id: 'wr1', name: 'StBrown', team: 'DET', position: 'WR', projection: 17, status: 'healthy' },
    ],
    bench: [
      { id: 'rb2', name: 'Saquon', team: 'PHI', position: 'RB', projection: 16, status: 'questionable' },
      { id: 'wr2', name: 'Evans', team: 'TB', position: 'WR', projection: 14, status: 'healthy' },
    ],
    ir: [{ id: 'ir1', name: 'IR Guy', team: 'NYJ', position: 'WR', projection: 0, status: 'ir' }],
    taxi: [{ id: 'tx1', name: 'Taxi Guy', team: 'CHI', position: 'RB', projection: 0, status: 'healthy' }],
    devy: [{ id: 'dv1', name: 'Devy Guy', team: 'COL', position: 'WR', projection: 0, status: 'healthy' }],
  },
}

function opt(starters: Array<[string, string, string]>): OptimizerResultLike {
  return {
    starters: starters.map(([slotCode, playerId, playerName], i) => ({
      slotId: `${slotCode}-${i}`,
      slotCode,
      slotLabel: slotCode,
      playerId,
      playerName,
      projectedPoints: 10,
      selectedPosition: slotCode,
    })),
    unfilledSlots: [],
  }
}

describe('foldOptimizerIntoApplyLineupPayload', () => {
  it('returns safe payload when optimizer mirrors current starters', () => {
    const result = foldOptimizerIntoApplyLineupPayload({
      currentPersistedRoster: persisted,
      optimizerResult: opt([
        ['QB', 'qb1', 'Allen'],
        ['RB1', 'rb1', 'Bijan'],
        ['WR1', 'wr1', 'StBrown'],
      ]),
    })
    expect(result.safeToApply).toBe(true)
    expect(result.blockingReasons).toEqual([])
    expect(result.payload?.roster.starters.map((p) => p.id)).toEqual(['qb1', 'rb1', 'wr1'])
    expect(result.payload?.roster.bench.map((p) => p.id).sort()).toEqual(['rb2', 'wr2'])
    expect(result.payload?.roster.ir.map((p) => p.id)).toEqual(['ir1'])
    expect(result.payload?.roster.taxi.map((p) => p.id)).toEqual(['tx1'])
    expect(result.payload?.roster.devy.map((p) => p.id)).toEqual(['dv1'])
    expect(result.diff.unchangedStarters).toHaveLength(3)
    expect(result.diff.movedToStarters).toHaveLength(0)
  })

  it('moves bench player into starters and benches replaced starter', () => {
    const result = foldOptimizerIntoApplyLineupPayload({
      currentPersistedRoster: persisted,
      optimizerResult: opt([
        ['QB', 'qb1', 'Allen'],
        ['RB1', 'rb2', 'Saquon'], // promoted from bench
        ['WR1', 'wr1', 'StBrown'],
      ]),
    })
    expect(result.safeToApply).toBe(true)
    expect(result.payload?.roster.starters.map((p) => p.id)).toEqual(['qb1', 'rb2', 'wr1'])
    expect(result.payload?.roster.bench.map((p) => p.id).sort()).toEqual(['rb1', 'wr2'])
    expect(result.diff.movedToStarters.find((m) => m.id === 'rb2')?.fromSection).toBe('bench')
    expect(result.diff.movedToBench.find((m) => m.id === 'rb1')?.fromSection).toBe('starters')
  })

  it('preserves IR / TAXI / DEVY untouched even if optimizer ignores them', () => {
    const result = foldOptimizerIntoApplyLineupPayload({
      currentPersistedRoster: persisted,
      optimizerResult: opt([
        ['QB', 'qb1', 'Allen'],
        ['RB1', 'rb1', 'Bijan'],
        ['WR1', 'wr1', 'StBrown'],
      ]),
    })
    expect(result.payload?.roster.ir.map((p) => p.id)).toEqual(['ir1'])
    expect(result.payload?.roster.taxi.map((p) => p.id)).toEqual(['tx1'])
    expect(result.payload?.roster.devy.map((p) => p.id)).toEqual(['dv1'])
    expect(result.diff.preserved).toEqual({ ir: ['ir1'], taxi: ['tx1'], devy: ['dv1'] })
  })

  it('rejects when optimizer recommends a player not on the roster', () => {
    const result = foldOptimizerIntoApplyLineupPayload({
      currentPersistedRoster: persisted,
      optimizerResult: opt([
        ['QB', 'qb1', 'Allen'],
        ['RB1', 'ghost', 'Ghost Player'],
        ['WR1', 'wr1', 'StBrown'],
      ]),
    })
    expect(result.safeToApply).toBe(false)
    expect(result.blockingReasons).toContain('starter_not_on_roster')
    expect(result.payload).toBeNull()
    expect(result.diff.missingFromRoster).toHaveLength(1)
    expect(result.diff.missingFromRoster[0]?.id).toBe('ghost')
  })

  it('rejects locked-player section change (locked starter benched)', () => {
    const result = foldOptimizerIntoApplyLineupPayload({
      currentPersistedRoster: persisted,
      lockedPlayerIds: ['qb1'],
      optimizerResult: opt([
        ['QB', 'rb1', 'Bijan'], // shoves locked QB to bench
        ['RB1', 'rb2', 'Saquon'],
        ['WR1', 'wr1', 'StBrown'],
      ]),
    })
    expect(result.safeToApply).toBe(false)
    expect(result.blockingReasons).toContain('locked_player_section_change')
    expect(result.diff.blockedLockedPlayers.find((b) => b.id === 'qb1')).toBeDefined()
  })

  it('rejects locked-player section change (locked bench promoted)', () => {
    const result = foldOptimizerIntoApplyLineupPayload({
      currentPersistedRoster: persisted,
      lockedPlayerIds: ['rb2'],
      optimizerResult: opt([
        ['QB', 'qb1', 'Allen'],
        ['RB1', 'rb2', 'Saquon'],
        ['WR1', 'wr1', 'StBrown'],
      ]),
    })
    expect(result.safeToApply).toBe(false)
    expect(result.blockingReasons).toContain('locked_player_section_change')
  })

  it('rejects empty optimizer result and missing input', () => {
    const noResult = foldOptimizerIntoApplyLineupPayload({
      currentPersistedRoster: persisted,
      optimizerResult: null,
    })
    expect(noResult.safeToApply).toBe(false)
    expect(noResult.blockingReasons).toEqual(['no_optimizer_result'])

    const empty = foldOptimizerIntoApplyLineupPayload({
      currentPersistedRoster: persisted,
      optimizerResult: { starters: [] },
    })
    expect(empty.safeToApply).toBe(false)
    expect(empty.blockingReasons).toContain('empty_starters')

    const noRoster = foldOptimizerIntoApplyLineupPayload({
      currentPersistedRoster: null,
      optimizerResult: opt([['QB', 'qb1', 'Allen']]),
    })
    expect(noRoster.safeToApply).toBe(false)
    expect(noRoster.blockingReasons).toEqual(['no_persisted_roster'])
  })

  it('flags unfilled slots as blocking', () => {
    const result = foldOptimizerIntoApplyLineupPayload({
      currentPersistedRoster: persisted,
      optimizerResult: {
        ...opt([
          ['QB', 'qb1', 'Allen'],
          ['RB1', 'rb1', 'Bijan'],
          ['WR1', 'wr1', 'StBrown'],
        ]),
        unfilledSlots: [{ slotId: 'flex-0', slotCode: 'FLEX', slotLabel: 'FLEX' }],
      },
    })
    expect(result.safeToApply).toBe(false)
    expect(result.blockingReasons).toContain('unfilled_slots')
  })

  it('rejects duplicate optimizer recommendations', () => {
    const result = foldOptimizerIntoApplyLineupPayload({
      currentPersistedRoster: persisted,
      optimizerResult: opt([
        ['QB', 'qb1', 'Allen'],
        ['RB1', 'rb1', 'Bijan'],
        ['RB2', 'rb1', 'Bijan'], // duplicate
      ]),
    })
    expect(result.safeToApply).toBe(false)
    expect(result.blockingReasons).toContain('duplicate_player')
  })

  it('supports legacy persisted shape (players[] + starters/reserve/taxi/devy id arrays)', () => {
    const legacy = {
      players: [
        { id: 'qb1', name: 'Allen', team: 'BUF', position: 'QB' },
        { id: 'rb1', name: 'Bijan', team: 'ATL', position: 'RB' },
        { id: 'wr1', name: 'StBrown', team: 'DET', position: 'WR' },
        { id: 'rb2', name: 'Saquon', team: 'PHI', position: 'RB' },
        { id: 'ir1', name: 'IR Guy', team: 'NYJ', position: 'WR' },
      ],
      starters: ['qb1', 'rb1', 'wr1'],
      reserve: ['ir1'],
      taxi: [],
      devy: [],
    }
    const result = foldOptimizerIntoApplyLineupPayload({
      currentPersistedRoster: legacy,
      optimizerResult: opt([
        ['QB', 'qb1', 'Allen'],
        ['RB1', 'rb2', 'Saquon'],
        ['WR1', 'wr1', 'StBrown'],
      ]),
    })
    expect(result.safeToApply).toBe(true)
    expect(result.payload?.roster.starters.map((p) => p.id)).toEqual(['qb1', 'rb2', 'wr1'])
    expect(result.payload?.roster.bench.map((p) => p.id).sort()).toEqual(['rb1'])
    expect(result.payload?.roster.ir.map((p) => p.id)).toEqual(['ir1'])
  })

  it('emits week in payload only when valid', () => {
    const r1 = foldOptimizerIntoApplyLineupPayload({
      currentPersistedRoster: persisted,
      optimizerResult: opt([
        ['QB', 'qb1', 'Allen'],
        ['RB1', 'rb1', 'Bijan'],
        ['WR1', 'wr1', 'StBrown'],
      ]),
      week: 7,
    })
    expect(r1.payload?.week).toBe(7)

    const r2 = foldOptimizerIntoApplyLineupPayload({
      currentPersistedRoster: persisted,
      optimizerResult: opt([
        ['QB', 'qb1', 'Allen'],
        ['RB1', 'rb1', 'Bijan'],
        ['WR1', 'wr1', 'StBrown'],
      ]),
      week: 0,
    })
    expect(r2.payload && 'week' in r2.payload).toBe(false)
  })
})
