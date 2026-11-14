import { describe, expect, it } from 'vitest'
import {
  backtestKey,
  buildIdSpaces,
  chooseIdSpace,
  completedThroughWeek,
  firstUnplayedWeek,
  gameRowsToWeekly,
  isManagerPick,
  isReplayablePick,
  recordedToReplayRows,
  marketWithProjections,
  parseAdpCsv,
  preDraftProjections,
  weekKickoff,
  weeklyByKey,
  windowPoints,
  type ProjectionRow,
} from '@/lib/shared-services/draft/backtest/backtestInputs'

/*
 * Draft backtest inputs (2026-11-14). The pieces that decide whether the backtest is honest: names meet
 * on one key, an id space is MEASURED rather than assumed, a projection written after its cutoff is
 * rejected, and an unseen player is "unknown", never a zero.
 */

describe('parseAdpCsv', () => {
  it('reads the Sleeper column, canonicalises names, and drops non-market positions and blanks', () => {
    const csv = [
      ',,,,,,',
      'Rank,Name,Team,Pos,Fantrax,Sleeper,ESPN',
      "1,Ja'Marr Chase,CIN,WR,1.1,1.8,1",
      '2,A.J. Brown,PHI,WR,9,12.5,9',
      '3,Some Defense,DAL,DST,90,80,90',
      '4,No Adp,NYJ,RB,10,,10',
    ].join('\n')
    const m = parseAdpCsv(csv)
    expect(m.map((p) => [p.name, p.position, p.adp])).toEqual([
      ['jamarr chase', 'WR', 1.8],
      ['aj brown', 'WR', 12.5],
    ])
  })
})

describe('id spaces', () => {
  const rows = [
    { id: 'u1', externalId: '100', sleeperId: '4866', source: 'espn', name: 'Saquon Barkley', position: 'RB' },
    { id: 'u2', externalId: '200', sleeperId: '6794', source: 'espn', name: 'Justin Jefferson', position: 'WR' },
    // An ESPN id equal to another player's id in another source is a collision, never pooled.
    { id: 'u3', externalId: '4866', sleeperId: null, source: 'other', name: 'Someone Else', position: 'TE' },
  ]
  const spaces = buildIdSpaces(rows)

  it('keeps sources apart and picks the space that places the most ids, reporting all of them', () => {
    const choice = chooseIdSpace(spaces, ['4866', '6794', '4866', 'zzz'])
    expect(choice.space?.name).toBe('sleeperId')
    expect(choice).toMatchObject({ matched: 2, total: 3 })
    expect(choice.rates.find((r) => r.name === 'externalId:other')?.matched).toBe(1)
  })

  it('drops an id that names two players within one space', () => {
    const dup = buildIdSpaces([
      { id: 'a', externalId: null, sleeperId: '1', source: 's', name: 'X One', position: 'RB' },
      { id: 'b', externalId: null, sleeperId: '1', source: 's', name: 'Y Two', position: 'WR' },
    ]).find((s) => s.name === 'sleeperId')!
    expect(dup.byId.has('1')).toBe(false)
    expect(dup.conflicts).toBe(1)
  })

  it('places nothing when no space matches', () => {
    expect(chooseIdSpace(spaces, ['nope']).space).toBeNull()
  })
})

describe('outcomes', () => {
  const space = buildIdSpaces([
    { id: 'u1', externalId: null, sleeperId: '1', source: 's', name: 'Saquon Barkley', position: 'RB' },
    { id: 'u2', externalId: null, sleeperId: '2', source: 's', name: 'Justin Jefferson', position: 'WR' },
  ]).find((s) => s.name === 'sleeperId')!

  it('sums the window, never doubles a duplicate week, and counts what it could not place', () => {
    const { byKey, unmatchedRows } = weeklyByKey(
      [
        { playerId: '1', week: 1, fantasyPts: 20 },
        { playerId: '1', week: 2, fantasyPts: 10 },
        { playerId: '1', week: 2, fantasyPts: 10 },
        { playerId: '1', week: 5, fantasyPts: 99 },
        { playerId: '2', week: 1, fantasyPts: 0 },
        { playerId: '9', week: 1, fantasyPts: 30 },
      ],
      space,
    )
    expect(unmatchedRows).toBe(1)
    const pts = windowPoints(byKey, 1, 4)
    expect(pts.get(backtestKey('Saquon Barkley', 'RB'))).toBe(30)
    // Seen, scored 0 in the window: a real zero.
    expect(pts.get(backtestKey('Justin Jefferson', 'WR'))).toBe(0)
    // Never seen: absent, so the replay reads "unknown".
    expect(pts.has(backtestKey('Nobody', 'RB'))).toBe(false)
  })
})

describe('weeks and kickoffs', () => {
  const opener = new Date('2026-09-10T00:00:00Z')
  it('judges from the first week that had not kicked off when the draft began', () => {
    expect(firstUnplayedWeek(opener, new Date('2026-08-25T00:00:00Z'))).toBe(1)
    expect(firstUnplayedWeek(opener, new Date('2026-09-10T01:00:00Z'))).toBe(2)
    expect(weekKickoff(opener, 10).toISOString().slice(0, 10)).toBe('2026-11-12')
    expect(firstUnplayedWeek(opener, new Date('2027-02-01T00:00:00Z'))).toBeNull()
  })
})

