/**
 * The finalizer's fourth condition (lib/redraft/weekStatEvidence.ts): a player with no stat row may be
 * sealed at 0 only when his team's game is final AND the feed holds other stat lines for that game, or
 * his team had no game. A whole game's box score missing must hold the week open — in best ball that
 * game is a fifth of a roster, and a Guilly chop runs on the sealed week.
 *
 * The fake prisma answers each query from its WHERE clause, so a test that passes is evidence about the
 * query the finalizer actually sent, not about a mock that answers anything.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { finalizeRedraftWeek, finalizeWeekWithRefresh, WEEK_STAT_GAP_ACTION, WEEK_STAT_GAP_SEALED_ACTION } from '@/lib/redraft/weekFinalizer'

type AnyArgs = Record<string, any>

const SEASON = { id: 'season-1', leagueId: 'league-1', sport: 'NFL', season: 2026 }
const LAST_KICKOFF = '2026-09-21T20:15:00.000Z'
/** 13 hours after the last kickoff — past the 12-hour grace, inside the 24-hour escalation. */
const AFTER_GRACE = new Date('2026-09-22T09:15:00.000Z')
/** 12h grace + 24h escalation + a little: the gap is now the commissioner's to know about. */
const PAST_ESCALATION = new Date('2026-09-23T09:30:00.000Z')

type RosterRow = { rosterId: string; playerId: string; sport: string; slotType: string; position: string; team: string | null }
const p = (playerId: string, team: string | null, slotType = 'BN', position = 'WR'): RosterRow => ({
  rosterId: 'roster-1',
  playerId,
  sport: 'NFL',
  slotType,
  position,
  team,
})

/** Two games on the slate: KC at BUF, and DAL at PHI. Everyone else is on a bye. */
function slate(status = 'final') {
  return [
    { status, startTime: new Date(LAST_KICKOFF), source: 'espn', fetchedAt: new Date('2026-09-22T08:00:00.000Z'), season: 2026, week: 2, homeTeam: 'BUF', awayTeam: 'KC' },
    { status, startTime: new Date('2026-09-21T17:00:00.000Z'), source: 'espn', fetchedAt: new Date('2026-09-22T08:00:00.000Z'), season: 2026, week: 2, homeTeam: 'PHI', awayTeam: 'DAL' },
  ]
}

function makePrisma(opts: {
  /** The league's own best ball roster (every player counts). */
  roster: RosterRow[]
  /** Rows this league's players hold this week. */
  ownScores: Array<{ playerId: string; stats: Record<string, number> }>
  /** Players on OTHER rosters (other leagues), by team, with their rows this week. */
  elsewhere?: Array<{ playerId: string; team: string; position?: string; stats?: Record<string, number> | null }>
  auditExisting?: boolean
}) {
  const calls: Array<{ key: string; args: AnyArgs }> = []
  const rec = (key: string, args: AnyArgs) => calls.push({ key, args })
  let matchupReads = 0
  const elsewhere = opts.elsewhere ?? []
  const allScores = [
    ...opts.ownScores,
    ...elsewhere.filter((e) => e.stats != null).map((e) => ({ playerId: e.playerId, stats: e.stats! })),
  ]
  const prisma = {
    redraftSeason: { findFirst: vi.fn(async () => SEASON) },
    league: {
      findFirst: vi.fn(async () => ({ bestBallMode: true, leagueType: 'best_ball', leagueVariant: null, platform: 'sleeper', settings: {} })),
    },
    redraftMatchup: {
      findMany: vi.fn(async (args: AnyArgs) => {
        rec('redraftMatchup.findMany', args)
        matchupReads += 1
        return matchupReads === 1 ? [{ id: 'm1', status: 'active', awayRosterId: 'roster-2' }] : [{ status: 'final' }]
      }),
    },
    sportsGame: {
      findMany: vi.fn(async (args: AnyArgs) => {
        rec('sportsGame.findMany', args)
        return slate()
      }),
    },
    redraftRoster: { findMany: vi.fn(async () => [{ id: 'roster-1' }]) },
    redraftRosterPlayer: {
      findMany: vi.fn(async (args: AnyArgs) => {
        rec('redraftRosterPlayer.findMany', args)
        // The teammate lookup asks by team; the roster reads ask by roster id.
        if (args.where?.team) {
          const teams: string[] = args.where.team.in
          const own = opts.roster.filter((r) => r.team && teams.includes(r.team))
          const other = elsewhere.filter((e) => teams.includes(e.team)).map((e) => ({ playerId: e.playerId, team: e.team, position: e.position ?? 'WR' }))
          return [...own, ...other]
        }
        return opts.roster
      }),
    },
    roster: { findMany: vi.fn(async () => []) },
    afRosterLineupAssignment: { findMany: vi.fn(async () => []) },
    playerWeeklyScore: {
      findMany: vi.fn(async (args: AnyArgs) => {
        rec('playerWeeklyScore.findMany', args)
        const ids: string[] = args.where.playerId.in
        return allScores.filter((s) => ids.includes(s.playerId)).map((s) => ({ playerId: s.playerId, sport: 'NFL', stats: s.stats }))
      }),
      createMany: vi.fn(async (args: AnyArgs) => {
        rec('playerWeeklyScore.createMany', args)
        return { count: args.data.length }
      }),
      updateMany: vi.fn(async (args: AnyArgs) => {
        rec('playerWeeklyScore.updateMany', args)
        return { count: 1 }
      }),
    },
    leagueAuditLog: {
      findFirst: vi.fn(async (args: AnyArgs) => {
        rec('leagueAuditLog.findFirst', args)
        return opts.auditExisting ? { id: 'already' } : null
      }),
      create: vi.fn(async (args: AnyArgs) => {
        rec('leagueAuditLog.create', args)
        return { id: 'log-1' }
      }),
    },
  }
  return { prisma: prisma as any, calls }
}

