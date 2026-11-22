/**
 * Daily best ball needs its season's regular-season opener — curated, or derived from the schedule stored
 * in Postgres (lib/season-week/deriveDailySportSeasonStart.ts). With neither, the week cannot be cut into
 * days. That used to be a server log line only; the commissioner panel and the Best Ball tab now say
 * "daily scoring is waiting for the season schedule". NBA curates 2026 only, so 2027 is the uncurated case.
 */
// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'

const db = vi.hoisted(() => ({
  league: { findUnique: vi.fn() },
  draftSession: { findFirst: vi.fn(async () => null) },
  teamWeekResult: { findMany: vi.fn(async () => []) },
  weeklyScore: { findMany: vi.fn(async () => []) },
  fantasyStanding: { findMany: vi.fn(async () => []) },
  sportsPlayer: { findMany: vi.fn(async () => []) },
  sportsGame: { findMany: vi.fn(async () => []) },
  sportsDataCache: { findUnique: vi.fn(async () => null), findMany: vi.fn(async () => []) },
  playerGameStat: { findFirst: vi.fn(async () => null) },
}))
const nativeLoad = vi.hoisted(() => ({ loadNativeBestBallTab: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'U1' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league-access', () => ({ resolveLeagueAccess: vi.fn(async () => ({ isMember: true })) }))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/league/structuralSettingsLock', () => ({ structuralSettingsLockReason: vi.fn(async () => null) }))
vi.mock('@/lib/bestball/nativeBestBallTabLoad', () => nativeLoad)
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { GET as bestBallGET } from '@/app/api/leagues/[leagueId]/bestball/handler'
import { BestBallTab } from '@/app/league/[leagueId]/tabs/BestBallTab'
import { BestBallSettingsCommissionerPanel } from '@/components/league-settings/BestBallSettingsCommissionerPanel'
import { dailyScheduleWaitingNotice, loadDailyBestBallScheduleStatus } from '@/lib/bestball/dailyScheduleStatus'
import { clearDerivedDailySportSeasonStarts } from '@/lib/season-week/dailySportSeasonStarts'
import { resetDailySportSeasonStartChecks } from '@/lib/season-week/deriveDailySportSeasonStart'

const DAILY = { best_ball_settings: { scoringPeriod: 'daily', dailyBestBall: true, contestStructure: 'season_long' } }
const WEEKLY = { best_ball_settings: { scoringPeriod: 'weekly', dailyBestBall: false, contestStructure: 'season_long' } }
const leagueRow = (over: Record<string, unknown> = {}) => ({
  id: 'L1', name: 'L', sport: 'NBA', season: 2027, leagueSize: 12, bestBallMode: true, settings: DAILY, bbMatchupFormat: 'h2h',
  bbScoringPeriod: 'daily', platform: 'manual', rosters: [], teams: [], ...over,
})
const nativeSeason = (season: number) => ({
  season,
  body: { selectedWeek: 1, weeksAvailable: [], lineups: [], rosterComposition: [], standings: [], history: [] },
})
const get = async () => {
  const req = { nextUrl: new URL('http://localhost/api/leagues/L1/bestball') } as never
  const res = await bestBallGET(req, { params: Promise.resolve({ leagueId: 'L1' }) })
  return res.json()
}

beforeEach(() => {
  vi.clearAllMocks()
  clearDerivedDailySportSeasonStarts()
  resetDailySportSeasonStartChecks()
  db.playerGameStat.findFirst.mockResolvedValue(null)
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the status', () => {
  it('waiting for an uncurated season with no labelled game stored; ready once one is', async () => {
    expect(await loadDailyBestBallScheduleStatus({ sport: 'NBA', season: 2027 }, { db: db as never })).toEqual({ state: 'waiting', season: 2027 })
    resetDailySportSeasonStartChecks()
    db.playerGameStat.findFirst.mockResolvedValue({ gameDate: new Date('2027-10-19T00:00:00.000Z') })
    expect(await loadDailyBestBallScheduleStatus({ sport: 'NBA', season: 2027 }, { db: db as never })).toEqual({ state: 'ready', season: 2027 })
  })

  it('a curated season is ready without reading the database; a weekly-only sport has no status', async () => {
    expect(await loadDailyBestBallScheduleStatus({ sport: 'NBA', season: 2026 }, { db: db as never })).toEqual({ state: 'ready', season: 2026 })
    expect(db.playerGameStat.findFirst).not.toHaveBeenCalled()
    expect(await loadDailyBestBallScheduleStatus({ sport: 'NFL', season: 2027 }, { db: db as never })).toBeNull()
  })

  it('the notice names the season, and is null when ready', () => {
    expect(dailyScheduleWaitingNotice({ state: 'waiting', season: 2027 })).toMatch(/^Daily scoring is waiting for the 2027 season schedule\./)
    expect(dailyScheduleWaitingNotice({ state: 'ready', season: 2027 })).toBeNull()
    expect(dailyScheduleWaitingNotice(null)).toBeNull()
  })
})

describe('GET /api/leagues/:id/bestball', () => {
  it('a daily league with no opener yet: status waiting, and the tab notice', async () => {
    db.league.findUnique.mockResolvedValue(leagueRow())
    nativeLoad.loadNativeBestBallTab.mockResolvedValue(nativeSeason(2027))
    const body = await get()
    expect(body.dailySchedule).toEqual({ state: 'waiting', season: 2027 })
    expect(body.dailyScheduleNotice).toMatch(/waiting for the 2027 season schedule/)
  })

  it('a weekly league gets the status (the panel offers daily) but no tab notice', async () => {
    db.league.findUnique.mockResolvedValue(leagueRow({ settings: WEEKLY, bbScoringPeriod: 'weekly' }))
    nativeLoad.loadNativeBestBallTab.mockResolvedValue(nativeSeason(2027))
    const body = await get()
    expect(body.dailySchedule).toEqual({ state: 'waiting', season: 2027 })
    expect(body.dailyScheduleNotice).toBeNull()
  })

  it('nothing once the opener is derivable, and nothing for an imported league', async () => {
    db.league.findUnique.mockResolvedValue(leagueRow())
    nativeLoad.loadNativeBestBallTab.mockResolvedValue(nativeSeason(2027))
    db.playerGameStat.findFirst.mockResolvedValue({ gameDate: new Date('2027-10-19T00:00:00.000Z') })
    const ready = await get()
    expect(ready.dailySchedule).toEqual({ state: 'ready', season: 2027 })
    expect(ready.dailyScheduleNotice).toBeNull()

    db.league.findUnique.mockResolvedValue(leagueRow({ platform: 'sleeper' }))
    nativeLoad.loadNativeBestBallTab.mockResolvedValue(null)
    const imported = await get()
    expect(imported.dailySchedule).toBeNull()
    expect(imported.dailyScheduleNotice).toBeNull()
  })
})

const tabBody = (scoringPeriod: string, notice: string | null) => ({
  league: { id: 'L1', name: 'L', sport: 'NBA', season: 2027, summary: 'Best Ball', settings: { mode: 'standard', draftMode: 'snake', contestStructure: 'season_long', matchupFormat: 'h2h', waiversEnabled: false, tradesEnabled: false, substitutionsEnabled: false, playoffTeams: 0, scoringPeriod }, profile: { label: 'NBA', scoringPeriod: 'weekly', recommendedRosterSize: 18, lineupSlots: [], notes: [] } },
  source: 'native', selectedWeek: 1, weeksAvailable: [], draftNotice: null, dailyScheduleNotice: notice,
  lineups: [], rosterComposition: [], standings: [], history: [],
})

describe('the Best Ball tab', () => {
  it('shows the waiting notice in a daily league', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => tabBody('daily', dailyScheduleWaitingNotice({ state: 'waiting', season: 2027 })) })))
    render(<BestBallTab leagueId="L1" sport="NBA" />)
    await waitFor(() => expect(screen.getByTestId('bestball-daily-schedule-pending').textContent).toMatch(/2027 season schedule/))
  })

  it('shows nothing when there is no notice', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => tabBody('daily', null) })))
    render(<BestBallTab leagueId="L1" sport="NBA" />)
    await waitFor(() => expect(screen.getByTestId('bestball-lineup-explainer')).toBeTruthy())
    expect(screen.queryByTestId('bestball-daily-schedule-pending')).toBeNull()
  })
})