describe('preDraftProjections', () => {
  const space = buildIdSpaces([{ id: 'u1', externalId: null, sleeperId: '1', source: 's', name: 'Saquon Barkley', position: 'RB' }]).find(
    (s) => s.name === 'sleeperId',
  )!
  const row = (over: Partial<ProjectionRow>): ProjectionRow => ({
    playerId: '1',
    week: 1,
    projectedPoints: 18,
    fetchedAt: new Date('2026-09-08T00:00:00Z'),
    source: 'allfantasy',
    stats: {},
    ...over,
  })
  const cutoff = new Date('2026-09-10T00:00:00Z')

  it('rejects a line written at or after the cutoff — never uses its newer value', () => {
    const r = preDraftProjections({ rows: [row({ fetchedAt: cutoff })], week: 1, cutoff, space })
    expect(r).toMatchObject({ usable: 0, leaked: 1 })
    expect(r.byKey.size).toBe(0)
  })

  it('scales a pre-cutoff weekly line to a season, ignores other weeks, and falls back to the stats name', () => {
    const r = preDraftProjections({
      rows: [row({}), row({ week: 2, projectedPoints: 50 }), row({ playerId: 'x', stats: { name: 'A.J. Brown', position: 'WR' }, projectedPoints: 15 }), row({ playerId: 'y' })],
      week: 1,
      cutoff,
      space,
    })
    expect(r.byKey.get(backtestKey('Saquon Barkley', 'RB'))).toBe(306)
    expect(r.byKey.get(backtestKey('aj brown', 'WR'))).toBe(255)
    expect(r).toMatchObject({ usable: 2, leaked: 0, unmatched: 1 })
  })

  it('attaches to the market by the same key', () => {
    const m = marketWithProjections(
      [
        { name: 'saquon barkley', position: 'RB', adp: 3 },
        { name: 'aj brown', position: 'WR', adp: 12 },
      ],
      new Map([[backtestKey('Saquon Barkley', 'RB'), 306]]),
    )
    expect(m.map((p) => p.projectedPoints)).toEqual([306, null])
  })
})

describe('script fixes (2026-11-14, after the first production run)', () => {
  const opener = new Date('2026-09-10T00:00:00Z')

  it('judges only weeks whose Monday night has passed', () => {
    // Saturday 14 Nov: week 10 kicked off Thursday the 12th and is not over; week 9 is.
    expect(completedThroughWeek(opener, new Date('2026-11-14T21:00:00Z'))).toBe(9)
    expect(completedThroughWeek(opener, new Date('2026-09-14T00:00:00Z'))).toBe(0)
  })

  it('counts Sleeper and imported picks as the manager’s own, and never a timer, commissioner or keeper', () => {
    // The first run found 0 manager picks: mirrored drafts write `sleeper`, which a `user`-only test missed.
    for (const s of ['user', 'sleeper', 'import', null]) expect(isManagerPick(s)).toBe(true)
    for (const s of ['auto', 'commissioner', 'keeper', 'devy']) expect(isManagerPick(s)).toBe(false)
    expect(isReplayablePick('keeper')).toBe(false)
    expect(isReplayablePick('sleeper')).toBe(true)
  })

  it('drops never-scored box scores instead of reading their 0 as points, and sums a week', () => {
    const { rows, unscored } = gameRowsToWeekly([
      { playerId: '1', weekOrRound: 3, fantasyPoints: 0, normalizedStatMap: { scored: false } },
      { playerId: '1', weekOrRound: 4, fantasyPoints: 12, normalizedStatMap: {} },
      { playerId: '1', weekOrRound: 4, fantasyPoints: 3, normalizedStatMap: { scored: true } },
    ])
    expect(unscored).toBe(1)
    expect(rows).toEqual([{ playerId: '1', week: 4, fantasyPts: 15 }])
  })

  it('scores recorded picks from the first unplayed week, and holds back ones with nothing played yet', () => {
    const space = buildIdSpaces([
      { id: 'a', externalId: null, sleeperId: '1', source: 's', name: 'Saquon Barkley', position: 'RB' },
      { id: 'b', externalId: null, sleeperId: '2', source: 's', name: 'Justin Jefferson', position: 'WR' },
    ]).find((s) => s.name === 'sleeperId')!
    const { byKey } = weeklyByKey(
      [
        { playerId: '1', week: 1, fantasyPts: 50 },
        { playerId: '1', week: 2, fantasyPts: 10 },
        { playerId: '2', week: 2, fantasyPts: 20 },
      ],
      space,
    )
    const rec = (createdAt: string) => ({
      createdAt: new Date(createdAt),
      round: 3,
      overallPick: 30,
      observeName: 'Saquon Barkley',
      observePosition: 'RB',
      activeName: 'Justin Jefferson',
      activePosition: 'WR',
    })
    const { rows, pending } = recordedToReplayRows({
      records: [rec('2026-09-12T00:00:00Z'), rec('2026-11-13T00:00:00Z')],
      byKey,
      seasonOpener: opener,
      throughWeek: 2,
    })
    expect(pending).toBe(1)
    // Recorded after week 1 kicked off: week 1's 50 points are NOT counted for anyone.
    expect(rows[0]!.byMode.observe).toEqual({ name: 'saquon barkley', points: 10 })
    expect(rows[0]!.byMode.active).toEqual({ name: 'justin jefferson', points: 20 })
  })
})
