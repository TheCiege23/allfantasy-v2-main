import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getServerSessionMock,
  leagueFindFirstMock,
  leagueFindUniqueMock,
  leagueUpdateMock,
  leagueWaiverSettingsFindUniqueMock,
  leagueWaiverSettingsUpsertMock,
  leagueCreateMock,
  getCreationPayloadAndSettingsMock,
  validateLeagueSettingsMock,
  validateLeagueFeatureFlagsMock,
  runPostCreateInitializationMock,
  executeCanonicalLeagueCreationMock,
  resolveAppUserIdForLeagueCreateMock,
  runLegacyWizardSpecialtyBootstrapsMock,
} = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
  leagueFindFirstMock: vi.fn(),
  leagueFindUniqueMock: vi.fn(),
  leagueUpdateMock: vi.fn(),
  leagueWaiverSettingsFindUniqueMock: vi.fn(),
  leagueWaiverSettingsUpsertMock: vi.fn(),
  leagueCreateMock: vi.fn(),
  getCreationPayloadAndSettingsMock: vi.fn(),
  validateLeagueSettingsMock: vi.fn(),
  validateLeagueFeatureFlagsMock: vi.fn(),
  runPostCreateInitializationMock: vi.fn(),
  executeCanonicalLeagueCreationMock: vi.fn(),
  resolveAppUserIdForLeagueCreateMock: vi.fn(),
  runLegacyWizardSpecialtyBootstrapsMock: vi.fn(),
}))

vi.mock('next-auth', () => ({
  getServerSession: getServerSessionMock,
}))

vi.mock('@/lib/auth', () => ({
  authOptions: {},
}))

vi.mock('@/lib/auth-guard', () => ({
  requireVerifiedUser: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findFirst: leagueFindFirstMock,
      findUnique: leagueFindUniqueMock,
      create: leagueCreateMock,
      update: leagueUpdateMock,
    },
    leagueWaiverSettings: {
      findUnique: leagueWaiverSettingsFindUniqueMock,
      upsert: leagueWaiverSettingsUpsertMock,
    },
    // Prevents TypeError when real RosterTemplateService/ScheduleTemplateResolver/
    // FeatureToggleService code runs (due to module-cache state in full test runs).
    rosterTemplate: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    scheduleTemplate: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    featureToggle: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    storyline: {
      findFirst: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({ id: 'sl-1' }),
    },
  },
}))

vi.mock('@/lib/viral-loop', () => ({
  buildLeagueInviteUrl: vi.fn(() => 'https://invite.test/league'),
}))

vi.mock('@/lib/league-defaults-orchestrator/LeagueDefaultsOrchestrator', () => ({
  getCreationPayloadAndSettings: getCreationPayloadAndSettingsMock,
  runPostCreateInitialization: runPostCreateInitializationMock,
}))

vi.mock('@/lib/league-settings-validation', () => ({
  validateLeagueSettings: validateLeagueSettingsMock,
}))

vi.mock('@/lib/sport-defaults/SportFeatureFlagsService', () => ({
  validateLeagueFeatureFlags: validateLeagueFeatureFlagsMock,
}))

vi.mock('@/lib/league-creation/canonical/executeCanonicalLeagueCreation', () => ({
  executeCanonicalLeagueCreation: executeCanonicalLeagueCreationMock,
}))

vi.mock('@/lib/redraft-creation/resolve-app-user-for-league', () => ({
  resolveAppUserIdForLeagueCreate: resolveAppUserIdForLeagueCreateMock,
}))

vi.mock('@/lib/league-creation/legacyWizardSpecialtyBootstraps', () => ({
  runLegacyWizardSpecialtyBootstrapsAfterLeagueCreate: runLegacyWizardSpecialtyBootstrapsMock,
}))

