/**
 * "Apply tournament schedule" re-applies the conference season plan to leagues whose season existed
 * before the plan — only when that season has not started — and reports every league.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => {
  const state = {
    season: null as null | Record<string, unknown>,
    matchups: [] as Array<Record<string, unknown>>,
    scored: 0,
    /** Matchups seen on the re-read inside the transaction (a week scored in between). */
    matchupsInTx: null as null | Array<Record<string, unknown>>,
    inTx: false,
  }
  const redraftMatchup = {
    findMany: vi.fn(async () => (state.inTx && state.matchupsInTx ? state.matchupsInTx : state.matchups)),
    deleteMany: vi.fn(async () => ({ count: state.matchups.length })),
  }
  const prisma = {
    redraftSeason: { findFirst: vi.fn(async () => state.season), update: vi.fn(async () => ({})) },
    redraftMatchup,
    teamWeekResult: { count: vi.fn(async () => state.scored) },
    tournamentShell: { findUnique: vi.fn() },
    tournamentLeague: { findMany: vi.fn() },
    tournamentAuditLog: { create: vi.fn(async () => ({})) },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => { state.inTx = true; try { return await fn(prisma) } finally { state.inTx = false } }),
  }
  return { state, prisma, applySeasonPlan: vi.fn(async () => undefined), ensureSchedule: vi.fn(async () => undefined) }
})

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))
vi.mock('@/lib/redraft/finalizeDraftToRedraftSeason', () => ({ ensureScheduleForNewSeason: m.ensureSchedule }))
vi.mock('@/lib/tournament/divisions/conferenceLeagues', () => ({ applySeasonPlan: m.applySeasonPlan, CONFERENCE_LEAGUE_READY: 'ready' }))

const { reapplyConferenceSchedule, applyTournamentScheduleToLeagues, seasonHasStarted, scheduleOutcomeSummary } = await import('@/lib/tournament/divisions/conferenceSchedule')
const { buildConferenceSeasonPlan } = await import('@/lib/tournament/divisions/conferenceSeasonPlan')
const { defaultFormatSettings } = await import('@/lib/tournament/divisions/engine')

const plan = buildConferenceSeasonPlan('t1', defaultFormatSettings('NFL')) // lastWeek 17
const oldSeason = { id: 's1', season: 2026, sport: 'NFL', status: 'active', currentWeek: 1, totalWeeks: 18, playoffStartWeek: 15, medianGame: false }
const week = (w: number, extra: Record<string, unknown> = {}) => ({ week: w, status: 'scheduled', homeScore: 0, awayScore: 0, lineupSnapshots: null, ...extra })
const oldSchedule = Array.from({ length: 14 }, (_, i) => week(i + 1))

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(m.state, { season: null, matchups: [], scored: 0, matchupsInTx: null, inTx: false })
})

describe('seasonHasStarted', () => {
  it('a fresh season with only scheduled zero-score weeks has not started', () => {
    expect(seasonHasStarted(oldSeason, oldSchedule)).toBe(false)
  })
  it.each([
    ['a final matchup', [week(1, { status: 'final' })], 0, oldSeason],
    ['a live score', [week(1, { homeScore: 12.4 })], 0, oldSeason],
    ['a locked lineup snapshot', [week(1, { lineupSnapshots: {} })], 0, oldSeason],
    ['a stored week result', [week(1)], 1, oldSeason],
    ['the season moved past its first week', [week(1), week(2)], 0, { ...oldSeason, currentWeek: 2 }],
    ['a finished season', [week(1)], 0, { ...oldSeason, status: 'complete' }],
  ])('started: %s', (_label, matchups, scored, season) => {
    expect(seasonHasStarted(season, matchups, scored)).toBe(true)
  })
})