function stubPanel(dailySchedule: unknown, scoringPeriod = 'weekly') {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({
      league: { structureLock: null, settings: { mode: 'standard', contestStructure: 'season_long', matchupFormat: 'h2h', playoffFormat: 'bracket', tieRule: 'points_for', scoringPeriod, waiversEnabled: false, tradesEnabled: false, substitutionsEnabled: false, podSize: 12, tournamentAdvancementRounds: 0, regularSeasonLength: 21, playoffTeams: 6 } },
      dailySchedule,
    }),
  })))
}

describe('the commissioner panel', () => {
  it('says daily scoring is waiting beside the daily option', async () => {
    stubPanel({ state: 'waiting', season: 2027 })
    render(<BestBallSettingsCommissionerPanel leagueId="L1" sport="NBA" canEdit />)
    const note = await screen.findByTestId('bb-daily-schedule-pending')
    expect(note.textContent).toMatch(/^Daily scoring is waiting for the 2027 season schedule/)
  })

  it('says nothing when the schedule is ready', async () => {
    stubPanel({ state: 'ready', season: 2027 }, 'daily')
    render(<BestBallSettingsCommissionerPanel leagueId="L1" sport="NBA" canEdit />)
    await screen.findByTestId('bb-scoring-period')
    expect(screen.queryByTestId('bb-daily-schedule-pending')).toBeNull()
  })
})
