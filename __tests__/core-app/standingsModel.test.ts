import { describe, expect, it } from 'vitest'

import {
  advanceWeek,
  buildStandingsBoard,
  byesForField,
  chainStamps,
  explainOrder,
  isWeekSnapshot,
  readPlayoffTeams,
  readStandingsRules,
  weekStamp,
  type RemainingGame,
  type ReportedRecord,
  type StandingsRules,
  type TeamMeta,
  type WeekRow,
  type WeekSnapshot,
} from '@/lib/core-app/standingsModel'
import { readPlayoffFormat } from '@/lib/core-app/outlookFormat'
import {
  parseStandingsDivisions,
  readEspnDivisions,
  readSleeperDivisions,
} from '@/lib/league-import/standingsDivisions'

/*
 * The standings maths, pinned against the cases production actually has (2026-09-17): unpaired
 * leagues whose `win` column says everyone won, Sleeper's median game, a live week the platform has
 * not finalised, and the playoff line.
 */

const RULES: StandingsRules = {
  playoffTeams: 2,
  playoffTeamsSource: 'league',
  byes: 0,
  regularSeasonEnd: null,
  tiebreakers: ['points_for', 'head_to_head'],
  tiebreakerSource: 'platform',
  rankIsOfficial: false,
  platformLabel: 'Sleeper',
}

function game(week: number, matchupId: number | null, a: [string, number], b?: [string, number]): WeekRow[] {
  const rows: WeekRow[] = [
    { week, rosterId: a[0], matchupId, pointsFor: a[1], pointsAgainst: b ? b[1] : 0 },
  ]
  if (b) rows.push({ week, rosterId: b[0], matchupId, pointsFor: b[1], pointsAgainst: a[1] })
  return rows
}

function fold(weeks: WeekRow[][], ids: string[]): WeekSnapshot[] {
  const out: WeekSnapshot[] = []
  weeks.forEach((rows, i) => out.push(advanceWeek(out[i - 1] ?? null, 2026, i + 1, rows, ids, `s${i + 1}`)))
  return out
}

function meta(id: string, reported: Partial<ReportedRecord> | null = null, extra: Partial<TeamMeta> = {}): TeamMeta {
  return {
    rosterId: id,
    name: `Team ${id.toUpperCase()}`,
    avatarUrl: null,
    isYou: id === 'a',
    division: null,
    reported: reported
      ? { wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: null, rank: null, ...reported }
      : null,
    ...extra,
  }
}

const IDS = ['a', 'b', 'c', 'd']

describe('advanceWeek — results come from pairs, not the win column', () => {
  it('pairs by matchupId and records a tie as a tie', () => {
    const [s] = fold([[...game(1, 1, ['a', 100], ['b', 90]), ...game(1, 2, ['c', 80], ['d', 80])]], IDS)
    const t = (id: string) => s.teams.find((x) => x.r === id)!
    expect([t('a').w, t('a').l, t('a').res, t('a').opp, t('a').pa]).toEqual([1, 0, 'W', 'b', 90])
    expect([t('b').w, t('b').l, t('b').res]).toEqual([0, 1, 'L'])
    expect([t('c').t, t('d').t, t('c').res]).toEqual([1, 1, 'T'])
  })

  it('gives an unpaired roster no result at all — the 15 production leagues that showed everyone 1-0', () => {
    const [s] = fold([[...game(1, 1, ['a', 100]), ...game(1, 2, ['b', 90]), ...game(1, 3, ['c', 80])]], ['a', 'b', 'c'])
    for (const t of s.teams) {
      expect(t.w + t.l + t.t).toBe(0)
      expect(t.res).toBeNull()
    }
    // …but it still has points and all-play.
    expect(s.teams.find((x) => x.r === 'a')!.apw).toBe(2)
  })

  it('counts all-play, expected wins and the median game against the week’s field', () => {
    const [s] = fold([[...game(1, 1, ['a', 100], ['b', 90]), ...game(1, 2, ['c', 80], ['d', 70])]], IDS)
    const t = (id: string) => s.teams.find((x) => x.r === id)!
    expect([t('a').apw, t('a').apl]).toEqual([3, 0])
    expect([t('c').apw, t('c').apl]).toEqual([1, 2])
    expect(t('c').xw).toBeCloseTo(1 / 3)
    // Top half of four: a and b win the median game even though b lost head-to-head.
    expect([t('a').mw, t('b').mw, t('c').ml, t('d').ml]).toEqual([1, 1, 1, 1])
  })

  it('carries a team that did not play forward, unscored', () => {
    const snaps = fold([game(1, 1, ['a', 100], ['b', 90]), game(2, 1, ['a', 50], ['c', 60])], ['a', 'b', 'c'])
    const b = snaps[1].teams.find((x) => x.r === 'b')!
    expect([b.pts, b.l, b.pf, b.n]).toEqual([null, 1, 90, 1])
  })
})

