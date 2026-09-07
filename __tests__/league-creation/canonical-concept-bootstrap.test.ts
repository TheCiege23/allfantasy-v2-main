/**
 * Concept bootstrap on the LIVE create path.
 *
 * 🛑 ZOMBIE AND BIG BROTHER WERE THE ONLY TWO FORMATS THE WIZARD COULD CREATE
 * WITHOUT CONFIGURING. Their bootstrap lived only in
 * `legacyWizardSpecialtyBootstraps.ts`, whose two callers are both inside
 * `app/api/league/create/route.ts` — the DEPRECATED route. The wizard posts to
 * `POST /api/leagues`, offers both formats, and validation blocks only
 * devy/c2c. Measured 2026-09-07: `zombie_league_configs` and
 * `big_brother_league_configs` hold zero rows in production.
 *
 * Nothing could have gone red. A missing config row is not an error at create
 * time — it surfaces later as a concept surface that reads null and renders
 * empty, in a league that otherwise looks fine.
 *
 * ⚠ THESE DRIVE `runLeagueBootstrap` RATHER THAN GREPPING ITS SOURCE. A
 * source-string assertion passes on code sitting inside a branch that can never
 * be reached, which is exactly the failure mode being fixed here. Only the last
 * test reads source, and only because it is a registry census — a question about
 * which concepts have an owner at all, not about what runs.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const leagueFindUnique = vi.fn()
const upsertZombieLeagueConfig = vi.fn()
const createZombieLeague = vi.fn()
const upsertBigBrotherConfig = vi.fn()
const runBigBrotherLeagueBootstrap = vi.fn()
const upsertSurvivorConfig = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: { league: { findUnique: (...a: unknown[]) => leagueFindUnique(...a) } },
}))

vi.mock('@/lib/zombie/ZombieLeagueConfig', () => ({
  upsertZombieLeagueConfig: (...a: unknown[]) => upsertZombieLeagueConfig(...a),
}))
vi.mock('@/lib/zombie/setupEngine', () => ({
  createZombieLeague: (...a: unknown[]) => createZombieLeague(...a),
}))
vi.mock('@/lib/big-brother/BigBrotherLeagueConfig', () => ({
  upsertBigBrotherConfig: (...a: unknown[]) => upsertBigBrotherConfig(...a),
}))
vi.mock('@/lib/big-brother/bigBrotherLeagueBootstrap', () => ({
  runBigBrotherLeagueBootstrap: (...a: unknown[]) => runBigBrotherLeagueBootstrap(...a),
}))
vi.mock('@/lib/survivor/SurvivorLeagueConfig', () => ({
  upsertSurvivorConfig: (...a: unknown[]) => upsertSurvivorConfig(...a),
}))
vi.mock('@/lib/survivor/SurvivorExileEngine', () => ({ getOrCreateExileLeague: vi.fn() }))
vi.mock('@/lib/survivor/survivorLeagueBootstrap', () => ({ runSurvivorLeagueBootstrap: vi.fn() }))
vi.mock('@/lib/idp', () => ({ upsertIdpLeagueConfig: vi.fn() }))

// Everything the orchestrator does before the concept blocks, stubbed to
// no-ops so this suite is about concept coverage and nothing else.
vi.mock('@/lib/roster-defaults/LeagueRosterBootstrapService', () => ({
  bootstrapLeagueRoster: vi.fn().mockResolvedValue({ templateId: 't' }),
}))
vi.mock('@/lib/sport-defaults/LeagueCreationInitializer', () => ({
  initializeLeagueWithSportDefaults: vi.fn().mockResolvedValue({ settingsApplied: true, waiverApplied: true }),
}))
vi.mock('@/lib/multi-sport/SportConfigResolver', () => ({
  resolveSportConfigForLeague: () => ({ defaultFormat: 'standard' }),
}))
vi.mock('@/lib/scoring-defaults/LeagueScoringBootstrapService', () => ({
  bootstrapLeagueScoring: vi.fn().mockResolvedValue({ templateId: 't', isDefault: true }),
}))
vi.mock('@/lib/sport-teams/LeaguePlayerPoolBootstrapService', () => ({
  bootstrapLeaguePlayerPool: vi.fn().mockResolvedValue({ playerCount: 0, teamCount: 0 }),
}))
vi.mock('@/lib/draft-defaults/LeagueDraftBootstrapService', () => ({
  bootstrapLeagueDraftConfig: vi.fn().mockResolvedValue({ draftConfigApplied: true }),
}))
vi.mock('@/lib/waiver-defaults/LeagueWaiverBootstrapService', () => ({
  bootstrapLeagueWaiverSettings: vi.fn().mockResolvedValue({ waiverSettingsApplied: true }),
}))
vi.mock('@/lib/playoff-defaults/LeaguePlayoffBootstrapService', () => ({
  bootstrapLeaguePlayoffConfig: vi.fn().mockResolvedValue({ playoffConfigApplied: true }),
}))
vi.mock('@/lib/schedule-defaults/LeagueScheduleBootstrapService', () => ({
  bootstrapLeagueScheduleConfig: vi.fn().mockResolvedValue({ scheduleConfigApplied: true }),
}))
vi.mock('@/lib/fantasy-schedule/types', () => ({ getDefaultScheduleConfig: () => ({}) }))
vi.mock('@/lib/fantasy-schedule/ScheduleConfigService', () => ({
  updateScheduleConfigForLeague: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/roster-engine', () => ({
  createDefaultLeagueRosterConfig: vi.fn().mockResolvedValue(undefined),
  // `isSupported` is called on the registry — a bare `{}` throws, which is
  // the stub failing rather than the code under test.
  getRosterEngineRegistry: () => ({ isSupported: () => true }),
}))
vi.mock('@/lib/league-creation/warmLeagueSportsData', () => ({
  warmLeagueSportsDataAfterCreate: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/league/ensureLeagueDraftSetupDefaults', () => ({
  ensureLeagueDraftSetupDefaults: vi.fn().mockResolvedValue(undefined),
}))

import { runLeagueBootstrap } from '@/lib/league-creation/LeagueBootstrapOrchestrator'

/** The orchestrator reads settings first, then the league row inside a concept block. */
function mockLeague(leagueType: string, conceptSetup: Record<string, unknown> = {}) {
  leagueFindUnique.mockImplementation(async (args: { select?: Record<string, unknown> }) => {
    if (args?.select && 'settings' in args.select) {
      return { settings: { league_type: leagueType, conceptSetup } }
    }
    return { name: 'Test League', leagueSize: 12 }
  })
}

