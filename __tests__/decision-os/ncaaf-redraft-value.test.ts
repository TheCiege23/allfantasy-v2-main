import { describe, expect, it } from 'vitest'
import {
  applyCollegeGrade,
  gradeNcaafRedraftDeal,
  ncaafDealPositions,
  ncaafPickRefusal,
  ncaafSeasonWindow,
  NCAAF_FAAB_REASON,
  NCAAF_PICKS_UNPRICED_REASON,
  NCAAF_REDRAFT_PICKS_REASON,
  resolveNcaafRosteredPlayer,
  type NcaafRedraftContext,
} from '@/lib/decision-os/trade/ncaafRedraftValue'
import type { LeagueGrade } from '@/lib/trade-value-console/leagueGrade'
import type { TradeAssetInput } from '@/lib/trade-value-console/types'

const rostered = [
  { rosterPlayerId: '101', name: 'Arch Manning', position: 'QB' },
  { rosterPlayerId: '102', name: 'Jeremiah Smith', position: 'WR' },
  { rosterPlayerId: '103', name: 'Ryan Williams', position: 'WR' },
  { rosterPlayerId: '104', name: 'Ryan Williams', position: 'RB' },
  { rosterPlayerId: '105', name: 'Depth Receiver', position: 'WR' },
]

const ctx = (over: Partial<NcaafRedraftContext> = {}): NcaafRedraftContext => ({
  rostered,
  perGameByRosterId: new Map([
    ['101', { perGame: 24, position: 'QB' }],
    ['102', { perGame: 20, position: 'WR' }],
    ['103', { perGame: 15, position: 'WR' }],
    ['105', { perGame: 8, position: 'WR' }],
  ]),
  replacementByPosition: new Map([
    ['QB', { name: 'Free QB', perGame: 16 }],
    ['WR', { name: 'Free WR', perGame: 10 }],
  ]),
  window: { season: 2026, fromWeek: 6, toWeek: 15, weeks: 10 },
  ...over,
})

const p = (name: string, rosterPlayerId?: string): TradeAssetInput => ({ kind: 'player', name, ...(rosterPlayerId ? { rosterPlayerId } : {}) })

describe('resolveNcaafRosteredPlayer — one rostered player, or why not', () => {
  it('an id is authoritative, even when the name is shared', () => {
    expect(resolveNcaafRosteredPlayer(p('Ryan Williams', '104'), rostered)).toMatchObject({ ok: true, player: { rosterPlayerId: '104', position: 'RB' } })
  })

  it('a name carried by exactly one rostered player resolves, allowing for suffixes and punctuation', () => {
    expect(resolveNcaafRosteredPlayer(p('Arch Manning Jr.'), rostered)).toMatchObject({ ok: true, player: { rosterPlayerId: '101' } })
  })

  it('a name two rostered players share is refused, never the first', () => {
    const out = resolveNcaafRosteredPlayer(p('Ryan Williams'), rostered)
    expect(out).toEqual({ ok: false, reason: expect.stringContaining('matches 2 rostered players') })
  })

  it('a player not on a roster here is refused, by id or by name', () => {
    expect(resolveNcaafRosteredPlayer(p('Nobody', '999'), rostered)).toMatchObject({ ok: false })
    expect(resolveNcaafRosteredPlayer(p('Nobody'), rostered)).toMatchObject({ ok: false, reason: 'Nobody is not on a roster in this league.' })
  })
})

