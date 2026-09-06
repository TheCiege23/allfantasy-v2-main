import { describe, expect, it } from 'vitest'

import { weekKickoffs } from '@/lib/core-app/playerGame'
import { moveLegality, playerLock, swapLegality } from '@/lib/core-app/swapLegality'

/*
 * Legal bench swaps: both sides of a lineup swap must be unlocked, and a bench
 * candidate whose own game has started cannot come in. Sunday 2026-10-25:
 * Buffalo and Dallas kick off at 1:00pm ET, Baltimore at 4:25pm ET.
 */

const KICKOFFS = { BUF: '2026-10-25T17:00:00.000Z', DAL: '2026-10-25T17:00:00.000Z', BAL: '2026-10-25T20:25:00.000Z' }
const BEFORE = '2026-10-25T16:18:00.000Z' // 42 min before the early games
const AFTER = '2026-10-25T17:30:00.000Z' // early games under way, late game not yet

describe('playerLock', () => {
  it('reads locked from kickoff on, a countdown before it, and nothing for a club not in the map', () => {
    expect(playerLock('DAL', KICKOFFS, AFTER)).toEqual({ locked: true, kickoff: KICKOFFS.DAL, label: 'kicked off Sun 1:00p ET' })
    expect(playerLock('BAL', KICKOFFS, AFTER)).toMatchObject({ locked: false, label: 'locks in 2h 55m' })
    expect(playerLock('Dallas Cowboys', KICKOFFS, AFTER).locked).toBe(true) // folded through the club vocabulary
    expect(playerLock('KC', KICKOFFS, AFTER)).toEqual({ locked: false, kickoff: null, label: null })
    expect(playerLock(null, KICKOFFS, AFTER).locked).toBe(false)
  })
})

describe('swapLegality', () => {
  const kincaid = { name: 'Dalton Kincaid', team: 'BUF' }
  const ferguson = { name: 'Jake Ferguson', team: 'DAL' }
  const likely = { name: 'Isaiah Likely', team: 'BAL' }

  it('is legal while both games are ahead', () => {
    expect(swapLegality({ out: ferguson, in: kincaid, kickoffs: KICKOFFS, nowIso: BEFORE })).toEqual({ legal: true, reason: null })
  })

  it('names the game that closed the door', () => {
    expect(swapLegality({ out: ferguson, in: likely, kickoffs: KICKOFFS, nowIso: AFTER })).toEqual({ legal: false, reason: 'locked — Ferguson’s game kicked off Sun 1:00p ET' })
    expect(swapLegality({ out: likely, in: kincaid, kickoffs: KICKOFFS, nowIso: AFTER })).toEqual({ legal: false, reason: 'locked — Kincaid’s game kicked off Sun 1:00p ET' })
    expect(swapLegality({ out: ferguson, in: kincaid, kickoffs: KICKOFFS, nowIso: AFTER })).toEqual({ legal: false, reason: 'locked — both games have kicked off' })
  })

  it('does not claim a lock for a club it cannot see, and reads a single move from one side', () => {
    expect(swapLegality({ out: { name: 'Nobody Known', team: 'KC' }, in: likely, kickoffs: KICKOFFS, nowIso: AFTER }).legal).toBe(true)
    expect(swapLegality({ out: ferguson, in: kincaid, kickoffs: {}, nowIso: AFTER }).legal).toBe(true)
    expect(moveLegality({ name: 'Dalton Kincaid', team: 'BUF', kickoffs: KICKOFFS, nowIso: AFTER })).toEqual({ legal: false, reason: 'locked — Kincaid’s game kicked off Sun 1:00p ET' })
    expect(moveLegality({ name: 'Dalton Kincaid', team: 'BUF', kickoffs: KICKOFFS, nowIso: BEFORE }).legal).toBe(true)
  })
})

describe('weekKickoffs', () => {
  it('maps every club through either spelling to its earliest kickoff, skipping rows with no time', () => {
    const rows = [
      { homeTeam: 'Buffalo Bills', awayTeam: 'Miami Dolphins', startTime: new Date(KICKOFFS.BUF), seasonType: 'regular', venue: null },
      { homeTeam: 'BUF', awayTeam: 'MIA', startTime: new Date(KICKOFFS.BUF), seasonType: null, venue: null },
      { homeTeam: 'Baltimore Ravens', awayTeam: 'Cleveland Browns', startTime: new Date(KICKOFFS.BAL), seasonType: 'regular', venue: null },
      { homeTeam: 'KC', awayTeam: 'DEN', startTime: null, seasonType: 'regular', venue: null },
    ]
    expect(weekKickoffs(rows)).toEqual({ BUF: KICKOFFS.BUF, MIA: KICKOFFS.BUF, BAL: KICKOFFS.BAL, CLE: KICKOFFS.BAL })
  })
})
