import { describe, expect, it } from 'vitest'
import { boardFromHistoryWeek, boardFromImportedView, boardFromNativeSummary, historyWeeks, type NativeBoardSummary } from '@/lib/guillotine/survivalBoardModel'
import { buildSurvivalHistory } from '@/lib/guillotine/survivalHistory'
import { DEFAULT_CHOP_LIST_ORDER, readChopListOrder } from '@/lib/guillotine/chopListOrder'

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
    // The default order (Sleeper's and Yahoo's): the chop zone leads the list, the safest team closes it.
    expect(b.order).toBe('chop_top')
    expect(b.rows.map((r) => r.rosterId)).toEqual(['z', 'b', 'me', 'a'])
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

describe('the order of the list (lib/guillotine/chopListOrder.ts)', () => {
  it('🛑 chop zone on top is the default; a league that never chose reads it', () => {
    expect(DEFAULT_CHOP_LIST_ORDER).toBe('chop_top')
    expect(readChopListOrder(null)).toBe('chop_top')
    expect(readChopListOrder({})).toBe('chop_top')
    expect(readChopListOrder({ guillotineChopListOrder: 'sideways' })).toBe('chop_top')
    expect(readChopListOrder({ guillotineChopListOrder: 'chop_bottom' })).toBe('chop_bottom')
  })

  it('the commissioner can put the chop zone at the bottom: the same rows, reversed', () => {
    const top = boardFromNativeSummary(native())
    const bottom = boardFromNativeSummary(native({ config: { chopListOrder: 'chop_bottom' } }))
    expect(bottom.order).toBe('chop_bottom')
    expect(bottom.rows.map((r) => r.rosterId)).toEqual(['a', 'me', 'b', 'z'])
    expect(bottom.rows.map((r) => r.rosterId)).toEqual([...top.rows.map((r) => r.rosterId)].reverse())
    // An explicit option wins over the league's setting (the page passes the live board's order to a replayed week).
    expect(boardFromNativeSummary(native({ config: { chopListOrder: 'chop_bottom' } }), { order: 'chop_top' }).order).toBe('chop_top')
  })

  it('the order changes nothing but the order: rank, the race, the line and the headline are the same', () => {
    const top = boardFromNativeSummary(native())
    const bottom = boardFromNativeSummary(native({ config: { chopListOrder: 'chop_bottom' } }))
    const ranks = (b: typeof top) => Object.fromEntries(b.rows.map((r) => [r.rosterId, r.rank]))
    expect(ranks(top)).toEqual({ a: 1, me: 2, b: 3, z: 4 })
    expect(ranks(bottom)).toEqual(ranks(top))
    for (const b of [top, bottom]) {
      expect(b.headline).toBe('Safe by 14.2')
      expect(b.above?.name).toBe('Alpha')
      expect(b.below?.name).toBe('Bravo')
      expect(b.cutScore).toBe(80)
      // The chop-zone marker is drawn above the zone's first row, wherever the zone sits.
      expect(b.rows.filter((r) => r.cutAbove).map((r) => r.rosterId)).toEqual(['z'])
    }
  })

  it('each zone is named once, above its first row', () => {
    const zones = (b: ReturnType<typeof boardFromNativeSummary>) => b.rows.map((r) => r.zoneStart)
    expect(zones(boardFromNativeSummary(native()))).toEqual(['chop_zone', 'danger', 'safe', null])
    expect(zones(boardFromNativeSummary(native({ config: { chopListOrder: 'chop_bottom' } })))).toEqual(['safe', null, 'danger', 'chop_zone'])
  })
})

describe('before anyone scores, the list is the projection (never a blank card)', () => {
  const outlook = (proj: Record<string, number>) => Object.fromEntries(Object.entries(proj).map(([id, p]) => [id, { playersLeft: 9, starters: 9, gamesLeft: 9, remainingProjection: p, partial: false }]))
  const pre = (over: Partial<NativeBoardSummary> = {}): NativeBoardSummary => ({
    weekOrPeriod: 6,
    myRosterId: 'me',
    dangerTiers: [],
    field: [{ rosterId: 'a', displayName: 'Alpha' }, { rosterId: 'me', displayName: 'Mine' }, { rosterId: 'b', displayName: 'Bravo' }, { rosterId: 'z', displayName: 'Zulu' }],
    home: { scores: {} },
    outlook: outlook({ a: 130, me: 110, b: 100, z: 60 }),
    ...over,
  })

  it('🛑 with a projection for every team, the lowest projected finisher is the projected chop zone', () => {
    const b = boardFromNativeSummary(pre())
    expect(b.scored).toBe(false)
    expect(b.projected).toBe(true)
    expect(b.rows.map((r) => r.rosterId)).toEqual(['z', 'b', 'me', 'a'])
    expect(b.rows.find((r) => r.rosterId === 'z')).toMatchObject({ tier: 'chop_zone', cutAbove: true, rank: 4, points: null })
    expect(b.rows.every((r) => r.safePct != null)).toBe(true)
    // It is a forecast: no chop line score, no gap, and the viewer is still told there are no scores.
    expect(b.cutScore).toBeNull()
    expect(b.gap).toBeNull()
    expect(b.status).toBe('pre_scores')
    expect(b.detail).toContain('No scores yet.')
    expect(b.detail).toContain('You are projected 2nd of 4.')
  })

  it('a double-chop week projects two teams into the zone', () => {
    const b = boardFromNativeSummary(pre({ chopWatch: { week: 6, chopCount: 2, chopLine: null } }))
    expect(b.rows.filter((r) => r.tier === 'chop_zone').map((r) => r.rosterId).sort()).toEqual(['b', 'z'])
  })

  it('[control] no projection for one team means no projected zone: the field is listed level', () => {
    const b = boardFromNativeSummary(pre({ outlook: { ...outlook({ a: 130, me: 110, b: 100 }) } }))
    expect(b.projected).toBe(false)
    expect(b.rows.some((r) => r.cutAbove || r.zoneStart != null || r.rank != null)).toBe(false)
    expect(b.rows.every((r) => r.tier === 'safe')).toBe(true)
  })

  it('[control] a no-chop week projects nobody into a zone', () => {
    expect(boardFromNativeSummary(pre({ chopWatch: { week: 6, chopCount: 0, chopLine: null } })).projected).toBe(false)
  })

  it('the first real score ends the projection: the engine tiers are back', () => {
    const b = boardFromNativeSummary(native({ outlook: outlook({ a: 0, me: 0, b: 0, z: 200 }) }))
    expect(b.scored).toBe(true)
    expect(b.projected).toBe(false)
    // Zulu has the most left to come, and the engine still has it in the chop zone on the scores so far.
    expect(b.rows.find((r) => r.rosterId === 'z')?.tier).toBe('chop_zone')
  })
})