const writes = (calls: Array<{ key: string }>) =>
  calls.filter((c) => ['playerWeeklyScore.createMany', 'playerWeeklyScore.updateMany'].includes(c.key))

const recalc = vi.fn(async () => ({ updated: 1, incomplete: 0, summaries: [] as any[] }))
const quiet = { enqueueTankingScan: async () => {}, notifyResults: async () => {}, resolvePredictions: async () => {} }

/** A best ball roster of five: four with real lines, `x` (on `team`) with none — coverage 0.8, the floor. */
function roster(team: string | null) {
  return {
    roster: [p('a1', 'BUF'), p('a2', 'PHI'), p('a3', 'DAL'), p('a4', 'BUF'), p('x', team)],
    ownScores: [
      { playerId: 'a1', stats: { rec: 4 } },
      { playerId: 'a2', stats: { rec: 2 } },
      { playerId: 'a3', stats: { rush_yd: 30 } },
      { playerId: 'a4', stats: { rec: 1 } },
    ],
  }
}

beforeEach(() => {
  recalc.mockClear()
  delete process.env.REDRAFT_WEEK_FINALIZER_DISABLED
})

describe('missing stats are sealed at 0 only with evidence the player did not play', () => {
  it('his team played, and the feed has another KC line this week: a real 0, sealed', async () => {
    const { prisma, calls } = makePrisma({
      ...roster('KC'),
      elsewhere: [{ playerId: 'kc-wr', team: 'KC', stats: { rec: 6, rec_yd: 81 } }],
    })
    const result = await finalizeRedraftWeek({ seasonId: SEASON.id, week: 2 }, { prisma, now: () => AFTER_GRACE, recalculateMatchups: recalc as any, ...quiet })

    expect(result.refusal).toBeNull()
    expect(result.finalized).toBe(true)
    expect(result.zeroedPlayerIds).toEqual(['x'])
    expect(result.unverifiedZeroPlayerIds).toBeUndefined()
    // The teammate read asked for KC, this sport, and capped itself.
    const teammateRead = calls.find((c) => c.key === 'redraftRosterPlayer.findMany' && c.args.where?.team)
    expect(teammateRead?.args.where).toEqual({ sport: { in: ['NFL'] }, team: { in: ['KC'] } })
    expect(teammateRead?.args.take).toBeGreaterThan(0)
  })

  it('🛑 his team played and the feed holds NOTHING for that game: refuses, and writes no zero', async () => {
    const { prisma, calls } = makePrisma({ ...roster('KC') })
    const result = await finalizeRedraftWeek({ seasonId: SEASON.id, week: 2 }, { prisma, now: () => AFTER_GRACE, recalculateMatchups: recalc as any, ...quiet })

    expect(result.refusal).toBe('game_stats_missing')
    expect(result.finalized).toBe(false)
    expect(result.coverage).toBe(0.8) // the old floor alone would have sealed this
    expect(result.statGapTeams).toEqual(['KC'])
    expect(result.statGapPlayerIds).toEqual(['x'])
    expect(writes(calls)).toHaveLength(0)
    expect(recalc).not.toHaveBeenCalled()
    // Inside the escalation window: no league-log row yet.
    expect(calls.some((c) => c.key === 'leagueAuditLog.create')).toBe(false)
  })

  it('an EMPTY row (a sealed zero) and a TEAM DEFENSE row are not evidence the box score arrived', async () => {
    const { prisma, calls } = makePrisma({
      ...roster('KC'),
      elsewhere: [
        { playerId: 'kc-sealed-zero', team: 'KC', stats: {} },
        { playerId: 'nfl:def:KC', team: 'KC', position: 'DEF', stats: { def_points_allowed: 20 } },
      ],
    })
    const result = await finalizeRedraftWeek({ seasonId: SEASON.id, week: 2 }, { prisma, now: () => AFTER_GRACE, recalculateMatchups: recalc as any, ...quiet })
    expect(result.refusal).toBe('game_stats_missing')
    expect(writes(calls)).toHaveLength(0)
  })

  it('his team is not on the slate (a bye): a real 0, sealed without any teammate read', async () => {
    const { prisma, calls } = makePrisma({ ...roster('SEA') })
    const result = await finalizeRedraftWeek({ seasonId: SEASON.id, week: 2 }, { prisma, now: () => AFTER_GRACE, recalculateMatchups: recalc as any, ...quiet })
    expect(result.finalized).toBe(true)
    expect(result.zeroedPlayerIds).toEqual(['x'])
    expect(calls.some((c) => c.key === 'redraftRosterPlayer.findMany' && c.args.where?.team)).toBe(false)
  })

  it('a team defense with no row is placed by its id, and its game being box-less holds the week', async () => {
    const { prisma } = makePrisma({
      roster: [p('a1', 'BUF'), p('a2', 'PHI'), p('a3', 'DAL'), p('a4', 'BUF'), p('nfl:def:KC', null, 'BN', 'DEF')],
      ownScores: roster('KC').ownScores,
    })
    const result = await finalizeRedraftWeek({ seasonId: SEASON.id, week: 2 }, { prisma, now: () => AFTER_GRACE, recalculateMatchups: recalc as any, ...quiet })
    expect(result.refusal).toBe('game_stats_missing')
    expect(result.statGapTeams).toEqual(['KC'])
  })

  it('no team on the row: the old tolerance stands, but the zero is reported as unverified', async () => {
    const { prisma } = makePrisma({ ...roster(null) })
    const result = await finalizeRedraftWeek({ seasonId: SEASON.id, week: 2 }, { prisma, now: () => AFTER_GRACE, recalculateMatchups: recalc as any, ...quiet })
    expect(result.finalized).toBe(true)
    expect(result.unverifiedZeroPlayerIds).toEqual(['x'])
  })

  it('a dry run gives the same answer and writes nothing — the refresh probe relies on it', async () => {
    const { prisma, calls } = makePrisma({ ...roster('KC') })
    const result = await finalizeRedraftWeek({ seasonId: SEASON.id, week: 2, dryRun: true }, { prisma, now: () => PAST_ESCALATION })
    expect(result.refusal).toBe('game_stats_missing_escalated')
    expect(writes(calls)).toHaveLength(0)
    expect(calls.some((c) => c.key.startsWith('leagueAuditLog'))).toBe(false)
  })
})

