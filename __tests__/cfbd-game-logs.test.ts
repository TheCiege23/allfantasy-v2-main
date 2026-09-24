import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/schedule-stats', () => ({ ingestSportStats: vi.fn() }))

import fixture from './fixtures/cfbd/games-players.2026-w3.sample.json'
import {
  MAX_WEEKS_PER_RUN,
  NCAAF_WEEK_SETTLE_MS,
  createCfbdGameLogCollector,
  parseCfbdGamePlayers,
  planCfbdGameLogs,
} from '@/lib/stats/cfbdGameLogs'

/*
 * The fixture is a real CFBD `/games/players?year=2026&week=3&seasonType=regular` response, trimmed
 * to 3 of its 128 games (SEC v ACC, Patriot v Ivy, Big 12 v MAC). Captured 2026-09-23 with one call.
 * The shape it pins had never been read by any code before: the old parser only counted ids.
 */

describe('parseCfbdGamePlayers — against the captured response', () => {
  const rows = parseCfbdGamePlayers(fixture)

  it('one row per player per game, merging every category — team-total rows excluded', () => {
    expect(rows).toHaveLength(217) // distinct numeric athlete ids per game, summed
    expect(rows.every((r) => /^[0-9]+$/.test(r.playerId))).toBe(true) // "-6827 | Team" rows dropped
    expect(new Set(rows.map((r) => `${r.gameId}|${r.playerId}`)).size).toBe(rows.length)
  })

  it('reads a QB line exactly, splitting C/ATT into the season-row names', () => {
    const curtis = rows.find((r) => r.playerId === '5158948')!
    expect(curtis.gameId).toBe('cfbd:401856695')
    expect(curtis.statPayload).toMatchObject({
      name: 'Jared Curtis',
      _team: 'Vanderbilt',
      _opponent: 'NC State',
      _homeAway: 'home',
      'passing.COMPLETIONS': 20,
      'passing.ATT': 34,
      'passing.YDS': 277,
      'passing.QBR': 48.5,
      'rushing.YDS': 64, // the same player's rushing line, merged into the one row
    })
    expect(curtis.statPayload['passing.C/ATT']).toBeUndefined()
  })

  it('keeps negative yardage and splits kicking made/attempted', () => {
    expect(rows.find((r) => r.playerId === '5218655')!.statPayload['rushing.YDS']).toBe(-1)
    const kicker = rows.find((r) => r.playerId === '5087247')!
    expect(kicker.statPayload['kicking.FGM']).toBe(0)
    expect(kicker.statPayload['kicking.FGA']).toBe(0)
    expect(kicker.statPayload['kicking.FG']).toBeUndefined()
  })

  it('drops an unavailable value ("--") rather than storing it as a number', () => {
    const withDash = parseCfbdGamePlayers([
      { id: 1, teams: [{ team: 'A', categories: [{ name: 'passing', types: [{ name: 'QBR', athletes: [{ id: '9', name: 'X', stat: '--' }] }] }] }] },
    ])
    expect(withDash[0].statPayload['passing.QBR']).toBeUndefined()
  })

  it('tolerates junk without throwing', () => {
    expect(parseCfbdGamePlayers(null)).toEqual([])
    expect(parseCfbdGamePlayers([{}, { id: 2 }, { id: 3, teams: [{}] }])).toEqual([])
  })
})

/** A fake db serving the ledger and schedule the planner reads. */
function db(ledger: Array<{ weekOrRound: number; completedAt: Date | null }>, schedule: Array<{ externalId: string; week: number; startTime: Date }>) {
  return {
    statIngestionJob: { findMany: async () => ledger },
    sportsGame: { findMany: async () => schedule },
  } as never
}

const W3_LAST = new Date('2026-09-20T06:30:00Z')

describe('planCfbdGameLogs + collector', () => {
  it('writes an unsettled week, dates it from the schedule, and records what it did', async () => {
    const plan = await planCfbdGameLogs(
      { season: 2026, now: new Date('2026-09-20T12:00:00Z') },
      db([], [{ externalId: '401856695', week: 3, startTime: W3_LAST }]),
    )
    const c = createCfbdGameLogCollector(plan)
    c.offer(3, fixture)
    const ingest = vi.fn().mockResolvedValue({})
    const report = await c.flush({ season: 2026 }, ingest)

    expect(report.weeksWritten).toEqual([{ week: 3, rows: 217 }])
    const input = ingest.mock.calls[0][0]
    expect(input).toMatchObject({ sportType: 'NCAAF', season: 2026, weekOrRound: 3, source: 'cfbd-weekly' })
    const curtis = input.playerStats.find((p: { playerId: string }) => p.playerId === '5158948')
    expect(curtis.gameDate).toEqual(W3_LAST)
    // Never the VarChar(8) columns — school names would overflow them.
    expect(curtis.team).toBeUndefined()
    expect(curtis.opponent).toBeUndefined()
  })

  it('skips a week completed AFTER it settled, but rewrites one stamped before', async () => {
    const settled = new Date(W3_LAST.getTime() + NCAAF_WEEK_SETTLE_MS)
    const now = new Date(settled.getTime() + 3_600_000)
    const schedule = [{ externalId: '401856695', week: 3, startTime: W3_LAST }]

    const done = await planCfbdGameLogs({ season: 2026, now }, db([{ weekOrRound: 3, completedAt: new Date(settled.getTime() + 60_000) }], schedule))
    expect(done.isComplete(3)).toBe(true)

    const early = await planCfbdGameLogs({ season: 2026, now }, db([{ weekOrRound: 3, completedAt: new Date('2026-09-20T08:00:00Z') }], schedule))
    expect(early.isComplete(3)).toBe(false)
  })

  it('keeps at most MAX_WEEKS_PER_RUN weeks in memory and defers the rest', async () => {
    const plan = await planCfbdGameLogs({ season: 2026, now: new Date('2026-09-20T12:00:00Z') }, db([], []))
    const c = createCfbdGameLogCollector(plan)
    for (const w of [1, 2, 3, 4]) c.offer(w, fixture)
    const report = await c.flush({ season: 2026 }, vi.fn().mockResolvedValue({}))
    expect(report.weeksWritten.map((x) => x.week)).toEqual([1, 2].slice(0, MAX_WEEKS_PER_RUN))
    expect(report.weeksDeferred).toEqual([3, 4])
  })

  it('never throws — a failed week is reported and the next still written', async () => {
    const plan = await planCfbdGameLogs({ season: 2026, now: new Date('2026-09-20T12:00:00Z') }, db([], []))
    const c = createCfbdGameLogCollector(plan)
    c.offer(1, fixture)
    c.offer(2, fixture)
    const ingest = vi.fn().mockRejectedValueOnce(new Error('pool timeout')).mockResolvedValueOnce({})
    const report = await c.flush({ season: 2026 }, ingest)
    expect(report.errors[0]).toMatch(/week 1: pool timeout/)
    expect(report.weeksWritten).toEqual([{ week: 2, rows: 217 }])
  })
})
