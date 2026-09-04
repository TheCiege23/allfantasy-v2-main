import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'

import { SUPPORTED_SPORTS } from '@/lib/sport-scope'
import { getGuillotineSportConfig } from '@/lib/guillotine/sportConfig'
import { getDraftTypeOptions, getTeamCountOptions } from '@/lib/create-league-v2/rules-engine'
import { DRAFT_TYPES_BY_LEAGUE_FORMAT } from '@/lib/draft-types/draftTypeRegistry'
import { resolveEliminationWindow } from '@/lib/guillotine/EliminationWindowResolver'
import { buildWeeklySummary } from '@/lib/guillotine/GuillotineWeeklySummaryService'
import { buildPromptForType } from '@/lib/guillotine/ai/GuillotineAIPrompts'
import { runElimination } from '@/lib/guillotine/GuillotineEliminationEngine'
import { GuillotineHome } from '@/components/guillotine/GuillotineHome'
import { createCanonicalLeagueInTransaction } from '@/lib/league-creation/canonical/createCanonicalLeagueInTransaction'

const prismaMock = vi.hoisted(() => ({
  guillotineRosterState: {
    findMany: vi.fn(),
    upsert: vi.fn(),
  },
  roster: {
    findMany: vi.fn(),
    update: vi.fn(),
  },
  leagueTeam: {
    updateMany: vi.fn(),
  },
  appUser: {
    findMany: vi.fn(),
  },
  /*
   * The engine reads this delegate for the chop audit. It was absent, so the audit lift crashed
   * here with `Cannot read properties of undefined (reading 'findMany')` -- a synchronous TypeError
   * that the engine's `.catch` could not convert, because the property access happens before any
   * promise exists.
   */
  redraftRoster: {
    findMany: vi.fn(),
    update: vi.fn(),
  },
}))
const resolveRedraftRosterIdMock = vi.hoisted(() => vi.fn())
const resolveRedraftRosterIdsMock = vi.hoisted(() => vi.fn())

const getGuillotineConfigMock = vi.hoisted(() => vi.fn())
const resolveTiebreakMock = vi.hoisted(() => vi.fn())
const evaluateWeekMock = vi.hoisted(() => vi.fn())
const getDraftSlotByRosterMock = vi.hoisted(() => vi.fn())
const releaseChoppedRostersMock = vi.hoisted(() => vi.fn())
const appendEventMock = vi.hoisted(() => vi.fn())
const postChopToLeagueChatMock = vi.hoisted(() => vi.fn())
const standingsMock = vi.hoisted(() => vi.fn())
const dangerMock = vi.hoisted(() => vi.fn())
const eventsMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
/*
 * The engine resolves across the two roster id spaces through this module. Mocking it keeps this
 * suite testing ELIMINATION rather than re-modelling the reconciler's query sequence -- the
 * reconciler has its own suite. Both exports are stubbed because the engine imports both:
 * `resolveRedraftRosterId` for the elimination write, `resolveRedraftRosterIds` for the audit.
 */
vi.mock('@/lib/league-runtime/reconcileRosterRedraftLinks', () => ({
  resolveRedraftRosterId: resolveRedraftRosterIdMock,
  resolveRedraftRosterIds: resolveRedraftRosterIdsMock,
  reconcileRosterRedraftLinks: vi.fn(),
}))
vi.mock('@/lib/guillotine/GuillotineLeagueConfig', () => ({
  getGuillotineConfig: getGuillotineConfigMock,
}))
vi.mock('@/lib/guillotine/GuillotineTiebreakResolver', () => ({
  resolveTiebreak: resolveTiebreakMock,
}))
vi.mock('@/lib/guillotine/GuillotineWeekEvaluator', () => ({
  evaluateWeek: evaluateWeekMock,
  getDraftSlotByRoster: getDraftSlotByRosterMock,
}))
vi.mock('@/lib/guillotine/GuillotineRosterReleaseEngine', async () => {
  const actual = await vi.importActual<typeof import('@/lib/guillotine/GuillotineRosterReleaseEngine')>('@/lib/guillotine/GuillotineRosterReleaseEngine')
  return {
    ...actual,
    releaseChoppedRosters: releaseChoppedRostersMock,
  }
})
vi.mock('@/lib/guillotine/GuillotineEventLog', () => ({
  appendEvent: appendEventMock,
  getRecentEvents: eventsMock,
}))
vi.mock('@/lib/guillotine/guillotineChat', () => ({
  postChopToLeagueChat: postChopToLeagueChatMock,
}))
vi.mock('@/lib/guillotine/GuillotineStandingsProjectionService', () => ({
  getSurvivalStandings: standingsMock,
}))
vi.mock('@/lib/guillotine/GuillotineDangerEngine', () => ({
  getDangerTiers: dangerMock,
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => <a href={href} {...rest}>{children}</a>,
}))
vi.mock('@/components/guillotine/GuillotineChopAnimation', () => ({
  GuillotineChopAnimation: () => <div data-testid="guillotine-chop-animation" />,
}))
vi.mock('@/components/guillotine/GuillotineAIPanel', () => ({
  GuillotineAIPanel: () => <div data-testid="guillotine-ai-panel" />,
}))

