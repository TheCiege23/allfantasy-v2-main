// @vitest-environment node
/**
 * The portfolio board's derived numbers — every chart on /core/portfolio is recounted here under the
 * reader's filters, so every rule that decides a number is pinned here.
 */
import { describe, expect, it } from 'vitest'

import {
  EMPTY_FILTER,
  byeLevel,
  diversification,
  distribution,
  exposureRows,
  filterLeagues,
  fragileLevel,
  injuryLevel,
  isEmptyFilter,
  isUrgent,
  KEY_FALL,
  KEY_PLAYER_VALUE,
  leagueMovesOn,
  leagueValueChanges,
  parseFilter,
  parseView,
  rankActions,
  riskRows,
  serializeFilter,
  stackLevel,
  toggleValue,
  valueTotals,
  type PortfolioFilter,
} from '@/lib/core-app/portfolioView'
import type {
  LeagueRisk,
  PortfolioInsights,
  PortfolioLeagueFacts,
  PortfolioPlayer,
} from '@/lib/core-app/portfolioInsightsTypes'

function league(over: Partial<PortfolioLeagueFacts> & { id: string }): PortfolioLeagueFacts {
  return {
    name: over.id.toUpperCase(),
    platform: 'sleeper',
    sport: 'NFL',
    season: '2026',
    concept: 'redraft',
    family: 'redraft',
    bestBall: false,
    idp: false,
    superflex: false,
    scoring: 'ppr',
    tePremium: false,
    stage: 'in_season',
    commissioner: false,
    teamCount: 12,
    record: { wins: 1, losses: 1, ties: 0 },
    rank: 6,
    status: 'middle',
    statusSource: 'standings',
    rosterValue: 1000,
    rosterValueRank: 6,
    valuedTeams: 12,
    valueBook: 'redraft · 1QB',
    hasRoster: true,
    slotsKnown: true,
    ...over,
  }
}

function player(over: Partial<PortfolioPlayer> & { id: string; held: PortfolioPlayer['held'] }): PortfolioPlayer {
  return {
    key: `NFL:${over.id}`,
    sport: 'NFL',
    name: `Player ${over.id}`,
    position: 'WR',
    team: 'KC',
    value: 1000,
    valueDelta: 0,
    injury: null,
    byeWeek: null,
    ...over,
  }
}

function risk(over: Partial<LeagueRisk> & { leagueIndex: number }): LeagueRisk {
  return { out: [], atRisk: [], byes: {}, fragile: [], stack: null, ...over }
}

function insights(over: Partial<PortfolioInsights> = {}): PortfolioInsights {
  return {
    version: 1,
    builtAt: '2026-09-16T12:00:00.000Z',
    leagues: [],
    players: [],
    risk: [],
    nflWeek: { season: 2026, week: 3, preseason: false },
    byeWeeks: [5, 6],
    injuryGaps: [],
    injuryFeedStale: false,
    valueDates: [],
    valueSeries: [],
    movers: [],
    playerValueBook: 'dynasty · superflex',
    notes: {},
    ...over,
  }
}

const NO_EXTRAS = { favoriteIds: [], paidIds: [] }

