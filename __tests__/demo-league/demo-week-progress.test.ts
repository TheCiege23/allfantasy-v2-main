/**
 * The mid-Sunday week. Every team has SOME points the moment the early games kick off, and the
 * next week's rows already exist at 0–0, so "every team has points" read the week being played as
 * finished: the live demo counted half-played games as wins and losses, showed the NEXT week as
 * "upcoming", and fed those partial totals to Chimmy as recent form (measured 2026-11-15).
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/core-app/finishedNflWeeks', () => ({
  finishedWeekKey: (s: number, w: number) => `${s}:${w}`,
  loadFinishedNflWeeks: vi.fn(async () => new Set<string>()),
}))

import { buildDemoLeagueView } from '@/lib/demo-league/view'
import { findInProgressNflWeek, type InProgressWeekDeps } from '@/lib/demo-league/inProgressWeek'
import { lastScoredWeek, makeWeekIsFinished } from '@/lib/demo-league/weekProgress'
import type { SourceSnapshot } from '@/lib/demo-league/source'

/**
 * Four teams. Weeks 1–3 are played; team 1 beats team 2 and team 3 beats team 4 every week.
 * Week 4 is MID-PLAY: everyone has a small partial total, and team 2 leads team 1 so far.
 * Week 5's rows exist at 0–0, as Sleeper writes them.
 */
function source(inProgressWeek?: number | null): SourceSnapshot {
  const teams = [1, 2, 3, 4].map((n) => ({
    key: `t${n}`, externalId: String(n), ownerName: `Owner ${n}`, teamName: `Team ${n}`, avatarUrl: null,
    platformUserId: null, claimedByUserId: null, wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0,
    currentRank: null, isOrphan: false,
  }))
  const weekRows: SourceSnapshot['weekRows'] = []
  const game = (week: number, a: number, b: number, pa: number, pb: number, matchupId: number) => {
    weekRows.push({ seasonYear: 2026, week, rosterId: String(a), matchupId, pointsFor: pa, pointsAgainst: pb, win: pa > pb ? 1 : 0 })
    weekRows.push({ seasonYear: 2026, week, rosterId: String(b), matchupId, pointsFor: pb, pointsAgainst: pa, win: pb > pa ? 1 : 0 })
  }
  for (const w of [1, 2, 3]) { game(w, 1, 2, 130, 110, 1); game(w, 3, 4, 125, 100, 2) }
  game(4, 1, 2, 21.5, 38.2, 1); game(4, 3, 4, 12.1, 30.4, 2)
  game(5, 1, 3, 0, 0, 1); game(5, 2, 4, 0, 0, 2)
  return {
    league: { id: 'l', name: 'Real League', platform: 'sleeper', platformLeagueId: 'pid', sport: 'NFL', season: 2026 },
    teams, users: [], weekRows, inProgressWeek, rosters: [], trades: [], openAlertHeadlines: [], tradeCountThisSeason: 0,
  } as unknown as SourceSnapshot
}
const viewOf = (src: SourceSnapshot) => buildDemoLeagueView(src, new Map(src.teams.map((t, i) => [t.key, i]))).view

describe('the finished-week rule', () => {
  it('the latest week where every team has points is the only one that can be mid-play', () => {
    expect(lastScoredWeek(source().weekRows)).toBe(4)
    const done = makeWeekIsFinished(source().weekRows, 4)
    expect([1, 2, 3, 4, 5].map(done)).toEqual([true, true, true, false, false])
  })
})

describe('the demo view, mid-Sunday', () => {
  it('BEFORE (no schedule signal): the half-played week counts — the bug, kept as a control', () => {
    const v = viewOf(source(null))
    expect(v.standings.find((s) => s.slot === 1)).toMatchObject({ wins: 3, losses: 1 })
    expect(v.weeklyScores.map((w) => w.week)).toEqual([1, 2, 3, 4])
    expect(v.matchups.every((m) => m.status === 'upcoming')).toBe(true)
  })

  it('AFTER: the week being played is left out of the record, out of recent form, and shown as live', () => {
    const v = viewOf(source(4))
    expect(v.standings.find((s) => s.slot === 1)).toMatchObject({ wins: 3, losses: 0, pointsFor: 390 })
    expect(v.standings.find((s) => s.slot === 2)).toMatchObject({ wins: 0, losses: 3 })
    expect(v.weeklyScores.map((w) => w.week)).toEqual([1, 2, 3])
    expect(v.matchups.length).toBeGreaterThan(0)
    expect(v.matchups.every((m) => m.status === 'live')).toBe(true)
  })
})

describe('findInProgressNflWeek: what the schedule says', () => {
  const rows = source().weekRows
  const deps = (over: Partial<InProgressWeekDeps>): InProgressWeekDeps => ({
    weekFinal: async () => false, regularGames: async () => 14, ...over,
  })

  it('a week with games still going is in progress', async () => {
    expect(await findInProgressNflWeek('NFL', 2026, rows, deps({}))).toBe(4)
  })
  it('once every game is final, nothing is held back', async () => {
    expect(await findInProgressNflWeek('NFL', 2026, rows, deps({ weekFinal: async () => true }))).toBeNull()
  })
  it('no schedule rows for that week means "cannot tell" — never freeze the demo a week behind', async () => {
    expect(await findInProgressNflWeek('NFL', 2026, rows, deps({ regularGames: async () => 0 }))).toBeNull()
  })
  it('asks about the season and week the league is on', async () => {
    const weekFinal = vi.fn(async () => false)
    await findInProgressNflWeek('nfl', 2026, rows, deps({ weekFinal }))
    expect(weekFinal).toHaveBeenCalledWith(2026, 4)
  })
  it('other sports and empty leagues are left to the scores rule', async () => {
    expect(await findInProgressNflWeek('NBA', 2026, rows, deps({}))).toBeNull()
    expect(await findInProgressNflWeek('NFL', null, rows, deps({}))).toBeNull()
    expect(await findInProgressNflWeek('NFL', 2026, [], deps({}))).toBeNull()
  })
})
