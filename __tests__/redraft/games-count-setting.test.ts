/**
 * "Which games count" (lib/redraft/gamesCount.ts): the setting, its validation in the commissioner
 * settings PATCH, and the pure selection with its tie-breaks.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  prisma: {
    league: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    redraftSeason: { findMany: vi.fn() },
    $queryRaw: vi.fn(),
    leagueWaiverSettings: { findUnique: vi.fn() },
    leagueSettings: { upsert: vi.fn() },
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))
vi.mock('@/lib/league/permissions', () => ({ requireCommissionerRole: vi.fn().mockResolvedValue(undefined) }))
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

import { executeLeagueSettingsPatch } from '@/lib/league/execute-league-settings-patch'
import {
  gamesCountActive,
  gamesCountSportConfigError,
  lastGame,
  readGamesCountSetting,
  selectCountingGames,
  type WeekGame,
} from '@/lib/redraft/gamesCount'
import { resetGamesCountTablesProbe } from '@/lib/redraft/gamesCountStore'
import { gamesCountTimingRefusal, keepGamesCountFields } from '@/lib/redraft/gamesCountSwitch'

const sc = (sportConfig: Record<string, unknown>) => ({ sportConfig })

describe('readGamesCountSetting', () => {
  it('defaults to all games, for a missing key and for any invalid value', () => {
    expect(readGamesCountSetting({}, 'NBA')).toEqual({ mode: 'all' })
    expect(readGamesCountSetting(null, 'NBA')).toEqual({ mode: 'all' })
    expect(readGamesCountSetting(sc({ gamesCountMode: 'weird' }), 'NBA')).toEqual({ mode: 'all' })
    expect(readGamesCountSetting(sc({ gamesCountMode: 'best_n' }), 'NBA')).toEqual({ mode: 'all' })
    expect(readGamesCountSetting(sc({ gamesCountMode: 'best_n', gamesCountBestN: 4 }), 'NBA')).toEqual({ mode: 'all' })
    expect(readGamesCountSetting(sc({ gamesCountMode: 'best_n', gamesCountBestN: '2' }), 'NBA')).toEqual({ mode: 'all' })
  })

  it('reads best-N and lock-in for NBA, NHL and MLB only', () => {
    expect(readGamesCountSetting(sc({ gamesCountMode: 'best_n', gamesCountBestN: 3 }), 'nhl')).toEqual({ mode: 'best_n', n: 3 })
    expect(readGamesCountSetting(sc({ gamesCountMode: 'lock_in' }), 'MLB')).toEqual({ mode: 'lock_in' })
    expect(readGamesCountSetting(sc({ gamesCountMode: 'lock_in' }), 'NFL')).toEqual({ mode: 'all' })
    expect(readGamesCountSetting(sc({ gamesCountMode: 'lock_in' }), 'NCAAB')).toEqual({ mode: 'all' })
    expect(gamesCountActive(sc({ gamesCountMode: 'lock_in' }), 'NBA')).toBe(true)
    expect(gamesCountActive(sc({}), 'NBA')).toBe(false)
  })
})

describe('gamesCountSportConfigError', () => {
  it('accepts valid values and blobs that do not mention the keys', () => {
    expect(gamesCountSportConfigError({ enableIDP: true }, 'NFL')).toBeNull()
    expect(gamesCountSportConfigError({ gamesCountMode: 'all' }, 'NFL')).toBeNull()
    expect(gamesCountSportConfigError({ gamesCountMode: 'all', gamesCountBestN: null }, 'NBA')).toBeNull()
    expect(gamesCountSportConfigError({ gamesCountMode: 'best_n', gamesCountBestN: 2 }, 'NBA')).toBeNull()
    expect(gamesCountSportConfigError({ gamesCountMode: 'lock_in' }, 'MLB')).toBeNull()
  })

  it('refuses a bad mode, a bad N, and a non-all mode outside NBA/NHL/MLB', () => {
    expect(gamesCountSportConfigError({ gamesCountMode: 'best_of' }, 'NBA')).toMatch(/gamesCountMode must be one of/)
    expect(gamesCountSportConfigError({ gamesCountMode: 'best_n' }, 'NBA')).toMatch(/gamesCountBestN must be 2 or 3/)
    expect(gamesCountSportConfigError({ gamesCountMode: 'best_n', gamesCountBestN: 4 }, 'NHL')).toMatch(/gamesCountBestN/)
    expect(gamesCountSportConfigError({ gamesCountMode: 'lock_in' }, 'NFL')).toMatch(/NBA, NHL, MLB leagues only/)
    expect(gamesCountSportConfigError({ gamesCountBestN: 9 }, 'NBA')).toMatch(/gamesCountBestN/)
  })
})

describe('the commissioner settings PATCH', () => {
  let settingsInDb: Record<string, unknown>
  beforeEach(() => {
    vi.clearAllMocks()
    resetGamesCountTablesProbe()
    settingsInDb = {}
    // No season yet (pre-draft) and the tables exist, unless a test says otherwise.
    m.prisma.redraftSeason.findMany.mockResolvedValue([])
    m.prisma.$queryRaw.mockResolvedValue([{ ok: true }])
    const leagueRow = { id: 'L', sport: 'NBA', platform: 'manual', leagueSize: 12, timezone: 'UTC', teams: [], leagueSettings: null, get settings() { return settingsInDb } }
    m.prisma.league.findFirst.mockImplementation(async () => leagueRow)
    m.prisma.league.findUnique.mockImplementation(async () => ({ settings: settingsInDb }))
    m.prisma.league.update.mockImplementation(async ({ data }: { data: { settings?: Record<string, unknown> } }) => {
      if (data.settings) settingsInDb = data.settings
      return {}
    })
  })

  it('400s an invalid value and writes nothing', async () => {
    const res = await executeLeagueSettingsPatch('u1', { leagueId: 'L', sportConfig: { gamesCountMode: 'best_n', gamesCountBestN: 5 } })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/gamesCountBestN/)
    expect(m.prisma.league.update).not.toHaveBeenCalled()
  })

  it('400s the same value sent through settingsMerge', async () => {
    const res = await executeLeagueSettingsPatch('u1', { leagueId: 'L', settingsMerge: { sportConfig: { gamesCountMode: 'top' } } })
    expect(res.status).toBe(400)
    expect(m.prisma.league.update).not.toHaveBeenCalled()
  })

  it('400s a non-all mode for an NFL league', async () => {
    m.prisma.league.findFirst.mockImplementation(async () => ({ id: 'L', sport: 'NFL', platform: 'manual', leagueSize: 12, timezone: 'UTC', teams: [], leagueSettings: null, settings: {} }))
    const res = await executeLeagueSettingsPatch('u1', { leagueId: 'L', sportConfig: { gamesCountMode: 'lock_in' } })
    expect(res.status).toBe(400)
  })

  it('stores a valid value in sportConfig', async () => {
    const res = await executeLeagueSettingsPatch('u1', { leagueId: 'L', sportConfig: { gamesCountMode: 'best_n', gamesCountBestN: 3 } })
    expect(res.status).toBe(200)
    expect(readGamesCountSetting(settingsInDb, 'NBA')).toEqual({ mode: 'best_n', n: 3 })
  })

  const patchMode = (sportConfig: Record<string, unknown>) => executeLeagueSettingsPatch('u1', { leagueId: 'L', sportConfig })

  it('409 games_count_storage_unavailable leaving "All games" before the tables exist — and writes nothing', async () => {
    m.prisma.$queryRaw.mockResolvedValue([{ ok: false }])
    for (const sc of [{ gamesCountMode: 'lock_in' }, { gamesCountMode: 'best_n', gamesCountBestN: 2 }]) {
      const res = await patchMode(sc)
      expect(res.status).toBe(409)
      expect((await res.json()).code).toBe('games_count_storage_unavailable')
    }
    // The probe throwing (no such function, no connection) is "missing" too.
    m.prisma.$queryRaw.mockRejectedValue(new Error('boom'))
    expect((await patchMode({ gamesCountMode: 'lock_in' })).status).toBe(409)
    expect(m.prisma.league.update).not.toHaveBeenCalled()
  })

  it('going back to "All games" is always allowed without the tables', async () => {
    m.prisma.$queryRaw.mockResolvedValue([{ ok: false }])
    settingsInDb = { sportConfig: { gamesCountMode: 'lock_in' } }
    const res = await patchMode({ gamesCountMode: 'all', gamesCountBestN: null })
    expect(res.status).toBe(200)
    expect(readGamesCountSetting(settingsInDb, 'NBA')).toEqual({ mode: 'all' })
  })

  it('probes with to_regclass for BOTH tables', async () => {
    await patchMode({ gamesCountMode: 'lock_in' })
    const sql = (m.prisma.$queryRaw.mock.calls[0][0] as TemplateStringsArray).join('')
    expect(sql).toContain("to_regclass('public.player_week_game_scores') IS NOT NULL")
    expect(sql).toContain("to_regclass('public.redraft_games_count_choices') IS NOT NULL")
  })

  describe('the season-in-progress rule', () => {
    // NBA 2026 week 1 starts 20 Oct; the 1999 season has no recorded dates.
    const season = (status: string, year = 2026) => [{ sport: 'NBA', season: year, status }]
    const BEFORE = new Date('2026-10-19T12:00:00.000Z')
    const AFTER = new Date('2026-10-21T12:00:00.000Z')

    it('pure rule: open in setup, before week 1, and once complete; closed from week 1 on and with unknown dates', () => {
      expect(gamesCountTimingRefusal([], AFTER)).toBeNull()
      expect(gamesCountTimingRefusal(season('setup'), AFTER)).toBeNull()
      expect(gamesCountTimingRefusal(season('active'), BEFORE)).toBeNull()
      expect(gamesCountTimingRefusal(season('complete'), AFTER)).toBeNull()
      expect(gamesCountTimingRefusal(season('active'), new Date('2026-10-20T00:00:00.000Z'))?.code).toBe('games_count_season_in_progress')
      expect(gamesCountTimingRefusal(season('active'), AFTER)?.code).toBe('games_count_season_in_progress')
      expect(gamesCountTimingRefusal(season('in_season'), AFTER)?.code).toBe('games_count_season_in_progress')
      expect(gamesCountTimingRefusal(season('playoffs'), AFTER)?.code).toBe('games_count_season_in_progress')
      expect(gamesCountTimingRefusal(season('active', 1999), BEFORE)?.code).toBe('games_count_season_in_progress')
    })

    it('the PATCH refuses a mode change, an N change and a change back to "All games" mid-season', async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(AFTER)
      try {
        m.prisma.redraftSeason.findMany.mockResolvedValue(season('active'))
        settingsInDb = { sportConfig: { gamesCountMode: 'best_n', gamesCountBestN: 2 } }
        for (const sc of [
          { gamesCountMode: 'lock_in' },
          { gamesCountMode: 'best_n', gamesCountBestN: 3 },
          { gamesCountMode: 'all', gamesCountBestN: null },
        ]) {
          const res = await patchMode(sc)
          expect(res.status).toBe(409)
          expect((await res.json()).code).toBe('games_count_season_in_progress')
        }
        expect(m.prisma.league.update).not.toHaveBeenCalled()
        // Re-saving the SAME setting mid-season (the panel autosaves the whole blob) is not a change.
        expect((await patchMode({ gamesCountMode: 'best_n', gamesCountBestN: 2, enableIDP: false })).status).toBe(200)
        // A blob that omits the keys keeps the stored values instead of turning the rule off.
        expect((await patchMode({ enableIDP: true })).status).toBe(200)
        expect(readGamesCountSetting(settingsInDb, 'NBA')).toEqual({ mode: 'best_n', n: 2 })
      } finally {
        vi.useRealTimers()
      }
    })

    it('the PATCH allows a change before week 1 and after the season completes', async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      try {
        vi.setSystemTime(BEFORE)
        m.prisma.redraftSeason.findMany.mockResolvedValue(season('active'))
        expect((await patchMode({ gamesCountMode: 'lock_in' })).status).toBe(200)
        vi.setSystemTime(AFTER)
        m.prisma.redraftSeason.findMany.mockResolvedValue(season('complete'))
        expect((await patchMode({ gamesCountMode: 'best_n', gamesCountBestN: 3 })).status).toBe(200)
        expect(readGamesCountSetting(settingsInDb, 'NBA')).toEqual({ mode: 'best_n', n: 3 })
      } finally {
        vi.useRealTimers()
      }
    })
  })
})

describe('keepGamesCountFields', () => {
  it('keeps stored keys only when the incoming blob does not mention them', () => {
    const stored = { gamesCountMode: 'lock_in', other: 1 }
    expect(keepGamesCountFields(stored, { x: 2 })).toEqual({ x: 2, gamesCountMode: 'lock_in' })
    expect(keepGamesCountFields(stored, null)).toEqual({ gamesCountMode: 'lock_in' })
    expect(keepGamesCountFields(stored, { gamesCountMode: 'all' })).toEqual({ gamesCountMode: 'all' })
    expect(keepGamesCountFields({}, { x: 2 })).toEqual({ x: 2 })
    expect(keepGamesCountFields({}, null)).toBeNull()
  })
})

const g = (gameId: string, day: string, points: number, startTime: string | null = null): WeekGame => ({ gameId, day, startTime, points })

describe('selectCountingGames', () => {
  const games = [g('g1', '2026-10-20', 10), g('g2', '2026-10-22', 30), g('g3', '2026-10-24', 20)]

  it('all: every game', () => {
    expect(selectCountingGames({ mode: 'all' }, games)).toEqual({ countedGameIds: ['g1', 'g2', 'g3'], points: 60 })
  })

  it('best N: the best N with no picks; all of them when he played fewer', () => {
    expect(selectCountingGames({ mode: 'best_n', n: 2 }, games)).toEqual({ countedGameIds: ['g2', 'g3'], points: 50 })
    expect(selectCountingGames({ mode: 'best_n', n: 3 }, games.slice(0, 2)).countedGameIds).toEqual(['g1', 'g2'])
    expect(selectCountingGames({ mode: 'best_n', n: 2 }, []).points).toBe(0)
  })

  it('best N: picks first (capped at N, unknown ids ignored), then his best', () => {
    expect(selectCountingGames({ mode: 'best_n', n: 2 }, games, { pickedGameIds: ['g1'] })).toEqual({ countedGameIds: ['g1', 'g2'], points: 40 })
    expect(selectCountingGames({ mode: 'best_n', n: 2 }, games, { pickedGameIds: ['g1', 'g3'] }).points).toBe(30)
    expect(selectCountingGames({ mode: 'best_n', n: 2 }, games, { pickedGameIds: ['g3', 'g1', 'g2'] }).countedGameIds).toEqual(['g1', 'g3'])
    expect(selectCountingGames({ mode: 'best_n', n: 2 }, games, { pickedGameIds: ['zz'] }).countedGameIds).toEqual(['g2', 'g3'])
  })

  it('best N tie-break: equal points go to the EARLIER game, then the game id — never input order', () => {
    const tied = [g('b', '2026-10-23', 7), g('a', '2026-10-21', 7), g('c', '2026-10-21', 7, '2026-10-21T23:00:00Z'), g('d', '2026-10-25', 4)]
    expect(selectCountingGames({ mode: 'best_n', n: 2 }, tied).countedGameIds).toEqual(['a', 'c'])
    expect(selectCountingGames({ mode: 'best_n', n: 2 }, [...tied].reverse()).countedGameIds).toEqual(['a', 'c'])
  })

  it('lock-in: the locked game; never locked, the last game; an unknown lock is ignored', () => {
    expect(selectCountingGames({ mode: 'lock_in' }, games, { lockedGameId: 'g1' })).toEqual({ countedGameIds: ['g1'], points: 10 })
    expect(selectCountingGames({ mode: 'lock_in' }, games)).toEqual({ countedGameIds: ['g3'], points: 20 })
    expect(selectCountingGames({ mode: 'lock_in' }, games, { lockedGameId: 'nope' }).countedGameIds).toEqual(['g3'])
    expect(selectCountingGames({ mode: 'lock_in' }, []).countedGameIds).toEqual([])
  })

  it('lock-in tie-break for "last": the later start time, then the game id (a doubleheader)', () => {
    const dh = [g('dh2', '2026-10-24', 1, '2026-10-24T23:00:00Z'), g('dh1', '2026-10-24', 9, '2026-10-24T17:00:00Z')]
    expect(lastGame(dh)?.gameId).toBe('dh2')
    expect(lastGame([g('y', '2026-10-24', 1), g('x', '2026-10-24', 1)])?.gameId).toBe('y')
  })
})
