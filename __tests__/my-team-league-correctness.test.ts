import { describe, expect, it } from 'vitest'

import { composeMyTeamMoves } from '@/lib/core-app/chimmyMoves'
import { isEligibleForSlot, startingSlotTemplate } from '@/lib/core-app/rosterSlots'
import type { LineupPlayer } from '@/lib/core-app/myTeam'

/*
 * Two league-page fixes from the My Team audit (2026-10-02). The footnote fix is in my-team-screen.test.tsx; Best Ball and the 0%-owned
 * fix are driven through the real getMyTeamData in my-team-bench-check-byes.test.ts.
 */

describe("Sleeper's WR/RB flex takes no tight end", () => {
  it('maps WRRB_FLEX to its own W/R slot, not the TE-eligible FLEX', () => {
    expect(startingSlotTemplate({ roster_positions: ['WRRB_FLEX', 'FLEX'] })).toEqual(['W/R', 'FLEX'])
  })

  it('W/R takes a WR or an RB and refuses a TE; FLEX still takes all three', () => {
    expect(isEligibleForSlot('W/R', 'WR')).toBe(true)
    expect(isEligibleForSlot('W/R', 'RB')).toBe(true)
    expect(isEligibleForSlot('W/R', 'TE')).toBe(false)
    expect(isEligibleForSlot('FLEX', 'TE')).toBe(true)
  })
})

function player(over: Partial<LineupPlayer> = {}): LineupPlayer {
  return {
    sleeperId: 'p1', name: 'Bo Nix', position: 'QB', team: 'DEN', sport: 'NFL', imageUrl: null,
    gameContext: 'DEN vs MIA · Sun 9:05p ET', kickoff: new Date('2099-09-13T21:05:00Z'), preseason: false,
    venue: null, injuryStatus: null, ruledOut: false, projectedPoints: 19.8, afProjectedPoints: 22.4,
    indoors: false, weather: null, market: null, onBye: false, ...over,
  }
}

describe("Chimmy's moves see an empty starting slot", () => {
  const base = { leagueId: 'L 1', leagueName: 'Sunday Sweat', nowIso: '2026-10-02T12:00:00Z' }

  it('leads with the hole when no starter is flagged — it used to say all clear', () => {
    const moves = composeMyTeamMoves({ ...base, starters: [player()], emptySlots: [{ index: 3, slotLabel: 'WR' }] })
    expect(moves.moves).toHaveLength(1)
    expect(moves.moves[0]).toMatchObject({
      tone: 'bad',
      title: 'Fill your empty WR slot',
      href: '/core/my-team?league=L%201#lineup-slot-3',
      actionLabel: 'Fix lineup',
    })
  })

  it('puts empty slots ahead of flagged starters and keeps the three-move cap', () => {
    const out = player({ sleeperId: 'o1', name: 'Out Guy', injuryStatus: 'Out', ruledOut: true })
    const q = player({ sleeperId: 'q1', name: 'Maybe Guy', injuryStatus: 'Questionable' })
    const moves = composeMyTeamMoves({
      ...base,
      starters: [out, q],
      emptySlots: [{ index: 0, slotLabel: 'QB' }, { index: 5, slotLabel: 'FLEX' }],
    })
    expect(moves.moves.map((m) => m.title)).toEqual(['Fill your empty QB slot', 'Fill your empty FLEX slot', 'Bench Out Guy'])
  })

  it('is unchanged for a caller that passes no slot list', () => {
    expect(composeMyTeamMoves({ ...base, starters: [player()] }).moves).toEqual([])
  })
})