describe('filters', () => {
  const base = insights({
    leagues: [
      league({ id: 'a', family: 'dynasty', status: 'contender', bestBall: true }),
      league({ id: 'b', family: 'redraft', status: 'rebuild', idp: true }),
      league({ id: 'c', family: 'keeper', status: 'contender', platform: 'espn', commissioner: true }),
      league({ id: 'd', family: 'dynasty', status: 'middle', bestBall: true, idp: true, sport: 'NBA' }),
    ],
  })

  it('ORs within a group and ANDs across groups', () => {
    const f: PortfolioFilter = { ...EMPTY_FILTER, families: ['dynasty', 'keeper'], status: ['contender'] }
    expect(filterLeagues(base, f, NO_EXTRAS)).toEqual([0, 2])
  })

  it('🛑 requires EVERY chosen modifier — best ball + IDP is both, not either', () => {
    const f: PortfolioFilter = { ...EMPTY_FILTER, modifiers: ['best_ball', 'idp'] }
    expect(filterLeagues(base, f, NO_EXTRAS)).toEqual([3])
  })

  it('matches importance from request-scoped favourites and paid ids, OR-ed', () => {
    const f: PortfolioFilter = { ...EMPTY_FILTER, importance: ['favorite', 'paid', 'commissioner'] }
    expect(filterLeagues(base, f, { favoriteIds: ['b'], paidIds: ['d'] })).toEqual([1, 2, 3])
  })

  it('matches sport case-insensitively and platform exactly', () => {
    expect(filterLeagues(base, { ...EMPTY_FILTER, sports: ['NBA'] }, NO_EXTRAS)).toEqual([3])
    expect(filterLeagues(base, { ...EMPTY_FILTER, platforms: ['espn'] }, NO_EXTRAS)).toEqual([2])
  })

  it('round-trips through the URL and drops values it does not recognise', () => {
    const f: PortfolioFilter = { ...EMPTY_FILTER, status: ['contender', 'rebuild'], modifiers: ['idp'], sports: ['NFL'] }
    const params = new Map(serializeFilter(f))
    expect(parseFilter((p) => params.get(p))).toEqual(f)
    const junk = new Map([
      ['pf_st', 'contender.<script>.winning'],
      ['pf_imp', 'paid.everything'],
      ['pf_sport', 'nfl'],
    ])
    expect(parseFilter((p) => junk.get(p))).toEqual({ ...EMPTY_FILTER, status: ['contender'], importance: ['paid'], sports: ['NFL'] })
  })

  it('🛑 never uses `league` as a param — that is the page’s auth boundary', () => {
    const f: PortfolioFilter = {
      status: ['contender'],
      families: ['dynasty'],
      modifiers: ['idp'],
      importance: ['paid'],
      platforms: ['sleeper'],
      sports: ['NFL'],
      stages: ['in_season'],
    }
    for (const [k] of serializeFilter(f)) {
      expect(k.startsWith('pf_')).toBe(true)
      expect(k).not.toBe('league')
    }
  })

  it('toggles a value on and off, and knows an empty filter', () => {
    const on = toggleValue(EMPTY_FILTER, 'families', 'dynasty')
    expect(on.families).toEqual(['dynasty'])
    expect(isEmptyFilter(on)).toBe(false)
    expect(isEmptyFilter(toggleValue(on, 'families', 'dynasty'))).toBe(true)
  })

  it('parses the view and falls back to the overview', () => {
    expect(parseView('risk')).toBe('risk')
    expect(parseView('admin')).toBe('overview')
    expect(parseView(['risk'])).toBe('overview')
  })
})

describe('exposure', () => {
  const base = insights({
    leagues: [league({ id: 'a' }), league({ id: 'b' }), league({ id: 'c', hasRoster: false })],
    players: [
      player({ id: '1', held: [[0, 'S'], [1, 'B']] }),
      player({ id: '2', held: [[0, 'S'], [1, 'S']], value: 50 }),
      player({ id: '3', held: [[1, 'I']], value: 9000 }),
    ],
  })

  it('🛑 divides by rosters we could READ, not by leagues', () => {
    const rows = exposureRows(base, [0, 1, 2])
    expect(rows[0].of).toBe(2)
    expect(rows[0].share).toBe(1)
  })

  it('orders by rosters held, then starts, then value', () => {
    const rows = exposureRows(base, [0, 1, 2])
    expect(rows.map((r) => r.player.id)).toEqual(['2', '1', '3'])
    expect(rows[0].starts).toBe(2)
    expect(rows[1].starts).toBe(1)
  })

  it('recounts under a filter and drops players outside it', () => {
    const rows = exposureRows(base, [0])
    expect(rows.map((r) => [r.player.id, r.count, r.of])).toEqual([
      ['1', 1, 1],
      ['2', 1, 1],
    ])
  })
})

