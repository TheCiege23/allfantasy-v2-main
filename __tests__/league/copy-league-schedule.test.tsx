/**
 * Copy leagues, part 2 — the real NFL schedule (docs/league-page/COPY_LEAGUES_DESIGN.md §3–4).
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const db = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  games: [] as Array<{ homeTeam: string; awayTeam: string; week: number | null; seasonType: string | null; startTime: Date | null }>,
  rows: [] as Array<{ seasonId: string; week: number; type: string; homeRosterId: string; awayRosterId: string | null; isMedianMatchup: boolean; status: string }>,
  currentWeek: 1,
}))

vi.mock('@/lib/prisma', () => {
  const league = {
    findUnique: async () => ({ settings: db.settings }),
    update: async ({ data }: { data: { settings: Record<string, unknown> } }) => { db.settings = data.settings; return {} },
  }
  const redraftMatchup = {
    deleteMany: async ({ where }: { where: { week: number } }) => { db.rows = db.rows.filter((r) => r.week !== where.week); return { count: 0 } },
    createMany: async ({ data }: { data: typeof db.rows }) => { db.rows.push(...data); return { count: data.length } },
  }
  const tx = { league, redraftMatchup }
  return {
    prisma: {
      redraftSeason: {
        findUnique: async () => ({
          id: 'S1', leagueId: 'L1', sport: 'NFL', season: 2026, currentWeek: db.currentWeek, playoffStartWeek: 15,
          rosters: ['r1', 'r2', 'r3', 'r4', 'r5'].map((id) => ({ id })),
          schedule: db.rows.map((r) => ({ week: r.week, status: r.status, homeScore: 0, awayScore: 0 })),
          league: { settings: db.settings, sport: 'NFL' },
        }),
      },
      leagueTeam: { findMany: async () => ['1', '2', '3', '4', '5'].map((n) => ({ id: `t${n}`, externalId: `x${n}` })) },
      roster: { findMany: async () => ['1', '2', '3', '4', '5'].map((n) => ({ id: `x${n}`, redraftRosterId: `r${n}` })) },
      sportsGame: { findMany: async () => db.games },
      league,
      $transaction: async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx),
    },
  }
})
vi.mock('@/server/services/auditService', () => ({ logAction: async () => ({}) }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useLanguage: () => ({ t: (k: string) => k, language: 'en' }) }))

import { nflDivisionOf, pairWeek, planRealSchedule, realWeeksFromGames, weekIsLoaded, type GameRow } from '@/lib/league/copyLeagueSchedule'
import { applyRealSchedule, previewRealSchedule } from '@/lib/league/copyLeagueScheduleService'
import { readCopyLeague, withCopyLeague } from '@/lib/league/copyLeague'
import { readCustomWeeks } from '@/lib/schedule-runtime/customWeeks'
import { ScheduleToolsCard, weekRanges } from '@/components/league-settings/ScheduleToolsCard'

// A real-looking 2026 week: 16 games, Thursday night to Monday night (US Eastern).
const WEEK_PAIRS: Array<[string, string]> = [
  ['KC', 'BUF'], ['PHI', 'DAL'], ['SF', 'SEA'], ['DET', 'GB'], ['BAL', 'PIT'], ['CIN', 'CLE'], ['MIA', 'NYJ'], ['NE', 'HOU'],
  ['IND', 'TEN'], ['JAX', 'DEN'], ['LV', 'LAC'], ['NYG', 'WAS'], ['CHI', 'MIN'], ['ATL', 'NO'], ['CAR', 'TB'], ['ARI', 'LAR'],
]
const at = (iso: string) => new Date(iso)
function riWeek(thursdayEt: string): GameRow[] {
  // Thu 8:20pm, Sun 1pm ×13, Sun 8:20pm, Mon 8:15pm — all US Eastern.
  const [y, m, d] = thursdayEt.split('-').map(Number) as [number, number, number]
  const day = (offset: number, time: string) => {
    const dt = new Date(Date.UTC(y, m - 1, d + offset))
    return at(`${dt.toISOString().slice(0, 10)}T${time}-04:00`)
  }
  return WEEK_PAIRS.map(([home, away], i) => ({
    homeTeam: home, awayTeam: away, week: null, seasonType: null,
    startTime: i === 0 ? day(0, '20:20:00') : i === 15 ? day(4, '20:15:00') : i === 14 ? day(3, '20:20:00') : day(3, '13:00:00'),
  }))
}

describe('games → weeks', () => {
  it('derives Thursday-anchored weeks; a Monday night game stays in its week', () => {
    const rows = [...riWeek('2026-09-10'), ...riWeek('2026-09-17')]
    const { weeks, unusable } = realWeeksFromGames(rows, 2026)
    expect(unusable).toEqual([])
    expect([...weeks.keys()].sort()).toEqual([1, 2])
    expect(weeks.get(1)).toHaveLength(16)
    expect(weeks.get(1)).toContainEqual({ home: 'ARI', away: 'LAR' }) // the Monday game
  })

  it('drops preseason (before Sep 1) and playoff weeks (past 18), and api_sports pre/post rows', () => {
    const pre = riWeek('2026-08-20')
    const rows = [...pre, ...riWeek('2026-09-10'), { homeTeam: 'KC', awayTeam: 'BUF', week: 1, seasonType: 'post', startTime: null }]
    const { weeks } = realWeeksFromGames(rows, 2026)
    expect([...weeks.keys()]).toEqual([1])
    const late = realWeeksFromGames([...riWeek('2026-09-10'), ...riWeek('2027-01-21')], 2026).weeks
    expect([...late.keys()]).toEqual([1])
  })

  it('counts a game once across both sources, normalizes team names, and ignores unknown teams', () => {
    const rows: GameRow[] = [
      ...riWeek('2026-09-10'),
      { homeTeam: 'Kansas City Chiefs', awayTeam: 'Buffalo Bills', week: 1, seasonType: 'regular', startTime: null },
      { homeTeam: 'WSH', awayTeam: 'JAC', week: 2, seasonType: 'regular', startTime: null },
      { homeTeam: 'London Monarchs', awayTeam: 'KC', week: 3, seasonType: 'regular', startTime: null },
    ]
    const { weeks } = realWeeksFromGames(rows, 2026)
    expect(weeks.get(1)).toHaveLength(16)
    expect(weeks.get(2)).toEqual([{ home: 'WAS', away: 'JAX' }])
    expect(weeks.has(3)).toBe(false)
  })

  it('a derived week where a team plays twice is unusable, not guessed', () => {
    const rows = [...riWeek('2026-09-10'), { homeTeam: 'KC', awayTeam: 'DEN', week: null, seasonType: null, startTime: at('2026-09-12T13:00:00-04:00') }]
    const { weeks, unusable } = realWeeksFromGames(rows, 2026)
    expect(unusable).toEqual([1])
    expect(weeks.has(1)).toBe(false)
  })

  it('a week needs 13 games to count as loaded', () => {
    expect(weekIsLoaded(WEEK_PAIRS.slice(0, 13).map(([home, away]) => ({ home, away })))).toBe(true)
    expect(weekIsLoaded(WEEK_PAIRS.slice(0, 12).map(([home, away]) => ({ home, away })))).toBe(false)
  })
})

describe('pairing a week', () => {
  const games = WEEK_PAIRS.map(([home, away]) => ({ home, away }))

  it('real games first; the rest by division; an odd one out gets the bye', () => {
    const teams = [
      { rosterId: 'a', code: 'KC' }, { rosterId: 'b', code: 'BUF' }, // play each other for real
      { rosterId: 'c', code: 'DEN' }, { rosterId: 'd', code: 'PHI' }, { rosterId: 'e', code: 'LV' }, // opponents not picked
    ]
    const { pairs, real } = pairWeek({ week: 2, games, teams, met: new Map() })
    expect(real).toEqual([{ home: 'a', away: 'b' }])
    expect(pairs).toHaveLength(3)
    // DEN and LV share the AFC West; PHI is left over.
    expect(pairs).toContainEqual(expect.objectContaining({ away: null }))
    const paired = pairs.find((p) => p.away && [p.home, p.away].includes('c'))!
    expect([paired.home, paired.away].sort()).toEqual(['c', 'e'])
    expect(nflDivisionOf('LV')?.division).toBe('AFC West')
  })

  it('is deterministic, and rotates so leftover teams meet different opponents', () => {
    const teams = ['a', 'b', 'c', 'd'].map((id) => ({ rosterId: id, code: null }))
    const once = planRealSchedule({ weeks: [1, 2, 3], real: { weeks: new Map([1, 2, 3].map((w) => [w, games])), unusable: [] }, teams })
    const again = planRealSchedule({ weeks: [1, 2, 3], real: { weeks: new Map([1, 2, 3].map((w) => [w, games])), unusable: [] }, teams })
    expect(once).toEqual(again)
    const keys = once.flatMap((w) => w.pairs.map((p) => [p.home, p.away].sort().join('-')))
    // Four teams, three weeks: every pair once — a round robin, nobody meets twice.
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('a week without enough games is left alone', () => {
    const plan = planRealSchedule({ weeks: [1, 2], real: { weeks: new Map([[1, games], [2, games.slice(0, 5)]]), unusable: [] }, teams: [{ rosterId: 'a', code: 'KC' }, { rosterId: 'b', code: 'BUF' }] })
    expect(plan.map((w) => [w.week, w.loaded, w.pairs.length])).toEqual([[1, true, 1], [2, false, 0]])
  })
})

describe('the service', () => {
  beforeEach(() => {
    db.settings = withCopyLeague({}, { enabled: true, sport: 'NFL', teams: { t1: 'KC', t2: 'BUF', t3: 'DEN', t4: 'PHI', t5: 'LV' }, previous: {} })
    db.games = [...riWeek('2026-09-10'), ...riWeek('2026-09-17')]
    db.rows = []
    db.currentWeek = 1
  })

  it('previews coverage without writing', async () => {
    const out = await previewRealSchedule({ seasonId: 'S1', now: new Date('2026-08-01T00:00:00Z') })
    expect(out.ok && out.weeks.filter((w) => w.loaded).map((w) => [w.week, w.real, w.total])).toEqual([[1, 1, 3], [2, 1, 3]])
    expect(db.rows).toEqual([])
  })

  it('writes the loaded weeks as custom weeks and records the real games; other weeks are left alone', async () => {
    const out = await applyRealSchedule({ seasonId: 'S1', actorUserId: 'boss', now: new Date('2026-08-01T00:00:00Z') })
    expect(out.ok).toBe(true)
    expect(new Set(db.rows.map((r) => r.week))).toEqual(new Set([1, 2]))
    expect(db.rows.filter((r) => r.week === 1)).toContainEqual(expect.objectContaining({ homeRosterId: 'r1', awayRosterId: 'r2', type: 'regular' }))
    expect(Object.keys(readCustomWeeks(db.settings, 2026)).sort()).toEqual(['1', '2'])
    const realGames = (db.settings.copy_league as { realGames: Record<string, Record<string, unknown>> }).realGames['2026']
    expect(realGames?.['1']).toEqual([['r1', 'r2']])
    // Part 1's writer keeps part 2's real games.
    const kept = withCopyLeague(db.settings, readCopyLeague(db.settings, 'NFL'))
    expect((kept.copy_league as { realGames?: unknown }).realGames).toBeTruthy()
  })

  it('refuses when copy league is off, or when no week is loaded', async () => {
    db.settings = withCopyLeague({}, { enabled: false, sport: 'NFL', teams: {}, previous: {} })
    expect(await applyRealSchedule({ seasonId: 'S1', actorUserId: 'boss' })).toMatchObject({ ok: false, code: 'NOT_A_COPY_LEAGUE' })
    db.settings = withCopyLeague({}, { enabled: true, sport: 'NFL', teams: {}, previous: {} })
    db.games = []
    expect(await applyRealSchedule({ seasonId: 'S1', actorUserId: 'boss' })).toMatchObject({ ok: false, code: 'SCHEDULE_NOT_LOADED' })
  })
})

describe('the schedule tools', () => {
  const fetchMock = vi.fn()
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })
  const schedule = { playoffStartWeek: 15, weeks: [{ week: 1, locked: false, matchups: [{ id: 'm', homeRosterId: 'r1', awayRosterId: 'r2', homeName: 'Chiefs', awayName: 'Bills', bye: false }] }] }
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(cleanup)

  it('a copy league sees coverage, applies, and the week editor tags the real games', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(200, { schedule, customWeeks: [], copyLeague: true, realGames: { '1': [['r1', 'r2']] } }))
      .mockResolvedValueOnce(reply(200, { weeks: [{ week: 1, loaded: true, real: 1, total: 1 }, { week: 2, loaded: false, real: 0, total: 0 }] }))
      .mockResolvedValue(reply(200, { ok: true, weeks: [{ week: 1, loaded: true, real: 1, total: 1 }] }))
    render(<ScheduleToolsCard leagueId="L1" />)
    expect(await screen.findByTestId('schedule-real-coverage')).toBeTruthy()
    expect(screen.getByTestId('schedule-real-missing')).toBeTruthy()
    expect(screen.getByTestId('schedule-real-tag').textContent).toBe('commControl.realTag')
    fireEvent.click(screen.getByTestId('schedule-real-apply'))
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => c[1]?.body && JSON.parse(c[1].body).action === 'real_schedule_apply')).toBe(true))
  })

  it('a league that is not a copy league gets no section', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { schedule, customWeeks: [], copyLeague: false, realGames: {} }))
    render(<ScheduleToolsCard leagueId="L1" />)
    await screen.findByTestId('schedule-randomize')
    expect(screen.queryByTestId('schedule-real')).toBeNull()
  })

  it('writes week ranges compactly', () => {
    expect(weekRanges([5, 6, 7, 8, 10, 12, 13, 14])).toBe('5–8, 10, 12–14')
    expect(weekRanges([3])).toBe('3')
  })
})