describe('gradeNcaafRedraftDeal — points over the best free agent, for the weeks left', () => {
  it('values each player as (per game − replacement) × weeks remaining', () => {
    const view = gradeNcaafRedraftDeal({ give: [p('Arch Manning')], get: [p('Jeremiah Smith')], ctx: ctx() })
    expect(view.graded).toBe(true)
    if (!view.graded) return
    // QB: (24 − 16) × 10 = 80.  WR: (20 − 10) × 10 = 100.
    expect(view.giveValue).toBe(80)
    expect(view.getValue).toBe(100)
    expect(view.lines).toEqual([
      { side: 'give', name: 'Arch Manning', marketValue: 80, leagueValue: 80, source: 'ncaaf-redraft-vorp' },
      { side: 'get', name: 'Jeremiah Smith', marketValue: 100, leagueValue: 100, source: 'ncaaf-redraft-vorp' },
    ])
    expect(view.percentDiff).toBe(20)
    expect(view.basis).toMatch(/weeks 6–15 of the 2026 college season/)
    expect(view.scoringApplied).toBe(true)
    expect(view.needApplied).toBe(false)
  })

  it('a player below the best free agent adds nothing: he could be picked up instead', () => {
    const view = gradeNcaafRedraftDeal({ give: [p('Depth Receiver')], get: [p('Jeremiah Smith')], ctx: ctx() })
    expect(view).toMatchObject({ graded: true, giveValue: 0, getValue: 100, letter: 'A', partnerLetter: 'F' })
  })

  it('a below-replacement throw-in costs his side nothing — he does not subtract from the star beside him', () => {
    const view = gradeNcaafRedraftDeal({ give: [p('Arch Manning')], get: [p('Jeremiah Smith'), p('Depth Receiver')], ctx: ctx() })
    expect(view).toMatchObject({ graded: true, getValue: 100 })
    if (!view.graded) return
    expect(view.lines.find((l) => l.name === 'Depth Receiver')).toMatchObject({ leagueValue: 0 })
  })

  it('a deal where nobody beats a free agent is not graded — and says why, not "no value"', () => {
    const view = gradeNcaafRedraftDeal({ give: [p('Depth Receiver')], get: [p('Depth Receiver')], ctx: ctx() })
    expect(view).toMatchObject({ graded: false, reason: expect.stringContaining('replaced from the wire') })
  })

  it('weeks remaining sizes the numbers but never moves the letter', () => {
    const deal = { give: [p('Arch Manning')], get: [p('Jeremiah Smith'), p('Depth Receiver')] }
    const ten = gradeNcaafRedraftDeal({ ...deal, ctx: ctx() })
    const three = gradeNcaafRedraftDeal({ ...deal, ctx: ctx({ window: { season: 2026, fromWeek: 13, toWeek: 15, weeks: 3 } }) })
    expect(ten.graded && three.graded).toBe(true)
    if (!ten.graded || !three.graded) return
    expect(three.getValue).toBeLessThan(ten.getValue)
    expect([three.letter, three.percentDiff]).toEqual([ten.letter, ten.percentDiff])
  })

  it('no weeks left: nothing to grade', () => {
    const view = gradeNcaafRedraftDeal({ give: [p('Arch Manning')], get: [p('Jeremiah Smith')], ctx: ctx({ window: { season: 2026, fromWeek: 16, toWeek: 15, weeks: 0 } }) })
    expect(view).toMatchObject({ graded: false, reason: expect.stringContaining('no weeks left') })
  })

  it.each([
    ['a draft pick', { kind: 'pick', year: 2027, round: 1 } as TradeAssetInput, NCAAF_REDRAFT_PICKS_REASON],
    ['FAAB', { kind: 'faab', amount: 20 } as TradeAssetInput, NCAAF_FAAB_REASON],
  ])('%s is refused with its reason, never priced', (_what, asset, reason) => {
    expect(gradeNcaafRedraftDeal({ give: [p('Arch Manning')], get: [p('Jeremiah Smith'), asset], ctx: ctx() })).toMatchObject({ graded: false, reason })
  })

  it('a player with no league-scored projection is refused, never priced as zero', () => {
    const view = gradeNcaafRedraftDeal({ give: [p('Ryan Williams', '104')], get: [p('Jeremiah Smith')], ctx: ctx() })
    expect(view).toMatchObject({ graded: false, reason: expect.stringContaining('Ryan Williams has no college projection') })
  })

  it('a position with no projected free agent has no replacement level — refused, not priced at full points', () => {
    const view = gradeNcaafRedraftDeal({
      give: [p('Arch Manning')],
      get: [p('Jeremiah Smith')],
      ctx: ctx({ replacementByPosition: new Map([['WR', { name: 'Free WR', perGame: 10 }]]) }),
    })
    expect(view).toMatchObject({ graded: false, reason: expect.stringContaining('No free agent at QB') })
  })

  it('an ambiguous name refuses the whole deal', () => {
    expect(gradeNcaafRedraftDeal({ give: [p('Ryan Williams')], get: [p('Jeremiah Smith')], ctx: ctx() })).toMatchObject({
      graded: false,
      reason: expect.stringContaining('matches 2 rostered players'),
    })
  })
})

