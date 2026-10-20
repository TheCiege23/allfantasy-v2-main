/**
 * The manager's "which games count" API (lib/redraft/gamesCountService.ts, app/api/redraft/games-count):
 * every refusal, and the two writes it allows.
 *
 * NBA 2026 week 1 is Tue 20 – Mon 26 Oct. The player is a Celtic with games g1 (20th), g2 (22nd) and a
 * scheduled g3 (24th).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  league: { findFirst: vi.fn(), findUnique: vi.fn() },
  redraftSeason: { findFirst: vi.fn() },
  redraftMatchup: { findMany: vi.fn() },
  redraftRosterPlayer: { findFirst: vi.fn() },
  roster: { findMany: vi.fn() },
  afRosterLineupAssignment: { findMany: vi.fn() },
  redraftDailyLineup: { findMany: vi.fn() },
  sportsDataCache: { findUnique: vi.fn(), findMany: vi.fn() },
  playerWeekGameScore: { findMany: vi.fn() },
  redraftGamesCountChoice: { findUnique: vi.fn(), findMany: vi.fn(), upsert: vi.fn() },
  $queryRaw: vi.fn(),
}))
const auth = vi.hoisted(() => ({
  member: vi.fn(),
  lookup: vi.fn(),
  session: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/league/league-access', () => ({ assertLeagueMember: auth.member }))
vi.mock('@/lib/redraft/redraftRosterIdentity', () => ({ resolveRedraftRosterLookupReadOnly: auth.lookup }))
vi.mock('next-auth', () => ({ getServerSession: auth.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/devy/scoringEligibilityEngine', () => ({ leagueUsesDevyEngine: vi.fn(async () => false), calculateOfficialTeamScore: vi.fn() }))
vi.mock('@/lib/c2c/scoringEngine', () => ({ leagueUsesC2CEngine: vi.fn(async () => false), updateC2CMatchupScores: vi.fn() }))
vi.mock('@/lib/events', () => ({ getPlatformEvents: () => ({ emit: vi.fn(async () => undefined) }), EVENT: {} }))
vi.mock('@/lib/sports-evidence/gates', () => ({ isSportsDataEnabled: () => false }))

import { applyGamesCountAction, getGamesCountState } from '@/lib/redraft/gamesCountService'
import { resetGamesCountTablesProbe } from '@/lib/redraft/gamesCountStore'

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const BEST2 = { sportConfig: { gamesCountMode: 'best_n', gamesCountBestN: 2 } }
const LOCK = { sportConfig: { gamesCountMode: 'lock_in' } }
const NOW = new Date('2026-10-23T15:00:00.000Z') // Fri: g2 is over, g3 (Sat) has not started

type Sched = { gameId: string; day: string; startTime: string; status: string; homeTeam: string; awayTeam: string }
let schedule: Sched[]

function arrange(settings: unknown, over: { slot?: string; stats?: Array<[string, string, number]>; choice?: Record<string, unknown> | null } = {}) {
  auth.member.mockResolvedValue({ ok: true })
  db.$queryRaw.mockResolvedValue([{ ok: true }])
  auth.lookup.mockResolvedValue({ season: { id: 's1', leagueId: 'L1' }, roster: { id: 'r1', leagueId: 'L1' } })
  db.league.findUnique.mockResolvedValue({ sport: 'NBA', settings })
  db.league.findFirst.mockResolvedValue({ sport: 'NBA', settings })
  db.redraftSeason.findFirst.mockResolvedValue({ id: 's1', season: 2026, currentWeek: 1 })
  db.redraftMatchup.findMany.mockResolvedValue([{ status: 'active', homeRosterId: 'r1', awayRosterId: 'r2' }])
  db.redraftRosterPlayer.findFirst.mockResolvedValue({
    rosterId: 'r1', playerId: 'p1', sport: 'NBA', position: 'PG', team: 'Boston Celtics', slotType: over.slot ?? 'PG',
    addedAt: new Date('2026-10-01T00:00:00Z'), droppedAt: null,
  })
  db.roster.findMany.mockResolvedValue([])
  db.afRosterLineupAssignment.findMany.mockResolvedValue([])
  db.redraftDailyLineup.findMany.mockResolvedValue([])
  const stats = over.stats ?? [['g1', '2026-10-20', 10], ['g2', '2026-10-22', 30]]
  db.playerWeekGameScore.findMany.mockResolvedValue(
    stats.map(([gameId, d, pts]) => ({ playerId: 'p1', gameId, gameDay: day(d), startTime: null, stats: { pts } })),
  )
  db.redraftGamesCountChoice.findUnique.mockResolvedValue(over.choice ?? null)
  db.redraftGamesCountChoice.upsert.mockImplementation(async (a: { create: unknown }) => a.create)
  schedule = [
    { gameId: 'g1', day: '2026-10-20', startTime: '2026-10-20T23:30:00.000Z', status: 'final', homeTeam: 'Boston Celtics', awayTeam: 'New York Knicks' },
    { gameId: 'g2', day: '2026-10-22', startTime: '2026-10-22T23:30:00.000Z', status: 'final', homeTeam: 'Miami Heat', awayTeam: 'Boston Celtics' },
    { gameId: 'g3', day: '2026-10-24', startTime: '2026-10-24T23:30:00.000Z', status: 'scheduled', homeTeam: 'Boston Celtics', awayTeam: 'Detroit Pistons' },
  ]
  db.sportsDataCache.findUnique.mockResolvedValue({ data: {} })
  db.sportsDataCache.findMany.mockImplementation(async () => [{ cacheKey: 'NBA:rischedule:2026:x', data: { games: schedule } }])
}

const act = (input: Parameters<typeof applyGamesCountAction>[0]['input'], now = NOW) =>
  applyGamesCountAction({ leagueId: 'L1', userId: 'u1', playerId: 'p1', input, now })

beforeEach(() => {
  vi.clearAllMocks()
  resetGamesCountTablesProbe()
})

describe('refusals before anything is read from the new tables', () => {
  it('403 for a non-member', async () => {
    arrange(LOCK)
    auth.member.mockResolvedValue({ ok: false, status: 403 })
    const r = await act({ action: 'lock', gameId: 'g2' })
    expect(r).toMatchObject({ ok: false, status: 403 })
    expect(db.playerWeekGameScore.findMany).not.toHaveBeenCalled()
  })

  it('409 when the league counts every game — and neither new table is queried', async () => {
    arrange({ sportConfig: {} })
    const r = await getGamesCountState({ leagueId: 'L1', userId: 'u1', playerIds: ['p1'] })
    expect(r).toMatchObject({ ok: false, status: 409, code: 'games_count_off' })
    expect(db.playerWeekGameScore.findMany).not.toHaveBeenCalled()
    expect(db.redraftGamesCountChoice.findUnique).not.toHaveBeenCalled()
  })

  it('fail safe: tables missing → 409 games_count_storage_unavailable, no query against them, a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      arrange(LOCK)
      db.$queryRaw.mockResolvedValue([{ ok: false }])
      expect(await act({ action: 'lock', gameId: 'g2' })).toMatchObject({ ok: false, status: 409, code: 'games_count_storage_unavailable' })
      expect(await getGamesCountState({ leagueId: 'L1', userId: 'u1', playerIds: ['p1'] })).toMatchObject({ status: 409 })
      expect(db.playerWeekGameScore.findMany).not.toHaveBeenCalled()
      expect(db.redraftGamesCountChoice.findUnique).not.toHaveBeenCalled()
      expect(db.redraftGamesCountChoice.upsert).not.toHaveBeenCalled()
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('[games-count] api'))
    } finally {
      warn.mockRestore()
    }
  })

  it('403 for a member with no team in the league (roster ownership)', async () => {
    arrange(LOCK)
    auth.lookup.mockResolvedValue({ season: { id: 's1', leagueId: 'L1' }, roster: null })
    expect(await act({ action: 'lock', gameId: 'g2' })).toMatchObject({ ok: false, status: 403, code: 'no_roster' })
  })

  it('404 for a player who is not on the manager\'s roster', async () => {
    arrange(LOCK)
    db.redraftRosterPlayer.findFirst.mockResolvedValue(null)
    expect(await act({ action: 'lock', gameId: 'g2' })).toMatchObject({ ok: false, status: 404, code: 'not_on_roster' })
  })

  it('400 for a bad week', async () => {
    arrange(LOCK)
    const r = await applyGamesCountAction({ leagueId: 'L1', userId: 'u1', playerId: 'p1', week: 'x', input: { action: 'lock', gameId: 'g2' }, now: NOW })
    expect(r).toMatchObject({ ok: false, status: 400, code: 'bad_week' })
  })
})

describe('refusals for the week and the player', () => {
  it('409 once his matchup is final', async () => {
    arrange(LOCK)
    db.redraftMatchup.findMany.mockResolvedValue([{ status: 'final', homeRosterId: 'r1', awayRosterId: 'r2' }])
    expect(await act({ action: 'lock', gameId: 'g2' })).toMatchObject({ ok: false, status: 409, code: 'week_final' })
    expect(db.redraftGamesCountChoice.upsert).not.toHaveBeenCalled()
  })

  it('409 for a player who was not started', async () => {
    arrange(BEST2, { slot: 'BN' })
    expect(await act({ action: 'pick', gameIds: ['g1'] })).toMatchObject({ ok: false, status: 409, code: 'not_started' })
  })
})

describe('best N picks', () => {
  it('409 in a lock-in league', async () => {
    arrange(LOCK)
    expect(await act({ action: 'pick', gameIds: ['g1'] })).toMatchObject({ ok: false, status: 409, code: 'wrong_mode' })
  })

  it('400 for too many, none, duplicates, or a game that is not his', async () => {
    arrange(BEST2, { stats: [['g1', '2026-10-20', 10], ['g2', '2026-10-22', 30], ['g3', '2026-10-24', 5]] })
    expect(await act({ action: 'pick', gameIds: ['g1', 'g2', 'g3'] })).toMatchObject({ status: 400, code: 'bad_pick' })
    expect(await act({ action: 'pick', gameIds: [] })).toMatchObject({ status: 400, code: 'bad_pick' })
    expect(await act({ action: 'pick', gameIds: ['g1', 'g1'] })).toMatchObject({ status: 400, code: 'bad_pick' })
    expect(await act({ action: 'pick', gameIds: ['g9'] })).toMatchObject({ status: 400, code: 'game_not_eligible' })
    expect(db.redraftGamesCountChoice.upsert).not.toHaveBeenCalled()
  })

  it('stores the picks and answers with what now counts', async () => {
    arrange(BEST2, { stats: [['g1', '2026-10-20', 10], ['g2', '2026-10-22', 30], ['g3', '2026-10-24', 5]] })
    const r = await act({ action: 'pick', gameIds: ['g3'] })
    expect(db.redraftGamesCountChoice.upsert.mock.calls[0][0].create).toMatchObject({ rosterId: 'r1', week: 1, playerId: 'p1', pickedGameIds: ['g3'] })
    expect(r).toMatchObject({ ok: true, countedGameIds: ['g2', 'g3'] })
  })
})

describe('lock-in', () => {
  it('409 in a best-N league', async () => {
    arrange(BEST2)
    expect(await act({ action: 'lock', gameId: 'g2' })).toMatchObject({ status: 409, code: 'wrong_mode' })
  })

  it('400 for a game that is not one of his started games', async () => {
    arrange(LOCK)
    expect(await act({ action: 'lock', gameId: 'g3' })).toMatchObject({ status: 400, code: 'game_not_eligible' })
  })

  it('409 for a game that has not finished (or that the schedule does not list)', async () => {
    arrange(LOCK)
    schedule[1].status = 'in progress'
    expect(await act({ action: 'lock', gameId: 'g2' })).toMatchObject({ status: 409, code: 'game_not_finished' })
    schedule.splice(1, 1)
    expect(await act({ action: 'lock', gameId: 'g2' })).toMatchObject({ status: 409, code: 'game_not_finished' })
  })

  it('409 once he has a stat line for a later game', async () => {
    arrange(LOCK)
    expect(await act({ action: 'lock', gameId: 'g1' })).toMatchObject({ status: 409, code: 'next_game_started' })
  })

  it('409 once his team\'s next scheduled game has started, even before any stat line exists', async () => {
    arrange(LOCK)
    expect(await act({ action: 'lock', gameId: 'g2' }, new Date('2026-10-24T23:45:00.000Z'))).toMatchObject({ status: 409, code: 'next_game_started' })
    expect(db.redraftGamesCountChoice.upsert).not.toHaveBeenCalled()
  })

  it('locks a finished game before his next one starts', async () => {
    arrange(LOCK)
    const r = await act({ action: 'lock', gameId: 'g2' })
    expect(db.redraftGamesCountChoice.upsert.mock.calls[0][0].create).toMatchObject({ playerId: 'p1', lockedGameId: 'g2', lockedAt: NOW })
    expect(r).toMatchObject({ ok: true, countedGameIds: ['g2'], choice: { lockedGameId: 'g2' } })
  })

  it('409 when a game is already locked in', async () => {
    arrange(LOCK, { choice: { pickedGameIds: [], lockedGameId: 'g1' } })
    expect(await act({ action: 'lock', gameId: 'g2' })).toMatchObject({ status: 409, code: 'already_locked' })
  })

  it('daily-lineup league: a game on a day he was benched cannot be locked', async () => {
    arrange({ sportConfig: { lineupLockType: 'daily', dailyLineupsEnabled: true, gamesCountMode: 'lock_in' } })
    db.redraftDailyLineup.findMany.mockResolvedValue([
      { rosterId: 'r1', playerId: 'p1', scoringDay: day('2026-10-20'), slotType: 'PG' },
      { rosterId: 'r1', playerId: 'p1', scoringDay: day('2026-10-22'), slotType: 'BN' },
    ])
    expect(await act({ action: 'lock', gameId: 'g2' })).toMatchObject({ status: 400, code: 'game_not_eligible' })
  })
})

describe('the route', () => {
  it('401 without a session, 400 for an unknown action, and passes a refusal\'s status through', async () => {
    const { GET, POST } = await import('@/app/api/redraft/games-count/route')
    auth.session.mockResolvedValue(null)
    const anon = await GET({ nextUrl: new URL('http://x/api/redraft/games-count?leagueId=L1&playerId=p1') } as never)
    expect(anon.status).toBe(401)

    auth.session.mockResolvedValue({ user: { id: 'u1' } })
    const bad = await POST({ json: async () => ({ leagueId: 'L1', playerId: 'p1', action: 'nuke' }) } as never)
    expect(bad.status).toBe(400)

    arrange(LOCK)
    db.redraftMatchup.findMany.mockResolvedValue([{ status: 'final', homeRosterId: 'r1', awayRosterId: 'r2' }])
    const final = await POST({ json: async () => ({ leagueId: 'L1', playerId: 'p1', action: 'lock', gameId: 'g2' }) } as never)
    expect(final.status).toBe(409)
    expect((await final.json()).code).toBe('week_final')
  })
})