describe('the escalation: bounded waiting, visible to the commissioner, never a seal', () => {
  it('a day past the grace period the refusal escalates and ONE commissioner log row is written', async () => {
    const { prisma, calls } = makePrisma({ ...roster('KC') })
    const result = await finalizeRedraftWeek({ seasonId: SEASON.id, week: 2 }, { prisma, now: () => PAST_ESCALATION, recalculateMatchups: recalc as any, ...quiet })

    expect(result.refusal).toBe('game_stats_missing_escalated')
    expect(writes(calls)).toHaveLength(0)
    const created = calls.find((c) => c.key === 'leagueAuditLog.create')
    expect(created?.args.data).toMatchObject({
      leagueId: 'league-1',
      userId: null,
      actionType: WEEK_STAT_GAP_ACTION,
      entityId: 'season-1:2',
      afterState: { teams: ['KC'], playerIds: ['x'] },
      metadata: { season: 2026, week: 2, sport: 'NFL' },
    })
  })

  it('the five-minute sweep re-refusing the same week does not write the row again', async () => {
    const { prisma, calls } = makePrisma({ ...roster('KC'), auditExisting: true })
    const result = await finalizeRedraftWeek({ seasonId: SEASON.id, week: 2 }, { prisma, now: () => PAST_ESCALATION, recalculateMatchups: recalc as any, ...quiet })
    expect(result.refusal).toBe('game_stats_missing_escalated')
    expect(calls.find((c) => c.key === 'leagueAuditLog.findFirst')?.args.where).toEqual({
      leagueId: 'league-1',
      actionType: WEEK_STAT_GAP_ACTION,
      entityId: 'season-1:2',
    })
    expect(calls.some((c) => c.key === 'leagueAuditLog.create')).toBe(false)
  })

  it('the sweep backfills once on a missing box score, and seals when the backfill brings it', async () => {
    // Before the backfill the feed has nothing for KC; after it, KC's box score has landed.
    const { prisma: before } = makePrisma({ ...roster('KC') })
    const { prisma: after } = makePrisma({ ...roster('KC'), elsewhere: [{ playerId: 'kc-te', team: 'KC', stats: { rec: 3 } }] })
    let synced = false
    const syncWeekStats = vi.fn(async () => {
      synced = true
    })
    const result = await finalizeWeekWithRefresh(
      { seasonId: SEASON.id, week: 2 },
      {
        now: () => AFTER_GRACE,
        recalculateMatchups: recalc as any,
        ...quiet,
        syncWeekStats,
        get prisma() {
          return synced ? after : before
        },
      } as any,
    )
    expect(syncWeekStats).toHaveBeenCalledOnce()
    expect(syncWeekStats).toHaveBeenCalledWith({ seasonId: SEASON.id, week: 2 })
    expect(result.refusal).toBeNull()
    expect(result.finalized).toBe(true)
  })
})