describe('ncaafSeasonWindow — the college weeks still to be played', () => {
  it('counts the current week while it is still to be played or under way', () => {
    expect(ncaafSeasonWindow({ season: 2026, current: { state: 'upcoming', sportWeek: 5, nextSportWeek: 6 }, lastRegularWeek: 15 })).toEqual({ season: 2026, fromWeek: 5, toWeek: 15, weeks: 11 })
    expect(ncaafSeasonWindow({ season: 2026, current: { state: 'live', sportWeek: 5, nextSportWeek: 6 }, lastRegularWeek: 15 })?.weeks).toBe(11)
  })

  it('starts from the next week once this one is played', () => {
    expect(ncaafSeasonWindow({ season: 2026, current: { state: 'played', sportWeek: 5, nextSportWeek: 6 }, lastRegularWeek: 15 })?.weeks).toBe(10)
    expect(ncaafSeasonWindow({ season: 2026, current: { state: 'between', sportWeek: 5, nextSportWeek: 6 }, lastRegularWeek: 15 })?.fromWeek).toBe(6)
  })

  it('the season is over after the last regular week', () => {
    expect(ncaafSeasonWindow({ season: 2026, current: { state: 'played', sportWeek: 15, nextSportWeek: null }, lastRegularWeek: 15 })?.weeks).toBe(0)
  })

  it('no schedule, no window — there is no fallback week', () => {
    expect(ncaafSeasonWindow({ season: 2026, current: null, lastRegularWeek: 15 })).toBeNull()
    expect(ncaafSeasonWindow({ season: 2026, current: { state: 'upcoming', sportWeek: 5, nextSportWeek: 6 }, lastRegularWeek: null })).toBeNull()
  })
})

describe('picks in a college league', () => {
  it('a redraft league has no next season for a pick; any other college league has no pick price yet', () => {
    const pick = [{ kind: 'pick', year: 2027, round: 1 } as TradeAssetInput]
    expect(ncaafPickRefusal(pick, true)).toBe(NCAAF_REDRAFT_PICKS_REASON)
    expect(ncaafPickRefusal(pick, false)).toBe(NCAAF_PICKS_UNPRICED_REASON)
    expect(ncaafPickRefusal([p('Arch Manning')], false)).toBeNull()
  })
})

describe('ncaafDealPositions', () => {
  it('names the positions a replacement is needed for, from the projection feed first', () => {
    expect(ncaafDealPositions([p('Arch Manning'), p('Jeremiah Smith'), { kind: 'faab', amount: 5 }], rostered, ctx().perGameByRosterId).sort()).toEqual(['QB', 'WR'])
  })
})

describe('applyCollegeGrade — the console shows the basis it grades on', () => {
  const consoleGrade = (): LeagueGrade =>
    ({
      giveLines: [{ name: 'Arch Manning', marketValue: 4200, leagueValue: 4500, valueAdjustments: [{ kind: 'scoring', factor: 1.07, reason: 'x' }] }],
      getLines: [{ name: 'Jeremiah Smith', marketValue: 5100, leagueValue: 5000, valueAdjustments: [] }],
      totals: { giveBase: 4200, getBase: 5100, giveLeague: 4500, getLeague: 5000, percentDiff: 10, unpriced: 0 },
      valueBasis: { graded: 'league', label: 'Dynasty · 12 teams', scoringAdjusted: true, needAdjusted: false, needGap: null },
    }) as unknown as LeagueGrade

  it('rewrites lines, totals, gap and basis from the college grade', () => {
    const g = consoleGrade()
    const view = gradeNcaafRedraftDeal({ give: [p('Arch Manning')], get: [p('Jeremiah Smith')], ctx: ctx() })
    applyCollegeGrade(g, view)
    expect(g.giveLines[0]).toMatchObject({ marketValue: 80, leagueValue: 80, valueAdjustments: [] })
    expect(g.getLines[0]).toMatchObject({ marketValue: 100, leagueValue: 100 })
    expect(g.totals).toMatchObject({ giveLeague: 80, getLeague: 100, percentDiff: 20 })
    expect(g.valueBasis.label).toMatch(/college season/)
  })

  it('a withheld college grade clears the chart numbers rather than showing them as this league’s', () => {
    const g = consoleGrade()
    applyCollegeGrade(g, { graded: false, reason: NCAAF_REDRAFT_PICKS_REASON, basis: null })
    expect(g.giveLines[0]!.leagueValue).toBeNull()
    expect(g.totals).toMatchObject({ giveLeague: 0, getLeague: 0, percentDiff: 0 })
    expect(g.valueBasis.label).toBe(`Not graded: ${NCAAF_REDRAFT_PICKS_REASON}`)
  })
})
