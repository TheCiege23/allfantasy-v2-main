/**
 * The commissioner's "Lineups: Daily / Weekly" switch (NBA/NHL/MLB; lib/redraft/lineupModeSwitch.ts).
 *
 * Daily is the three-part gate `isDailyLineupScoringEnabled` reads (lineupLockType 'daily' AND
 * dailyLineupsEnabled AND a daily sport), so the switch must write BOTH fields, refuse other sports,
 * and — because daily-sport weeks run back to back and the lock reads the fields directly — refuse to
 * flip while a season is under way, so a week is never locked one way and scored the other.
 *
 * NBA 2026 opens 2026-10-20 (lib/season-week/dailySportSeasonStarts.ts): week 1 is [10-20, 10-27).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  prisma: {
    league: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    leagueWaiverSettings: { findUnique: vi.fn() },
    leagueSettings: { upsert: vi.fn() },
    redraftSeason: { findFirst: vi.fn(), findMany: vi.fn() },
    redraftPlayoffRound: { findFirst: vi.fn() },
    redraftRoster: { findFirst: vi.fn() },
    redraftLeagueTransaction: { create: vi.fn() },
    $queryRaw: vi.fn(),
  },
  session: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))
vi.mock('@/lib/league/permissions', () => ({
  requireCommissionerRole: vi.fn().mockResolvedValue(undefined),
  hasLeagueCommissionerRights: vi.fn().mockResolvedValue(true),
}))
vi.mock('next-auth', () => ({ getServerSession: m.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/subscription/EntitlementResolver', () => ({
  EntitlementResolver: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.resolveForUser = vi.fn().mockResolvedValue({ hasAccess: false })
  }),
}))
vi.mock('@/lib/league/league-settings-draft-sync', () => ({ syncDraftSessionFromLeagueSettings: vi.fn() }))
vi.mock('@/lib/live-draft-engine/RosterFitValidation', () => ({ validateDraftRoundsFitRoster: vi.fn() }))
vi.mock('@/lib/league/commissioner-settings-derived-sync', () => ({ syncCommissionerDerivedLeagueState: vi.fn() }))
vi.mock('@/server/services/commissionerService', () => ({ assertSettingsEditAllowed: vi.fn() }))
vi.mock('@/server/services/auditService', () => ({ logAction: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/analytics/recordAnalyticsEvent', () => ({ recordProductEvent: vi.fn() }))
vi.mock('@/lib/league-events/publisher', () => ({ publishLeagueFanoutEvent: vi.fn() }))
vi.mock('@/lib/league/structuralSettingsLock', () => ({ structuralPatchRefusal: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/waiver-wire/settings-service', () => ({ upsertLeagueWaiverSettings: vi.fn() }))
vi.mock('@/lib/waiver-wire/waiver-state-service', () => ({ refreshLeagueWaiverNextRunAt: vi.fn() }))

import { executeLeagueSettingsPatch } from '@/lib/league/execute-league-settings-patch'
import { commissionerLeagueFieldsFromRow } from '@/lib/league/commissioner-league-patch'
import { isDailyLineupScoringEnabled } from '@/lib/redraft/dailyLineups'
import {
  keepLineupModeFields,
  lineupModeSwitchTimingRefusal,
  readLineupMode,
  withLineupMode,
} from '@/lib/redraft/lineupModeSwitch'
import { POST as lockRoutePost } from '@/app/api/redraft/lineup-lock/route'
import { createMockNextRequest } from '../helpers/createMockNextRequest'

const PRESEASON = new Date('2026-10-19T15:00:00.000Z') // the day before the NBA opener
const MID_WEEK_1 = new Date('2026-10-23T15:00:00.000Z') // NBA week 1 is under way

let settingsInDb: Record<string, unknown>
let leagueSport: string
let seasons: Array<{ sport: string; season: number; status: string | null }>
let tablesExist: boolean

const DAILY_SC = { lineupLockType: 'daily', dailyLineupsEnabled: true }

function league(opts: { sport?: string; sportConfig?: Record<string, unknown>; seasonStatus?: string | null } = {}) {
  leagueSport = opts.sport ?? 'NBA'
  settingsInDb = { inviteCode: 'KEEP-ME', ...(opts.sportConfig ? { sportConfig: { ...opts.sportConfig } } : {}) }
  seasons = opts.seasonStatus === undefined ? [] : [{ sport: leagueSport, season: 2026, status: opts.seasonStatus }]
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(PRESEASON)
  tablesExist = true
  league()
  m.session.mockResolvedValue({ user: { id: 'u' } })
  m.prisma.league.findFirst.mockImplementation(async () => ({
    id: 'L', platform: 'manual', sport: leagueSport, leagueSize: 12, timezone: 'UTC', teams: [], leagueSettings: null,
    waiverSchedule: null, waiverProcessTime: '02:00', settings: structuredClone(settingsInDb),
  }))
  m.prisma.league.findUnique.mockImplementation(async () => ({ settings: structuredClone(settingsInDb) }))
  m.prisma.league.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
    if ('settings' in data) settingsInDb = structuredClone(data.settings as Record<string, unknown>)
    return {}
  })
  m.prisma.redraftSeason.findFirst.mockImplementation(async (args: { where: { id?: string } }) =>
    args.where.id ? { id: 's1', leagueId: 'L', sport: leagueSport } : null,
  )
  m.prisma.redraftSeason.findMany.mockImplementation(async () => structuredClone(seasons))
  m.prisma.redraftPlayoffRound.findFirst.mockResolvedValue(null)
  m.prisma.$queryRaw.mockImplementation(async () => [{ ok: tablesExist }])
})

afterEach(() => {
  vi.useRealTimers()
})

const sc = () => (settingsInDb.sportConfig ?? {}) as Record<string, unknown>
const scoredDaily = () => isDailyLineupScoringEnabled(settingsInDb, leagueSport)
const patch = (body: Record<string, unknown>) => executeLeagueSettingsPatch('u', { leagueId: 'L', ...body })
const setMode = (mode: string) =>
  lockRoutePost(
    createMockNextRequest('http://localhost/api/redraft/lineup-lock', {
      method: 'POST',
      body: { seasonId: 's1', action: 'set_mode', mode },
    }),
  )

describe('the two gate fields are written together', () => {
  it('daily writes lineupLockType AND dailyLineupsEnabled; the scorer and the lock then read daily', () => {
    const next = withLineupMode({ scoringPreset: 'X' }, 'daily')
    expect(next).toEqual({ scoringPreset: 'X', lineupLockType: 'daily', dailyLineupsEnabled: true })
    expect(isDailyLineupScoringEnabled({ sportConfig: next }, 'NHL')).toBe(true)
  })

  it('weekly turns the opt-in off and names the lock a stored daily has always behaved as', () => {
    expect(withLineupMode({ ...DAILY_SC }, 'weekly')).toEqual({
      lineupLockType: 'per_player_kickoff',
      dailyLineupsEnabled: false,
    })
  })

  it("weekly keeps a category league's first_game_of_week lock", () => {
    expect(withLineupMode({ lineupLockType: 'first_game_of_week' }, 'weekly').lineupLockType).toBe('first_game_of_week')
  })

  it('reads the mode back from the same gate the scorer reads', () => {
    expect(readLineupMode({ sportConfig: DAILY_SC }, 'MLB')).toBe('daily')
    expect(readLineupMode({ sportConfig: { lineupLockType: 'daily' } }, 'MLB')).toBe('weekly')
    expect(readLineupMode({ sportConfig: DAILY_SC }, 'NFL')).toBe('weekly')
    expect(readLineupMode({}, 'NBA')).toBe('weekly')
  })
})

describe('timing rule: refused while a season is under way', () => {
  const nba = (status: string | null) => [{ sport: 'NBA', season: 2026, status }]

  it('open before week 1 starts, even after the draft (status active)', () => {
    expect(lineupModeSwitchTimingRefusal(nba('active'), PRESEASON)).toBeNull()
  })

  it('refused once week 1 has started, in every running spelling', () => {
    for (const status of ['active', 'in_season', 'regular_season_complete', 'playoffs', null, 'something_new']) {
      expect(lineupModeSwitchTimingRefusal(nba(status), MID_WEEK_1)?.status).toBe(409)
    }
  })

  it('open before the draft (setup) and once the season is complete', () => {
    expect(lineupModeSwitchTimingRefusal(nba('setup'), MID_WEEK_1)).toBeNull()
    expect(lineupModeSwitchTimingRefusal(nba('complete'), MID_WEEK_1)).toBeNull()
  })

  it('a running season whose week window is unknown is refused (cannot tell)', () => {
    expect(lineupModeSwitchTimingRefusal([{ sport: 'NBA', season: 2031, status: 'active' }], PRESEASON)?.status).toBe(409)
  })
})

describe('settings PATCH: lineupMode', () => {
  it('turns an NBA league daily before the season, writing both fields and keeping the rest', async () => {
    league({ seasonStatus: 'active' })
    const res = await patch({ lineupMode: 'daily' })
    expect(res.status).toBe(200)
    expect(sc()).toEqual(DAILY_SC)
    expect(settingsInDb.inviteCode).toBe('KEEP-ME')
    expect(scoredDaily()).toBe(true)
  })

  it('turns a daily MLB league back to weekly once its season is complete', async () => {
    league({ sport: 'MLB', sportConfig: DAILY_SC, seasonStatus: 'complete' })
    vi.setSystemTime(MID_WEEK_1)
    const res = await patch({ lineupMode: 'weekly' })
    expect(res.status).toBe(200)
    expect(sc()).toEqual({ lineupLockType: 'per_player_kickoff', dailyLineupsEnabled: false })
    expect(scoredDaily()).toBe(false)
  })

  it('is refused (400) for a sport without daily lineups, and writes nothing', async () => {
    for (const sport of ['NFL', 'NCAAB', 'SOCCER']) {
      league({ sport })
      const res = await patch({ lineupMode: 'daily' })
      expect(res.status).toBe(400)
      expect((await res.json()).code).toBe('lineup_mode_sport_unsupported')
    }
    expect(m.prisma.league.update).not.toHaveBeenCalled()
  })

  it('rejects a value that is neither daily nor weekly', async () => {
    expect((await patch({ lineupMode: 'hourly' })).status).toBe(400)
    expect(m.prisma.league.update).not.toHaveBeenCalled()
  })

  it('refuses turning daily on while the per-day tables are missing (migration not applied)', async () => {
    tablesExist = false
    const res = await patch({ lineupMode: 'daily' })
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('lineup_mode_unavailable')
    expect(scoredDaily()).toBe(false)
  })

  it('saving the mode a league already has is not a switch, mid-season included', async () => {
    league({ sportConfig: DAILY_SC, seasonStatus: 'active' })
    vi.setSystemTime(MID_WEEK_1)
    expect((await patch({ lineupMode: 'daily' })).status).toBe(200)
    expect(scoredDaily()).toBe(true)
  })
})

describe('🛑 a week already under way is scored by ONE mode: no door flips it mid-season', () => {
  it('weekly → daily mid-week is refused, and nothing else in the save is applied', async () => {
    league({ seasonStatus: 'active' })
    vi.setSystemTime(MID_WEEK_1)
    const res = await patch({ lineupMode: 'daily', name: 'Renamed' })
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('lineup_mode_season_in_progress')
    expect(m.prisma.league.update).not.toHaveBeenCalled()
    expect(scoredDaily()).toBe(false)
  })

  it('daily → weekly mid-week is refused too', async () => {
    league({ sportConfig: DAILY_SC, seasonStatus: 'active' })
    vi.setSystemTime(MID_WEEK_1)
    expect((await patch({ lineupMode: 'weekly' })).status).toBe(409)
    expect(scoredDaily()).toBe(true)
  })

  it('a wholesale sportConfig save keeps the stored mode (the sport-config panel sends a stale copy)', async () => {
    league({ sportConfig: DAILY_SC, seasonStatus: 'active' })
    vi.setSystemTime(MID_WEEK_1)
    expect((await patch({ sportConfig: { scoringPreset: 'CUSTOM' } })).status).toBe(200)
    expect(sc()).toEqual({ scoringPreset: 'CUSTOM', ...DAILY_SC })
    expect(scoredDaily()).toBe(true)

    league({ seasonStatus: 'active' })
    expect((await patch({ sportConfig: { ...DAILY_SC } })).status).toBe(200)
    expect(scoredDaily()).toBe(false)

    league({ seasonStatus: 'active' })
    expect((await patch({ settingsMerge: { sportConfig: { ...DAILY_SC } } })).status).toBe(200)
    expect(scoredDaily()).toBe(false)
  })

  it('the lock-mode route: set_mode on a daily league mid-season is refused', async () => {
    league({ sportConfig: DAILY_SC, seasonStatus: 'active' })
    vi.setSystemTime(MID_WEEK_1)
    const res = await setMode('first_game_of_week')
    expect(res.status).toBe(409)
    expect(scoredDaily()).toBe(true)
    expect((await setMode('daily')).status).toBe(200) // no change: not a switch
  })

  it('the lock-mode route: daily mid-season is refused', async () => {
    league({ seasonStatus: 'active' })
    vi.setSystemTime(MID_WEEK_1)
    expect((await setMode('daily')).status).toBe(409)
    expect(scoredDaily()).toBe(false)
  })
})

describe('the commissioner lock-mode route accepts daily', () => {
  it('daily before the season writes both fields and reports mode daily', async () => {
    league({ seasonStatus: 'active' })
    const res = await setMode('daily')
    expect(res.status).toBe(200)
    expect((await res.json()).mode).toBe('daily')
    expect(sc()).toEqual(DAILY_SC)
  })

  it('a weekly mode on a daily league (between seasons) turns the opt-in off', async () => {
    league({ sportConfig: DAILY_SC, seasonStatus: 'complete' })
    const res = await setMode('manual')
    expect(res.status).toBe(200)
    expect(sc()).toEqual({ lineupLockType: 'manual', dailyLineupsEnabled: false })
  })

  it('daily is refused (400) for NFL', async () => {
    league({ sport: 'NFL' })
    expect((await setMode('daily')).status).toBe(400)
    expect(m.prisma.league.update).not.toHaveBeenCalled()
  })

  it('switching between weekly lock modes mid-season is unchanged (not a daily/weekly switch)', async () => {
    league({ seasonStatus: 'active' })
    vi.setSystemTime(MID_WEEK_1)
    expect((await setMode('first_game_of_week')).status).toBe(200)
    expect(sc()).toEqual({ lineupLockType: 'first_game_of_week' })
    expect(m.prisma.redraftSeason.findMany).not.toHaveBeenCalled()
  })
})

describe('defaults stay weekly', () => {
  it('a league that never chose reads weekly in the commissioner form', () => {
    const row = { sport: 'NBA', settings: {} } as unknown as Parameters<typeof commissionerLeagueFieldsFromRow>[0]
    expect(commissionerLeagueFieldsFromRow(row).lineupMode).toBe('weekly')
    const daily = { sport: 'NBA', settings: { sportConfig: DAILY_SC } } as unknown as typeof row
    expect(commissionerLeagueFieldsFromRow(daily).lineupMode).toBe('daily')
  })

  it("the sport config's own lineupLockType 'daily' (nba.ts) alone is weekly", () => {
    expect(keepLineupModeFields({}, { lineupLockType: 'daily' }, 'NBA')).toEqual({ lineupLockType: 'daily' })
    expect(readLineupMode({ sportConfig: { lineupLockType: 'daily' } }, 'NBA')).toBe('weekly')
  })
})
