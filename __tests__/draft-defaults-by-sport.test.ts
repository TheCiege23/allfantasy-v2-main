import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getDraftDefaults, getRosterDefaults } from '@/lib/sport-defaults/SportDefaultsRegistry'
import {
  getDraftPreset,
  getDraftPresetDefinitions,
  getSupportedDraftVariantsForSport,
} from '@/lib/draft-defaults/DraftDefaultsRegistry'
import { resolveDraftPreset } from '@/lib/draft-defaults/DraftPresetResolver'
import { getDraftOrderBehavior } from '@/lib/draft-defaults/DraftOrderRuleResolver'
import { getDraftRankingContext } from '@/lib/draft-defaults/DraftRankingContextResolver'

const { leagueFindUniqueMock, leagueUpdateMock } = vi.hoisted(() => ({
  leagueFindUniqueMock: vi.fn(),
  leagueUpdateMock: vi.fn(),
}))

/** Starter + bench slots in the sport's default roster — what a default draft must fill. */
function rosterSlots(sport: 'NFL' | 'NCAAF'): number {
  const roster = getRosterDefaults(sport)
  const starters = Object.values(roster.starter_slots ?? {}).reduce((a, b) => a + Number(b), 0)
  return starters + Number(roster.bench_slots ?? 0)
}

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findUnique: leagueFindUniqueMock,
      update: leagueUpdateMock,
    },
  },
}))