describe('snapshot integrity', () => {
  it('chains stamps so a corrected early week invalidates every later week', () => {
    const before = chainStamps(['w1', 'w2', 'w3'])
    const after = chainStamps(['w1x', 'w2', 'w3'])
    expect(after[0]).not.toBe(before[0])
    expect(after[2]).not.toBe(before[2])
    expect(chainStamps(['w1', 'w2', 'w3'])).toEqual(before)
  })

  it('stamps sums, so a no-op rewrite keeps the stamp and a stat correction does not', () => {
    const base = { rows: 12, scored: 12, pointsFor: 1400.12, pointsAgainst: 1400.12 }
    expect(weekStamp(base)).toBe(weekStamp({ ...base }))
    expect(weekStamp({ ...base, pointsFor: 1400.32 })).not.toBe(weekStamp(base))
  })

  it('rejects a stored row for another week, season or version', () => {
    const [s] = fold([game(1, 1, ['a', 1], ['b', 2])], ['a', 'b'])
    const json = JSON.parse(JSON.stringify(s))
    expect(isWeekSnapshot(json, 2026, 1)).toBe(true)
    expect(isWeekSnapshot(json, 2026, 2)).toBe(false)
    expect(isWeekSnapshot(json, 2025, 1)).toBe(false)
    expect(isWeekSnapshot({ ...json, v: 2 }, 2026, 1)).toBe(false)
    expect(isWeekSnapshot({ foo: 1 }, 2026, 1)).toBe(false)
  })
})