describe('a week already chopped, replayed from the season history', () => {
  const names = { a: 'Alpha', me: 'Mine', b: 'Bravo', z: 'Zulu', x: 'Xray' }
  const history = buildSurvivalHistory({
    scores: [
      { rosterId: 'a', week: 1, points: 120 }, { rosterId: 'me', week: 1, points: 90 }, { rosterId: 'b', week: 1, points: 85 }, { rosterId: 'z', week: 1, points: 100 }, { rosterId: 'x', week: 1, points: 80 },
      { rosterId: 'a', week: 2, points: 110 }, { rosterId: 'me', week: 2, points: 72 }, { rosterId: 'b', week: 2, points: 70 }, { rosterId: 'z', week: 2, points: 95 },
    ],
    chopped: [{ rosterId: 'x', week: 1 }, { rosterId: 'b', week: 2 }],
    names,
    closeCallMargin: 10,
  })

  it('offers every week the chop has scored, oldest first', () => {
    expect(historyWeeks(history)).toEqual([1, 2])
    expect(historyWeeks(null)).toEqual([])
  })

  it('🛑 shows that week as it finished: final scores, who fell, and how the viewer came through', () => {
    const b = boardFromHistoryWeek(history, 2, { myRosterId: 'me', dangerMargin: 10 })!
    expect(b.final).toBe(true)
    expect(b.week).toBe(2)
    expect(b.rows.map((r) => [r.rosterId, r.points, r.tier])).toEqual([['b', 70, 'chop_zone'], ['me', 72, 'danger'], ['z', 95, 'safe'], ['a', 110, 'safe']])
    expect(b.headline).toBe('You survived by 2.0')
    expect(b.detail).toBe('Week 2, final. Chop line: 70.0. Bravo was chopped.')
    // The graveyard as it stood once that week was chopped.
    expect(b.graveyard.map((g) => [g.name, g.week])).toEqual([['Xray', 1], ['Bravo', 2]])
    // A replayed week has no forecast.
    expect(b.projected).toBe(false)
    expect(b.rows.every((r) => r.safePct == null && r.projectedFinish == null)).toBe(true)
  })

  it('the team that fell is told so, and an earlier week does not list a later chop', () => {
    expect(boardFromHistoryWeek(history, 2, { myRosterId: 'b' })!.headline).toBe('You were chopped in week 2')
    const week1 = boardFromHistoryWeek(history, 1, { myRosterId: null, order: 'chop_bottom' })!
    expect(week1.headline).toBe('Xray was chopped')
    expect(week1.graveyard.map((g) => g.name)).toEqual(['Xray'])
    expect(week1.rows[week1.rows.length - 1]!.rosterId).toBe('x')
  })

  it('[control] a week the history never scored has no board', () => {
    expect(boardFromHistoryWeek(history, 9)).toBeNull()
    expect(boardFromHistoryWeek(null, 1)).toBeNull()
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

describe('after the draft, before anyone scores', () => {
  it('🛑 lists the field from `field` when there is no chop line yet, instead of "appears once the season has started"', () => {
    const b = boardFromNativeSummary({ weekOrPeriod: 6, myRosterId: 'me', dangerTiers: [], field: [{ rosterId: 'me', displayName: 'Mine' }, { rosterId: 'x', displayName: 'Other' }], home: { scores: {} } })
    expect(b.rows.map((r) => r.name).sort()).toEqual(['Mine', 'Other'])
    expect(b.status).toBe('pre_scores')
    expect(b.rows.some((r) => r.cutAbove)).toBe(false)
  })
})

describe('a calendar week before the first chop week', () => {
  const base = {
    weekOrPeriod: 7,
    myRosterId: 'me',
    dangerTiers: [],
    field: [{ rosterId: 'me', displayName: 'Mine' }, { rosterId: 'x', displayName: 'Other' }],
    home: { scores: {} },
    config: { eliminationStartWeek: 7 },
  }
  it('🛑 says the week being played does not count, and when chops start', () => {
    const b = boardFromNativeSummary({ ...base, calendarWeek: 6 })
    expect(b.notCountingWeek).toBe(6)
    expect(b.headline).toBe('Chops start in week 7')
    expect(b.detail).toBe("Week 6 doesn't count toward a chop. The lowest score in week 7 is the first one chopped.")
  })
  it('[control] in the first chop week itself it is the ordinary board', () => {
    const b = boardFromNativeSummary({ ...base, calendarWeek: 7 })
    expect(b.notCountingWeek).toBeNull()
    expect(b.headline).toBe("Don't finish last this week")
  })
  it('without a calendar week (an older payload) nothing changes', () => {
    expect(boardFromNativeSummary(base).notCountingWeek).toBeNull()
  })
})