describe('Guillotine full regression matrix', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.roster.update.mockResolvedValue({ id: 'ok' })
    prismaMock.leagueTeam.updateMany.mockResolvedValue({ count: 1 })
    // Default to UNRESOLVED, which is the state of a league whose links have not been reconciled.
    resolveRedraftRosterIdMock.mockResolvedValue(null)
    resolveRedraftRosterIdsMock.mockResolvedValue(new Map<string, string>())
    prismaMock.redraftRoster.findMany.mockResolvedValue([])
    prismaMock.redraftRoster.update.mockResolvedValue({ id: 'ok' })
  })

  it('supports all 7 sports with valid guillotine config and waivers after chop', () => {
    expect(SUPPORTED_SPORTS).toEqual(['NFL', 'NBA', 'NHL', 'MLB', 'NCAAF', 'NCAAB', 'SOCCER'])

    for (const sport of SUPPORTED_SPORTS) {
      const profile = getGuillotineSportConfig(sport)
      expect(profile).toBeDefined()
      expect(profile!.regularSeasonWeeks).toBeGreaterThan(0)
      expect(profile!.chopDay).toBeGreaterThanOrEqual(0)
      expect(profile!.chopDay).toBeLessThanOrEqual(6)
      expect(profile!.waiverDay).toBeGreaterThanOrEqual(0)
      expect(profile!.waiverDay).toBeLessThanOrEqual(6)
      expect((profile!.waiverDay - profile!.chopDay + 7) % 7).toBe(1)

      const window = resolveEliminationWindow(sport, new Date('2026-09-14T00:00:00.000Z'), 24)
      expect(window).not.toBeNull()
      expect(window!.waiversAt.getTime()).toBeGreaterThan(window!.opensAt.getTime())
      expect(window!.closesAt.getTime()).toBeGreaterThan(window!.waiversAt.getTime())
    }
  })

  it('supports guillotine draft types for all sports (snake/linear/auction)', () => {
    expect(DRAFT_TYPES_BY_LEAGUE_FORMAT.guillotine).toEqual(['snake', 'linear', 'auction'])

    for (const sport of SUPPORTED_SPORTS) {
      const options = getDraftTypeOptions('guillotine', sport)
      const ids = new Set(options.map((o) => o.id))
      expect(ids.has('snake')).toBe(true)
      expect(ids.has('auction')).toBe(true)
    }
  })

  it('guillotine team count options stay within sport schedule bounds', () => {
    for (const sport of SUPPORTED_SPORTS) {
      const profile = getGuillotineSportConfig(sport)!
      const options = getTeamCountOptions(sport, 'guillotine')
      expect(options[0]).toBe(profile.minTeams)
      expect(options[options.length - 1]).toBe(profile.maxTeams)
      expect(options.length).toBeGreaterThan(0)
    }
  })

  it('eliminates lowest score, marks roster eliminated, releases players to waivers, and emits events', async () => {
    getGuillotineConfigMock.mockResolvedValue({
      eliminationStartWeek: 1,
      eliminationEndWeek: 18,
      teamsPerChop: 1,
      tiebreakerOrder: ['bench_points'],
      rosterReleaseTiming: 'next_waiver_run',
    })
    evaluateWeekMock.mockResolvedValue({
      pastCutoff: true,
      scores: [
        { rosterId: 'r-low', periodPoints: 77 },
        { rosterId: 'r-mid', periodPoints: 100 },
      ],
    })
    getDraftSlotByRosterMock.mockResolvedValue(new Map([['r-low', 2], ['r-mid', 1]]))
    resolveTiebreakMock.mockReturnValue({
      choppedRosterIds: ['r-low'],
      stepUsed: 'bench_points',
      reason: 'lowest score',
    })
    prismaMock.roster.findMany.mockResolvedValue([{ id: 'r-low', platformUserId: 'u1' }])
    prismaMock.appUser.findMany.mockResolvedValue([{ id: 'u1', displayName: 'Lowest Team', email: 'u1@test.com' }])
    resolveRedraftRosterIdMock.mockResolvedValue('rr-low')
    resolveRedraftRosterIdsMock.mockResolvedValue(new Map([['r-low', 'rr-low']]))
    prismaMock.redraftRoster.findMany.mockResolvedValue([
      { id: 'rr-low', teamName: 'Lowest Team', ownerName: 'u1', ownerId: 'u1' },
    ])

    const out = await runElimination({
      leagueId: 'league-1',
      weekOrPeriod: 3,
      systemUserId: 'system',
    })

    expect(out?.choppedRosterIds).toEqual(['r-low'])
    expect(prismaMock.guillotineRosterState.upsert).toHaveBeenCalledTimes(1)
    /*
     * THIS ASSERTION USED TO NAME `prisma.roster.update`, AND HAD BEEN FAILING SINCE b05de0bf0.
     * `Roster` HAS NO `isEliminated` COLUMN -- the old call only compiled behind a cast, and was
     * removed. The flag lives on `RedraftRoster`, so the write crosses the two roster id spaces
     * and the RESOLVED id is the thing worth pinning: asserting `r-low` would pass against a
     * version that never translated at all, which is the bug the link column exists to prevent.
     */
    expect(prismaMock.redraftRoster.update).toHaveBeenCalledWith({
      where: { id: 'rr-low' },
      data: { isEliminated: true },
    })
    expect(prismaMock.leagueTeam.updateMany).toHaveBeenCalledWith({
      where: { leagueId: 'league-1', externalId: 'r-low' },
      data: {
        claimedByUserId: null,
        platformUserId: null,
        isOrphan: true,
      },
    })
    expect(releaseChoppedRostersMock).toHaveBeenCalledWith({
      leagueId: 'league-1',
      rosterIds: ['r-low'],
      releaseTiming: 'next_waiver_run',
    })
    expect(appendEventMock).toHaveBeenCalledWith('league-1', 'chop', expect.any(Object))
    expect(appendEventMock).toHaveBeenCalledWith('league-1', 'chop_animation_trigger', expect.any(Object))
    expect(postChopToLeagueChatMock).toHaveBeenCalledTimes(1)
  })

  it('chops a league whose roster links are unreconciled, and issues no empty query', async () => {
    /*
     * The degraded path, which is every league until the backfill runs. Nothing resolves, so
     * nothing can be marked -- but the chop itself must still complete, and the audit must not
     * issue `id: { in: [] }`, a round-trip that cannot return a row.
     *
     * THE EMPTY QUERY WAS NOT MERELY WASTEFUL, IT CRASHED. `prisma.redraftRoster.findMany` reads
     * a property off `prisma.redraftRoster` BEFORE any promise exists, so an absent delegate
     * throws synchronously and the engine's `.catch` never sees it -- a `.catch` converts a
     * rejected promise, not a TypeError. That is what took this suite red on main after the
     * audit lift.
     */
    getGuillotineConfigMock.mockResolvedValue({
      leagueId: 'league-1',
      isActive: true,
      currentWeek: 3,
    })
    evaluateWeekMock.mockResolvedValue({
      pastCutoff: true,
      scores: [
        { rosterId: 'r-low', periodPoints: 77 },
        { rosterId: 'r-mid', periodPoints: 100 },
      ],
    })
    getDraftSlotByRosterMock.mockResolvedValue(new Map([['r-low', 2], ['r-mid', 1]]))
    resolveTiebreakMock.mockReturnValue({
      choppedRosterIds: ['r-low'],
      stepUsed: 'bench_points',
      reason: 'lowest score',
    })
    prismaMock.roster.findMany.mockResolvedValue([{ id: 'r-low', platformUserId: 'u1' }])
    prismaMock.appUser.findMany.mockResolvedValue([{ id: 'u1', displayName: 'Lowest Team', email: 'u1@test.com' }])
    // beforeEach already leaves both resolvers unresolved; restated here because it IS the fixture.
    resolveRedraftRosterIdMock.mockResolvedValue(null)
    resolveRedraftRosterIdsMock.mockResolvedValue(new Map())

    const out = await runElimination({
      leagueId: 'league-1',
      weekOrPeriod: 3,
      systemUserId: 'system',
    })

    expect(out?.choppedRosterIds).toEqual(['r-low'])
    expect(prismaMock.redraftRoster.findMany).not.toHaveBeenCalled()
    expect(prismaMock.redraftRoster.update).not.toHaveBeenCalled()
  })

  it('release engine clears players from chopped rosters for waiver pool', async () => {
    const { releaseChoppedRosters: releaseChoppedRostersActual } =
      await vi.importActual<typeof import('@/lib/guillotine/GuillotineRosterReleaseEngine')>(
        '@/lib/guillotine/GuillotineRosterReleaseEngine'
      )

    prismaMock.roster.findMany.mockResolvedValue([
      { id: 'r1', playerData: { starters: ['p1'], players: ['p1', 'p2'] } },
    ])

    await releaseChoppedRostersActual({
      leagueId: 'league-1',
      rosterIds: ['r1'],
      releaseTiming: 'next_waiver_run',
    })

    expect(prismaMock.roster.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { playerData: { starters: ['p1'], players: [] } },
    })
    expect(appendEventMock).toHaveBeenCalledWith('league-1', 'roster_released', expect.objectContaining({ rosterIds: ['r1'] }))
  })

  it('summary includes bubble/danger and chopped history payload', async () => {
    standingsMock.mockResolvedValue([
      { rosterId: 'r1', displayName: 'Team 1', rank: 1, seasonPointsCumul: 400 },
      { rosterId: 'r2', displayName: 'Team 2', rank: 2, seasonPointsCumul: 350 },
    ])
    dangerMock.mockResolvedValue([
      { rosterId: 'r2', displayName: 'Team 2', tier: 'chop_zone', pointsFromChopZone: 0 },
      { rosterId: 'r3', displayName: 'Team 3', tier: 'danger', pointsFromChopZone: 4 },
    ])
    eventsMock.mockResolvedValue([
      { metadata: { weekOrPeriod: 4, choppedRosterIds: ['r4'] } },
    ])

    const summary = await buildWeeklySummary({ leagueId: 'league-1', weekOrPeriod: 4, includeDanger: true })

    expect(summary).not.toBeNull()
    expect(summary!.recentChopEvents).toHaveLength(1)
    expect(summary!.dangerTiers?.some((d) => d.tier === 'chop_zone')).toBe(true)
    expect(summary!.dangerTiers?.some((d) => d.tier === 'danger')).toBe(true)
  })

  it('home view renders bubble teams, waivers section, settings link, and storyline panel', async () => {
    const summary = {
      leagueId: 'league-1',
      weekOrPeriod: 4,
      choppedThisWeek: [{ rosterId: 'r4', displayName: 'Team 4' }],
      survivalStandings: [
        { rosterId: 'r1', displayName: 'Team 1', rank: 1, seasonPointsCumul: 400 },
        { rosterId: 'r2', displayName: 'Team 2', rank: 2, seasonPointsCumul: 350 },
      ],
      dangerTiers: [
        { rosterId: 'r2', displayName: 'Team 2', tier: 'chop_zone', pointsFromChopZone: 0 },
        { rosterId: 'r3', displayName: 'Team 3', tier: 'danger', pointsFromChopZone: 3.2 },
        { rosterId: 'r5', displayName: 'Team 5', tier: 'safe', pointsFromChopZone: 11.1 },
      ],
      recentChopEvents: [{ weekOrPeriod: 4, choppedRosterIds: ['r4'] }],
      assets: { leagueImage: '/guillotine/Guillotine.png', introVideo: '/guillotine/Guillotine.mp4' },
      config: {
        eliminationStartWeek: 1,
        eliminationEndWeek: 18,
        teamsPerChop: 1,
        tiebreakerOrder: ['bench_points'],
        dangerMarginPoints: 10,
        rosterReleaseTiming: 'next_waiver_run',
      },
    }

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => summary,
    }))

    render(<GuillotineHome leagueId="league-1" sport="NFL" leagueName="Blade League" />)

    await waitFor(() => {
      expect(screen.getByText('On The Bubble (Bottom 4)')).toBeTruthy()
    })

    expect(screen.getByText('Waiver & FAAB')).toBeTruthy()
    expect(screen.getByTestId('guillotine-bubble-separator')).toBeTruthy()
    expect(screen.getByTestId('guillotine-ai-panel')).toBeTruthy()
    expect(screen.getByTestId('guillotine-open-waivers')).toBeTruthy()
    expect(screen.getByTestId('guillotine-league-settings')).toBeTruthy()
  })

  it('storyline recap prompt is wired to deterministic guillotine data', () => {
    const ctx = {
      leagueId: 'league-1',
      sport: 'NFL',
      weekOrPeriod: 4,
      survivalStandings: [{ rosterId: 'r1', displayName: 'Team 1', rank: 1, seasonPointsCumul: 400 }],
      dangerTiers: [{ rosterId: 'r2', displayName: 'Team 2', tier: 'danger', pointsFromChopZone: 2.5 }],
      recentChopEvents: [{ weekOrPeriod: 4, choppedRosterIds: ['r4'] }],
      choppedThisWeek: [{ rosterId: 'r4', displayName: 'Team 4' }],
      config: {
        eliminationStartWeek: 1,
        eliminationEndWeek: 18,
        teamsPerChop: 1,
        dangerMarginPoints: 10,
        tiebreakerOrder: ['bench_points'],
      },
    }

    const prompt = buildPromptForType('recap', ctx as any)
    expect(prompt.system).toContain('storyteller')
    expect(prompt.user).toContain('Chopped this week: Team 4')
    expect(prompt.user).toContain('Danger tier: Team 2')
  })

  it('guillotine canonical creation disables playoffs and keeps trade settings configurable', async () => {
    const tx: any = {
      league: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'league-1' }),
      },
      guillotineLeagueConfig: { upsert: vi.fn().mockResolvedValue({}) },
      leagueSettings: { create: vi.fn().mockResolvedValue({}) },
      leagueWaiverSettings: { create: vi.fn().mockResolvedValue({}) },
      redraftLeagueExtendedSettings: { create: vi.fn().mockResolvedValue({}) },
      redraftLeagueDraftProfile: { create: vi.fn().mockResolvedValue({}) },
      redraftLeagueHomepageState: { create: vi.fn().mockResolvedValue({}) },
      redraftLeagueSportIntegration: { create: vi.fn().mockResolvedValue({}) },
      redraftLeagueChatRoom: { create: vi.fn().mockResolvedValue({}) },
      roster: { create: vi.fn().mockResolvedValue({ id: 'roster-1' }) },
      leagueTeam: { create: vi.fn().mockResolvedValue({}) },
      redraftLeagueMember: { create: vi.fn().mockResolvedValue({}) },
      leagueEntrySlot: { createMany: vi.fn().mockResolvedValue({ count: 12 }) },
      draftSession: { create: vi.fn().mockResolvedValue({}) },
    }

    await createCanonicalLeagueInTransaction(
      tx,
      'user-1',
      {
        sport: 'NFL',
        leagueName: 'Blade League',
        draftType: 'auction',
        teamCount: 12,
        scoringPreset: 'ppr',
        tradeReviewMode: 'league_vote',
        timezone: 'America/New_York',
        language: 'en',
        conceptSetup: null,
      } as any,
      {
        leagueFormatId: 'guillotine',
        presetKey: 'test-preset',
        settingsSnapshot: {},
        formatResolution: {
          modifiers: [],
          draftDefaults: { rounds_default: 15, timer_seconds_default: 90 },
          waiverDefaults: { waiver_type: 'faab' },
        },
      } as any,
    )

    const leagueCreateArg = tx.league.create.mock.calls[0][0]
    expect(leagueCreateArg.data.playoffStartWeek).toBeNull()
    expect(leagueCreateArg.data.playoffTeams).toBeNull()
    expect(leagueCreateArg.data.playoffWeeksPerRound).toBeNull()
    expect(leagueCreateArg.data.guillotineMode).toBe(true)

    const extArg = tx.redraftLeagueExtendedSettings.create.mock.calls[0][0]
    expect(extArg.data.commissionerTradeReviewType).toBe('league_vote')
  })
})
