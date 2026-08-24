import { describe, expect, it, vi } from 'vitest'
import { createCanonicalLeagueInTransaction } from '@/lib/league-creation/canonical/createCanonicalLeagueInTransaction'

function buildTx() {
  let rosterCreateCount = 0
  let teamCreateCount = 0
  const tx = {
    userProfile: {
      findUnique: vi.fn().mockResolvedValue({ displayName: 'Creator Name', xpLevel: 9, legacyCareerLevel: null }),
    },
    appUser: {
      findUnique: vi.fn().mockResolvedValue({ username: 'creator_user', email: 'creator@test.local' }),
    },
    league: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'league-1' }),
    },
    leagueSettings: {
      create: vi.fn().mockResolvedValue({ id: 'ls-1' }),
    },
    leagueWaiverSettings: {
      create: vi.fn().mockResolvedValue({ id: 'lws-1' }),
    },
    scoringSettingsSnapshot: {
      create: vi.fn().mockResolvedValue({ id: 'score-1' }),
    },
    guillotineLeagueConfig: {
      upsert: vi.fn().mockResolvedValue({ id: 'g-1' }),
    },
    idpLeagueConfig: {
      upsert: vi.fn().mockResolvedValue({ id: 'idp-1' }),
    },
    dynastyLeagueConfig: {
      upsert: vi.fn().mockResolvedValue({ id: 'dynasty-1' }),
    },
    devyLeagueConfig: {
      upsert: vi.fn().mockResolvedValue({ id: 'devy-1' }),
    },
    c2CLeagueConfig: {
      upsert: vi.fn().mockResolvedValue({ id: 'c2c-1' }),
    },
    redraftLeagueExtendedSettings: {
      create: vi.fn().mockResolvedValue({ id: 'ext-1' }),
    },
    redraftLeagueDraftProfile: {
      create: vi.fn().mockResolvedValue({ id: 'dp-1' }),
    },
    redraftLeagueHomepageState: {
      create: vi.fn().mockResolvedValue({ id: 'home-1' }),
    },
    redraftLeagueSportIntegration: {
      create: vi.fn().mockResolvedValue({ id: 'si-1' }),
    },
    redraftLeagueChatRoom: {
      create: vi.fn().mockResolvedValue({ id: 'chat-1' }),
    },
    roster: {
      create: vi.fn().mockImplementation(async (args?: any) => {
        rosterCreateCount += 1
        return {
          id: `roster-${rosterCreateCount}`,
          platformUserId: args?.data?.platformUserId ?? `platform-${rosterCreateCount}`,
        }
      }),
    },
    leagueTeam: {
      create: vi.fn().mockImplementation(async () => {
        teamCreateCount += 1
        return { id: `team-${teamCreateCount}` }
      }),
    },
    redraftLeagueMember: {
      create: vi.fn().mockResolvedValue({ id: 'member-1' }),
    },
    leagueEntrySlot: {
      createMany: vi.fn().mockResolvedValue({ count: 12 }),
    },
    draftSession: {
      create: vi.fn().mockResolvedValue({ id: 'ds-1' }),
    },
    leagueInvite: {
      create: vi.fn().mockResolvedValue({ id: 'invite-1', token: 'JOIN12345' }),
    },
    findLeagueListing: {
      upsert: vi.fn().mockResolvedValue({ id: 'listing-1' }),
    },
  }

  return tx
}

function buildBody(overrides: Record<string, unknown> = {}) {
  return {
    concept: 'redraft',
    sport: 'NFL',
    teamCount: 12,
    draftType: 'snake',
    scoringPreset: 'fb_half_ppr',
    leagueName: 'Contract League',
    language: 'en',
    tradeReviewMode: 'commissioner',
    ...overrides,
  } as any
}

function buildEngine(overrides: Record<string, unknown> = {}) {
  const { formatResolution: formatResolutionOverrides, ...topLevelOverrides } = overrides as any
  return {
    presetKey: 'preset-contract',
    leagueFormatId: 'redraft',
    settingsSnapshot: {},
    formatResolution: {
      draftDefaults: {
        rounds_default: 15,
        timer_seconds_default: 90,
      },
      waiverDefaults: {
        waiver_type: 'faab',
        processing_days: [2],
        processing_time_utc: '12:00:00',
        max_claims_per_period: 3,
        FAAB_budget_default: 100,
        claim_priority_behavior: 'reverse_standings',
        game_lock_behavior: 'game_time',
        free_agent_unlock_behavior: 'instant',
      },
      modifiers: [],
      ...formatResolutionOverrides,
    },
    ...topLevelOverrides,
  } as any
}

