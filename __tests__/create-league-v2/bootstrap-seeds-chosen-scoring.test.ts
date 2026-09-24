/**
 * The post-create bootstrap must seed the scoring the manager chose.
 *
 * 🛑 It seeded `af_default` (0.5 PPR) for every NFL league, and that store is what the live scorer
 * reads, so a league created as Full PPR or Standard scored half-PPR. College football was worse
 * the other way: nothing wrote `sportConfig.scoringPreset`, the scorer defaults that to full PPR,
 * and no NCAAF store is read — so every NCAAF league scored full PPR, the half-PPR default too.
 *
 * This drives the REAL bootstrap and the REAL NFL scoring store against an in-memory league row,
 * then scores two receptions with the REAL scorer — so it would fail if the bootstrap stopped
 * passing the preset, the store stopped honouring it, or the scorer stopped reading it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const row = vi.hoisted(() => ({
  current: { sport: 'NFL', scoringPresetId: 'fb_ppr', settings: {} as Record<string, unknown> },
}))

vi.mock('@/lib/prisma', () => {
  const league = {
    findUnique: vi.fn(async () => ({ ...row.current })),
    findFirst: vi.fn(async () => ({ ...row.current })),
    update: vi.fn(async ({ data }: { data: { settings?: Record<string, unknown> } }) => {
      if (data.settings) row.current.settings = data.settings
      return { ...row.current }
    }),
  }
  return { prisma: { league } }
})

vi.mock('@/lib/roster-defaults/LeagueRosterBootstrapService', () => ({
  bootstrapLeagueRoster: vi.fn(async () => ({ templateId: 't' })),
}))
vi.mock('@/lib/sport-defaults/LeagueCreationInitializer', () => ({
  initializeLeagueWithSportDefaults: vi.fn(async () => ({ settingsApplied: true, waiverApplied: true })),
}))
vi.mock('@/lib/multi-sport/SportConfigResolver', () => ({
  resolveSportConfigForLeague: vi.fn(() => ({ defaultFormat: 'standard' })),
}))
vi.mock('@/lib/scoring-defaults/LeagueScoringBootstrapService', () => ({
  bootstrapLeagueScoring: vi.fn(async () => ({ templateId: 's', isDefault: true })),
}))
vi.mock('@/lib/sport-teams/LeaguePlayerPoolBootstrapService', () => ({
  bootstrapLeaguePlayerPool: vi.fn(async () => ({ playerCount: 0, teamCount: 0 })),
}))
vi.mock('@/lib/draft-defaults/LeagueDraftBootstrapService', () => ({
  bootstrapLeagueDraftConfig: vi.fn(async () => ({ draftConfigApplied: true })),
}))
vi.mock('@/lib/waiver-defaults/LeagueWaiverBootstrapService', () => ({
  bootstrapLeagueWaiverSettings: vi.fn(async () => ({ waiverSettingsApplied: true })),
}))
vi.mock('@/lib/playoff-defaults/LeaguePlayoffBootstrapService', () => ({
  bootstrapLeaguePlayoffConfig: vi.fn(async () => ({ playoffConfigApplied: true })),
}))
vi.mock('@/lib/schedule-defaults/LeagueScheduleBootstrapService', () => ({
  bootstrapLeagueScheduleConfig: vi.fn(async () => ({ scheduleConfigApplied: true })),
}))
vi.mock('@/lib/fantasy-schedule/ScheduleConfigService', () => ({
  updateScheduleConfigForLeague: vi.fn(async () => undefined),
}))
vi.mock('@/lib/roster-engine', () => ({
  createDefaultLeagueRosterConfig: vi.fn(async () => undefined),
  getRosterEngineRegistry: () => ({ isSupported: () => false }),
}))
vi.mock('@/lib/league-creation/warmLeagueSportsData', () => ({
  warmLeagueSportsDataAfterCreate: vi.fn(async () => undefined),
}))

import { runLeagueBootstrap } from '@/lib/league-creation/LeagueBootstrapOrchestrator'
import { calculateScoreFromSportConfig } from '@/lib/redraft/scoringEngine'

async function createAndScoreTwoReceptions(sport: 'NFL' | 'NCAAF', scoringPresetId: string) {
  row.current = { sport, scoringPresetId, settings: {} }
  await runLeagueBootstrap('league-1', sport as never)
  return calculateScoreFromSportConfig('league-1', 'wr-1', 1, { rec: 2 }, 'WR')
}

describe('bootstrap seeds the scoring the manager chose', () => {
  beforeEach(() => vi.clearAllMocks())

  it('NFL Full PPR scores a reception at 1', async () => {
    expect(await createAndScoreTwoReceptions('NFL', 'fb_ppr')).toBe(2)
    const store = row.current.settings.nfl_scoring_config as { presetKey: string }
    expect(store.presetKey).toBe('af_ppr')
  })

  it('NFL Standard scores a reception at 0', async () => {
    expect(await createAndScoreTwoReceptions('NFL', 'fb_standard')).toBe(0)
  })

  it('NFL Half PPR still scores 0.5', async () => {
    expect(await createAndScoreTwoReceptions('NFL', 'fb_half_ppr')).toBe(1)
  })

  it('NCAAF half PPR scores 0.5, not the full-PPR scorer default', async () => {
    expect(await createAndScoreTwoReceptions('NCAAF', 'ncaaf_half_ppr')).toBe(1)
    expect((row.current.settings.sportConfig as { scoringPreset: string }).scoringPreset).toBe('HALF_PPR')
  })

  it('NCAAF standard scores 0', async () => {
    expect(await createAndScoreTwoReceptions('NCAAF', 'ncaaf_standard')).toBe(0)
  })
})