describe('Prompt 17 draft defaults by sport and variant', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('defines draft defaults for all supported sports with required fields', () => {
    const sports = ['NFL', 'NBA', 'MLB', 'NHL', 'NCAAF', 'NCAAB', 'SOCCER'] as const
    for (const sport of sports) {
      const draft = getDraftDefaults(sport, 'STANDARD')
      expect(draft.sport_type).toBe(sport)
      expect(['snake', 'linear', 'auction']).toContain(draft.draft_type)
      expect(draft.rounds_default).toBeGreaterThan(0)
      expect(draft.timer_seconds_default === null || draft.timer_seconds_default > 0).toBe(true)
      expect(typeof draft.pick_order_rules).toBe('string')
      expect(typeof draft.autopick_behavior).toBe('string')
      expect(typeof draft.pre_draft_ranking_source).toBe('string')
      expect(typeof draft.roster_fill_order).toBe('string')
      expect(typeof draft.position_filter_behavior).toBe('string')
    }
  })

  it('applies variant-aware NFL draft presets for standard/PPR/superflex/IDP', () => {
    const standard = getDraftDefaults('NFL', 'STANDARD')
    const ppr = getDraftDefaults('NFL', 'PPR')
    const superflex = getDraftDefaults('NFL', 'SUPERFLEX')
    const idp = getDraftDefaults('NFL', 'IDP')
    const dynastyIdp = getDraftDefaults('NFL', 'DYNASTY_IDP')

    // Base rounds fill the default roster (starters + bench) — 12 for NFL today. The old
    // hard-coded 15 predates the roster defaults this is now derived alongside.
    expect(standard.rounds_default).toBeGreaterThanOrEqual(rosterSlots('NFL'))
    expect(ppr.pre_draft_ranking_source).toBe('ecr')

    expect(superflex.rounds_default).toBeGreaterThanOrEqual(standard.rounds_default)
    expect(superflex.position_filter_behavior).toBe('by_need')

    expect(idp.rounds_default).toBeGreaterThan(standard.rounds_default)
    expect(idp.pre_draft_ranking_source).toBe('tiers')
    expect(idp.position_filter_behavior).toBe('by_need')
    expect(dynastyIdp.rounds_default).toBe(idp.rounds_default)
  })

  it('applies sport-specific expectations for MLB, NHL, NCAA, and Soccer', () => {
    const mlb = getDraftDefaults('MLB', 'STANDARD')
    const nhl = getDraftDefaults('NHL', 'STANDARD')
    const ncaaf = getDraftDefaults('NCAAF', 'STANDARD')
    const ncaab = getDraftDefaults('NCAAB', 'STANDARD')
    const soccer = getDraftDefaults('SOCCER', 'STANDARD')

    expect(mlb.rounds_default).toBeGreaterThanOrEqual(20)
    expect(mlb.roster_fill_order).toBe('position_scarcity')

    expect(nhl.position_filter_behavior).toBe('by_eligibility')

    expect(ncaaf.rounds_default).toBeGreaterThanOrEqual(rosterSlots('NCAAF'))
    expect(ncaab.rounds_default).toBeGreaterThanOrEqual(12)

    expect(soccer.pre_draft_ranking_source).toBe('sport_default')
    expect(soccer.position_filter_behavior).toBe('by_eligibility')
  })

  it('exposes draft preset definitions and supported variants by sport', () => {
    const nflVariants = getSupportedDraftVariantsForSport('NFL')
    expect(nflVariants).toEqual(
      expect.arrayContaining(['STANDARD', 'PPR', 'HALF_PPR', 'SUPERFLEX', 'IDP', 'DYNASTY_IDP'])
    )

    const defs = getDraftPresetDefinitions('NFL')
    expect(defs.length).toBeGreaterThanOrEqual(6)
    expect(defs.map((d) => d.variant)).toEqual(expect.arrayContaining(['IDP', 'DYNASTY_IDP']))

    const soccerPreset = getDraftPreset('SOCCER', 'STANDARD')
    expect(soccerPreset.sport_type).toBe('SOCCER')
  })

  it('resolves draft preset capabilities and ranking context by sport/variant', () => {
    const idpPreset = resolveDraftPreset('NFL', 'IDP')
    expect(idpPreset.supportsIdpPlayers).toBe(true)
    expect(idpPreset.defaultOrderMode).toBe('snake')

    const soccerPreset = resolveDraftPreset('SOCCER', 'STANDARD')
    expect(soccerPreset.supportsIdpPlayers).toBe(false)

    const ranking = getDraftRankingContext('NFL', 'IDP')
    expect(ranking.pre_draft_ranking_source).toBe('tiers')
    expect(ranking.contextLabel).toContain('NFL IDP')
  })

  it('resolves draft order behavior including third-round reversal', () => {
    const snake3rr = getDraftOrderBehavior('snake', true)
    expect(snake3rr.rule).toBe('snake')
    expect(snake3rr.thirdRoundReversal).toBe(true)
    expect(snake3rr.label).toContain('3RR')

    const linear = getDraftOrderBehavior('linear', true)
    expect(linear.rule).toBe('linear')
    expect(linear.thirdRoundReversal).toBe(false)
  })

  it('fills only missing draft keys during league draft bootstrap', async () => {
    leagueFindUniqueMock.mockResolvedValueOnce({
      id: 'league-1',
      sport: 'SOCCER',
      leagueVariant: 'STANDARD',
      settings: {
        draft_type: 'linear',
        draft_rounds: 18,
      },
    })
    leagueUpdateMock.mockResolvedValueOnce({ id: 'league-1' })

    const { bootstrapLeagueDraftConfig } = await import('@/lib/draft-defaults/LeagueDraftBootstrapService')
    const result = await bootstrapLeagueDraftConfig('league-1')

    expect(result.draftConfigApplied).toBe(true)
    expect(leagueUpdateMock).toHaveBeenCalledTimes(1)
    const nextSettings = leagueUpdateMock.mock.calls[0]?.[0]?.data?.settings
    expect(nextSettings.draft_type).toBe('linear')
    expect(nextSettings.draft_rounds).toBe(18)
    expect(nextSettings.draft_timer_seconds).toBe(90)
    expect(nextSettings.draft_autopick_behavior).toBe('queue-first')
    expect(nextSettings.draft_position_filter_behavior).toBe('by_eligibility')
  })

  it('keeps bootstrap idempotent when all draft keys already exist', async () => {
    leagueFindUniqueMock.mockResolvedValueOnce({
      id: 'league-2',
      sport: 'NFL',
      leagueVariant: 'IDP',
      settings: {
        draft_type: 'snake',
        draft_rounds: 20,
        draft_timer_seconds: 75,
        draft_pick_order_rules: 'snake',
        draft_snake_or_linear: 'snake',
        draft_third_round_reversal: false,
        draft_autopick_behavior: 'queue-first',
        draft_queue_size_limit: 65,
        draft_pre_draft_ranking_source: 'custom',
        draft_roster_fill_order: 'need_based',
        draft_position_filter_behavior: 'by_need',
      },
    })

    const { bootstrapLeagueDraftConfig } = await import('@/lib/draft-defaults/LeagueDraftBootstrapService')
    const result = await bootstrapLeagueDraftConfig('league-2')

    expect(result.draftConfigApplied).toBe(false)
    expect(leagueUpdateMock).not.toHaveBeenCalled()
  })

  it('uses per-key fallback in draft room config resolver for partially configured settings', async () => {
    leagueFindUniqueMock.mockResolvedValueOnce({
      sport: 'NFL',
      leagueVariant: 'SUPERFLEX',
      settings: {
        draft_rounds: 21,
      },
    })

    const { getDraftConfigForLeague } = await import('@/lib/draft-defaults/DraftRoomConfigResolver')
    const config = await getDraftConfigForLeague('league-3')

    expect(config).not.toBeNull()
    expect(config?.sport).toBe('NFL')
    expect(config?.variant).toBe('SUPERFLEX')
    expect(config?.rounds).toBe(21)
    expect(config?.draft_type).toBe('snake')
    expect(config?.position_filter_behavior).toBe('by_need')
  })

  it('normalizes devy and c2c draft variants to runtime draft types', async () => {
    leagueFindUniqueMock
      .mockResolvedValueOnce({
        sport: 'NFL',
        leagueVariant: 'STANDARD',
        settings: {
          draft_type: 'devy_snake',
          requested_draft_type: 'devy_snake',
        },
      })
      .mockResolvedValueOnce({
        sport: 'NBA',
        leagueVariant: 'STANDARD',
        settings: {
          draft_type: 'c2c_auction',
          requested_draft_type: 'c2c_auction',
        },
      })

    const { getDraftConfigForLeague } = await import('@/lib/draft-defaults/DraftRoomConfigResolver')

    const devyConfig = await getDraftConfigForLeague('league-devy')
    const c2cConfig = await getDraftConfigForLeague('league-c2c')

    expect(devyConfig?.draft_type).toBe('snake')
    expect(c2cConfig?.draft_type).toBe('auction')
  })

  it('normalizes devy and c2c linear drafts to linear, not the sport default', async () => {
    for (const draftType of ['devy_linear', 'c2c_linear']) {
      leagueFindUniqueMock.mockResolvedValueOnce({
        sport: 'NFL',
        leagueVariant: 'STANDARD',
        settings: { draft_type: draftType, requested_draft_type: draftType },
      })
      const { getDraftConfigForLeague } = await import('@/lib/draft-defaults/DraftRoomConfigResolver')
      const config = await getDraftConfigForLeague(`league-${draftType}`)
      expect(config?.draft_type, draftType).toBe('linear')
    }
  })
})