describe('reapplyConferenceSchedule', () => {
  it('reschedules an unstarted season onto the plan: 17 regular weeks, no playoffs', async () => {
    m.state.season = { ...oldSeason }
    m.state.matchups = oldSchedule
    await expect(reapplyConferenceSchedule('L1', plan)).resolves.toBe('rescheduled')
    expect(m.applySeasonPlan).toHaveBeenCalledWith('L1', plan)
    expect(m.prisma.redraftMatchup.deleteMany).toHaveBeenCalledWith({ where: { seasonId: 's1' } })
    expect(m.prisma.redraftSeason.update).toHaveBeenCalledWith({ where: { id: 's1' }, data: { totalWeeks: 17, playoffStartWeek: 18 } })
    expect(m.ensureSchedule).toHaveBeenCalledWith(expect.objectContaining({ seasonId: 's1', leagueId: 'L1', totalWeeks: 17, playoffStartWeek: 18, startWeek: 1 }))
  })

  it('keeps a late-start season starting on the week it already starts', async () => {
    m.state.season = { ...oldSeason, currentWeek: 5 }
    m.state.matchups = [week(5), week(6)]
    await reapplyConferenceSchedule('L1', plan)
    expect(m.ensureSchedule).toHaveBeenCalledWith(expect.objectContaining({ startWeek: 5 }))
  })

  it('refuses a season that has started and writes nothing to it', async () => {
    m.state.season = { ...oldSeason }
    m.state.matchups = [week(1, { status: 'final', homeScore: 101, awayScore: 99 }), ...oldSchedule.slice(1)]
    await expect(reapplyConferenceSchedule('L1', plan)).resolves.toBe('started')
    expect(m.prisma.redraftMatchup.deleteMany).not.toHaveBeenCalled()
    expect(m.prisma.redraftSeason.update).not.toHaveBeenCalled()
    expect(m.ensureSchedule).not.toHaveBeenCalled()
  })

  it('refuses when a week is scored between the check and the clear', async () => {
    m.state.season = { ...oldSeason }
    m.state.matchups = oldSchedule
    m.state.matchupsInTx = [week(1, { status: 'live', homeScore: 3 }), ...oldSchedule.slice(1)]
    await expect(reapplyConferenceSchedule('L1', plan)).resolves.toBe('started')
    expect(m.prisma.redraftMatchup.deleteMany).not.toHaveBeenCalled()
  })

  it('is idempotent: a season already on the plan is left alone', async () => {
    m.state.season = { ...oldSeason, totalWeeks: 17, playoffStartWeek: 18 }
    m.state.matchups = Array.from({ length: 17 }, (_, i) => week(i + 1))
    await expect(reapplyConferenceSchedule('L1', plan)).resolves.toBe('unchanged')
    expect(m.prisma.$transaction).not.toHaveBeenCalled()
    expect(m.ensureSchedule).not.toHaveBeenCalled()
  })

  it('a league with no season yet only gets the plan, which shapes the season when it is created', async () => {
    await expect(reapplyConferenceSchedule('L1', plan)).resolves.toBe('plan_saved')
    expect(m.applySeasonPlan).toHaveBeenCalled()
    expect(m.ensureSchedule).not.toHaveBeenCalled()
  })

  it('a schedule cleared by a run that then failed is rebuilt on the next run', async () => {
    m.state.season = { ...oldSeason, totalWeeks: 17, playoffStartWeek: 18 }
    m.state.matchups = []
    await expect(reapplyConferenceSchedule('L1', plan)).resolves.toBe('rescheduled')
    expect(m.ensureSchedule).toHaveBeenCalled()
  })
})

describe('applyTournamentScheduleToLeagues', () => {
  it('reports every conference league and writes one audit row', async () => {
    m.prisma.tournamentShell.findUnique.mockResolvedValue({ id: 't1', format: 'divisions', sport: 'NFL', formatSettings: {} })
    m.prisma.tournamentLeague.findMany.mockResolvedValue([
      { id: 'tl1', name: 'North', leagueId: 'L1', status: 'ready' },
      { id: 'tl2', name: 'South', leagueId: null, status: 'forming' },
      { id: 'tl3', name: 'East', leagueId: 'L3', status: 'ready' },
    ])
    m.applySeasonPlan.mockImplementationOnce(async () => undefined).mockImplementationOnce(async () => { throw new Error('db down') })
    const out = await applyTournamentScheduleToLeagues('t1', 'owner')
    expect(out.map(o => [o.name, o.outcome])).toEqual([['North', 'plan_saved'], ['South', 'not_ready'], ['East', 'failed']])
    expect(out[2]!.error).not.toContain('db down')
    expect(m.prisma.tournamentAuditLog.create).toHaveBeenCalledTimes(1)
    expect(m.prisma.tournamentAuditLog.create.mock.calls[0]![0].data.action).toBe('divisions_conference_schedules_applied')
  })

  it('does nothing for a tournament that is not a divisions tournament', async () => {
    m.prisma.tournamentShell.findUnique.mockResolvedValue({ id: 't1', format: 'bracket', sport: 'NFL', formatSettings: {} })
    await expect(applyTournamentScheduleToLeagues('t1', 'owner')).resolves.toEqual([])
    expect(m.prisma.tournamentAuditLog.create).not.toHaveBeenCalled()
  })

  it('summarises outcomes per group', () => {
    expect(scheduleOutcomeSummary([{ name: 'North', outcome: 'rescheduled' }, { name: 'East', outcome: 'started' }, { name: 'West', outcome: 'rescheduled' }]))
      .toBe('North, West: rescheduled. East: season already started, left as it is.')
  })
})
