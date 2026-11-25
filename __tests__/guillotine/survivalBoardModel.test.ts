import { describe, expect, it } from 'vitest'
import { boardFromImportedView, boardFromNativeSummary, type NativeBoardSummary } from '@/lib/guillotine/survivalBoardModel'

const tiers = (rows: Array<[string, string, string, number]>) =>
  rows.map(([rosterId, displayName, tier, pointsFromChopZone]) => ({ rosterId, displayName, tier, pointsFromChopZone }))

function native(over: Partial<NativeBoardSummary> = {}): NativeBoardSummary {
  return {
    weekOrPeriod: 6,
    myRosterId: 'me',
    dangerTiers: tiers([
      ['a', 'Alpha', 'safe', 40],
      ['me', 'Mine', 'safe', 14.2],
      ['b', 'Bravo', 'danger', 4],
      ['z', 'Zulu', 'chop_zone', 0],
    ]),
    home: { scores: { a: 120, me: 94.2, b: 84, z: 80 }, chopLabel: 'By Wednesday 7:00 AM ET', chopped: [{ rosterId: 'x', name: 'Xray', week: 3, points: 50 }] },
    ...over,
  }
}

describe('survival board (native)', () => {
  it('leads with the cushion above the chop line, and names the race either side', () => {
    const b = boardFromNativeSummary(native())
    expect(b.status).toBe('safe')
    expect(b.cutScore).toBe(80)
    expect(b.gap).toBe(14.2)
    expect(b.headline).toBe('Safe by 14.2')
    expect(b.above?.name).toBe('Alpha')
    expect(b.below?.name).toBe('Bravo')
    expect(b.rows.map((r) => r.rosterId)).toEqual(['a', 'me', 'b', 'z'])
    expect(b.rows.find((r) => r.cutAbove)?.rosterId).toBe('z')
    expect(b.graveyard).toEqual([{ rosterId: 'x', name: 'Xray', week: 3, isMe: false }])
  })

  it('in the chop zone, the gap is negative: the points needed to pass the lowest safe team', () => {
    const b = boardFromNativeSummary(native({
      dangerTiers: tiers([['a', 'Alpha', 'safe', 40], ['b', 'Bravo', 'danger', 4], ['me', 'Mine', 'chop_zone', 0]]),
      home: { scores: { a: 120, b: 84, me: 77.7 } },
    }))
    expect(b.status).toBe('chop_zone')
    expect(b.gap).toBe(-6.3)
    expect(b.headline).toBe('6.3 pts from safety')
    expect(b.detail).toContain('Pass Bravo')
    expect(b.safeScore).toBe(84)
    // The blade sits between the zone (0%) and the lowest safe team, never on top of the viewer.
    expect(b.bladePct).toBeGreaterThan(0)
    expect(b.bladePct!).toBeLessThan(b.rows.find((r) => r.rosterId === 'b')!.trackPct!)
  })

  it('says danger when the engine does', () => {
    const b = boardFromNativeSummary(native({ myRosterId: 'b' }))
    expect(b.status).toBe('danger')
    expect(b.headline).toBe('Only 4.0 above the chop line')
  })

  it('before any score there is no line, no gap and no strip position', () => {
    const b = boardFromNativeSummary(native({ home: { scores: {} } }))
    expect(b.scored).toBe(false)
    expect(b.status).toBe('pre_scores')
    expect(b.headline).toBe("Don't finish last this week")
    expect(b.bladePct).toBeNull()
    expect(b.gap).toBeNull()
    expect(b.rows.every((r) => r.trackPct == null && !r.cutAbove)).toBe(true)
  })

  it('a chopped viewer is told when, and a member with no team is a spectator', () => {
    expect(boardFromNativeSummary(native({ myRosterId: 'x' })).headline).toBe('You were chopped in week 3')
    expect(boardFromNativeSummary(native({ myRosterId: null })).status).toBe('spectator')
  })

  it('an immune viewer is told the chop cannot take them', () => {
    const t = tiers([['a', 'Alpha', 'safe', 40], ['me', 'Mine', 'chop_zone', 0]]).map((r) => (r.rosterId === 'me' ? { ...r, immune: true } : r))
    const b = boardFromNativeSummary(native({ dangerTiers: t, home: { scores: { a: 100, me: 60 } } }))
    expect(b.status).toBe('immune')
  })

  it('reads a double-chop week from Chop Watch', () => {
    expect(boardFromNativeSummary(native({ chopWatch: { week: 7, chopCount: 2, chopLine: 80 } })).chopCount).toBe(2)
  })
})

describe('survival board (imported)', () => {
  const view = {
    week: 9,
    standings: [
      { rosterId: '1', name: 'One', points: 110, onChopLine: false, tier: 'safe' as const },
      { rosterId: '2', name: 'Two', points: 70, onChopLine: true, tier: 'chop_zone' as const },
    ],
    chopped: [{ rosterId: '3', name: 'Three', week: 8 }],
    teamsAlive: 2,
    scoredThisWeek: 2,
  }
  it('builds the same board from the provider scores, with the viewer from their claimed team', () => {
    const b = boardFromImportedView(view, '1')
    expect(b.source).toBe('imported')
    expect(b.status).toBe('safe')
    expect(b.gap).toBe(40)
    expect(b.graveyard[0]).toMatchObject({ name: 'Three', week: 8 })
  })
  it('shows no scores for a week that has not started', () => {
    const b = boardFromImportedView({ ...view, scoredThisWeek: 0 }, '1')
    expect(b.scored).toBe(false)
    expect(b.rows.every((r) => r.points == null)).toBe(true)
  })
})