describe('the hard cap: a box score that never arrives cannot freeze the league', () => {
  // Grace ends 2026-09-22T08:15Z; the cap is 72h after that.
  const PAST_CAP = new Date('2026-09-25T09:30:00.000Z')

  it('three days past the grace period the week seals, reports the zeros as unverified and logs it once', async () => {
    const { prisma, calls } = makePrisma({ ...roster('KC') })
    const result = await finalizeRedraftWeek({ seasonId: SEASON.id, week: 2 }, { prisma, now: () => PAST_CAP, recalculateMatchups: recalc as any, ...quiet })
    expect(result.refusal).toBeNull()
    expect(result.finalized).toBe(true)
    expect(result.unverifiedZeroPlayerIds).toEqual(['x'])
    const created = calls.find((c) => c.key === 'leagueAuditLog.create')
    expect(created?.args.data).toMatchObject({ actionType: WEEK_STAT_GAP_SEALED_ACTION, entityId: 'season-1:2', afterState: { teams: ['KC'], playerIds: ['x'] } })
  })

  it('just before the cap it still refuses', async () => {
    const { prisma } = makePrisma({ ...roster('KC') })
    const result = await finalizeRedraftWeek({ seasonId: SEASON.id, week: 2 }, { prisma, now: () => new Date('2026-09-25T08:00:00.000Z'), recalculateMatchups: recalc as any, ...quiet })
    expect(result.refusal).toBe('game_stats_missing_escalated')
  })

  it('the sealed-anyway row is commissioner-only and says the week closed', async () => {
    const { describeLogEntry } = await import('@/lib/league-log/leagueLog')
    const row = {
      id: 'log-2',
      actionType: WEEK_STAT_GAP_SEALED_ACTION,
      entityId: 'season-1:2',
      userId: null,
      beforeState: null,
      afterState: { teams: ['KC'], playerIds: ['x'] },
      metadata: { season: 2026, week: 2, sport: 'NFL' },
      createdAt: '2026-09-25T09:30:00.000Z',
    }
    const names = { users: {}, teams: {} }
    expect(describeLogEntry(row, { lang: 'en', names, forCommissioner: false })).toBeNull()
    expect(describeLogEntry(row, { lang: 'en', names, forCommissioner: true })?.title).toBe('Week 2 closed with stats still missing')
  })
})

describe('the escalation as the commissioner reads it', () => {
  it('is worded for the commissioner and hidden from members', async () => {
    const { describeLogEntry } = await import('@/lib/league-log/leagueLog')
    const row = {
      id: 'log-1',
      actionType: WEEK_STAT_GAP_ACTION,
      entityId: 'season-1:2',
      userId: null,
      beforeState: null,
      afterState: { teams: ['KC'], playerIds: ['x'] },
      metadata: { season: 2026, week: 2, sport: 'NFL' },
      createdAt: '2026-09-23T09:30:00.000Z',
    }
    const names = { users: {}, teams: {} }
    expect(describeLogEntry(row, { lang: 'en', names, forCommissioner: false })).toBeNull()
    const entry = describeLogEntry(row, { lang: 'en', names, forCommissioner: true })
    expect(entry?.title).toBe('Week 2 is waiting on missing stats')
    expect(entry?.detail).toContain('No box score has arrived for KC.')
    expect(entry?.category).toBe('scoring')
  })
})