describe('createCanonicalLeagueInTransaction contract', () => {
  it('writes canonical records and defaults for create->finder/join/draft-intro flow', async () => {
    const tx = buildTx()

    const body = buildBody()
    const engine = buildEngine()

    const result = await createCanonicalLeagueInTransaction(tx as any, 'app-user-1', body, engine)

    expect(result.leagueId).toBe('league-1')
    expect(result.inviteUrl).toBe('/join/JOIN12345')

    const homepage = new URL(result.homepageUrl, 'http://localhost')
    expect(homepage.pathname).toBe('/league/league-1')
    expect(homepage.searchParams.get('created')).toBe('1')
    expect(homepage.searchParams.get('showInvite')).toBe('1')
    expect(homepage.searchParams.get('openChat')).toBe('league')
    expect(homepage.searchParams.get('playIntro')).toBe('1')

    expect(tx.league.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'app-user-1',
          isCommissioner: true,
          name: 'Contract League',
          timezone: 'America/New_York',
          language: 'en',
          leagueType: 'redraft',
          leagueSize: 12,
          scoring: 'PPR',
          playoffTeams: 6,
        }),
      }),
    )
    const leagueCreateArg = tx.league.create.mock.calls[0]?.[0]
    /**
     * Regression guard, deliberately asserted on the captured call arg rather than folded into
     * the `objectContaining` block above: `rosterSize` used to read `rosterSettings['roster_size']`
     * / `rosterSettings['rosterSize']`, two keys no producer under lib/league-defaults or
     * lib/league-concepts has ever written. Every call missed both, the 0 fallback collapsed
     * through `|| null`, and every manual league was created with NULL rosterSize. Verified on
     * prod 2026-08-24: 33 of 34 NULL-rosterSize leagues have leagueSize set, i.e. configured
     * leagues silently missing this one field.
     *
     * A number is not the same claim as a non-zero one — the old `0 || null` collapse means a
     * silent-failure 0 and a real answer would look identical to `expect.any(Number)` alone.
     */
    expect(typeof leagueCreateArg.data.rosterSize).toBe('number')
    expect(leagueCreateArg.data.rosterSize).toBeGreaterThan(0)
    expect(leagueCreateArg.data.settings).toEqual(
      expect.objectContaining({
        foundation_defaults: expect.objectContaining({
          scoring: expect.objectContaining({ scoringTemplateId: 'fb_half_ppr' }),
          draft: expect.objectContaining({ draftType: 'snake' }),
          conceptPreset: expect.objectContaining({ aiEnabledFeatures: expect.any(Array) }),
        }),
      }),
    )

    expect(tx.leagueSettings.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          leagueId: 'league-1',
          draftType: 'snake',
          rounds: 15,
        }),
      }),
    )

    expect(tx.scoringSettingsSnapshot.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          leagueId: 'league-1',
          formatKey: 'redraft',
          scoringFormat: 'PPR',
          templateId: 'fb_half_ppr',
        }),
      }),
    )

    expect(tx.roster.create).toHaveBeenCalledTimes(12)
    expect(tx.leagueTeam.create).toHaveBeenCalledTimes(12)
    expect(tx.leagueTeam.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          leagueId: 'league-1',
          claimedByUserId: 'app-user-1',
          isCommissioner: true,
        }),
      }),
    )
    expect(tx.leagueTeam.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          ownerName: 'Open Team 2',
          teamName: 'Open Team 2',
          isOrphan: true,
        }),
      }),
    )

    expect(tx.redraftLeagueMember.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          leagueId: 'league-1',
          userId: 'app-user-1',
          role: 'COMMISSIONER',
        }),
      }),
    )

    expect(tx.draftSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          leagueId: 'league-1',
          status: 'pre_draft',
          teamCount: 12,
          slotOrder: expect.arrayContaining([
            expect.objectContaining({ slot: 1, rosterId: 'roster-1', open: false }),
            expect.objectContaining({ slot: 2, rosterId: 'roster-2', displayName: 'Open Team 2', open: true }),
          ]),
        }),
      }),
    )

    expect(tx.leagueInvite.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          leagueId: 'league-1',
          createdByRole: 'COMMISSIONER',
          bypassRankGate: false,
        }),
      }),
    )

    expect(tx.redraftLeagueExtendedSettings.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          leagueId: 'league-1',
          allowMemberInviteRankBypass: false,
        }),
      }),
    )

    expect(tx.leagueEntrySlot.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ leagueId: 'league-1', slotNumber: 1, status: 'FILLED', rosterId: 'roster-1' }),
          expect.objectContaining({ leagueId: 'league-1', slotNumber: 12, status: 'OPEN', rosterId: 'roster-12' }),
        ]),
      }),
    )

    expect(tx.findLeagueListing.upsert).toHaveBeenCalledTimes(1)
    const listingArg = tx.findLeagueListing.upsert.mock.calls[0]?.[0]
    expect(listingArg.create.creatorRankLevel).toBe(9)
    expect(listingArg.create.minRankLevel).toBe(6)
    expect(listingArg.create.maxRankLevel).toBe(12)

    const listingBody = JSON.parse(String(listingArg.create.body)) as {
      creatorRankLevel: number
      minRankLevel: number
      maxRankLevel: number
      timezone: string
    }

    expect(listingBody.creatorRankLevel).toBe(9)
    expect(listingBody.minRankLevel).toBe(6)
    expect(listingBody.maxRankLevel).toBe(12)
    expect(listingBody.timezone).toBe('America/New_York')
  })

  it.each([
    ['NFL redraft snake', buildBody(), buildEngine(), null],
    ['NFL dynasty', buildBody({ concept: 'dynasty' }), buildEngine({ leagueFormatId: 'dynasty' }), 'dynasty'],
    [
      'NFL IDP',
      buildBody({ concept: 'idp', scoringPreset: 'fb_idp_ppr' }),
      buildEngine({
        leagueFormatId: 'redraft',
        formatResolution: { modifiers: ['idp'] },
      }),
      'idp',
    ],
    [
      'NCAAF devy',
      buildBody({ concept: 'devy', sport: 'NCAAF', scoringPreset: 'ncaaf_devy_ppr' }),
      buildEngine({ leagueFormatId: 'devy', formatResolution: { modifiers: ['devy', 'taxi'] } }),
      'devy',
    ],
    [
      'NCAAF C2C',
      buildBody({ concept: 'c2c', sport: 'NCAAF', scoringPreset: 'ncaaf_c2c_ppr' }),
      buildEngine({ leagueFormatId: 'c2c', formatResolution: { modifiers: ['c2c', 'taxi'] } }),
      'c2c',
    ],
  ])('creates the required foundation for %s', async (_label, body, engine, specialty) => {
    const tx = buildTx()

    await createCanonicalLeagueInTransaction(tx as any, 'app-user-1', body as any, engine as any)

    expect(tx.scoringSettingsSnapshot.create).toHaveBeenCalledTimes(1)
    expect(tx.redraftLeagueChatRoom.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ leagueId: 'league-1', roomType: 'league' }),
      }),
    )
    expect(tx.roster.create).toHaveBeenCalledTimes(12)
    expect(tx.leagueEntrySlot.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ slotNumber: 1, status: 'FILLED' }),
          expect.objectContaining({ slotNumber: 2, status: 'OPEN' }),
        ]),
      }),
    )

    if (specialty === 'dynasty' || specialty === 'devy' || specialty === 'c2c') {
      expect(tx.dynastyLeagueConfig.upsert).toHaveBeenCalledTimes(1)
    }
    if (specialty === 'idp') {
      expect(tx.idpLeagueConfig.upsert).toHaveBeenCalledTimes(1)
    }
    if (specialty === 'devy') {
      expect(tx.devyLeagueConfig.upsert).toHaveBeenCalledTimes(1)
      const draftArg = tx.draftSession.create.mock.calls[0]?.[0]
      expect(draftArg.data.devyConfig).toEqual(expect.objectContaining({ enabled: true }))
    }
    if (specialty === 'c2c') {
      expect(tx.c2CLeagueConfig.upsert).toHaveBeenCalledTimes(1)
      const draftArg = tx.draftSession.create.mock.calls[0]?.[0]
      expect(draftArg.data.c2cConfig).toEqual(expect.objectContaining({ enabled: true }))
    }
  })
})
