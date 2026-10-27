import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import {
  parseStatReingestBody,
  runStatReingest,
  StatReingestError,
  type StatReingestDeps,
  type StatReingestRequest,
} from '@/lib/admin/statReingest'

const LEAGUE = 'd41382f9-6700-475d-ac8c-041632dd0a33'

/**
 * A two-matchup NHL week. Stored scores: m1 10–9 (home wins), m2 20–5.
 * Each roster has one goalie starter; the "fresh" re-sum gives the m1 AWAY goalie a win, which
 * the toy scorer values at 5 points — so m1 flips (10 vs 14) and m2 does not move.
 */
function fakeDb(opts: { sealed?: boolean } = {}) {
  const status = opts.sealed === false ? 'active' : 'final'
  const matchups = [
    { id: 'm1', status, homeRosterId: 'r1', awayRosterId: 'r2', homeScore: 10, awayScore: 9 },
    { id: 'm2', status, homeRosterId: 'r3', awayRosterId: 'r4', homeScore: 20, awayScore: 5 },
  ]
  const writes: string[] = []
  const db = {
    redraftSeason: {
      findFirst: vi.fn(async () => ({
        id: 'season1',
        leagueId: LEAGUE,
        season: 2026,
        sport: 'NHL',
        status: 'in_season',
        league: { platform: 'allfantasy', sport: 'NHL', settings: {}, bestBallMode: false, leagueVariant: null, leagueType: 'redraft' },
      })),
    },
    redraftMatchup: { findMany: vi.fn(async () => matchups.map((m) => ({ ...m }))) },
    redraftRosterPlayer: {
      findMany: vi.fn(async () =>
        ['r1', 'r2', 'r3', 'r4'].map((r) => ({ rosterId: r, playerId: `g-${r}`, playerName: `Goalie ${r}`, position: 'G', slotType: 'G', sport: 'NHL' })),
      ),
    },
    roster: { findMany: vi.fn(async () => []) },
    afRosterLineupAssignment: { findMany: vi.fn(async () => []) },
    playerWeeklyScore: {
      findMany: vi.fn(async () => ['r1', 'r2', 'r3', 'r4'].map((r) => ({ playerId: `g-${r}`, stats: { g_win: 0 } }))),
    },
    playerGameStat: {
      findMany: vi.fn(async () => [
        { normalizedStatMap: { group: 'goalies', stats: { goals_against: 0, time_on_ice_minutes: 60 } } },
        { normalizedStatMap: { group: 'skaters', stats: { goals: 1 } } },
      ]),
    },
    leagueAuditLog: { create: vi.fn(async () => { writes.push('audit'); return {} }) },
  }
  return { db, writes }
}

function deps(db: unknown, extra: Partial<StatReingestDeps> = {}): StatReingestDeps {
  return {
    prisma: db as never,
    ingest: vi.fn(async () => ({ sport: 'NHL', written: 42 }) as never),
    loadWeekStats: vi.fn(async () => {
      const m = new Map<string, Record<string, number>>()
      for (const r of ['r1', 'r2', 'r3', 'r4']) m.set(`g-${r}`, { g_win: r === 'r2' ? 1 : 0 })
      return m
    }),
    syncWeek: vi.fn(async () => ({ scoresUpserted: 4 }) as never),
    recalcWeek: vi.fn(async () => ({ updated: 2, incomplete: 0, summaries: [] })),
    standings: vi.fn(async () => undefined as never),
    finalizeWeek: vi.fn(async () => ({ finalized: true, alreadyFinal: false, refusal: null }) as never),
    usesDevyEngine: async () => false,
    usesC2CEngine: async () => false,
    buildScorer: () => (stats) => (stats.g_win ?? 0) * 5,
    ...extra,
  }
}

function req(over: Partial<StatReingestRequest> = {}): StatReingestRequest {
  return {
    sport: 'NHL',
    from: '2026-09-29',
    to: '2026-10-12',
    leagueId: LEAGUE,
    weeks: [1],
    dryRun: true,
    confirm: null,
    skipIngest: false,
    ...over,
  }
}