describe('risk grid', () => {
  it('levels are ordinal and zero means zero', () => {
    expect([injuryLevel(0, 0), injuryLevel(0, 1), injuryLevel(1, 0), injuryLevel(1, 2)]).toEqual([0, 1, 2, 3])
    expect([byeLevel(0), byeLevel(1), byeLevel(2), byeLevel(5)]).toEqual([0, 1, 2, 3])
    expect([fragileLevel(0), fragileLevel(1), fragileLevel(3)]).toEqual([0, 1, 3])
    expect([stackLevel(1), stackLevel(2), stackLevel(3), stackLevel(4)]).toEqual([0, 1, 2, 3])
  })

  const base = insights({
    leagues: [
      league({ id: 'a' }),
      league({ id: 'b', sport: 'NBA' }),
      league({ id: 'c', slotsKnown: false }),
      league({ id: 'd', hasRoster: false }),
    ],
    risk: [
      risk({ leagueIndex: 0, out: ['NFL:1'], atRisk: ['NFL:2'], byes: { '5': ['NFL:3', 'NFL:4'] }, stack: { team: 'KC', players: ['NFL:1', 'NFL:2', 'NFL:3'] } }),
      risk({ leagueIndex: 1, out: ['NBA:9'] }),
      risk({ leagueIndex: 2, fragile: null }),
      risk({ leagueIndex: 3 }),
    ],
  })

  it('has one column per upcoming bye week, between injuries and thin spots', () => {
    const { columns } = riskRows(base, [0])
    expect(columns.map((c) => c.id)).toEqual(['injury', 'bye-5', 'bye-6', 'fragile', 'stack'])
  })

  it('🛑 leaves non-NFL leagues out rather than showing them as safe', () => {
    const { rows } = riskRows(base, [0, 1, 2, 3])
    expect(rows.map((r) => r.index)).not.toContain(1)
  })

  it('prints a count and a level on every cell, riskiest league first', () => {
    const { rows } = riskRows(base, [0, 1, 2, 3])
    expect(rows[0].index).toBe(0)
    expect(rows[0].cells.map((c) => [c.count, c.level])).toEqual([
      [2, 2],
      [2, 2],
      [0, 0],
      [0, 0],
      [3, 2],
    ])
  })

  it('🛑 does not judge thin spots before the draft is done', () => {
    const drafting = { ...base, leagues: base.leagues.map((l, i) => (i === 0 ? { ...l, stage: 'pre_draft' as const } : l)) }
    const row = riskRows(drafting, [0]).rows[0]
    expect(row.cells[3]).toMatchObject({ level: 0, unknown: 'draft not finished' })
  })

  it('🛑 marks cells it cannot judge as unknown, never as zero risk', () => {
    const { rows } = riskRows(base, [2, 3])
    const noSlots = rows.find((r) => r.index === 2)!
    expect(noSlots.cells[3].unknown).toMatch(/slots/)
    const noRoster = rows.find((r) => r.index === 3)!
    expect(noRoster.cells.every((c) => c.unknown === 'no roster players imported')).toBe(true)
  })
})

describe('distribution', () => {
  it('buckets by dimension, biggest first, and names a missing rulebook', () => {
    const base = insights({
      leagues: [league({ id: 'a', scoring: 'ppr' }), league({ id: 'b', scoring: null }), league({ id: 'c', scoring: 'ppr' })],
    })
    expect(distribution(base, [0, 1, 2], 'scoring')).toEqual([
      { key: 'ppr', count: 2, indexes: [0, 2] },
      { key: 'unknown', count: 1, indexes: [1] },
    ])
  })
})

describe('diversification', () => {
  const base = insights({
    leagues: [league({ id: 'a' }), league({ id: 'b' }), league({ id: 'c' }), league({ id: 'n', sport: 'NBA' })],
    byeWeeks: [7],
    players: [
      // on three rosters, starts in two — a player event
      player({ id: '1', team: 'KC', byeWeek: 7, held: [[0, 'S'], [1, 'S'], [2, 'B']] }),
      // KC starter in league 0 only; KC club event reaches leagues 0 and 1
      player({ id: '2', team: 'KC', byeWeek: 7, held: [[0, 'S']] }),
      // benched KC player must NOT count toward the club event
      player({ id: '3', team: 'KC', held: [[2, 'B']] }),
      player({ id: '4', team: 'BUF', held: [[2, 'S']] }),
      player({ id: '9', sport: 'NBA', key: 'NBA:9', team: 'BOS', held: [[3, 'S']] }),
    ],
  })

  it('ranks player, club and bye events by lineups reached', () => {
    const v = diversification(base, [0, 1, 2, 3])
    expect(v.events.map((e) => [e.kind, e.label, e.lineups, e.starters])).toEqual([
      ['player', 'Player 1', 3, 2],
      ['team', 'KC', 2, 3],
    ])
  })

  it('🛑 counts only starters for a club event', () => {
    const kc = diversification(base, [0, 1, 2]).events.find((e) => e.kind === 'team')!
    expect(kc.indexes.sort()).toEqual([0, 1])
    expect(kc.players).not.toContain('NFL:3')
  })

  it('🛑 a bye only counts where it takes two or more starters at once', () => {
    const v = diversification(base, [0, 1, 2])
    expect(v.events.some((e) => e.kind === 'bye')).toBe(false)
    const heavy = insights({
      ...base,
      players: [
        ...base.players,
        player({ id: '5', team: 'DAL', byeWeek: 7, held: [[1, 'S']] }),
      ],
    })
    const bye = diversification(heavy, [0, 1, 2]).events.find((e) => e.kind === 'bye')!
    expect(bye.lineups).toBe(2)
    expect(bye.starters).toBe(4)
  })

  it('states the top club’s share of starting slots, NFL only', () => {
    const v = diversification(base, [0, 1, 2, 3])
    expect(v.starterSlots).toBe(4)
    expect(v.topTeam).toBe('KC')
    expect(v.topTeamShare).toBe(0.75)
    expect(v.lineups).toBe(3)
  })
})

