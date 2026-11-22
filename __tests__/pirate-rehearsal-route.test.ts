import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { pirateRehearsalEnabled, PIRATE_STAGING_PROJECT, PIRATE_STAGING_ENVIRONMENT, isPirateRehearsalLeague } from '@/lib/pirate/stagingRehearsalScope'

const m = vi.hoisted(() => ({ auth: vi.fn(), league: vi.fn(), season: vi.fn(), users: vi.fn(), capture: vi.fn(),
  sync: vi.fn(), recalc: vi.fn(), standings: vi.fn(), finalize: vi.fn(), sealed: vi.fn(), seed: vi.fn(), maintain: vi.fn(), scheduleMeta: vi.fn(), schedule: vi.fn(), dataRun: vi.fn(), slate: vi.fn(), logs: vi.fn(), reference: vi.fn() }))
vi.mock('@/app/api/cron/_auth', () => ({ requireCronAuth: m.auth }))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findUnique: m.league }, redraftSeason: { findFirst: m.season }, appUser: { findMany: m.users }, sportsDataCache: { findUnique: m.scheduleMeta }, syncJobRun: { findFirst: m.dataRun } } }))
vi.mock('@/lib/sports-data/riSeasonSchedule', () => ({ syncRiSeasonSchedule: m.schedule }))
vi.mock('@/lib/sports-live-scores-service', () => ({ getLiveScoresForSport: m.slate }))
vi.mock('@/lib/sports-data/rollingInsightsGameLogs', () => ({ ingestRollingInsightsGameLogs: m.logs }))
vi.mock('@/lib/sports-data/riScheduleCache', async original => ({...await original<typeof import('@/lib/sports-data/riScheduleCache')>(),readRiScheduleWindow:m.reference}))
vi.mock('@/lib/pirate/lineupEvidence', () => ({ capturePirateLineupEvidence: m.capture }))
vi.mock('@/lib/pirate/service', () => ({ seedPirateClaims: m.seed, maintainPirateClaims: m.maintain }))
vi.mock('@/lib/redraft/playerWeeklyScoreService', () => ({ syncPlayerWeeklyScoresForRedraftSeason: m.sync }))
vi.mock('@/lib/redraft/scoringEngine', () => ({ recalculateMatchupsForSeasonWeek: m.recalc }))
vi.mock('@/lib/redraft/standingsEngine', () => ({ updateStandings: m.standings }))
vi.mock('@/lib/redraft/weekFinalizer', () => ({ finalizeCompletedWeeksForSeason: m.finalize }))
vi.mock('@/lib/redraft/weekSealed', () => ({ isRedraftWeekSealed: m.sealed }))
vi.mock('@/lib/production-health/syncJobRunTelemetry', () => ({ withSyncJobRun: async (_ctx: unknown, fn: () => Promise<unknown>) => fn() }))
import { GET } from '@/app/api/cron/pirate-rehearsal/route'

const settings = { PIRATE_REHEARSAL_ENABLED: '1', PIRATE_REHEARSAL_LEAGUE_ID: 'fixture',
  RAILWAY_PROJECT_ID: PIRATE_STAGING_PROJECT, RAILWAY_ENVIRONMENT_ID: PIRATE_STAGING_ENVIRONMENT,
  DATABASE_URL: 'postgresql://fixture@ep-winter-salad-test.c-2.us-east-1.aws.neon.tech/qa',
  PIRATE_REHEARSAL_UNTIL: '2026-11-07T12:00:00Z' }
const league = { id: 'fixture', tenantId: 'pirate-capture-live-test', platform: 'manual', leagueType: 'pirate', leagueVariant: 'pirate', settings: { pirate_live_rehearsal: true } }
const req = (task = 'capture') => new NextRequest(`https://pirate-web-staging.up.railway.app/api/cron/pirate-rehearsal?task=${task}`)
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-29T00:00:00Z')); vi.clearAllMocks()
  for (const [key, value] of Object.entries(settings)) vi.stubEnv(key, value)
  m.auth.mockReturnValue(true); m.league.mockResolvedValue(league)
  m.season.mockResolvedValue({ id: 'season', season: 2026, sport: 'NFL', currentWeek: 8, rosters: [{ ownerId: 'bot' }] })
  m.users.mockResolvedValue([{ id: 'bot', email: 'qa@example.invalid' }]); m.capture.mockResolvedValue(2)
  m.sync.mockResolvedValue({ scoresUpserted: 3 }); m.sealed.mockResolvedValue(false)
  m.finalize.mockResolvedValue({ finalized: 0, refusals: { games_not_final: 1 } })
  m.seed.mockResolvedValue(0); m.maintain.mockResolvedValue({ transferred: 0, failed: 0 })
  m.scheduleMeta.mockResolvedValue(null); m.schedule.mockResolvedValue({ fetched: true, games: 100, notModified: false, unsupported: false, error: null })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })

describe('bounded isolated rehearsal', () => {
  it.each(['RAILWAY_PROJECT_ID', 'RAILWAY_ENVIRONMENT_ID', 'DATABASE_URL', 'PIRATE_REHEARSAL_ENABLED', 'PIRATE_REHEARSAL_LEAGUE_ID'])('fails closed on an incorrect %s', key => {
    expect(pirateRehearsalEnabled({ ...settings, [key]: key === 'PIRATE_REHEARSAL_LEAGUE_ID' ? '' : 'wrong' })).toBe(false)
  })
  it('expires and refuses extensions past the reviewed date', () => {
    expect(pirateRehearsalEnabled(settings)).toBe(true)
    expect(pirateRehearsalEnabled(settings, Date.parse(settings.PIRATE_REHEARSAL_UNTIL))).toBe(false)
    expect(pirateRehearsalEnabled({ ...settings, PIRATE_REHEARSAL_UNTIL: '2027-01-01' })).toBe(false)
    expect(isPirateRehearsalLeague({ ...league, tenantId: 'allfantasy' }, 'fixture')).toBe(false)
    expect(isPirateRehearsalLeague(league, 'another-league')).toBe(false)
  })
  it('requires cron authorization before reading any league', async () => {
    m.auth.mockReturnValue(false); expect((await GET(req())).status).toBe(401); expect(m.league).not.toHaveBeenCalled()
  })
  it('refuses an untagged league or human owner', async () => {
    m.league.mockResolvedValueOnce({ ...league, settings: {} }); expect((await GET(req())).status).toBe(409)
    m.users.mockResolvedValueOnce([{ id: 'bot', email: 'human@example.com' }]); expect((await GET(req())).status).toBe(409)
    expect(m.capture).not.toHaveBeenCalled()
  })
  it('captures only the fixed fixture and does not run scoring in its capture worker', async () => {
    expect((await GET(req())).status).toBe(200)
    expect(m.capture).toHaveBeenCalledWith({ leagueId: 'fixture', seasonId: 'season', season: 2026, week: 8 })
    expect(m.sync).not.toHaveBeenCalled(); expect(m.seed).not.toHaveBeenCalled()
  })
  it('keeps the daily pilot disabled without a separately pinned league', async () => {
    expect((await GET(req('capture&pilot=daily'))).status).toBe(404)
    expect(m.league).not.toHaveBeenCalled()
  })
  it('requires a daily-tagged league, an NBA daily season, and synthetic owners', async () => {
    vi.stubEnv('PIRATE_DAILY_REHEARSAL_LEAGUE_ID', 'daily-fixture')
    const daily = { ...league, id: 'daily-fixture', tenantId: 'pirate-capture-live-daily-qa', settings: {
      pirate_live_rehearsal: true, pirate_daily_rehearsal: true,
      sportConfig: { lineupLockType: 'daily', dailyLineupsEnabled: true },
    } }
    m.league.mockResolvedValue(daily)
    expect((await GET(req('capture&pilot=daily'))).status).toBe(409) // NFL season cannot be repointed.
    m.season.mockResolvedValue({ id: 'daily-season', sport: 'NBA', season: 2026, currentWeek: 2, rosters: [{ ownerId: 'bot' }] })
    expect((await GET(req('capture&pilot=daily'))).status).toBe(200)
    expect(m.capture).toHaveBeenLastCalledWith({ leagueId: 'daily-fixture', seasonId: 'daily-season', season: 2026, week: 2 })
    m.capture.mockClear()
    expect((await GET(req('score&pilot=daily'))).status).toBe(409)
    m.dataRun.mockResolvedValue({status:'success',completedAt:new Date()})
    expect((await GET(req('score&pilot=daily'))).status).toBe(200)
    expect(m.maintain).toHaveBeenLastCalledWith({leagueId:'daily-fixture',limit:8})
    m.capture.mockClear()
    m.users.mockResolvedValueOnce([{ id: 'bot', email: 'human@example.com' }])
    expect((await GET(req('score&pilot=daily'))).status).toBe(409)
    m.league.mockResolvedValueOnce({ ...daily, tenantId: league.tenantId })
    expect((await GET(req('capture&pilot=daily'))).status).toBe(409)
    m.league.mockResolvedValueOnce({ ...daily, settings: { ...daily.settings, sportConfig: { lineupLockType: 'daily' } } })
    expect((await GET(req('capture&pilot=daily'))).status).toBe(409)
    expect(m.capture).not.toHaveBeenCalled()
  })
  it('does not accept arbitrary pilot selectors or let the daily pilot run schedule sweeps', async () => {
    expect((await GET(req('capture&pilot=user-league'))).status).toBe(400)
    expect((await GET(req('schedules&pilot=daily'))).status).toBe(400)
    expect(m.league).not.toHaveBeenCalled()
  })
  it('certifies the full daily calendar and only asks for game logs once that date has started', async () => {
    vi.setSystemTime(new Date('2026-10-29T12:00:00Z'))
    vi.stubEnv('PIRATE_DAILY_REHEARSAL_LEAGUE_ID','daily-fixture')
    m.league.mockResolvedValue({...league,id:'daily-fixture',tenantId:'pirate-capture-live-daily-qa',settings:{pirate_live_rehearsal:true,pirate_daily_rehearsal:true,
      sportConfig:{lineupLockType:'daily',dailyLineupsEnabled:true}}})
    m.season.mockResolvedValue({id:'daily-season',sport:'NBA',season:2026,currentWeek:2,rosters:[{ownerId:'bot'}]})
    const game={homeTeamFull:'Atlanta Hawks',awayTeamFull:'Cleveland Cavaliers',startTime:'2026-10-29T00:00:00Z'}
    const tomorrow={...game,startTime:'2026-10-30T00:00:00Z'}
    m.slate.mockResolvedValue({refreshed:true,source:'espn_live',scores:[game,tomorrow]})
    m.reference.mockResolvedValue([game,tomorrow].map(g=>({homeTeam:g.homeTeamFull,awayTeam:g.awayTeamFull,startTime:g.startTime,seasonType:'regular'})))
    m.logs.mockResolvedValue({errors:[],unsupported:false,notModifiedDates:[],datesFetched:1,written:12,unresolved:0})
    expect((await GET(req('data&pilot=daily'))).status).toBe(200)
    expect(m.slate.mock.calls[0][0].espnDates).toHaveLength(7)
    expect(m.logs).toHaveBeenCalledWith({sport:'NBA',dates:['2026-10-28']})
    m.logs.mockResolvedValueOnce({errors:[],unsupported:false,notModifiedDates:['2026-10-28'],datesFetched:0,written:0,unresolved:0})
    expect((await GET(req('data&pilot=daily'))).status).toBe(500)
  })
  it('retains fresh daily-sport schedules without spending provider calls', async () => {
    m.scheduleMeta.mockResolvedValue({ data: { syncedAt: new Date().toISOString() } })
    expect((await GET(req('schedules'))).status).toBe(200)
    expect(m.schedule).not.toHaveBeenCalled(); expect(m.sync).not.toHaveBeenCalled()
  })
  it('refreshes stale schedules for each daily sport and reports any failed provider', async () => {
    m.schedule.mockRejectedValueOnce(new Error('provider secret'))
    expect((await GET(req('schedules'))).status).toBe(500)
    expect(m.schedule).toHaveBeenCalledTimes(3)
  })
  it('keeps a sealed week closed and scopes claim maintenance', async () => {
    m.sealed.mockResolvedValue(true)
    expect((await GET(req('score'))).status).toBe(200)
    expect(m.sync).not.toHaveBeenCalled(); expect(m.recalc).not.toHaveBeenCalled()
    expect(m.maintain).toHaveBeenCalledWith({ leagueId: 'fixture', limit: 8 })
    expect(m.finalize.mock.calls[0][1]).toMatchObject({ notifyResults: expect.any(Function), enqueueTankingScan: expect.any(Function) })
  })
  it('captures before reconciling and reports failures without reflecting provider secrets', async () => {
    m.sync.mockRejectedValue(new Error('secret database url'))
    const response = await GET(req('score'))
    expect(response.status).toBe(500); expect(JSON.stringify(await response.json())).not.toContain('secret database')
    expect(m.capture.mock.invocationCallOrder[0]).toBeLessThan(m.sync.mock.invocationCallOrder[0])
  })
})