describe('parseStatReingestBody', () => {
  it('accepts the NHL weeks 1-2 request and defaults dryRun to true', () => {
    const r = parseStatReingestBody({ sport: 'nhl', from: '2026-09-29', to: '2026-10-12', leagueId: LEAGUE, weeks: [2, 1, 1] })
    expect(r).toEqual({
      ok: true,
      value: { sport: 'NHL', from: '2026-09-29', to: '2026-10-12', leagueId: LEAGUE, weeks: [1, 2], dryRun: true, confirm: null, skipIngest: false },
    })
  })

  it.each([
    [{ sport: 'NCAAF', from: '2026-09-29', to: '2026-10-12' }, /sport must be/],
    [{ sport: 'NHL', from: '2026-10-12', to: '2026-09-29' }, /on or before/],
    [{ sport: 'NHL', from: '2026-09-01', to: '2026-10-12' }, /limit is 31/],
    [{ sport: 'NHL', from: '2026-02-30', to: '2026-03-01' }, /YYYY-MM-DD/],
    [{ sport: 'NHL', from: '2026-09-29', to: '2026-10-12', weeks: [1] }, /weeks requires leagueId/],
    [{ sport: 'NHL', from: '2026-09-29', to: '2026-10-12', leagueId: LEAGUE }, /leagueId requires weeks/],
    [{ sport: 'NHL', from: '2026-09-29', to: '2026-10-12', leagueId: LEAGUE, weeks: [0] }, /whole numbers/],
    [{ sport: 'NHL', from: '2026-09-29', to: '2026-10-12', dryRun: 'false' }, /dryRun must be a boolean/],
    [{ sport: 'NHL', from: '2026-09-29', to: '2026-10-12', confirm: 'yes' }, /confirm must be/],
  ])('rejects %j', (body, message) => {
    const r = parseStatReingestBody(body)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(message)
  })

  it('a 31-day range is allowed', () => {
    expect(parseStatReingestBody({ sport: 'NHL', from: '2026-09-01', to: '2026-10-01' }).ok).toBe(true)
  })
})

