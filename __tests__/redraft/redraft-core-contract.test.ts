import { describe, expect, it } from 'vitest'
import {
  buildRedraftContractRepairPlan,
  buildRedraftDraftSlotOrder,
} from '@/lib/redraft-core-contract'
import { buildOrderedRosterSlots, assignPicksToSlots } from '@/lib/draft-room/rosterSlotOrder'
import { validateRedraftLineup } from '@/lib/redraft/lineupValidation'

describe('redraft core contract hardening', () => {
  it('builds a complete draft shell with human slot first and placeholders after', () => {
    const slotOrder = buildRedraftDraftSlotOrder({
      teamCount: 4,
      rosters: [{ id: 'commissioner-roster' }],
      teams: [{ ownerName: 'Commissioner' }],
    })

    expect(slotOrder).toEqual([
      { slot: 1, rosterId: 'commissioner-roster', displayName: 'Commissioner' },
      { slot: 2, rosterId: 'placeholder-2', displayName: 'Team 2' },
      { slot: 3, rosterId: 'placeholder-3', displayName: 'Team 3' },
      { slot: 4, rosterId: 'placeholder-4', displayName: 'Team 4' },
    ])
  })

  it('repairs an incomplete legacy NFL redraft league without duplicating active sessions', () => {
    const plan = buildRedraftContractRepairPlan({
      sport: 'NFL',
      leagueType: 'redraft',
      teamCount: 12,
      settings: {
        starter_slots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1 },
        scoring_preset_id: 'fb_ppr',
      },
      draftSession: { status: 'pre_draft', slotOrder: [] },
      rosters: [{ id: 'r1' }],
      teams: [{ ownerName: 'Commish' }],
    })

    expect(plan.eligible).toBe(true)
    expect(plan.settingsChanged).toBe(true)
    expect(plan.nextSettings.starter_slots).toEqual({ QB: 1, RB: 2, WR: 2, TE: 1, FLX: 1, K: 1, DEF: 1 })
    expect(plan.nextSettings.scoring_preset_id).toBe('fb_full_ppr')
    expect(plan.draftSession.shouldCreate).toBe(false)
    expect(plan.draftSession.shouldUpdate).toBe(true)
    expect(plan.draftSession.data.rounds).toBe(15)
    expect(plan.draftSession.data.slotOrder).toHaveLength(12)
  })

  it('does not overwrite customized roster slots or completed draft sessions', () => {
    const plan = buildRedraftContractRepairPlan({
      sport: 'NCAAF',
      leagueType: 'redraft',
      teamCount: 12,
      settings: {
        starter_slots: { QB: 1, RB: 2, WR: 3, TE: 1, FLX: 1, DEF: 1 },
        scoring_preset_id: 'custom_college_power',
      },
      draftSession: {
        status: 'completed',
        slotOrder: [{ slot: 1, rosterId: 'r1', displayName: 'Done' }],
      },
      rosters: [{ id: 'r1' }],
      teams: [{ ownerName: 'Done' }],
    })

    expect(plan.nextSettings.starter_slots).toEqual({ QB: 1, RB: 2, WR: 3, TE: 1, FLX: 1, DEF: 1, K: 1 })
    expect(plan.nextSettings.scoring_preset_id).toBe('custom_college_power')
    expect(plan.draftSession.shouldCreate).toBe(false)
    expect(plan.draftSession.shouldUpdate).toBe(false)
  })

  it('is idempotent after the first repair pass', () => {
    const first = buildRedraftContractRepairPlan({
      sport: 'NFL',
      leagueType: 'redraft',
      teamCount: 12,
      settings: {},
      draftSession: null,
    })
    const second = buildRedraftContractRepairPlan({
      sport: 'NFL',
      leagueType: 'redraft',
      teamCount: 12,
      settings: first.nextSettings,
      draftSession: {
        status: 'pre_draft',
        slotOrder: first.draftSession.data.slotOrder,
        rounds: first.draftSession.data.rounds,
        timerSeconds: first.draftSession.data.timerSeconds,
      },
    })

    expect(second.settingsChanged).toBe(false)
    expect(second.draftSession.shouldCreate).toBe(false)
    expect(second.draftSession.shouldUpdate).toBe(false)
  })

  it('draft room roster tracker accepts legacy aliases and emits canonical order', () => {
    const slots = buildOrderedRosterSlots({
      starterSlots: { QB: 1, RB: 1, WR: 2, TE: 1, FLEX: 1, SUPER_FLEX: 1, DST: 1 },
      benchSlots: 2,
    })

    expect(slots.map((slot) => slot.position)).toEqual(['QB', 'RB', 'WR', 'WR', 'TE', 'FLX', 'SF', 'DEF', 'BN', 'BN'])
    const assigned = assignPicksToSlots(
      [
        { playerName: 'QB One', position: 'QB' },
        { playerName: 'RB One', position: 'RB' },
        { playerName: 'WR One', position: 'WR' },
      ],
      slots,
    )
    expect(assigned.find((row) => row.slot.position === 'SF')?.pick).toBeNull()
  })

  it('lineup validation reads the same canonical FLX/DEF aliases', () => {
    const result = validateRedraftLineup({
      sport: 'NFL',
      week: 1,
      players: [
        { playerId: 'qb', playerName: 'QB', position: 'QB', sport: 'NFL', slotType: 'QB' },
        { playerId: 'rb', playerName: 'RB', position: 'RB', sport: 'NFL', slotType: 'RB' },
        { playerId: 'wr1', playerName: 'WR1', position: 'WR', sport: 'NFL', slotType: 'WR' },
        { playerId: 'wr2', playerName: 'WR2', position: 'WR', sport: 'NFL', slotType: 'WR' },
        { playerId: 'te', playerName: 'TE', position: 'TE', sport: 'NFL', slotType: 'TE' },
        { playerId: 'def', playerName: 'Defense', position: 'DST', sport: 'NFL', slotType: 'DST' },
      ],
    })

    expect(result.ok).toBe(true)
  })
})