describe('POST /api/league/create sport defaults integration', () => {
  // Extend timeout for all tests — dynamic route imports cold-load in 30–50s under full suite parallelism
  vi.setConfig({ testTimeout: 60000 })

  beforeAll(async () => {
    // Pre-warm the route module so per-test dynamic imports don't cold-load under parallelism pressure
    await import('@/app/api/league/create/route')
  }, 60000)

  beforeEach(() => {
    vi.clearAllMocks()

    getServerSessionMock.mockResolvedValue({ user: { id: 'u1' } })
    leagueFindFirstMock.mockResolvedValue(null)
    resolveAppUserIdForLeagueCreateMock.mockResolvedValue({ ok: true, appUserId: 'u1', resolvedVia: 'id' })
    executeCanonicalLeagueCreationMock.mockImplementation(async (args: { body: { sport: string } }) => ({
      ok: true as const,
      response: {
        success: true,
        league: {
          id: `league-${String(args.body.sport).toLowerCase()}`,
          leagueName: 'Test',
          concept: 'redraft',
          sport: String(args.body.sport),
          teamCount: 12,
          draftType: 'snake',
          scoringPreset: 'fb_half_ppr',
          status: 'setup',
          presetKey: 'pk',
        },
        homepageUrl: '/league/test',
      },
    }))
    runLegacyWizardSpecialtyBootstrapsMock.mockResolvedValue(undefined)
    leagueFindUniqueMock.mockImplementation(({ where }: { where: { id: string } }) => {
      const id = String(where?.id ?? '')
      const raw = id.replace(/^league-/i, '')
      const sport =
        raw.toLowerCase() === 'soccer'
          ? 'SOCCER'
          : raw.toUpperCase()
      return Promise.resolve({
        id,
        name: 'Test League',
        sport,
        leagueVariant: null,
        leagueSize: 12,
        settings: {},
      })
    })
    leagueWaiverSettingsFindUniqueMock.mockResolvedValue(null)
    leagueWaiverSettingsUpsertMock.mockResolvedValue({ id: 'lws-1' })
    leagueCreateMock.mockImplementation(async ({ data }: any) => ({
      id: `league-${String(data.sport).toLowerCase()}`,
      name: data.name,
      sport: data.sport,
    }))
    leagueUpdateMock.mockImplementation(async ({ where, data }: any) => ({
      id: where.id,
      name: 'Test League',
      sport: String(where.id).replace(/^league-/i, '').toUpperCase(),
      leagueVariant: null,
      leagueSize: 12,
      settings: data.settings ?? {},
      ...data,
    }))

    getCreationPayloadAndSettingsMock.mockImplementation((sport: string) => ({
      payload: {
        draft: {
          draft_type: 'snake',
          rounds_default: 15,
          timer_seconds_default: 90,
          pick_order_rules: 'snake',
          third_round_reversal: false,
        },
        waiver: {
          waiver_type: 'faab',
          processing_days: [2],
          FAAB_budget_default: 100,
          processing_time_utc: '10:00',
          claim_priority_behavior: 'faab_highest',
          game_lock_behavior: 'game_time',
        },
      },
      initialSettings: {
        sport_type: sport,
        default_team_count: sport === 'MLB' ? 12 : 10,
        regular_season_length:
          sport === 'NFL'
            ? 18
            : sport === 'NBA'
              ? 24
              : sport === 'MLB'
                ? 26
                : sport === 'NHL'
                  ? 25
                  : sport === 'NCAAF'
                    ? 15
                    : 18,
        playoff_team_count: 6,
        playoff_structure: { bracket_type: 'single_elimination' },
        matchup_frequency: 'weekly',
        season_labeling: 'week',
        scoring_mode: 'points',
        roster_mode: 'redraft',
        waiver_mode: 'faab',
        trade_review_mode: 'commissioner',
        standings_tiebreakers: ['points_for', 'head_to_head'],
        schedule_unit: 'week',
        injury_slot_behavior: sport === 'MLB' ? 'ir_only' : 'ir_or_out',
        lock_time_behavior: sport === 'MLB' ? 'slate_lock' : 'first_game',
      },
      settingsSummary: {
        playoff_team_count: 6,
      },
      context: {
        sport,
        variant: null,
      },
    }))

    validateLeagueSettingsMock.mockReturnValue({ valid: true, errors: [] })
    validateLeagueFeatureFlagsMock.mockResolvedValue({ valid: true, disallowed: [] })
    runPostCreateInitializationMock.mockResolvedValue({ ok: true })
  })

  it('persists sport-specific initial settings for required sports', async () => {
    const { POST } = await import('@/app/api/league/create/route')

    const sports = ['NFL', 'NBA', 'MLB', 'NHL', 'NCAAF', 'NCAAB', 'SOCCER'] as const

    for (const sport of sports) {
      const req = new Request('http://localhost/api/league/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${sport} Test League`,
          platform: 'manual',
          sport,
          leagueSize: 12,
          scoring: 'standard',
          isDynasty: false,
        }),
      })

      const res = await POST(req)
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json?.league?.sport).toBe(sport)
    }

    /** Manual leagues use POST /api/leagues canonical pipeline (executeCanonicalLeagueCreation), not orchestrator + prisma.league.create. */
    expect(getCreationPayloadAndSettingsMock).not.toHaveBeenCalled()
    expect(leagueCreateMock).not.toHaveBeenCalled()
    expect(executeCanonicalLeagueCreationMock).toHaveBeenCalledTimes(sports.length)
    sports.forEach((sport, i) => {
      expect(executeCanonicalLeagueCreationMock.mock.calls[i]?.[0]).toEqual(
        expect.objectContaining({
          body: expect.objectContaining({ sport, teamCount: 12 }),
        })
      )
    })
  })

  it('persists NFL variant matrix and Soccer standard variant', async () => {
    const { POST } = await import('@/app/api/league/create/route')

    const cases = [
      { sport: 'NFL', variant: 'STANDARD' },
      { sport: 'NFL', variant: 'PPR' },
      { sport: 'NFL', variant: 'SUPERFLEX' },
      { sport: 'NFL', variant: 'IDP' },
      { sport: 'NFL', variant: 'DYNASTY_IDP' },
      { sport: 'SOCCER', variant: 'STANDARD' },
    ] as const

    for (const c of cases) {
      const req = new Request('http://localhost/api/league/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${c.sport} ${c.variant} League`,
          platform: 'espn',
          platformLeagueId: 'espn-import-defaults-test',
          sport: c.sport,
          leagueVariant: c.variant,
          leagueSize: 12,
          scoring: 'standard',
          isDynasty: c.variant === 'DYNASTY_IDP',
        }),
      })

      const res = await POST(req)
      expect(res.status).toBe(200)
    }

    const recentPayloads = leagueCreateMock.mock.calls.slice(-cases.length).map((c) => c[0]?.data)
    expect(recentPayloads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sport: 'NFL', leagueVariant: 'STANDARD' }),
        expect.objectContaining({ sport: 'NFL', leagueVariant: 'PPR' }),
        expect.objectContaining({ sport: 'NFL', leagueVariant: 'SUPERFLEX' }),
        expect.objectContaining({ sport: 'NFL', leagueVariant: 'IDP' }),
        expect.objectContaining({ sport: 'NFL', leagueVariant: 'DYNASTY_IDP' }),
        expect.objectContaining({ sport: 'SOCCER', leagueVariant: 'STANDARD' }),
      ])
    )
  })

  it('supports remaining top paths: dynasty+snake and best_ball+snake', async () => {
    const { POST } = await import('@/app/api/league/create/route')

    const cases = [
      {
        sport: 'NFL',
        leagueType: 'dynasty',
        draftType: 'snake',
        isDynasty: true,
        assert: (payload: any) => {
          expect(payload.isDynasty).toBe(true)
          expect(payload.settings).toEqual(
            expect.objectContaining({
              league_type: 'dynasty',
              draft_type: 'snake',
              requested_draft_type: 'snake',
            })
          )
        },
      },
      {
        sport: 'NFL',
        leagueType: 'best_ball',
        draftType: 'snake',
        isDynasty: false,
        assert: (payload: any) => {
          expect(payload.isDynasty).toBe(false)
          expect(payload.settings).toEqual(
            expect.objectContaining({
              league_type: 'best_ball',
              draft_type: 'snake',
              requested_draft_type: 'snake',
              best_ball: true,
            })
          )
        },
      },
    ] as const

    for (const c of cases) {
      const req = new Request('http://localhost/api/league/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${c.leagueType} ${c.draftType} path`,
          platform: 'espn',
          platformLeagueId: 'espn-import-defaults-test',
          sport: c.sport,
          leagueType: c.leagueType,
          draftType: c.draftType,
          leagueSize: 12,
          scoring: 'standard',
          isDynasty: c.isDynasty,
        }),
      })

      const res = await POST(req)
      expect(res.status).toBe(200)
    }

    const recentPayloads = leagueCreateMock.mock.calls.slice(-cases.length).map((c) => c[0]?.data)
    expect(recentPayloads).toHaveLength(cases.length)
    for (const [index, payload] of recentPayloads.entries()) {
      expect(payload.isCommissioner).toBe(true)
      cases[index]!.assert(payload)
    }
  })

  it('supports remaining paths: keeper+snake and salary_cap+auction', async () => {
    const { POST } = await import('@/app/api/league/create/route')

    const cases = [
      {
        sport: 'NFL',
        leagueType: 'keeper',
        draftType: 'snake',
        isDynasty: false,
        assert: (payload: any) => {
          expect(payload.isDynasty).toBe(false)
          expect(payload.settings).toEqual(
            expect.objectContaining({
              league_type: 'keeper',
              format_id: 'keeper',
              draft_type: 'snake',
              requested_draft_type: 'snake',
            })
          )
        },
      },
      {
        sport: 'NFL',
        leagueType: 'salary_cap',
        draftType: 'auction',
        isDynasty: true,
        assert: (payload: any) => {
          expect(payload.isDynasty).toBe(true)
          expect(payload.leagueVariant).toBe('salary_cap')
          expect(payload.settings).toEqual(
            expect.objectContaining({
              league_type: 'salary_cap',
              format_id: 'salary_cap',
              draft_type: 'auction',
              requested_draft_type: 'auction',
            })
          )
        },
      },
    ] as const

    for (const c of cases) {
      const req = new Request('http://localhost/api/league/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${c.leagueType} ${c.draftType} path`,
          platform: 'espn',
          platformLeagueId: 'espn-import-defaults-test',
          sport: c.sport,
          leagueType: c.leagueType,
          draftType: c.draftType,
          leagueSize: 12,
          scoring: 'standard',
          isDynasty: c.isDynasty,
        }),
      })

      const res = await POST(req)
      expect(res.status).toBe(200)
    }

    const recentPayloads = leagueCreateMock.mock.calls.slice(-cases.length).map((c) => c[0]?.data)
    expect(recentPayloads).toHaveLength(cases.length)
    for (const [index, payload] of recentPayloads.entries()) {
      expect(payload.isCommissioner).toBe(true)
      cases[index]!.assert(payload)
    }
  })

  it('supports next paths: guillotine+snake and survivor+snake', async () => {
    const { POST } = await import('@/app/api/league/create/route')

    const cases = [
      {
        sport: 'NFL',
        leagueType: 'guillotine',
        draftType: 'snake',
        isDynasty: true,
        assert: (payload: any) => {
          expect(payload.isDynasty).toBe(false)
          expect(payload.leagueVariant).toBe('guillotine')
          expect(payload.settings).toEqual(
            expect.objectContaining({
              league_type: 'guillotine',
              format_id: 'guillotine',
              draft_type: 'snake',
              requested_draft_type: 'snake',
            })
          )
        },
      },
      {
        sport: 'NFL',
        leagueType: 'survivor',
        draftType: 'snake',
        isDynasty: false,
        assert: (payload: any) => {
          expect(payload.isDynasty).toBe(false)
          expect(payload.leagueVariant).toBe('survivor')
          expect(payload.settings).toEqual(
            expect.objectContaining({
              league_type: 'survivor',
              format_id: 'survivor',
              draft_type: 'snake',
              requested_draft_type: 'snake',
            })
          )
        },
      },
    ] as const

    for (const c of cases) {
      const req = new Request('http://localhost/api/league/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${c.leagueType} ${c.draftType} path`,
          platform: 'espn',
          platformLeagueId: 'espn-import-defaults-test',
          sport: c.sport,
          leagueType: c.leagueType,
          draftType: c.draftType,
          leagueSize: 12,
          scoring: 'standard',
          isDynasty: c.isDynasty,
        }),
      })

      const res = await POST(req)
      expect(res.status).toBe(200)
    }

    const recentPayloads = leagueCreateMock.mock.calls.slice(-cases.length).map((c) => c[0]?.data)
    expect(recentPayloads).toHaveLength(cases.length)
    for (const [index, payload] of recentPayloads.entries()) {
      expect(payload.isCommissioner).toBe(true)
      cases[index]!.assert(payload)
    }
  }, 60000)

  it('supports next paths: tournament+linear and redraft+auction', async () => {
    const { POST } = await import('@/app/api/league/create/route')

    const cases = [
      {
        sport: 'NFL',
        leagueType: 'tournament',
        draftType: 'linear',
        isDynasty: false,
        assert: (payload: any) => {
          expect(payload.isDynasty).toBe(false)
          expect(payload.leagueVariant).toBeNull()
          expect(payload.settings).toEqual(
            expect.objectContaining({
              league_type: 'tournament',
              format_id: 'tournament',
              draft_type: 'linear',
              requested_draft_type: 'linear',
            })
          )
        },
      },
      {
        sport: 'NFL',
        leagueType: 'redraft',
        draftType: 'auction',
        isDynasty: false,
        assert: (payload: any) => {
          expect(payload.isDynasty).toBe(false)
          expect(payload.leagueVariant).toBeNull()
          expect(payload.settings).toEqual(
            expect.objectContaining({
              league_type: 'redraft',
              format_id: 'redraft',
              draft_type: 'auction',
              requested_draft_type: 'auction',
            })
          )
        },
      },
    ] as const

    for (const c of cases) {
      const req = new Request('http://localhost/api/league/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${c.leagueType} ${c.draftType} path`,
          platform: 'espn',
          platformLeagueId: 'espn-import-defaults-test',
          sport: c.sport,
          leagueType: c.leagueType,
          draftType: c.draftType,
          leagueSize: 12,
          scoring: 'standard',
          isDynasty: c.isDynasty,
        }),
      })

      const res = await POST(req)
      expect(res.status).toBe(200)
    }

    const recentPayloads = leagueCreateMock.mock.calls.slice(-cases.length).map((c) => c[0]?.data)
    expect(recentPayloads).toHaveLength(cases.length)
    for (const [index, payload] of recentPayloads.entries()) {
      expect(payload.isCommissioner).toBe(true)
      cases[index]!.assert(payload)
    }
  })

  it('supports next paths: devy+devy_snake and c2c+c2c_snake', async () => {
    const { POST } = await import('@/app/api/league/create/route')

    const cases = [
      {
        sport: 'NFL',
        leagueType: 'devy',
        draftType: 'devy_snake',
        isDynasty: true,
        assert: (payload: any) => {
          expect(payload.isDynasty).toBe(true)
          expect(payload.leagueVariant).toBe('devy_dynasty')
          expect(payload.settings).toEqual(
            expect.objectContaining({
              league_type: 'devy',
              format_id: 'devy',
              draft_type: 'snake',
              requested_draft_type: 'devy_snake',
            })
          )
        },
      },
      {
        sport: 'NFL',
        leagueType: 'c2c',
        draftType: 'c2c_snake',
        isDynasty: true,
        assert: (payload: any) => {
          expect(payload.isDynasty).toBe(true)
          expect(payload.leagueVariant).toBe('merged_devy_c2c')
          expect(payload.settings).toEqual(
            expect.objectContaining({
              league_type: 'c2c',
              format_id: 'c2c',
              draft_type: 'snake',
              requested_draft_type: 'c2c_snake',
            })
          )
        },
      },
    ] as const

    for (const c of cases) {
      const req = new Request('http://localhost/api/league/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${c.leagueType} ${c.draftType} path`,
          platform: 'espn',
          platformLeagueId: 'espn-import-defaults-test',
          sport: c.sport,
          leagueType: c.leagueType,
          draftType: c.draftType,
          leagueSize: 12,
          scoring: 'standard',
          isDynasty: c.isDynasty,
        }),
      })

      const res = await POST(req)
      expect(res.status).toBe(200)
    }

    const recentPayloads = leagueCreateMock.mock.calls.slice(-cases.length).map((c) => c[0]?.data)
    expect(recentPayloads).toHaveLength(cases.length)
    for (const [index, payload] of recentPayloads.entries()) {
      expect(payload.isCommissioner).toBe(true)
      cases[index]!.assert(payload)
    }
  })

  it('supports next paths: devy+devy_auction and c2c+c2c_auction', async () => {
    const { POST } = await import('@/app/api/league/create/route')

    const cases = [
      {
        sport: 'NFL',
        leagueType: 'devy',
        draftType: 'devy_auction',
        isDynasty: true,
        assert: (payload: any) => {
          expect(payload.isDynasty).toBe(true)
          expect(payload.leagueVariant).toBe('devy_dynasty')
          expect(payload.settings).toEqual(
            expect.objectContaining({
              league_type: 'devy',
              format_id: 'devy',
              draft_type: 'auction',
              requested_draft_type: 'devy_auction',
            })
          )
        },
      },
      {
        sport: 'NFL',
        leagueType: 'c2c',
        draftType: 'c2c_auction',
        isDynasty: true,
        assert: (payload: any) => {
          expect(payload.isDynasty).toBe(true)
          expect(payload.leagueVariant).toBe('merged_devy_c2c')
          expect(payload.settings).toEqual(
            expect.objectContaining({
              league_type: 'c2c',
              format_id: 'c2c',
              draft_type: 'auction',
              requested_draft_type: 'c2c_auction',
            })
          )
        },
      },
    ] as const

    for (const c of cases) {
      const req = new Request('http://localhost/api/league/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${c.leagueType} ${c.draftType} path`,
          platform: 'espn',
          platformLeagueId: 'espn-import-defaults-test',
          sport: c.sport,
          leagueType: c.leagueType,
          draftType: c.draftType,
          leagueSize: 12,
          scoring: 'standard',
          isDynasty: c.isDynasty,
        }),
      })

      const res = await POST(req)
      expect(res.status).toBe(200)
    }

    const recentPayloads = leagueCreateMock.mock.calls.slice(-cases.length).map((c) => c[0]?.data)
    expect(recentPayloads).toHaveLength(cases.length)
    for (const [index, payload] of recentPayloads.entries()) {
      expect(payload.isCommissioner).toBe(true)
      cases[index]!.assert(payload)
    }
  })

  it('supports next paths: zombie+snake and salary_cap+auction', async () => {
    const { POST } = await import('@/app/api/league/create/route')

    const cases = [
      {
        sport: 'NFL',
        leagueType: 'zombie',
        draftType: 'snake',
        isDynasty: false,
        assert: (payload: any) => {
          expect(payload.isDynasty).toBe(false)
          expect(payload.leagueVariant).toBe('zombie')
          expect(payload.settings).toEqual(
            expect.objectContaining({
              league_type: 'zombie',
              format_id: 'zombie',
              draft_type: 'snake',
              requested_draft_type: 'snake',
            })
          )
        },
      },
      {
        sport: 'NFL',
        leagueType: 'salary_cap',
        draftType: 'auction',
        isDynasty: true,
        assert: (payload: any) => {
          expect(payload.isDynasty).toBe(true)
          expect(payload.leagueVariant).toBe('salary_cap')
          expect(payload.settings).toEqual(
            expect.objectContaining({
              league_type: 'salary_cap',
              format_id: 'salary_cap',
              draft_type: 'auction',
              requested_draft_type: 'auction',
            })
          )
        },
      },
    ] as const

    for (const c of cases) {
      const req = new Request('http://localhost/api/league/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${c.leagueType} ${c.draftType} path`,
          platform: 'espn',
          platformLeagueId: 'espn-import-defaults-test',
          sport: c.sport,
          leagueType: c.leagueType,
          draftType: c.draftType,
          leagueSize: 12,
          scoring: 'standard',
          isDynasty: c.isDynasty,
        }),
      })

      const res = await POST(req)
      expect(res.status).toBe(200)
    }

    const recentPayloads = leagueCreateMock.mock.calls.slice(-cases.length).map((c) => c[0]?.data)
    expect(recentPayloads).toHaveLength(cases.length)
    for (const [index, payload] of recentPayloads.entries()) {
      expect(payload.isCommissioner).toBe(true)
      cases[index]!.assert(payload)
    }
  })

  it('supports next paths: keeper+auction and best_ball+auction', async () => {
    const { POST } = await import('@/app/api/league/create/route')

    const cases = [
      {
        sport: 'NFL',
        leagueType: 'keeper',
        draftType: 'auction',
        isDynasty: false,
        assert: (payload: any) => {
          expect(payload.isDynasty).toBe(false)
          expect(payload.leagueVariant).toBeNull()
          expect(payload.settings).toEqual(
            expect.objectContaining({
              league_type: 'keeper',
              format_id: 'keeper',
              draft_type: 'auction',
              requested_draft_type: 'auction',
            })
          )
        },
      },
      {
        sport: 'NFL',
        leagueType: 'best_ball',
        draftType: 'auction',
        isDynasty: false,
        assert: (payload: any) => {
          expect(payload.isDynasty).toBe(false)
          expect(payload.leagueVariant).toBeNull()
          expect(payload.settings).toEqual(
            expect.objectContaining({
              league_type: 'best_ball',
              format_id: 'best_ball',
              draft_type: 'auction',
              requested_draft_type: 'auction',
              best_ball: true,
            })
          )
        },
      },
    ] as const

    for (const c of cases) {
      const req = new Request('http://localhost/api/league/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${c.leagueType} ${c.draftType} path`,
          platform: 'espn',
          platformLeagueId: 'espn-import-defaults-test',
          sport: c.sport,
          leagueType: c.leagueType,
          draftType: c.draftType,
          leagueSize: 12,
          scoring: 'standard',
          isDynasty: c.isDynasty,
        }),
      })

      const res = await POST(req)
      expect(res.status).toBe(200)
    }

    const recentPayloads = leagueCreateMock.mock.calls.slice(-cases.length).map((c) => c[0]?.data)
    expect(recentPayloads).toHaveLength(cases.length)
    for (const [index, payload] of recentPayloads.entries()) {
      expect(payload.isCommissioner).toBe(true)
      cases[index]!.assert(payload)
    }
  })

  it('supports next paths: dynasty+auction and redraft+linear', async () => {
    const { POST } = await import('@/app/api/league/create/route')

    const cases = [
      {
        sport: 'NFL',
        leagueType: 'dynasty',
        draftType: 'auction',
        isDynasty: true,
        assert: (payload: any) => {
          expect(payload.isDynasty).toBe(true)
          expect(payload.leagueVariant).toBeNull()
          expect(payload.settings).toEqual(
            expect.objectContaining({
              league_type: 'dynasty',
              format_id: 'dynasty',
              draft_type: 'auction',
              requested_draft_type: 'auction',
            })
          )
        },
      },
      {
        sport: 'NFL',
        leagueType: 'redraft',
        draftType: 'linear',
        isDynasty: false,
        assert: (payload: any) => {
          expect(payload.isDynasty).toBe(false)
          expect(payload.leagueVariant).toBeNull()
          expect(payload.settings).toEqual(
            expect.objectContaining({
              league_type: 'redraft',
              format_id: 'redraft',
              draft_type: 'linear',
              requested_draft_type: 'linear',
              roster_mode: 'redraft',
            })
          )
        },
      },
    ] as const

    for (const c of cases) {
      const req = new Request('http://localhost/api/league/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${c.leagueType} ${c.draftType} path`,
          platform: 'espn',
          platformLeagueId: 'espn-import-defaults-test',
          sport: c.sport,
          leagueType: c.leagueType,
          draftType: c.draftType,
          leagueSize: 12,
          scoring: 'standard',
          isDynasty: c.isDynasty,
        }),
      })

      const res = await POST(req)
      expect(res.status).toBe(200)
    }

    const recentPayloads = leagueCreateMock.mock.calls.slice(-cases.length).map((c) => c[0]?.data)
    expect(recentPayloads).toHaveLength(cases.length)
    for (const [index, payload] of recentPayloads.entries()) {
      expect(payload.isCommissioner).toBe(true)
      cases[index]!.assert(payload)
    }
  })

  it('supports next paths: devy+devy_snake and c2c+c2c_auction', async () => {
    const { POST } = await import('@/app/api/league/create/route')

    const cases = [
      {
        sport: 'NFL',
        leagueType: 'devy',
        draftType: 'devy_snake',
        isDynasty: true,
        assert: (payload: any) => {
          expect(payload.isDynasty).toBe(true)
          expect(payload.leagueVariant).toBe('devy_dynasty')
          expect(payload.settings).toEqual(
            expect.objectContaining({
              league_type: 'devy',
              format_id: 'devy',
              draft_type: 'snake',
              requested_draft_type: 'devy_snake',
            })
          )
        },
      },
      {
        sport: 'NFL',
        leagueType: 'c2c',
        draftType: 'c2c_auction',
        isDynasty: true,
        assert: (payload: any) => {
          expect(payload.isDynasty).toBe(true)
          expect(payload.leagueVariant).toBe('merged_devy_c2c')
          expect(payload.settings).toEqual(
            expect.objectContaining({
              league_type: 'c2c',
              format_id: 'c2c',
              draft_type: 'auction',
              requested_draft_type: 'c2c_auction',
            })
          )
        },
      },
    ] as const

    for (const c of cases) {
      const req = new Request('http://localhost/api/league/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${c.leagueType} ${c.draftType} path`,
          platform: 'espn',
          platformLeagueId: 'espn-import-defaults-test',
          sport: c.sport,
          leagueType: c.leagueType,
          draftType: c.draftType,
          leagueSize: 12,
          scoring: 'standard',
          isDynasty: c.isDynasty,
        }),
      })

      const res = await POST(req)
      expect(res.status).toBe(200)
    }

    const recentPayloads = leagueCreateMock.mock.calls.slice(-cases.length).map((c) => c[0]?.data)
    expect(recentPayloads).toHaveLength(cases.length)
    for (const [index, payload] of recentPayloads.entries()) {
      expect(payload.isCommissioner).toBe(true)
      cases[index]!.assert(payload)
    }
  })

  it('supports next paths: best_ball+snake and keeper+linear', async () => {
    const { POST } = await import('@/app/api/league/create/route')

    const cases = [
      {
        sport: 'NFL',
        leagueType: 'best_ball',
        draftType: 'snake',
        isDynasty: false,
        assert: (payload: any) => {
          expect(payload.isDynasty).toBe(false)
          expect(payload.leagueVariant).toBeNull()
          expect(payload.settings).toEqual(
            expect.objectContaining({
              league_type: 'best_ball',
              format_id: 'best_ball',
              draft_type: 'snake',
              requested_draft_type: 'snake',
              best_ball: true,
            })
          )
        },
      },
      {
        sport: 'NFL',
        leagueType: 'keeper',
        draftType: 'linear',
        isDynasty: false,
        assert: (payload: any) => {
          expect(payload.isDynasty).toBe(false)
          expect(payload.leagueVariant).toBeNull()
          expect(payload.settings).toEqual(
            expect.objectContaining({
              league_type: 'keeper',
              format_id: 'keeper',
              draft_type: 'linear',
              requested_draft_type: 'linear',
            })
          )
        },
      },
    ] as const

    for (const c of cases) {
      const req = new Request('http://localhost/api/league/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${c.leagueType} ${c.draftType} path`,
          platform: 'espn',
          platformLeagueId: 'espn-import-defaults-test',
          sport: c.sport,
          leagueType: c.leagueType,
          draftType: c.draftType,
          leagueSize: 12,
          scoring: 'standard',
          isDynasty: c.isDynasty,
        }),
      })

      const res = await POST(req)
      expect(res.status).toBe(200)
    }

    const recentPayloads = leagueCreateMock.mock.calls.slice(-cases.length).map((c) => c[0]?.data)
    expect(recentPayloads).toHaveLength(cases.length)
    for (const [index, payload] of recentPayloads.entries()) {
      expect(payload.isCommissioner).toBe(true)
      cases[index]!.assert(payload)
    }
  })

  it('supports next paths: salary_cap+auction and tournament+auction', async () => {
    const { POST } = await import('@/app/api/league/create/route')

    const cases = [
      {
        sport: 'NFL',
        leagueType: 'salary_cap',
        draftType: 'auction',
        isDynasty: true,
        assert: (payload: any) => {
          expect(payload.isDynasty).toBe(true)
          expect(payload.leagueVariant).toBe('salary_cap')
          expect(payload.settings).toEqual(
            expect.objectContaining({
              league_type: 'salary_cap',
              format_id: 'salary_cap',
              draft_type: 'auction',
              requested_draft_type: 'auction',
            })
          )
        },
      },
      {
        sport: 'NFL',
        leagueType: 'tournament',
        draftType: 'auction',
        isDynasty: false,
        assert: (payload: any) => {
          expect(payload.isDynasty).toBe(false)
          expect(payload.leagueVariant).toBeNull()
          expect(payload.settings).toEqual(
            expect.objectContaining({
              league_type: 'tournament',
              format_id: 'tournament',
              draft_type: 'auction',
              requested_draft_type: 'auction',
            })
          )
        },
      },
    ] as const

    for (const c of cases) {
      const req = new Request('http://localhost/api/league/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${c.leagueType} ${c.draftType} path`,
          platform: 'espn',
          platformLeagueId: 'espn-import-defaults-test',
          sport: c.sport,
          leagueType: c.leagueType,
          draftType: c.draftType,
          leagueSize: 12,
          scoring: 'standard',
          isDynasty: c.isDynasty,
        }),
      })

      const res = await POST(req)
      expect(res.status).toBe(200)
    }

    const recentPayloads = leagueCreateMock.mock.calls.slice(-cases.length).map((c) => c[0]?.data)
    expect(recentPayloads).toHaveLength(cases.length)
    for (const [index, payload] of recentPayloads.entries()) {
      expect(payload.isCommissioner).toBe(true)
      cases[index]!.assert(payload)
    }
  })

  it('supports next paths: zombie+snake and survivor+auction', async () => {
    const { POST } = await import('@/app/api/league/create/route')

    const cases = [
      {
        sport: 'NFL',
        leagueType: 'zombie',
        draftType: 'snake',
        isDynasty: false,
        assert: (payload: any) => {
          expect(payload.isDynasty).toBe(false)
          expect(payload.leagueVariant).toBe('zombie')
          expect(payload.settings).toEqual(
            expect.objectContaining({
              league_type: 'zombie',
              format_id: 'zombie',
              draft_type: 'snake',
              requested_draft_type: 'snake',
            })
          )
        },
      },
      {
        sport: 'NFL',
        leagueType: 'survivor',
        draftType: 'auction',
        isDynasty: false,
        assert: (payload: any) => {
          expect(payload.isDynasty).toBe(false)
          expect(payload.leagueVariant).toBe('survivor')
          expect(payload.settings).toEqual(
            expect.objectContaining({
              league_type: 'survivor',
              format_id: 'survivor',
              draft_type: 'auction',
              requested_draft_type: 'auction',
            })
          )
        },
      },
    ] as const

    for (const c of cases) {
      const req = new Request('http://localhost/api/league/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${c.leagueType} ${c.draftType} path`,
          platform: 'espn',
          platformLeagueId: 'espn-import-defaults-test',
          sport: c.sport,
          leagueType: c.leagueType,
          draftType: c.draftType,
          leagueSize: 12,
          scoring: 'standard',
          isDynasty: c.isDynasty,
        }),
      })

      const res = await POST(req)
      expect(res.status).toBe(200)
    }

    const recentPayloads = leagueCreateMock.mock.calls.slice(-cases.length).map((c) => c[0]?.data)
    expect(recentPayloads).toHaveLength(cases.length)
    for (const [index, payload] of recentPayloads.entries()) {
      expect(payload.isCommissioner).toBe(true)
      cases[index]!.assert(payload)
    }
  }, 60000)

  it('supports next paths: guillotine+linear and survivor+auction', async () => {
    const { POST } = await import('@/app/api/league/create/route')

    const cases = [
      {
        sport: 'NFL',
        leagueType: 'guillotine',
        draftType: 'linear',
        isDynasty: false,
        assert: (payload: any) => {
          expect(payload.isDynasty).toBe(false)
          expect(payload.leagueVariant).toBe('guillotine')
          expect(payload.settings).toEqual(
            expect.objectContaining({
              league_type: 'guillotine',
              format_id: 'guillotine',
              draft_type: 'linear',
              requested_draft_type: 'linear',
            })
          )
        },
      },
      {
        sport: 'NFL',
        leagueType: 'survivor',
        draftType: 'auction',
        isDynasty: false,
        assert: (payload: any) => {
          expect(payload.isDynasty).toBe(false)
          expect(payload.leagueVariant).toBe('survivor')
          expect(payload.settings).toEqual(
            expect.objectContaining({
              league_type: 'survivor',
              format_id: 'survivor',
              draft_type: 'auction',
              requested_draft_type: 'auction',
            })
          )
        },
      },
    ] as const

    for (const c of cases) {
      const req = new Request('http://localhost/api/league/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${c.leagueType} ${c.draftType} path`,
          platform: 'espn',
          platformLeagueId: 'espn-import-defaults-test',
          sport: c.sport,
          leagueType: c.leagueType,
          draftType: c.draftType,
          leagueSize: 12,
          scoring: 'standard',
          isDynasty: c.isDynasty,
        }),
      })

      const res = await POST(req)
      expect(res.status).toBe(200)
    }

    const recentPayloads = leagueCreateMock.mock.calls.slice(-cases.length).map((c) => c[0]?.data)
    expect(recentPayloads).toHaveLength(cases.length)
    for (const [index, payload] of recentPayloads.entries()) {
      expect(payload.isCommissioner).toBe(true)
      cases[index]!.assert(payload)
    }
  }, 60000)

  it('rejects zombie+auction draft path (snake-only)', async () => {
    const { POST } = await import('@/app/api/league/create/route')

    const req = new Request('http://localhost/api/league/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'zombie auction invalid path',
        platform: 'espn',
        platformLeagueId: 'espn-import-defaults-test',
        sport: 'NFL',
        leagueType: 'zombie',
        draftType: 'auction',
        leagueSize: 12,
        scoring: 'standard',
        isDynasty: false,
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('supports next paths: dynasty+linear and tournament+snake', async () => {
    const { POST } = await import('@/app/api/league/create/route')

    const cases = [
      {
        sport: 'NFL',
        leagueType: 'dynasty',
        draftType: 'linear',
        isDynasty: true,
        assert: (payload: any) => {
          expect(payload.isDynasty).toBe(true)
          expect(payload.leagueVariant).toBeNull()
          expect(payload.settings).toEqual(
            expect.objectContaining({
              league_type: 'dynasty',
              format_id: 'dynasty',
              draft_type: 'linear',
              requested_draft_type: 'linear',
            })
          )
        },
      },
      {
        sport: 'NFL',
        leagueType: 'tournament',
        draftType: 'snake',
        isDynasty: false,
        assert: (payload: any) => {
          expect(payload.isDynasty).toBe(false)
          expect(payload.leagueVariant).toBeNull()
          expect(payload.settings).toEqual(
            expect.objectContaining({
              league_type: 'tournament',
              format_id: 'tournament',
              draft_type: 'snake',
              requested_draft_type: 'snake',
            })
          )
        },
      },
    ] as const

    for (const c of cases) {
      const req = new Request('http://localhost/api/league/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${c.leagueType} ${c.draftType} path`,
          platform: 'espn',
          platformLeagueId: 'espn-import-defaults-test',
          sport: c.sport,
          leagueType: c.leagueType,
          draftType: c.draftType,
          leagueSize: 12,
          scoring: 'standard',
          isDynasty: c.isDynasty,
        }),
      })

      const res = await POST(req)
      expect(res.status).toBe(200)
    }

    const recentPayloads = leagueCreateMock.mock.calls.slice(-cases.length).map((c) => c[0]?.data)
    expect(recentPayloads).toHaveLength(cases.length)
    for (const [index, payload] of recentPayloads.entries()) {
      expect(payload.isCommissioner).toBe(true)
      cases[index]!.assert(payload)
    }
  })

  it('supports next paths: zombie+snake and tournament+linear', async () => {
    const { POST } = await import('@/app/api/league/create/route')

    const cases = [
      {
        sport: 'NFL',
        leagueType: 'zombie',
        draftType: 'snake',
        isDynasty: false,
        assert: (payload: any) => {
          expect(payload.isDynasty).toBe(false)
          expect(payload.leagueVariant).toBe('zombie')
          expect(payload.settings).toEqual(
            expect.objectContaining({
              league_type: 'zombie',
              format_id: 'zombie',
              draft_type: 'snake',
              requested_draft_type: 'snake',
            })
          )
        },
      },
      {
        sport: 'NFL',
        leagueType: 'tournament',
        draftType: 'linear',
        isDynasty: false,
        assert: (payload: any) => {
          expect(payload.isDynasty).toBe(false)
          expect(payload.leagueVariant).toBeNull()
          expect(payload.settings).toEqual(
            expect.objectContaining({
              league_type: 'tournament',
              format_id: 'tournament',
              draft_type: 'linear',
              requested_draft_type: 'linear',
            })
          )
        },
      },
    ] as const

    for (const c of cases) {
      const req = new Request('http://localhost/api/league/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${c.leagueType} ${c.draftType} path`,
          platform: 'espn',
          platformLeagueId: 'espn-import-defaults-test',
          sport: c.sport,
          leagueType: c.leagueType,
          draftType: c.draftType,
          leagueSize: 12,
          scoring: 'standard',
          isDynasty: c.isDynasty,
        }),
      })

      const res = await POST(req)
      expect(res.status).toBe(200)
    }

    const recentPayloads = leagueCreateMock.mock.calls.slice(-cases.length).map((c) => c[0]?.data)
    expect(recentPayloads).toHaveLength(cases.length)
    for (const [index, payload] of recentPayloads.entries()) {
      expect(payload.isCommissioner).toBe(true)
      cases[index]!.assert(payload)
    }
  })

  it('supports next paths: redraft+snake and keeper+snake', async () => {
    const { POST } = await import('@/app/api/league/create/route')

    const cases = [
      {
        sport: 'NFL',
        leagueType: 'redraft',
        draftType: 'snake',
        isDynasty: false,
        assert: (payload: any) => {
          expect(payload.isDynasty).toBe(false)
          expect(payload.leagueVariant).toBeNull()
          expect(payload.settings).toEqual(
            expect.objectContaining({
              league_type: 'redraft',
              format_id: 'redraft',
              draft_type: 'snake',
              requested_draft_type: 'snake',
              roster_mode: 'redraft',
            })
          )
        },
      },
      {
        sport: 'NFL',
        leagueType: 'keeper',
        draftType: 'snake',
        isDynasty: false,
        assert: (payload: any) => {
          expect(payload.isDynasty).toBe(false)
          expect(payload.leagueVariant).toBeNull()
          expect(payload.settings).toEqual(
            expect.objectContaining({
              league_type: 'keeper',
              format_id: 'keeper',
              draft_type: 'snake',
              requested_draft_type: 'snake',
            })
          )
        },
      },
    ] as const

    for (const c of cases) {
      const req = new Request('http://localhost/api/league/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${c.leagueType} ${c.draftType} path`,
          platform: 'espn',
          platformLeagueId: 'espn-import-defaults-test',
          sport: c.sport,
          leagueType: c.leagueType,
          draftType: c.draftType,
          leagueSize: 12,
          scoring: 'standard',
          isDynasty: c.isDynasty,
        }),
      })

      const res = await POST(req)
      expect(res.status).toBe(200)
    }

    const recentPayloads = leagueCreateMock.mock.calls.slice(-cases.length).map((c) => c[0]?.data)
    expect(recentPayloads).toHaveLength(cases.length)
    for (const [index, payload] of recentPayloads.entries()) {
      expect(payload.isCommissioner).toBe(true)
      cases[index]!.assert(payload)
    }
  })

  it('supports next paths: best_ball+linear and dynasty+snake', async () => {
    const { POST } = await import('@/app/api/league/create/route')

    const cases = [
      {
        sport: 'NFL',
        leagueType: 'best_ball',
        draftType: 'linear',
        isDynasty: false,
        assert: (payload: any) => {
          expect(payload.isDynasty).toBe(false)
          expect(payload.leagueVariant).toBeNull()
          expect(payload.settings).toEqual(
            expect.objectContaining({
              league_type: 'best_ball',
              format_id: 'best_ball',
              draft_type: 'linear',
              requested_draft_type: 'linear',
              best_ball: true,
            })
          )
        },
      },
      {
        sport: 'NFL',
        leagueType: 'dynasty',
        draftType: 'snake',
        isDynasty: true,
        assert: (payload: any) => {
          expect(payload.isDynasty).toBe(true)
          expect(payload.leagueVariant).toBeNull()
          expect(payload.settings).toEqual(
            expect.objectContaining({
              league_type: 'dynasty',
              format_id: 'dynasty',
              draft_type: 'snake',
              requested_draft_type: 'snake',
            })
          )
        },
      },
    ] as const

    for (const c of cases) {
      const req = new Request('http://localhost/api/league/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${c.leagueType} ${c.draftType} path`,
          platform: 'espn',
          platformLeagueId: 'espn-import-defaults-test',
          sport: c.sport,
          leagueType: c.leagueType,
          draftType: c.draftType,
          leagueSize: 12,
          scoring: 'standard',
          isDynasty: c.isDynasty,
        }),
      })

      const res = await POST(req)
      expect(res.status).toBe(200)
    }

    const recentPayloads = leagueCreateMock.mock.calls.slice(-cases.length).map((c) => c[0]?.data)
    expect(recentPayloads).toHaveLength(cases.length)
    for (const [index, payload] of recentPayloads.entries()) {
      expect(payload.isCommissioner).toBe(true)
      cases[index]!.assert(payload)
    }
  })

  it('supports next paths: guillotine+auction and survivor+snake', async () => {
    const { POST } = await import('@/app/api/league/create/route')

    const cases = [
      {
        sport: 'NFL',
        leagueType: 'guillotine',
        draftType: 'auction',
        isDynasty: false,
        assert: (payload: any) => {
          expect(payload.isDynasty).toBe(false)
          expect(payload.leagueVariant).toBe('guillotine')
          expect(payload.settings).toEqual(
            expect.objectContaining({
              league_type: 'guillotine',
              format_id: 'guillotine',
              draft_type: 'auction',
              requested_draft_type: 'auction',
            })
          )
        },
      },
      {
        sport: 'NFL',
        leagueType: 'survivor',
        draftType: 'snake',
        isDynasty: false,
        assert: (payload: any) => {
          expect(payload.isDynasty).toBe(false)
          expect(payload.leagueVariant).toBe('survivor')
          expect(payload.settings).toEqual(
            expect.objectContaining({
              league_type: 'survivor',
              format_id: 'survivor',
              draft_type: 'snake',
              requested_draft_type: 'snake',
            })
          )
        },
      },
    ] as const

    for (const c of cases) {
      const req = new Request('http://localhost/api/league/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${c.leagueType} ${c.draftType} path`,
          platform: 'espn',
          platformLeagueId: 'espn-import-defaults-test',
          sport: c.sport,
          leagueType: c.leagueType,
          draftType: c.draftType,
          leagueSize: 12,
          scoring: 'standard',
          isDynasty: c.isDynasty,
        }),
      })

      const res = await POST(req)
      expect(res.status).toBe(200)
    }

    const recentPayloads = leagueCreateMock.mock.calls.slice(-cases.length).map((c) => c[0]?.data)
    expect(recentPayloads).toHaveLength(cases.length)
    for (const [index, payload] of recentPayloads.entries()) {
      expect(payload.isCommissioner).toBe(true)
      cases[index]!.assert(payload)
    }
  }, 60000)

  it('supports next paths: zombie+snake and salary_cap+auction', async () => {
    const { POST } = await import('@/app/api/league/create/route')

    const cases = [
      {
        sport: 'NFL',
        leagueType: 'zombie',
        draftType: 'snake',
        isDynasty: false,
        assert: (payload: any) => {
          expect(payload.isDynasty).toBe(false)
          expect(payload.leagueVariant).toBe('zombie')
          expect(payload.settings).toEqual(
            expect.objectContaining({
              league_type: 'zombie',
              format_id: 'zombie',
              draft_type: 'snake',
              requested_draft_type: 'snake',
            })
          )
        },
      },
      {
        sport: 'NFL',
        leagueType: 'salary_cap',
        draftType: 'auction',
        isDynasty: false,
        assert: (payload: any) => {
          expect(payload.isDynasty).toBe(false)
          expect(payload.leagueVariant).toBe('salary_cap')
          expect(payload.settings).toEqual(
            expect.objectContaining({
              league_type: 'salary_cap',
              format_id: 'salary_cap',
              draft_type: 'auction',
              requested_draft_type: 'auction',
            })
          )
        },
      },
    ] as const

    for (const c of cases) {
      const req = new Request('http://localhost/api/league/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${c.leagueType} ${c.draftType} path`,
          platform: 'espn',
          platformLeagueId: 'espn-import-defaults-test',
          sport: c.sport,
          leagueType: c.leagueType,
          draftType: c.draftType,
          leagueSize: 12,
          scoring: 'standard',
          isDynasty: c.isDynasty,
        }),
      })

      const res = await POST(req)
      expect(res.status).toBe(200)
    }

    const recentPayloads = leagueCreateMock.mock.calls.slice(-cases.length).map((c) => c[0]?.data)
    expect(recentPayloads).toHaveLength(cases.length)
    for (const [index, payload] of recentPayloads.entries()) {
      expect(payload.isCommissioner).toBe(true)
      cases[index]!.assert(payload)
    }
  })

  it('persists survivor wizard fields on League row and clamps cast to 16/20/24', async () => {
    const { POST } = await import('@/app/api/league/create/route')
    const req = new Request('http://localhost/api/league/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Survivor automation test',
        platform: 'espn',
        platformLeagueId: 'espn-import-defaults-test',
        sport: 'NBA',
        leagueType: 'survivor',
        draftType: 'snake',
        leagueSize: 17,
        scoring: 'standard',
        isDynasty: false,
        settings: {
          league_size: 17,
          survivor_suggested_tribe_count: 3,
          survivor_tribe_name_mode: 'custom',
        },
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const data = leagueCreateMock.mock.calls.at(-1)?.[0]?.data as Record<string, unknown>
    expect(data.leagueType).toBe('survivor')
    expect(data.leagueSize).toBe(16)
    expect(data.survivorMode).toBe(true)
    expect(data.survivorPlayerCount).toBe(16)
    expect(data.survivorTribeCount).toBe(3)
    expect(data.survivorTribeNaming).toBe('custom')
    const st = data.settings as Record<string, unknown>
    expect(st.league_size).toBe(16)
    expect(st.survivor_creation_team_count).toBe(16)
  }, 60000)
})