beforeEach(() => vi.clearAllMocks())

describe('zombie', () => {
  it('writes the config and creates the ZombieLeague row', async () => {
    mockLeague('zombie')
    await runLeagueBootstrap('lg1', 'NFL')

    expect(upsertZombieLeagueConfig).toHaveBeenCalledWith('lg1', {
      whispererSelection: 'random',
      universeId: null,
    })
    expect(createZombieLeague).toHaveBeenCalledWith(
      expect.objectContaining({ leagueId: 'lg1', teamCount: 12, isSingleLeague: true }),
      null,
      null,
    )
  })

  it('carries wizard settings through when they exist', async () => {
    // None are collected by the V2 wizard today — this pins that the values
    // land the moment it learns to, rather than being silently discarded.
    mockLeague('zombie', {
      zombie_whisperer_selection: 'veteran_priority',
      zombie_universe_id: 'u1',
      zombie_level_id: 'lvl2',
    })
    await runLeagueBootstrap('lg1', 'NFL')

    expect(upsertZombieLeagueConfig).toHaveBeenCalledWith('lg1', {
      whispererSelection: 'veteran_priority',
      universeId: 'u1',
    })
    expect(createZombieLeague).toHaveBeenCalledWith(
      expect.objectContaining({ isSingleLeague: false }),
      'u1',
      'lvl2',
    )
  })

  it('a failing zombie bootstrap does not fail league creation', async () => {
    // The league row is already committed by the time this runs. Throwing here
    // would leave a created league reported as a failed create.
    mockLeague('zombie')
    createZombieLeague.mockRejectedValueOnce(new Error('universe unavailable'))
    await expect(runLeagueBootstrap('lg1', 'NFL')).resolves.toBeTruthy()
  })
})

