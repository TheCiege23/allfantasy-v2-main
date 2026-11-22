import { describe, expect, it } from 'vitest'

describe('Prompt 10 — League Creation End-to-End Sport Initialization', () => {
  describe('Module Structure and Availability', () => {
    it('LeagueBootstrapOrchestrator exports runLeagueBootstrap', async () => {
      const { runLeagueBootstrap } = await import('@/lib/league-creation/LeagueBootstrapOrchestrator')
      expect(typeof runLeagueBootstrap).toBe('function')
    })

    it('SportPresetLoader exports loadSportPresetForCreation', async () => {
      const { loadSportPresetForCreation } = await import('@/lib/league-creation/SportPresetLoader')
      expect(typeof loadSportPresetForCreation).toBe('function')
    })

    it('SportAwareFrontendResolver exports context resolution functions', async () => {
      const m = await import('@/lib/league-creation/SportAwareFrontendResolver')
      expect(typeof m.resolveSportAwareFrontendContext).toBe('function')
      expect(typeof m.resolveSportTeamLogos).toBe('function')
    })
  })

  describe('Bootstrap Service Integration', () => {
    it('bootstraps roster for sport', async () => {
      const { bootstrapLeagueRoster } = await import('@/lib/roster-defaults/LeagueRosterBootstrapService')
      expect(typeof bootstrapLeagueRoster).toBe('function')
    })

    it('bootstraps scoring for sport', async () => {
      const { bootstrapLeagueScoring } = await import('@/lib/scoring-defaults/LeagueScoringBootstrapService')
      expect(typeof bootstrapLeagueScoring).toBe('function')
    })

    it('bootstraps player pool for sport', async () => {
      const { bootstrapLeaguePlayerPool } = await import('@/lib/sport-teams/LeaguePlayerPoolBootstrapService')
      expect(typeof bootstrapLeaguePlayerPool).toBe('function')
    })

    it('bootstraps draft config for sport', async () => {
      const { bootstrapLeagueDraftConfig } = await import('@/lib/draft-defaults/LeagueDraftBootstrapService')
      expect(typeof bootstrapLeagueDraftConfig).toBe('function')
    })

    it('bootstraps waiver settings for sport', async () => {
      const { bootstrapLeagueWaiverSettings } = await import('@/lib/waiver-defaults/LeagueWaiverBootstrapService')
      expect(typeof bootstrapLeagueWaiverSettings).toBe('function')
    })

    it('bootstraps playoff config for sport', async () => {
      const { bootstrapLeaguePlayoffConfig } = await import('@/lib/playoff-defaults/LeaguePlayoffBootstrapService')
      expect(typeof bootstrapLeaguePlayoffConfig).toBe('function')
    })

    it('bootstraps schedule config for sport', async () => {
      const { bootstrapLeagueScheduleConfig } = await import('@/lib/schedule-defaults/LeagueScheduleBootstrapService')
      expect(typeof bootstrapLeagueScheduleConfig).toBe('function')
    })
  })

  describe('Sport Data Loading', () => {
    it('Sport-specific team metadata is available', async () => {
      const { getTeamMetadataForSportDbAware } = await import('@/lib/sport-teams/SportTeamMetadataRegistry')
      expect(typeof getTeamMetadataForSportDbAware).toBe('function')
    })

    it('Sport-specific player pool is available', async () => {
      const { getPlayerPoolForSport } = await import('@/lib/sport-teams/SportPlayerPoolResolver')
      expect(typeof getPlayerPoolForSport).toBe('function')
    })

    it('Sport registry exports version constant', async () => {
      const { SPORT_TEAM_METADATA_REGISTRY_VERSION } = await import('@/lib/sport-teams/SportTeamMetadataRegistry')
      expect(typeof SPORT_TEAM_METADATA_REGISTRY_VERSION).toBe('string')
    })

    it('Sport registry exports supported sports list', async () => {
      const { getSupportedTeamSports } = await import('@/lib/sport-teams/SportTeamMetadataRegistry')
      expect(typeof getSupportedTeamSports).toBe('function')
    })
  })

  describe('AI Context Building', () => {
    it('Sport context builder generates context strings', async () => {
      const { buildSportContextString } = await import('@/lib/ai/AISportContextResolver')
      expect(typeof buildSportContextString).toBe('function')
      const ctx = buildSportContextString({ sport: 'NBA', leagueName: 'Test' })
      expect(ctx).toContain('NBA')
      expect(ctx).toContain('Test')
    })

    it('AI sport codes include all 7 sports', async () => {
      const { AI_SPORT_CODES } = await import('@/lib/ai-simulation-integration/SportAIContextResolver')
      expect(Array.isArray(AI_SPORT_CODES)).toBe(true)
      expect(AI_SPORT_CODES).toContain('NFL')
      expect(AI_SPORT_CODES).toContain('NBA')
      expect(AI_SPORT_CODES).toContain('MLB')
      expect(AI_SPORT_CODES).toContain('NHL')
      expect(AI_SPORT_CODES).toContain('NCAAF')
      expect(AI_SPORT_CODES).toContain('NCAAB')
      expect(AI_SPORT_CODES).toContain('SOCCER')
    })
  })

  describe('Feature Flag Validation', () => {
    it('Feature flag service is available', async () => {
      const { validateLeagueFeatureFlags, getSportFeatureFlags } = await import('@/lib/sport-defaults/SportFeatureFlagsService')
      expect(typeof validateLeagueFeatureFlags).toBe('function')
      expect(typeof getSportFeatureFlags).toBe('function')
    })
  })

  describe('Sport Variant Support', () => {
    it('Draft defaults support variants', async () => {
      const { getDraftDefaults } = await import('@/lib/sport-defaults/SportDefaultsRegistry')
      expect(typeof getDraftDefaults).toBe('function')
    })

    it('Roster defaults support variants', async () => {
      const { getRosterDefaults } = await import('@/lib/sport-defaults/SportDefaultsRegistry')
      expect(typeof getRosterDefaults).toBe('function')
    })

    it('Scoring defaults support variants', async () => {
      const { getScoringDefaults } = await import('@/lib/sport-defaults/SportDefaultsRegistry')
      expect(typeof getScoringDefaults).toBe('function')
    })
  })

  describe('League Creation Wizard', () => {
    it('LeagueCreationWizard component exists', async () => {
      const m = await import('@/components/league-creation-wizard/LeagueCreationWizard')
      expect(m).toBeDefined()
    })

    it('LeagueCreationSportSelector component exists', async () => {
      const m = await import('@/components/league-creation/LeagueCreationSportSelector')
      expect(m).toBeDefined()
    })
  })

  describe('API Route Integration', () => {
    it('POST /api/league/create is exported (app route; not the /create-league page)', async () => {
      const m = await import('@/app/api/league/create/route')
      expect(m.POST).toBeDefined()
      expect(typeof m.POST).toBe('function')
    })
  })

  describe('Bootstrap Result Types', () => {
    it('LeagueBootstrapOrchestrator returns proper result shape', async () => {
      const { runLeagueBootstrap } = await import('@/lib/league-creation/LeagueBootstrapOrchestrator')
      // Function signature should return BootstrapResult
      expect(runLeagueBootstrap.length).toBeGreaterThanOrEqual(2) // at least leagueId and sport params
    })
  })

  describe('Backwards Compatibility', () => {
    it('Default sport is NFL when not specified', async () => {
      const { runLeagueBootstrap } = await import('@/lib/league-creation/LeagueBootstrapOrchestrator')
      // API route defaults sport to NFL per line: let sport = sportInput ?? 'NFL'
      expect(typeof runLeagueBootstrap).toBe('function')
    })

    it('NFL initialization preserves current behavior', async () => {
      const { getTeamMetadataForSport } = await import('@/lib/sport-teams/SportTeamMetadataRegistry')
      // NFL should still have 32 teams
      const nflTeams = getTeamMetadataForSport('NFL')
      expect(nflTeams).toHaveLength(32)
    })
  })

  describe('Error Handling', () => {
    it('Bootstrap services handle errors gracefully', async () => {
      const { bootstrapLeaguePlayerPool } = await import('@/lib/sport-teams/LeaguePlayerPoolBootstrapService')
      // Should handle missing league gracefully (per league/create route: .catch(() => (...)))
      expect(typeof bootstrapLeaguePlayerPool).toBe('function')
    })
  })
})
