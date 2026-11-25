import { describe, expect, it } from 'vitest'
import { survivalOdds, teamOutlook } from '@/lib/guillotine/survivalOutlook'
import { boardFromNativeSummary } from '@/lib/guillotine/survivalBoardModel'

describe('teamOutlook — players and games left', () => {
  it('counts starters with a game left, their games, and prorates the week projection to the games left', () => {
    const o = teamOutlook([
      { weekProjection: 40, gamesThisWeek: 4, gamesLeft: 2 }, // half his week left → 20
      { weekProjection: 30, gamesThisWeek: 3, gamesLeft: 3 }, // all of it → 30
      { weekProjection: 25, gamesThisWeek: 3, gamesLeft: 0 }, // done → 0, not counted
    ])
    expect(o).toEqual({ playersLeft: 2, starters: 3, gamesLeft: 5, remainingProjection: 50, partial: false })
  })
  it('a team that is done for the week has nothing left to add', () => {
    expect(teamOutlook([{ weekProjection: 40, gamesThisWeek: 1, gamesLeft: 0 }]).remainingProjection).toBe(0)
  })
  it('no projection for anyone still to play is unknown, never 0', () => {
    const o = teamOutlook([{ weekProjection: null, gamesThisWeek: 1, gamesLeft: 1 }])
    expect(o.playersLeft).toBe(1)
    expect(o.remainingProjection).toBeNull()
  })
  it('flags a remainder that is missing some players', () => {
    expect(teamOutlook([{ weekProjection: 10, gamesThisWeek: 1, gamesLeft: 1 }, { weekProjection: null, gamesThisWeek: 1, gamesLeft: 1 }]).partial).toBe(true)
  })
})

describe('survivalOdds — % safe', () => {
  const field = [
    { rosterId: 'leader', current: 120, remainingProjection: 10 },
    { rosterId: 'mid', current: 90, remainingProjection: 20 },
    { rosterId: 'low', current: 60, remainingProjection: 15 },
  ]
  it('the further ahead with less left to play, the safer; the trailer is least safe', () => {
    const o = survivalOdds(field, 1)!
    expect(o.get('leader')).toBe(99)
    expect(o.get('mid')!).toBeGreaterThan(o.get('low')!)
    expect(o.get('low')!).toBeLessThan(10)
  })
  it('is deterministic: the same week prints the same odds', () => {
    expect([...survivalOdds(field, 1)!]).toEqual([...survivalOdds(field, 1)!])
  })
  it('a finished week is certain: 100 for the survivors, 0 for the lowest', () => {
    const o = survivalOdds(field.map((t) => ({ ...t, remainingProjection: 0 })), 1)!
    expect([o.get('leader'), o.get('mid'), o.get('low')]).toEqual([100, 100, 0])
  })
  it('a close race with games left is close to a coin flip', () => {
    const o = survivalOdds([{ rosterId: 'a', current: 50, remainingProjection: 40 }, { rosterId: 'b', current: 50, remainingProjection: 40 }, { rosterId: 'c', current: 200, remainingProjection: 0 }], 1)!
    expect(Math.abs(o.get('a')! - 50)).toBeLessThan(6)
  })
  it('an immune team cannot be chopped, and a no-chop week is safe for all', () => {
    expect(survivalOdds([{ ...field[2]!, immune: true }, field[0]!, field[1]!], 1)!.get('low')).toBe(100)
    expect(survivalOdds(field, 0)!.get('low')).toBe(100)
  })
  it('a double chop takes two', () => {
    const o = survivalOdds(field.map((t) => ({ ...t, remainingProjection: 0 })), 2)!
    expect([o.get('leader'), o.get('mid'), o.get('low')]).toEqual([100, 0, 0])
  })
  it('🛑 no odds at all when any team alive has no projection for games it still has', () => {
    expect(survivalOdds([...field, { rosterId: 'x', current: 70, remainingProjection: null }], 1)).toBeNull()
  })
})

describe('the board with an outlook', () => {
  const summary = {
    weekOrPeriod: 6,
    myRosterId: 'me',
    dangerTiers: [
      { rosterId: 'a', displayName: 'Alpha', tier: 'safe', pointsFromChopZone: 30 },
      { rosterId: 'me', displayName: 'Mine', tier: 'chop_zone', pointsFromChopZone: 0 },
    ],
    home: { scores: { a: 90, me: 60 } },
    outlook: {
      a: { playersLeft: 1, starters: 10, gamesLeft: 1, remainingProjection: 8, partial: false },
      me: { playersLeft: 6, starters: 10, gamesLeft: 9, remainingProjection: 70, partial: false },
    },
  }
  it('carries % safe, players left and a projected finish on every row, and names the race in players', () => {
    const b = boardFromNativeSummary(summary)
    expect(b.hasOdds && b.hasPlayersLeft).toBe(true)
    const me = b.rows.find((r) => r.isMe)!
    expect(me.playersLeft).toBe(6)
    expect(me.projectedFinish).toBe(130)
    // Behind now but with far more left to play: the favourite to survive.
    expect(me.safePct!).toBeGreaterThan(50)
    expect(b.detail).toContain('You have 6 players left to play; Alpha has 1.')
  })
  it('without an outlook there are no odds and no players-left line', () => {
    const b = boardFromNativeSummary({ ...summary, outlook: null })
    expect(b.hasOdds || b.hasPlayersLeft).toBe(false)
    expect(b.rows.every((r) => r.safePct == null)).toBe(true)
  })
})

describe('before any score', () => {
  it('orders the field by projected finish, not by name', () => {
    const b = boardFromNativeSummary({
      weekOrPeriod: 6,
      myRosterId: 'a',
      dangerTiers: [
        { rosterId: 'a', displayName: 'Aaa', tier: 'safe', pointsFromChopZone: 0 },
        { rosterId: 'z', displayName: 'Zzz', tier: 'safe', pointsFromChopZone: 0 },
      ],
      home: { scores: {} },
      outlook: {
        a: { playersLeft: 10, starters: 10, gamesLeft: 24, remainingProjection: 300, partial: false },
        z: { playersLeft: 10, starters: 10, gamesLeft: 27, remainingProjection: 400, partial: false },
      },
    })
    // By projection, not by name: Aaa is projected lowest, so it is the projected chop zone, which leads the list
    // by default (lib/guillotine/chopListOrder.ts).
    expect(b.projected).toBe(true)
    expect(b.rows.map((r) => r.rosterId)).toEqual(['a', 'z'])
    expect(b.rows.map((r) => r.rank)).toEqual([2, 1])
    expect(b.me?.safePct).not.toBeNull()
  })
})