describe('value movement', () => {
  const base = insights({
    leagues: [league({ id: 'a' }), league({ id: 'b' })],
    valueDates: ['2026-09-01', '2026-09-02', '2026-09-03'],
    valueSeries: [
      { leagueIndex: 0, values: [100, 110, 120], priced: [10, 10, 10], rosterSize: 10 },
      { leagueIndex: 1, values: [null, 200, 180], priced: [null, 12, 12], rosterSize: 12 },
    ],
  })

  it('sums the reconstruction and marks it estimated', () => {
    expect(valueTotals(base, [0, 1])).toEqual([
      { date: '2026-09-01', total: 100, estimated: true, leagues: 1 },
      { date: '2026-09-02', total: 310, estimated: true, leagues: 2 },
      { date: '2026-09-03', total: 300, estimated: true, leagues: 2 },
    ])
  })

  it('🛑 a recorded day wins, and a league missing from it falls back AND marks the day estimated', () => {
    const recorded = [
      { date: '2026-09-02', values: { a: 111, b: 205 } },
      { date: '2026-09-03', values: { a: 125 } },
      { date: '2026-08-30', values: { a: 90 } },
    ]
    const pts = valueTotals(base, [0, 1], recorded)
    expect(pts.map((p) => p.date)).toEqual(['2026-08-30', '2026-09-01', '2026-09-02', '2026-09-03'])
    expect(pts[0]).toEqual({ date: '2026-08-30', total: 90, estimated: false, leagues: 1 })
    expect(pts[2]).toEqual({ date: '2026-09-02', total: 316, estimated: false, leagues: 2 })
    expect(pts[3]).toEqual({ date: '2026-09-03', total: 305, estimated: true, leagues: 2 })
  })

  it('never reads another league’s recorded value through a filter', () => {
    const pts = valueTotals(base, [0], [{ date: '2026-09-02', values: { b: 999 } }])
    expect(pts.find((p) => p.date === '2026-09-02')!.total).toBe(110)
  })

  it('opens one day into each league’s move, with the same stored-beats-rebuilt rule as the total', () => {
    const recorded = [{ date: '2026-09-02', values: { a: 111 } }]
    const moves = leagueMovesOn(base, [0, 1], recorded, '2026-09-03')
    expect(moves).toEqual([
      { index: 1, value: 180, previous: 200, delta: -20, estimated: true },
      { index: 0, value: 120, previous: 111, delta: 9, estimated: true },
    ])
    const first = leagueMovesOn(base, [0, 1], [], '2026-09-01')
    expect(first).toEqual([{ index: 0, value: 100, previous: null, delta: null, estimated: true }])
    expect(leagueMovesOn(base, [0, 1], [], '2026-01-01')).toEqual([])
    // Sums to the clicked point.
    const total = valueTotals(base, [0, 1], recorded).find((p) => p.date === '2026-09-03')!.total
    expect(moves.reduce((s2, m) => s2 + m.value, 0)).toBe(total)
  })

  it('lists leagues by the size of their move, first to last priced day', () => {
    expect(leagueValueChanges(base, [0, 1])).toEqual([
      { index: 0, first: 100, last: 120, delta: 20, pct: 0.2 },
      { index: 1, first: 200, last: 180, delta: -20, pct: -0.1 },
    ])
  })
})