describe('runStatReingest', () => {
  let fx: ReturnType<typeof fakeDb>
  beforeEach(() => {
    fx = fakeDb()
  })

  it('dryRun ingests nothing and writes nothing, but previews the flip', async () => {
    const d = deps(fx.db)
    const out = await runStatReingest(req({ confirm: 'allow-flips' }), 'admin:x', d)
    expect(d.ingest).not.toHaveBeenCalled()
    expect(d.syncWeek).not.toHaveBeenCalled()
    expect(d.recalcWeek).not.toHaveBeenCalled()
    expect(d.finalizeWeek).not.toHaveBeenCalled()
    expect(d.standings).not.toHaveBeenCalled()
    expect(fx.db.leagueAuditLog.create).not.toHaveBeenCalled()
    expect(out.ingest).toEqual({ ran: false, reason: 'dry_run', wouldFetchDates: 14 })
    expect(out.rescore?.wrote).toBe(false)
    expect(out.rescore?.writeRefusal).toBe('dry_run')
    const week = out.rescore!.weeks[0]
    expect(week.supported).toBe(true)
    const m1 = week.matchups.find((m) => m.matchupId === 'm1')!
    expect(m1).toMatchObject({ home: { before: 10, after: 10 }, away: { before: 9, after: 14 }, resultFlipped: true })
    expect(week.matchups.find((m) => m.matchupId === 'm2')).toMatchObject({ resultFlipped: false, away: { before: 5, after: 5 } })
    expect(out.rescore?.flips).toBe(1)
    // The NHL goalie tally is reported (the shutout falls back to the 60:00 + 0 GA rule).
    expect(out.goalies?.before).toMatchObject({ goalieLines: 1, shutouts: 1 })
    expect(out.goalies?.after).toBeNull()
  })

  it('without confirm, ingests (not dry run) but writes no scores', async () => {
    const d = deps(fx.db)
    const out = await runStatReingest(req({ dryRun: false }), 'admin:x', d)
    expect(d.ingest).toHaveBeenCalledTimes(1)
    expect((d.ingest as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({ sport: 'NHL' })
    expect((d.ingest as ReturnType<typeof vi.fn>).mock.calls[0][0].dates).toHaveLength(14)
    expect(d.syncWeek).not.toHaveBeenCalled()
    expect(out.rescore?.writeRefusal).toBe('confirm_required')
    expect(out.goalies?.after).not.toBeNull()
  })

  it('flip guard: confirm=true is refused when a result would flip', async () => {
    const d = deps(fx.db)
    const out = await runStatReingest(req({ dryRun: false, confirm: true }), 'admin:x', d)
    expect(out.rescore?.writeRefusal).toBe('flips_require_allow_flips')
    expect(out.rescore?.wrote).toBe(false)
    expect(d.syncWeek).not.toHaveBeenCalled()
    expect(d.recalcWeek).not.toHaveBeenCalled()
  })

  it('confirm=true writes through the rescore tools when nothing flips, and re-seals a sealed week', async () => {
    const d = deps(fx.db, {
      // No goalie gains a win this time: scores do not move, nothing flips.
      loadWeekStats: vi.fn(async () => new Map(['r1', 'r2', 'r3', 'r4'].map((r) => [`g-${r}`, { g_win: 0 }]))),
    })
    const out = await runStatReingest(req({ dryRun: false, confirm: true, skipIngest: true }), 'admin:owner', d)
    expect(d.ingest).not.toHaveBeenCalled()
    expect(out.rescore?.writeRefusal).toBeNull()
    expect(out.rescore?.wrote).toBe(true)
    expect(d.syncWeek).toHaveBeenCalledWith({ seasonId: 'season1', week: 1, actorId: 'admin:owner' })
    expect(d.recalcWeek).toHaveBeenCalledWith('season1', 1)
    expect(d.finalizeWeek).toHaveBeenCalledTimes(1)
    const [params, finalizeDeps] = (d.finalizeWeek as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(params).toEqual({ seasonId: 'season1', week: 1 })
    expect(typeof finalizeDeps.notifyResults).toBe('function')
    expect(d.standings).toHaveBeenCalledWith('season1', 1)
    expect(out.rescore?.applied[0]).toMatchObject({ week: 1, scoresUpserted: 4, reSeal: { finalized: true } })
    expect(fx.db.leagueAuditLog.create).toHaveBeenCalledTimes(1)
  })

  it('confirm="allow-flips" writes despite the flip', async () => {
    const d = deps(fx.db)
    const out = await runStatReingest(req({ dryRun: false, confirm: 'allow-flips', weeks: [1, 2] }), 'admin:x', d)
    expect(out.rescore?.wrote).toBe(true)
    expect(d.syncWeek).toHaveBeenCalledTimes(2)
    expect(d.recalcWeek).toHaveBeenCalledTimes(2)
  })

  it('does not re-seal a week that was not sealed', async () => {
    const open = fakeDb({ sealed: false })
    const d = deps(open.db, { loadWeekStats: vi.fn(async () => new Map()) })
    await runStatReingest(req({ dryRun: false, confirm: true, skipIngest: true }), 'admin:x', d)
    expect(d.syncWeek).toHaveBeenCalledTimes(1)
    expect(d.finalizeWeek).not.toHaveBeenCalled()
  })

  it('an unsupported preview needs allow-flips before writing', async () => {
    const d = deps(fx.db, { usesDevyEngine: async () => true })
    const out = await runStatReingest(req({ dryRun: false, confirm: true, skipIngest: true }), 'admin:x', d)
    expect(out.rescore?.weeks[0]).toMatchObject({ supported: false, reason: 'devy_engine' })
    expect(out.rescore?.writeRefusal).toBe('preview_unsupported_requires_allow_flips')
    expect(d.syncWeek).not.toHaveBeenCalled()
  })

  it('refuses a league whose sport does not match, before any ingest', async () => {
    const d = deps(fx.db)
    await expect(runStatReingest(req({ sport: 'NBA', dryRun: false }), 'admin:x', d)).rejects.toBeInstanceOf(StatReingestError)
    expect(d.ingest).not.toHaveBeenCalled()
  })

  it('NFL: no date ingest and no write', async () => {
    const d = deps(fx.db)
    const out = await runStatReingest(req({ sport: 'NFL', leagueId: null, weeks: [], dryRun: false }), 'admin:x', d)
    expect(d.ingest).not.toHaveBeenCalled()
    expect(out.ingest.ran).toBe(false)
    expect(out.goalies).toBeNull()
    expect(out.rescore).toBeNull()
  })
})
