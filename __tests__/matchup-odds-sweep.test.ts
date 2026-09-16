// @vitest-environment node
/**
 * The pre-game odds snapshot (weekly upsets, 2026-09-14): captured only while a week is entirely
 * unplayed, once, from the week board's own model — and dormant until its parked migration exists.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ aggregate: vi.fn(), groupBy: vi.fn(), findMany: vi.fn(), queryRaw: vi.fn(), executeRaw: vi.fn() }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    weeklyMatchup: { aggregate: h.aggregate, groupBy: h.groupBy, findMany: h.findMany },
    $queryRaw: (...a: unknown[]) => h.queryRaw(...a),
    $executeRaw: (...a: unknown[]) => h.executeRaw(...a),
  },
}))

import { inPlayWindow, runMatchupOddsSweep, ODDS_MODEL } from '@/lib/core-app/matchupOddsSweep'
import { winProbabilityOf } from '@/lib/core-app/weekBoard'

const WED = Date.parse('2026-09-16T15:00:00Z') // Wednesday 11:00 ET

/*
 * 🛑 PIN THE SYSTEM CLOCK TO `WED`, OR THIS SUITE IS A TIME BOMB.
 *
 * The sweep builds its deadline from the INJECTED `now()` — `now() + budget.remainingMs()` — and
 * hands it to `remainingFor`, which compares it against the REAL `Date.now()`. In production those
 * are the same clock, so the seam is invisible. In a test that injects a fixed instant they diverge,
 * and once the real clock passes `WED + remainingMs` every unit is skippedForTime and eight tests go
 * red at once, on a file nobody touched. Measured: this suite passed from 2026-09-14 until
 * 2026-09-16T15:03:19Z and failed on every run after it.
 */
const useWedClock = () => {
  beforeEach(() => {
    // Date only: faking setTimeout/setInterval here would hang unrelated async work in the sweep.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(WED)
  })
  afterEach(() => {
    vi.useRealTimers()
  })
}
const budget = (exhausted = false, remaining = 200_000) => ({ exhausted: () => exhausted, elapsedMs: () => 0, remainingMs: () => remaining })
const MISSING = Object.assign(new Error('relation "matchup_odds_snapshots" does not exist'), { code: 'P2010', meta: { code: '42P01' } })

type Row = { leagueId: string; seasonYear: number; week: number; rosterId: string; matchupId: number | null; pointsFor: number; pointsAgainst: number; win: number }
const row = (rosterId: string, week: number, pointsFor: number, matchupId: number | null = week * 10 + (rosterId === 'r1' || rosterId === 'r2' ? 1 : 2), season = 2026): Row => ({
  leagueId: 'sl-ice', seasonYear: season, week, rosterId, matchupId, pointsFor, pointsAgainst: pointsFor > 0 ? 100 : 0, win: 0,
})

/** Four teams, weeks 1-3 played, week 4 scheduled 0-0: r1 v r2, r3 v r4. */
function league(): Row[] {
  const out: Row[] = []
  const pts: Record<string, number[]> = { r1: [140, 130, 150], r2: [90, 100, 95], r3: [110, 112, 108], r4: [111, 109, 110] }
  for (const [rid, weeks] of Object.entries(pts)) {
    weeks.forEach((p, i) => out.push(row(rid, i + 1, p)))
    out.push(row(rid, 4, 0))
  }
  return out
}

function db({ have = [] as Array<{ league_id: string; week: number }>, rows = league() } = {}) {
  h.aggregate.mockResolvedValue({ _max: { seasonYear: 2026 } })
  h.queryRaw.mockResolvedValue(have)
  h.groupBy.mockResolvedValue([
    { leagueId: 'sl-ice', week: 3, _max: { pointsFor: 150, pointsAgainst: 100 } },
    { leagueId: 'sl-ice', week: 4, _max: { pointsFor: 0, pointsAgainst: 0 } },
    { leagueId: 'sl-ice', week: 5, _max: { pointsFor: 0, pointsAgainst: 0 } },
  ])
  h.findMany.mockResolvedValue(rows)
  h.executeRaw.mockResolvedValue(4)
}

beforeEach(() => {
  for (const f of Object.values(h)) f.mockReset()
})

describe('inPlayWindow', () => {
  it('🛑 Sunday, Monday and Tuesday before 06:00 US Eastern are in play; the rest of the week is not', () => {
    expect(inPlayWindow(new Date('2026-09-13T17:00:00Z'))).toBe(true) // Sun 13:00 ET
    expect(inPlayWindow(new Date('2026-09-15T02:00:00Z'))).toBe(true) // Mon 22:00 ET (Tue UTC)
    expect(inPlayWindow(new Date('2026-09-15T09:30:00Z'))).toBe(true) // Tue 05:30 ET
    expect(inPlayWindow(new Date('2026-09-15T10:30:00Z'))).toBe(false) // Tue 06:30 ET
    expect(inPlayWindow(new Date(WED))).toBe(false)
    expect(inPlayWindow(new Date('2026-09-19T15:00:00Z'))).toBe(false) // Sat
  })
})