describe('big brother', () => {
  it('writes the config and runs the week-1 bootstrap', async () => {
    mockLeague('big_brother')
    runBigBrotherLeagueBootstrap.mockResolvedValue({ weekOneCycle: { ok: true } })
    await runLeagueBootstrap('lg1', 'NFL')

    expect(upsertBigBrotherConfig).toHaveBeenCalledWith('lg1', {})
    expect(runBigBrotherLeagueBootstrap).toHaveBeenCalledWith('lg1')
  })

  it('keeps the config when only the week-1 cycle fails', async () => {
    // The config is what makes the league usable; the cycle is recoverable from
    // the commissioner panel. One must not cost the other.
    mockLeague('big_brother')
    runBigBrotherLeagueBootstrap.mockRejectedValueOnce(new Error('no cast'))
    await expect(runLeagueBootstrap('lg1', 'NFL')).resolves.toBeTruthy()
    expect(upsertBigBrotherConfig).toHaveBeenCalledWith('lg1', {})
  })
})

describe('the other concepts are untouched', () => {
  it('a redraft league bootstraps no concept config', async () => {
    mockLeague('redraft')
    await runLeagueBootstrap('lg1', 'NFL')
    expect(upsertZombieLeagueConfig).not.toHaveBeenCalled()
    expect(upsertBigBrotherConfig).not.toHaveBeenCalled()
    expect(upsertSurvivorConfig).not.toHaveBeenCalled()
  })

  it('survivor still bootstraps and zombie does not run alongside it', async () => {
    // 🛑 THE WHOLESALE-CALL MISTAKE THIS GUARDS. The obvious fix was to call
    // `runLegacyWizardSpecialtyBootstrapsAfterLeagueCreate` here — it covers
    // nine concepts, and this path already handles seven. That would re-seed
    // survivor's exile league, FAQ and draft session on every survivor create
    // and overwrite the transaction's computed configs with bare `{}` defaults.
    mockLeague('survivor')
    await runLeagueBootstrap('lg1', 'NFL')
    expect(upsertSurvivorConfig).toHaveBeenCalled()
    expect(upsertZombieLeagueConfig).not.toHaveBeenCalled()
    expect(upsertBigBrotherConfig).not.toHaveBeenCalled()
  })
})

describe('registry census', () => {
  it('every concept with a config table has an owner on the live path', async () => {
    // Source-read on purpose: this asks which concepts have a bootstrap AT ALL,
    // so a format added to the registry without one fails here rather than
    // shipping a league that cannot be configured.
    const fs = await import('fs')
    const combined =
      fs.readFileSync('lib/league-creation/LeagueBootstrapOrchestrator.ts', 'utf8') +
      fs.readFileSync('lib/league-creation/canonical/createCanonicalLeagueInTransaction.ts', 'utf8')

    const owners: Record<string, string> = {
      guillotine: 'guillotineLeagueConfig',
      devy: 'devyLeagueConfig',
      c2c: 'c2CLeagueConfig',
      dynasty: 'dynastyLeagueConfig',
      salary_cap: 'salaryCapLeagueConfig',
      idp: 'upsertIdpLeagueConfig',
      survivor: 'upsertSurvivorConfig',
      zombie: 'upsertZombieLeagueConfig',
      big_brother: 'upsertBigBrotherConfig',
    }
    const missing = Object.entries(owners)
      .filter(([, writer]) => !combined.includes(writer))
      .map(([concept]) => concept)
    expect(missing).toEqual([])
  })
})
