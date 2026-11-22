/**
 * Phase 7 (2026-11-19): the "My team" roster reads each sport's own lineup — basketball PG SG G SF PF
 * F C UTIL, baseball C 1B … OF UTIL SP RP P, hockey C LW RW D UTIL G, soccer GK DEF MID FWD — fills
 * flex slots by that sport's eligibility, and shows BYE only in football. The mock room uses the
 * same panel, so its bench no longer drops every pick past the starting slots.
 */
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assignPicksToSlots,
  buildOrderedRosterSlots,
  rosterSportFamily,
  sportHasByeWeeks,
} from '@/lib/draft-room/rosterSlotOrder'
import { ResultsRosterPanel } from '@/components/app/draft-room/ResultsRosterPanel'
import { mockStarterSlotCounts } from '@/components/mock-draft/MockDraftSleeperRoomClient'

afterEach(cleanup)

const labels = (starterSlots: Record<string, number>, sport: string, benchSlots = 0) =>
  buildOrderedRosterSlots({ starterSlots, benchSlots, sport }).map((s) => s.label)

describe("each sport's slot order", () => {
  it('basketball reads PG SG G SF PF F C UTIL, then BN', () => {
    expect(labels({ UTIL: 2, C: 1, F: 1, G: 1, PF: 1, SF: 1, SG: 1, PG: 1 }, 'NBA', 2)).toEqual([
      'PG', 'SG', 'G', 'SF', 'PF', 'F', 'C', 'UTIL', 'UTIL', 'BN', 'BN',
    ])
  })

  it('baseball reads C 1B 2B 3B SS OF UTIL SP RP P', () => {
    expect(labels({ P: 2, RP: 1, SP: 1, UTIL: 1, OF: 3, SS: 1, '3B': 1, '2B': 1, '1B': 1, C: 1 }, 'MLB')).toEqual([
      'C', '1B', '2B', '3B', 'SS', 'OF', 'OF', 'OF', 'UTIL', 'SP', 'RP', 'P', 'P',
    ])
  })

  it('hockey reads C LW RW D UTIL G, and soccer GK DEF MID FWD', () => {
    expect(labels({ G: 1, UTIL: 1, D: 2, RW: 1, LW: 1, C: 1 }, 'NHL')).toEqual(['C', 'LW', 'RW', 'D', 'D', 'UTIL', 'G'])
    expect(labels({ FWD: 1, MID: 2, DEF: 2, GK: 1 }, 'SOCCER')).toEqual(['GK', 'DEF', 'DEF', 'MID', 'MID', 'FWD'])
  })

  it('football keeps its order, with SF meaning superflex', () => {
    expect(labels({ SUPER_FLEX: 1, FLEX: 1, TE: 1, WR: 2, RB: 2, QB: 1 }, 'NFL', 1)).toEqual([
      'QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLX', 'SF', 'BN',
    ])
  })
})

describe("each sport's flex eligibility", () => {
  const fill = (starterSlots: Record<string, number>, sport: string, positions: string[], benchSlots = 2) =>
    assignPicksToSlots(
      positions.map((position, i) => ({ position, playerName: `P${i}` })),
      buildOrderedRosterSlots({ starterSlots, benchSlots, sport }),
      sport,
    ).map((e) => `${e.slot.label}:${e.pick?.playerName ?? '-'}`)

  it('a second point guard fills G, a third fills UTIL; a small forward is never a superflex', () => {
    expect(fill({ PG: 1, G: 1, SF: 1, UTIL: 1 }, 'NBA', ['PG', 'PG', 'PG', 'SF'])).toEqual([
      'PG:P0', 'G:P1', 'SF:P3', 'UTIL:P2', 'BN:-', 'BN:-',
    ])
  })

  it('a dual-eligible guard takes the open slot of either position', () => {
    expect(fill({ PG: 1, SG: 1 }, 'NBA', ['PG', 'PG/SG'])).toEqual(['PG:P0', 'SG:P1', 'BN:-', 'BN:-'])
  })

  it('baseball fills CI / MI / OF / P; hockey wingers fill W then F; goalies never skate', () => {
    expect(fill({ '1B': 1, CI: 1, OF: 1, P: 1 }, 'MLB', ['1B', '3B', 'LF', 'SP'], 0)).toEqual([
      '1B:P0', 'CI:P1', 'OF:P2', 'P:P3',
    ])
    expect(fill({ LW: 1, F: 1, UTIL: 1, G: 1 }, 'NHL', ['LW', 'LW', 'G', 'G'], 1)).toEqual([
      'LW:P0', 'F:P1', 'UTIL:-', 'G:P2', 'BN:P3',
    ])
  })

  it('an overflow pick goes to the bench, never off the roster', () => {
    expect(fill({ C: 1 }, 'NBA', ['C', 'C'], 1)).toEqual(['C:P0', 'BN:P1'])
  })
})

describe('BYE is football only', () => {
  it('knows which sports have byes', () => {
    expect(['NFL', 'NCAAF', null].map(sportHasByeWeeks)).toEqual([true, true, true])
    expect(['NBA', 'MLB', 'NHL', 'SOCCER', 'NCAAB'].map(sportHasByeWeeks)).toEqual([false, false, false, false, false])
    expect(rosterSportFamily('ncaab')).toBe('basketball')
  })

  const team = [{ rosterId: 'r1', displayName: 'Me', isCurrentUser: true }]
  const pick = (position: string) => [{ rosterId: 'r1', playerName: 'Someone', position, team: 'BOS', overall: 1, byeWeek: 7, pickLabel: '1.01' }]

  it('shows BYE and the pick in football', () => {
    render(<ResultsRosterPanel teams={team} picks={pick('QB')} currentUserRosterId="r1" starterSlots={{ QB: 1 }} sport="NFL" />)
    expect(screen.getByTestId('results-roster-panel-starters-bye-0').textContent).toBe('BYE 7')
    expect(screen.getByTestId('results-roster-panel-starters-pick-0').textContent).toBe('1.01')
  })

  it('shows the pick but no BYE in basketball', () => {
    render(<ResultsRosterPanel teams={team} picks={pick('C')} currentUserRosterId="r1" starterSlots={{ C: 1 }} sport="NBA" />)
    expect(screen.queryByTestId('results-roster-panel-starters-bye-0')).toBeNull()
    expect(screen.getByTestId('results-roster-panel-starters-pick-0').textContent).toBe('1.01')
  })
})

describe("the mock room's slot list", () => {
  it('counts starters and leaves the bench to the round count', () => {
    expect(mockStarterSlotCounts(['QB', 'RB', 'RB', 'FLEX', 'SUPER_FLEX', 'BN', 'bn'])).toEqual({
      QB: 1, RB: 2, FLEX: 1, SUPER_FLEX: 1,
    })
  })
})