describe('runMatchupOddsSweep', () => {
  useWedClock()

  it('🛑 snapshots the earliest unplayed week: both sides of each projected matchup, the board’s own probability', async () => {
    db()
    const out = await runMatchupOddsSweep({ budget: budget(), now: () => WED })
    expect(out).toMatchObject({ considered: 1, due: 1, written: 4, leaguesWritten: 1, started: 0, unprojected: 0, failed: 0, unavailable: 0, outsideWindow: 0 })
    const call = h.executeRaw.mock.calls[0]
    const sql = (call[0] as TemplateStringsArray).join('?')
    expect(sql).toContain('ON CONFLICT ("league_id", "season", "week", "roster_id") DO NOTHING')
    const joined = call[1] as { values: unknown[] }
    const tuples: unknown[][] = []
    for (let i = 0; i < joined.values.length; i += 12) tuples.push(joined.values.slice(i, i + 12))
    expect(tuples).toHaveLength(4)
    const r1 = tuples.find((t) => t[4] === 'r1')!
    const r2 = tuples.find((t) => t[4] === 'r2')!
    expect(r1.slice(1, 6)).toEqual(['sl-ice', 2026, 4, 'r1', 'r2'])
    expect(r1[11]).toBe(ODDS_MODEL)
    expect(r1[9]).toBe(3)
    const p = winProbabilityOf({ mu: 140, sigma: 12 }, { mu: 95, sigma: 12 })
    expect(r1[8] as number).toBeCloseTo(p, 10)
    expect((r1[8] as number) + (r2[8] as number)).toBeCloseTo(1, 10)
    expect(h.queryRaw.mock.calls[0].slice(1)).toEqual([2026])
  })

  it('🛑 a fire in the in-play window reads nothing at all', async () => {
    db()
    const out = await runMatchupOddsSweep({ budget: budget(), now: () => Date.parse('2026-09-13T17:00:00Z') })
    expect(out.outsideWindow).toBe(1)
    expect(h.aggregate).not.toHaveBeenCalled()
    expect(h.queryRaw).not.toHaveBeenCalled()
  })

  it('🛑 a parked migration (42P01) is unavailable — no matchup rows read, no write', async () => {
    db()
    h.queryRaw.mockRejectedValue(MISSING)
    const out = await runMatchupOddsSweep({ budget: budget(), now: () => WED })
    expect(out).toMatchObject({ unavailable: 1, failed: 0 })
    expect(h.groupBy).not.toHaveBeenCalled()
    expect(h.findMany).not.toHaveBeenCalled()
    expect(h.executeRaw).not.toHaveBeenCalled()
  })

  it('another due-query error is a failure, reported', async () => {
    db()
    h.queryRaw.mockRejectedValue(new Error('connection reset'))
    expect(await runMatchupOddsSweep({ budget: budget(), now: () => WED })).toMatchObject({ failed: 1, errors: ['due_query: connection reset'] })
  })

  it('🛑 written once: a league-week that already has a snapshot is not due', async () => {
    db({ have: [{ league_id: 'sl-ice', week: 4 }] })
    const out = await runMatchupOddsSweep({ budget: budget(), now: () => WED })
    expect(out).toMatchObject({ considered: 1, due: 0, written: 0 })
    expect(h.findMany).not.toHaveBeenCalled()
  })

  it('🛑 a week whose rows turn out to be scored is refused (started), never snapshotted', async () => {
    const rows = league().map((r) => (r.week === 4 && r.rosterId === 'r3' ? { ...r, pointsFor: 12.5 } : r))
    db({ rows })
    const out = await runMatchupOddsSweep({ budget: budget(), now: () => WED })
    expect(out).toMatchObject({ started: 1, written: 0 })
    expect(h.executeRaw).not.toHaveBeenCalled()
  })

  it('a matchup where a side has too little history is unprojected and not written', async () => {
    const rows = league().filter((r) => !(r.rosterId === 'r4' && r.week < 3))
    db({ rows })
    h.executeRaw.mockResolvedValue(2)
    const out = await runMatchupOddsSweep({ budget: budget(), now: () => WED })
    expect(out).toMatchObject({ unprojected: 1, written: 2 })
    const joined = h.executeRaw.mock.calls[0][1] as { values: unknown[] }
    expect(joined.values).toHaveLength(24)
  })

  it('nothing projectable writes nothing (and issues no insert, and is not a failure)', async () => {
    db({ rows: league().filter((r) => r.week === 4) })
    const out = await runMatchupOddsSweep({ budget: budget(), now: () => WED })
    expect(out).toMatchObject({ unprojected: 2, written: 0, leaguesWritten: 0, failed: 0 })
    expect(h.executeRaw).not.toHaveBeenCalled()
  })

  it('🛑 written counts the rows the insert actually took — a week another fire captured first adds none', async () => {
    db()
    h.executeRaw.mockResolvedValue(0)
    expect(await runMatchupOddsSweep({ budget: budget(), now: () => WED })).toMatchObject({ written: 0, leaguesWritten: 0, failed: 0 })
  })

  it('a week where only the OPPONENT side has points is played, so the next unplayed week is current', async () => {
    db()
    h.groupBy.mockResolvedValue([
      { leagueId: 'sl-ice', week: 4, _max: { pointsFor: 0, pointsAgainst: 12.5 } },
      { leagueId: 'sl-ice', week: 5, _max: { pointsFor: 0, pointsAgainst: 0 } },
    ])
    h.findMany.mockResolvedValue([])
    await runMatchupOddsSweep({ budget: budget(), now: () => WED })
    expect(h.queryRaw).toHaveBeenCalled()
    expect(h.findMany).toHaveBeenCalledTimes(1)
    const out = await runMatchupOddsSweep({ budget: budget(), now: () => WED })
    expect(out).toMatchObject({ considered: 1, due: 1 })
    h.queryRaw.mockResolvedValue([{ league_id: 'sl-ice', week: 5 }])
    expect(await runMatchupOddsSweep({ budget: budget(), now: () => WED })).toMatchObject({ due: 0 })
  })

  it('🛑 only THIS season’s rows for the week count — a scored week 4 from last season does not block it', async () => {
    const lastSeason = ['r1', 'r2', 'r3', 'r4'].map((rid) => row(rid, 4, 120, 41, 2025))
    db({ rows: [...league(), ...lastSeason] })
    expect(await runMatchupOddsSweep({ budget: budget(), now: () => WED })).toMatchObject({ started: 0, written: 4 })
  })

  it('a season with every week played, or no rows at all, has nothing due', async () => {
    db()
    h.groupBy.mockResolvedValue([{ leagueId: 'sl-ice', week: 17, _max: { pointsFor: 120, pointsAgainst: 99 } }])
    expect(await runMatchupOddsSweep({ budget: budget(), now: () => WED })).toMatchObject({ considered: 0, due: 0 })
    h.aggregate.mockResolvedValue({ _max: { seasonYear: null } })
    h.queryRaw.mockClear()
    expect(await runMatchupOddsSweep({ budget: budget(), now: () => WED })).toMatchObject({ considered: 0 })
    expect(h.queryRaw).not.toHaveBeenCalled()
  })

  it('out of budget: skippedForTime, no unit started', async () => {
    db()
    expect(await runMatchupOddsSweep({ budget: budget(true), now: () => WED })).toMatchObject({ skippedForTime: 1, written: 0 })
    // `remainingFor` reads the real clock, so pin it to the sweep's own "now" for the too-little-time case.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(WED))
    try {
      expect(await runMatchupOddsSweep({ budget: budget(false, 500), now: () => WED })).toMatchObject({ skippedForTime: 1 })
    } finally {
      vi.useRealTimers()
    }
    expect(h.findMany).not.toHaveBeenCalled()
  })

  it('one league failing does not stop the next; a missing table at insert is unavailable', async () => {
    db()
    h.groupBy.mockResolvedValue([
      { leagueId: 'sl-a', week: 4, _max: { pointsFor: 0, pointsAgainst: 0 } },
      { leagueId: 'sl-ice', week: 4, _max: { pointsFor: 0, pointsAgainst: 0 } },
    ])
    h.findMany.mockImplementation(async ({ where }: { where: { leagueId: string } }) => {
      if (where.leagueId === 'sl-a') throw new Error('boom')
      return league()
    })
    const out = await runMatchupOddsSweep({ budget: budget(), now: () => WED })
    expect(out).toMatchObject({ failed: 1, leaguesWritten: 1 })
    h.executeRaw.mockRejectedValue(MISSING)
    expect(await runMatchupOddsSweep({ budget: budget(), now: () => WED })).toMatchObject({ unavailable: 1 })
  })

  it('the per-fire league cap holds', async () => {
    db()
    h.groupBy.mockResolvedValue(['a', 'b', 'c'].map((l) => ({ leagueId: `sl-${l}`, week: 4, _max: { pointsFor: 0, pointsAgainst: 0 } })))
    h.findMany.mockResolvedValue([])
    await runMatchupOddsSweep({ budget: budget(), now: () => WED, leagueCap: 2 })
    expect(h.findMany).toHaveBeenCalledTimes(2)
  })
})