describe('action ranking', () => {
  const base = insights({
    leagues: [
      league({ id: 'quiet' }),
      league({ id: 'lineup' }),
      league({ id: 'fav' }),
      league({ id: 'done', stage: 'complete' }),
      league({ id: 'draft', stage: 'drafting' }),
      league({ id: 'thin', status: 'contender' }),
    ],
    risk: [
      risk({ leagueIndex: 0, fragile: [] }),
      risk({ leagueIndex: 1, byes: { '3': ['NFL:1'] }, atRisk: ['NFL:2'] }),
      risk({ leagueIndex: 2, out: ['NFL:4'] }),
      risk({ leagueIndex: 3, out: ['NFL:5'] }),
      risk({ leagueIndex: 4 }),
      risk({ leagueIndex: 5, fragile: [{ position: 'RB', starters: 2, healthy: 2, players: [] }] }),
    ],
    players: [
      player({ id: 'faller', value: 2000, valueDelta: -600, held: [[5, 'B']] }),
      // A stash below the key-player line falling hard is noise, not a trade reason.
      player({ id: 'stash', value: 300, valueDelta: -500, held: [[5, 'B'], [1, 'B']] }),
      // A key player drifting 5% is not a move.
      player({ id: 'drift', value: 5000, valueDelta: -250, held: [[5, 'S']] }),
    ],
  })

  it('skips quiet and finished leagues, and ranks the rest', () => {
    const items = rankActions(base, [0, 1, 2, 3, 4, 5], { lineup: { empty: 1, hurt: 0, drafting: false } }, NO_EXTRAS)
    const ids = items.map((i) => base.leagues[i.index].id)
    expect(ids).not.toContain('quiet')
    expect(ids).not.toContain('done')
    expect(ids[0]).toBe('draft')
  })

  it('🛑 uses the home’s lineup counts when it has them, and our own out count only when it does not', () => {
    const withHome = rankActions(base, [2], { fav: { empty: 0, hurt: 0, drafting: false } }, NO_EXTRAS)
    expect(withHome).toEqual([])
    const without = rankActions(base, [2], {}, NO_EXTRAS)
    expect(without[0].reasons[0].text).toBe('1 starter ruled out')
  })

  it('counts this week’s byes only in season, and links each league to the screen that fixes its top problem', () => {
    const [item] = rankActions(base, [1], { lineup: { empty: 1, hurt: 0, drafting: false } }, NO_EXTRAS)
    expect(item.primary).toBe('lineup')
    expect(item.href).toBe('/core/my-team?league=lineup')
    expect(item.reasons.map((r) => r.text)).toEqual(['1 empty starting slot', '1 starter on bye this week', '1 starter questionable'])
    const pre = rankActions({ ...base, nflWeek: { season: 2026, week: 1, preseason: true } }, [1], {}, NO_EXTRAS)
    expect(pre[0].reasons.map((r) => r.text)).toEqual(['1 starter questionable'])
  })

  it('flags thin rosters for waivers and a 10% value fall for trades; a tie goes to the more urgent kind', () => {
    const [item] = rankActions(base, [5], {}, NO_EXTRAS)
    expect(item.reasons.map((r) => r.kind).sort()).toEqual(['trade', 'trade', 'waiver'])
    expect(item.reasons.map((r) => r.text)).toContain(`1 key player down ${KEY_FALL * 100}%+ in value`)
    expect(KEY_PLAYER_VALUE).toBeGreaterThan(300)
    // waiver 2 vs trade 1 + 1 — equal, and waivers were added first (lineup > draft > waiver > trade).
    expect(item.primary).toBe('waiver')
    expect(item.href).toBe('/core/waivers?league=thin')
  })

  it('🛑 never flags thin spots or depth trades while a league is still drafting', () => {
    const pre = { ...base, leagues: base.leagues.map((l, i) => (i === 5 ? { ...l, stage: 'pre_draft' as const } : l)) }
    const [item] = rankActions(pre, [5], {}, NO_EXTRAS)
    expect(item.reasons.map((r) => r.kind)).toEqual(['draft', 'trade'])
    expect(item.reasons.some((r) => /backup|thin/.test(r.text))).toBe(false)
  })

  it('caps a value slide below a single lineup hole, and counts only deadline items as urgent', () => {
    const many = {
      ...base,
      players: Array.from({ length: 9 }, (_, n) => player({ id: `f${n}`, value: 4000, valueDelta: -1000, held: [[0, 'B']] })),
    }
    const [slide] = rankActions(many, [0], {}, NO_EXTRAS)
    expect(slide.score).toBe(3)
    expect(isUrgent(slide)).toBe(false)
    const [hole] = rankActions(base, [1], { lineup: { empty: 1, hurt: 0, drafting: false } }, NO_EXTRAS)
    expect(hole.score).toBeGreaterThan(slide.score)
    expect(isUrgent(hole)).toBe(true)
  })

  it('🛑 importance multiplies existing work and never creates it', () => {
    const plain = rankActions(base, [2], {}, NO_EXTRAS)[0].score
    const starred = rankActions(base, [2], {}, { favoriteIds: ['fav'], paidIds: ['fav'] })[0].score
    expect(starred).toBeCloseTo(plain * 1.5 * 1.3, 0)
    expect(starred).toBeGreaterThan(plain)
    expect(rankActions(base, [0], {}, { favoriteIds: ['quiet'], paidIds: [] })).toEqual([])
  })
})