describe('official table', () => {
  const week1 = [...game(1, 1, ['a', 100], ['b', 90]), ...game(1, 2, ['c', 120], ['d', 70])]
  const week2 = [...game(2, 1, ['a', 95], ['c', 110]), ...game(2, 2, ['b', 105], ['d', 60])]

  it('orders by record, then points for, then head-to-head', () => {
    const board = buildStandingsBoard({
      season: 2026,
      snapshots: fold([week1, week2], IDS),
      unplayed: [],
      teams: IDS.map((id) => meta(id)),
      rules: RULES,
    })
    // c 2-0; a and b both 1-1 on 195 points, and a beat b in week one; d 0-2.
    expect(board.teams.map((t) => t.rosterId)).toEqual(['c', 'a', 'b', 'd'])
    expect(board.teams.find((t) => t.rosterId === 'a')!.record).toEqual({ wins: 1, losses: 1, ties: 0 })
    expect(board.teams[0].tiebreak).toBeNull()
  })

  it('uses head-to-head only when points are level too', () => {
    const board = buildStandingsBoard({
      season: 2026,
      snapshots: fold([week1, week2], IDS),
      unplayed: [],
      teams: IDS.map((id) => meta(id)),
      rules: RULES,
    })
    const order = board.teams.map((t) => t.rosterId)
    // a and b: both 1-1, both 195 points; a won the meeting in week one.
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'))
    const b = board.teams.find((t) => t.rosterId === 'b')!
    expect(b.tiebreak).toMatch(/head-to-head 1-0/)
  })

  it('says a points tiebreak is the platform’s rule only when it is', () => {
    const snaps = fold([[...game(1, 1, ['a', 100], ['b', 90]), ...game(1, 2, ['c', 95], ['d', 70])]], IDS)
    const sleeper = buildStandingsBoard({ season: 2026, snapshots: snaps, unplayed: [], teams: IDS.map((id) => meta(id)), rules: RULES })
    const c = sleeper.teams.find((t) => t.rosterId === 'c')!
    expect(c.tiebreak).toMatch(/Level at 1-0; Team A is ahead on points for \(100\.0 to 95\.0\), Sleeper's tiebreaker/)
    const espn = buildStandingsBoard({
      season: 2026,
      snapshots: snaps,
      unplayed: [],
      teams: IDS.map((id) => meta(id)),
      rules: { ...RULES, tiebreakerSource: 'assumed', platformLabel: 'ESPN' },
    })
    expect(espn.teams.find((t) => t.rosterId === 'c')!.tiebreak).toMatch(/the tiebreaker we assume/)
    expect(espn.orderBasis).toMatch(/assumed, because ESPN does not report/)
  })

  it('explains a record gap without inventing a tiebreaker', () => {
    const text = explainOrder(
      { rosterId: 'x', name: 'X', record: { wins: 3, losses: 1, ties: 0 }, pointsFor: 400, pointsAgainst: 0 },
      { rosterId: 'y', name: 'Y', record: { wins: 2, losses: 2, ties: 0 }, pointsFor: 500, pointsAgainst: 0 },
      { h2h: {}, hasHeadToHead: true, tiebreakers: ['points_for'], tiebreakerSource: 'platform', platformLabel: 'Sleeper', platformOrder: false },
    )
    expect(text).toBe('X has the better record (3-1 to 2-2) — no tiebreaker needed.')
  })

  it('tracks movement week over week', () => {
    const board = buildStandingsBoard({
      season: 2026,
      snapshots: fold([week1, week2], IDS),
      unplayed: [],
      teams: IDS.map((id) => meta(id)),
      rules: RULES,
    })
    expect(board.history.a.map((p) => p.seed)).toHaveLength(2)
    const a = board.teams.find((t) => t.rosterId === 'a')!
    expect(a.seedMove).toBe(board.history.a[0].seed - board.history.a[1].seed)
  })

  it('orders a league with no head-to-head games by points, with no records', () => {
    const snaps = fold([[...game(1, 1, ['a', 100]), ...game(1, 2, ['b', 120]), ...game(1, 3, ['c', 80])]], ['a', 'b', 'c'])
    const board = buildStandingsBoard({ season: 2026, snapshots: snaps, unplayed: [], teams: ['a', 'b', 'c'].map((id) => meta(id)), rules: RULES })
    expect(board.hasHeadToHead).toBe(false)
    expect(board.teams.map((t) => t.rosterId)).toEqual(['b', 'a', 'c'])
    expect(board.teams[0].record).toEqual({ wins: 0, losses: 0, ties: 0 })
    expect(board.teams[0].winPct).toBeNull()
    expect(board.recordBasis).toMatch(/no head-to-head games/)
  })
})

describe('checking against the platform', () => {
  const week1 = [...game(1, 1, ['a', 100], ['b', 90]), ...game(1, 2, ['c', 120], ['d', 70])]
  // Week two is live: one game has started.
  const week2Live = [...game(2, 1, ['a', 12], ['c', 30]), ...game(2, 2, ['b', 0], ['d', 0])]

  it('stops the table at the week the platform has finalised', () => {
    const board = buildStandingsBoard({
      season: 2026,
      snapshots: fold([week1, week2Live], IDS),
      unplayed: [{ week: 2, a: 'b', b: 'd' }],
      teams: [
        meta('a', { wins: 1 }),
        meta('b', { losses: 1 }),
        meta('c', { wins: 1 }),
        meta('d', { losses: 1 }),
      ],
      rules: RULES,
    })
    expect(board.platformCheck).toBe('platform-behind')
    expect(board.throughWeek).toBe(1)
    expect(board.pendingWeeks).toEqual([2])
    expect(board.teams.find((t) => t.rosterId === 'a')!.record).toEqual({ wins: 1, losses: 0, ties: 0 })
    // The live week's games are still ahead of everyone.
    expect(board.teams.every((t) => t.gamesLeft === 1)).toBe(true)
    expect(board.gamesRemaining).toBe(2)
    expect(board.settledThrough).toBe(1)
  })

  it('detects Sleeper’s median game from the reported records', () => {
    // b loses to a but still finishes in the top half; c beats d but does not.
    const medianWeek = [...game(1, 1, ['a', 130], ['b', 125]), ...game(1, 2, ['c', 90], ['d', 70])]
    const board = buildStandingsBoard({
      season: 2026,
      snapshots: fold([medianWeek], IDS),
      unplayed: [],
      teams: [
        meta('a', { wins: 2 }),
        meta('b', { wins: 1, losses: 1 }),
        meta('c', { wins: 1, losses: 1 }),
        meta('d', { losses: 2 }),
      ],
      rules: RULES,
    })
    expect(board.medianGames).toBe(true)
    expect(board.platformCheck).toBe('matches')
    expect(board.teams.find((t) => t.rosterId === 'b')!.record).toEqual({ wins: 1, losses: 1, ties: 0 })
    expect(board.recordBasis).toMatch(/including the weekly median game, and match Sleeper/)
  })

  it('falls back to the platform’s records when it counts games we cannot pair', () => {
    const board = buildStandingsBoard({
      season: 2026,
      snapshots: fold([week1], IDS),
      unplayed: [],
      teams: [
        meta('a', { wins: 3, pointsFor: 300 }),
        meta('b', { wins: 2, losses: 1, pointsFor: 200 }),
        meta('c', { wins: 1, losses: 2, pointsFor: 250 }),
        meta('d', { losses: 3, pointsFor: 100 }),
      ],
      rules: RULES,
    })
    expect(board.platformCheck).toBe('platform-used')
    expect(board.teams.map((t) => t.rosterId)).toEqual(['a', 'b', 'c', 'd'])
    expect(board.teams[0].record.wins).toBe(3)
  })

  it('never uses a stored rank the provider did not produce', () => {
    const teams = [
      meta('a', { wins: 3, pointsFor: 300, rank: 4 }),
      meta('b', { wins: 2, losses: 1, pointsFor: 200, rank: 3 }),
      meta('c', { wins: 1, losses: 2, pointsFor: 250, rank: 2 }),
      meta('d', { losses: 3, pointsFor: 100, rank: 1 }),
    ]
    const ours = buildStandingsBoard({ season: 2026, snapshots: fold([week1], IDS), unplayed: [], teams, rules: RULES })
    expect(ours.teams[0].rosterId).toBe('a')
    const yahoo = buildStandingsBoard({
      season: 2026,
      snapshots: fold([week1], IDS),
      unplayed: [],
      teams,
      rules: { ...RULES, rankIsOfficial: true, platformLabel: 'Yahoo' },
    })
    expect(yahoo.teams.map((t) => t.rosterId)).toEqual(['d', 'c', 'b', 'a'])
    expect(yahoo.orderBasis).toBe("Order is Yahoo's reported standings.")
  })
})

describe('playoff line', () => {
  it('reads byes off the bracket size', () => {
    expect([4, 6, 7, 8, 5].map(byesForField)).toEqual([0, 2, 1, 0, 3])
  })

  it('clinches and eliminates only when no remaining result can change it', () => {
    // Six teams, two playoff spots, one week left.
    const ids = ['a', 'b', 'c', 'd', 'e', 'f']
    const w = (week: number, pairs: Array<[string, number, string, number]>) =>
      pairs.flatMap(([x, xp, y, yp], i) => game(week, i + 1, [x, xp], [y, yp]))
    const snaps = fold(
      [
        w(1, [['a', 100, 'b', 90], ['c', 100, 'd', 90], ['e', 100, 'f', 90]]),
        w(2, [['a', 100, 'c', 90], ['b', 100, 'e', 90], ['d', 100, 'f', 90]]),
        w(3, [['a', 100, 'd', 90], ['b', 100, 'f', 90], ['c', 100, 'e', 90]]),
      ],
      ids,
    )
    // a 3-0, b 2-1, c 2-1, d 1-2, e 1-2, f 0-3. One week left.
    const unplayed: RemainingGame[] = [
      { week: 4, a: 'a', b: 'f' },
      { week: 4, a: 'b', b: 'c' },
      { week: 4, a: 'd', b: 'e' },
    ]
    const board = buildStandingsBoard({
      season: 2026,
      snapshots: snaps,
      unplayed,
      teams: ids.map((id) => meta(id)),
      rules: { ...RULES, playoffTeams: 2, byes: 0 },
    })
    const by = (id: string) => board.teams.find((t) => t.rosterId === id)!
    // a: at worst 3-1; only b or c (one of them) can reach 3 → clinched.
    expect(by('a').clinched).toBe('playoff')
    // f: at best 1-3 while a, b and c already have more → eliminated.
    expect(by('f').zone).toBe('eliminated')
    // d and e can reach 2-2 at best, and a plus the b/c winner finish on 3 in every outcome.
    expect(by('d').zone).toBe('eliminated')
    expect(by('e').zone).toBe('eliminated')
    // b and c play each other for the last spot: that is the bubble, and neither is settled.
    expect([by('b').zone, by('c').zone]).toEqual(['bubble', 'bubble'])
    expect([by('b').clinched, by('c').clinched]).toEqual([null, null])
  })

  it('does not clinch a team that enough rivals can still draw level with', () => {
    // a 2-0, b 1-1, c 1-1, d 0-2; two spots; last week is a-b and c-d.
    const snaps = fold(
      [
        [...game(1, 1, ['a', 100], ['b', 90]), ...game(1, 2, ['c', 100], ['d', 90])],
        [...game(2, 1, ['a', 100], ['c', 90]), ...game(2, 2, ['b', 100], ['d', 90])],
      ],
      IDS,
    )
    const board = buildStandingsBoard({
      season: 2026,
      snapshots: snaps,
      unplayed: [
        { week: 3, a: 'a', b: 'b' },
        { week: 3, a: 'c', b: 'd' },
      ],
      teams: IDS.map((id) => meta(id)),
      rules: RULES,
    })
    // If b beats a and c beats d, three teams sit on 2-1 and a can lose the points tiebreak.
    expect(board.teams.find((t) => t.rosterId === 'a')!.clinched).toBeNull()
    // d can still finish 1-2 level with b and c (a beats b, d beats c) and take second on points.
    expect(board.teams.find((t) => t.rosterId === 'd')!.zone).not.toBe('eliminated')
  })

  it('never claims a clinch with too many games left to enumerate', () => {
    const ids = ['a', 'b', 'c', 'd']
    const snaps = fold([[...game(1, 1, ['a', 100], ['b', 90]), ...game(1, 2, ['c', 120], ['d', 70])]], ids)
    const unplayed: RemainingGame[] = Array.from({ length: 20 }, (_, i) => ({ week: 2 + i, a: i % 2 ? 'a' : 'b', b: i % 2 ? 'c' : 'd' }))
    const board = buildStandingsBoard({ season: 2026, snapshots: snaps, unplayed, teams: ids.map((id) => meta(id)), rules: RULES })
    expect(board.teams.every((t) => t.clinched == null && t.zone !== 'eliminated')).toBe(true)
  })

  it('settles every position once the regular season is over', () => {
    const snaps = fold([[...game(1, 1, ['a', 100], ['b', 90]), ...game(1, 2, ['c', 120], ['d', 70])]], IDS)
    const board = buildStandingsBoard({ season: 2026, snapshots: snaps, unplayed: [], teams: IDS.map((id) => meta(id)), rules: RULES })
    expect(board.teams.slice(0, 2).map((t) => t.clinched)).toEqual(['playoff', 'playoff'])
    expect(board.teams.slice(2).map((t) => t.zone)).toEqual(['eliminated', 'eliminated'])
  })
})

describe('power, all-play and projections', () => {
  const ids = ['a', 'b', 'c', 'd']
  const weeks = [1, 2, 3, 4].map((wk) => [
    ...game(wk, 1, ['a', 130 + wk], ['b', 80 + wk]),
    ...game(wk, 2, ['c', 100 + wk], ['d', 90 + wk]),
  ])

  it('ranks power on all-play and reports luck against expected wins', () => {
    const board = buildStandingsBoard({ season: 2026, snapshots: fold(weeks, ids), unplayed: [], teams: ids.map((id) => meta(id)), rules: RULES })
    const by = (id: string) => board.teams.find((t) => t.rosterId === id)!
    expect(by('a').powerRank).toBe(1)
    expect(by('a').allPlay).toEqual({ wins: 12, losses: 0, ties: 0 })
    // d loses every week but outscores b every week: unlucky scheduling is visible.
    expect(by('d').allPlay.wins).toBe(4)
    expect(by('b').luck).toBeLessThanOrEqual(0)
    expect(by('d').expectedWins).toBeCloseTo(4 / 3)
    expect(by('d').luck).toBeCloseTo(-4 / 3)
    expect(board.powerBasis).toMatch(/not the league table/)
  })

  it('withholds projections before three final weeks and says why', () => {
    const board = buildStandingsBoard({
      season: 2026,
      snapshots: fold(weeks.slice(0, 2), ids),
      unplayed: [{ week: 3, a: 'a', b: 'c' }],
      teams: ids.map((id) => meta(id)),
      rules: RULES,
    })
    expect(board.teams.every((t) => t.projected == null)).toBe(true)
    expect(board.projectionWithheld).toMatch(/once 3 weeks are final — 2 are so far/)
  })

  it('projects whole-game records that add up, separate from the actual record', () => {
    const unplayed: RemainingGame[] = [
      { week: 5, a: 'a', b: 'd' },
      { week: 5, a: 'b', b: 'c' },
      { week: 6, a: 'a', b: 'c' },
      { week: 6, a: 'b', b: 'd' },
    ]
    const board = buildStandingsBoard({ season: 2026, snapshots: fold(weeks, ids), unplayed, teams: ids.map((id) => meta(id)), rules: RULES })
    const a = board.teams.find((t) => t.rosterId === 'a')!
    expect(a.record).toEqual({ wins: 4, losses: 0, ties: 0 })
    expect(a.projected).not.toBeNull()
    expect(a.projected!.wins + a.projected!.losses).toBe(6)
    expect(a.projected!.wins).toBe(6)
    expect(a.projected!.seed).toBe(1)
    expect(board.projectionWithheld).toBeNull()
    expect(board.projectionBasis).toMatch(/not results/)
  })
})

describe('divisions', () => {
  it('ranks within a division without losing the overall seed', () => {
    const snaps = fold([[...game(1, 1, ['a', 100], ['b', 90]), ...game(1, 2, ['c', 120], ['d', 70])]], IDS)
    const east = { key: '1', name: 'East' }
    const west = { key: '2', name: 'West' }
    const board = buildStandingsBoard({
      season: 2026,
      snapshots: snaps,
      unplayed: [],
      teams: [meta('a', null, { division: east }), meta('b', null, { division: east }), meta('c', null, { division: west }), meta('d', null, { division: west })],
      rules: RULES,
    })
    const by = (id: string) => board.teams.find((t) => t.rosterId === id)!
    expect(board.divisions).toEqual([east, west])
    expect([by('c').seed, by('c').divisionRank]).toEqual([1, 1])
    expect([by('d').seed, by('d').divisionRank]).toEqual([4, 2])
    expect([by('b').seed, by('b').divisionRank]).toEqual([3, 2])
  })

  it('reads Sleeper divisions from league metadata and roster settings', () => {
    const d = readSleeperDivisions(
      { settings: { divisions: 2 }, metadata: { division_1: 'Kings', division_2: 'Queens' } },
      [
        { roster_id: 1, settings: { division: 1 } },
        { roster_id: 2, settings: { division: 2 } },
        { roster_id: 3, settings: {} },
      ],
    )
    expect(d).toEqual({ source: 'sleeper', names: { '1': 'Kings', '2': 'Queens' }, teams: { '1': '1', '2': '2' } })
    expect(readSleeperDivisions({ settings: { divisions: 0 } }, [{ roster_id: 1, settings: { division: 1 } }])).toBeNull()
    expect(parseStandingsDivisions({ standings_divisions: d })).toEqual(d)
    expect(parseStandingsDivisions({ standings_divisions: null })).toBeNull()
    expect(parseStandingsDivisions({ standings_divisions: { names: 'x' } })).toBeNull()
  })

  it('ignores ESPN’s single “League Standings” division', () => {
    const one = readEspnDivisions({ scheduleSettings: { divisions: [{ id: 0, name: 'League Standings', size: 10 }] } }, [
      { teamId: '1', divisionId: '0' },
      { teamId: '2', divisionId: '0' },
    ])
    expect(one).toBeNull()
    const two = readEspnDivisions(
      { scheduleSettings: { divisions: [{ id: 0, name: 'East', size: 1 }, { id: 1, name: 'West', size: 1 }] } },
      [
        { teamId: '1', divisionId: '0' },
        { teamId: '2', divisionId: '1' },
      ],
    )
    expect(two).toEqual({ source: 'espn', names: { '0': 'East', '1': 'West' }, teams: { '1': '0', '2': '1' } })
  })
})

describe('rules', () => {
  it('reads the playoff field from the keys importers actually write', () => {
    expect(readPlayoffTeams({ playoffSettings: { playoffTeams: 8 } }, 12)).toEqual({ teams: 8, source: 'league' })
    expect(readPlayoffTeams({ playoff_teams: 4 }, 10)).toEqual({ teams: 4, source: 'league' })
    expect(readPlayoffTeams({}, 12)).toEqual({ teams: 6, source: 'assumed' })
    // A field larger than the league, or ESPN's 0, is not a field.
    expect(readPlayoffTeams({ playoff_team_count: 0 }, 12).source).toBe('assumed')
    expect(readPlayoffTeams({ playoff_teams: 14 }, 12).source).toBe('assumed')
  })

  it('treats Sleeper’s playoff_start_week 0 as unset', () => {
    expect(readStandingsRules({ playoffSettings: { playoffStartWeek: 15 } }, 12, 'sleeper').regularSeasonEnd).toBe(14)
    expect(readStandingsRules({ playoff_start_week: 0, regular_season_length: 13 }, 12, 'sleeper').regularSeasonEnd).toBe(13)
    expect(readStandingsRules({ playoff_start_week: 0 }, 12, 'sleeper').regularSeasonEnd).toBeNull()
  })

  it('reads the settings blocks the same way Season Outlook does (production shapes, 2026-09-17)', () => {
    // A manual 8-team league: the block says 4, the flat import default says 6. The runtime plays 4.
    expect(readPlayoffTeams({ playoffSettings: { playoffTeams: 4 }, playoff_team_count: 6 }, 8)).toEqual({ teams: 4, source: 'league' })
    // A manual league whose field lives only in `playoff_structure`.
    expect(readPlayoffTeams({ playoff_structure: { playoff_team_count: 8 } }, 12)).toEqual({ teams: 8, source: 'league' })
    // The ESPN 18-team league stores 0 first: the first number decides, and 0 is not a field.
    expect(readPlayoffTeams({ playoffSettings: { playoffTeams: 0 }, playoff_team_count: 0, playoff_structure: { playoff_team_count: 6 } }, 18)).toEqual({
      teams: 6,
      source: 'assumed',
    })
  })

  it('lets a stated bye count lower the bracket gap, never raise it', () => {
    const four = readStandingsRules({ playoffSettings: { playoffTeams: 4, first_round_byes: 2 } }, 8, 'manual')
    expect(four.byes).toBe(0)
    const six = readStandingsRules({ playoff_teams: 6, playoff_structure: { first_round_byes: 1 } }, 12, 'sleeper')
    expect(six.byes).toBe(1)
    expect(readStandingsRules({ playoff_teams: 6 }, 12, 'sleeper').byes).toBe(2)
  })

  it('finds the regular-season end inside the blocks before falling back to its length', () => {
    expect(readStandingsRules({ playoffSettings: { playoff_start_week: 15 }, regular_season_length: 18 }, 12, 'manual').regularSeasonEnd).toBe(14)
    expect(readStandingsRules({ playoff_structure: { playoff_start_week: 15 }, regular_season_length: 24 }, 12, 'manual').regularSeasonEnd).toBe(14)
    expect(readStandingsRules({ playoffSettings: { regularSeasonEndWeek: 13, playoffStartWeek: 15 } }, 12, 'manual').regularSeasonEnd).toBe(13)
    // ESPN states only a length.
    expect(readStandingsRules({ playoffSettings: { playoffTeams: 6 }, regular_season_length: 17 }, 12, 'espn').regularSeasonEnd).toBe(17)
  })

  it('knows Sleeper’s tiebreaker and assumes everyone else’s', () => {
    expect(readStandingsRules({}, 12, 'sleeper')).toMatchObject({ tiebreakerSource: 'platform', rankIsOfficial: false, byes: 2 })
    expect(readStandingsRules({}, 12, 'espn')).toMatchObject({ tiebreakerSource: 'assumed', rankIsOfficial: false })
    expect(readStandingsRules({}, 12, 'yahoo')).toMatchObject({ tiebreakerSource: 'assumed', rankIsOfficial: true })
  })
})

describe('one playoff-format rule for standings and Season Outlook', () => {
  /*
   * The standings board reads its playoff field, byes and regular-season end through Season Outlook's
   * `readPlayoffFormat`. Two screens printing "top N make it" and the odds for N must never disagree, so
   * this pins them together on the production shapes both files document.
   */
  const shapes: Array<[string, unknown, number]> = [
    ['sleeper, 8 of 16', { playoff_teams: 8, playoffSettings: { playoffTeams: 8, playoffStartWeek: 15 } }, 16],
    ['sleeper, start week 0', { playoff_teams: 6, playoff_start_week: 0, regular_season_length: 13 }, 12],
    ['manual 8-team, block 4 beside flat 6', { playoffSettings: { playoffTeams: 4, first_round_byes: 2 }, playoff_team_count: 6 }, 8],
    ['manual, playoff_structure only', { playoff_structure: { playoff_team_count: 6, first_round_byes: 1, playoff_start_week: 15 }, regular_season_length: 24 }, 12],
    ['espn 18-team, zeros first', { playoffSettings: { playoffTeams: 0 }, playoff_team_count: 0, playoff_structure: { playoff_team_count: 6 }, regular_season_length: 17 }, 18],
    ['espn, length only', { playoffSettings: { playoffTeams: 6 }, regular_season_length: 14 }, 10],
    ['native, explicit end week', { playoffSettings: { playoffTeams: 7, regularSeasonEndWeek: 13, playoffStartWeek: 15 } }, 12],
    ['nothing stated', {}, 12],
    ['not an object', null, 4],
  ]

  it.each(shapes)('%s', (_label, settings, teams) => {
    const format = readPlayoffFormat(settings, teams)
    const rules = readStandingsRules(settings, teams, 'sleeper')
    expect({ field: rules.playoffTeams, byes: rules.byes, end: rules.regularSeasonEnd }).toEqual({
      field: format.playoffTeams,
      byes: format.byeTeams,
      end: format.regularSeasonEndWeek,
    })
    expect(rules.playoffTeamsSource).toBe(format.playoffTeamsSource === 'league' ? 'league' : 'assumed')
  })
})
