/**
 * Runs all sport-specific bootstrap steps after league creation so the league
 * has correct roster, scoring, waiver, settings, and context for its sport.
 */
import type { LeagueSport } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { bootstrapLeagueRoster } from '@/lib/roster-defaults/LeagueRosterBootstrapService'
import { initializeLeagueWithSportDefaults } from '@/lib/sport-defaults/LeagueCreationInitializer'
import { resolveSportConfigForLeague } from '@/lib/multi-sport/SportConfigResolver'
import { bootstrapLeagueScoring } from '@/lib/scoring-defaults/LeagueScoringBootstrapService'
import { bootstrapLeaguePlayerPool } from '@/lib/sport-teams/LeaguePlayerPoolBootstrapService'
import { bootstrapLeagueDraftConfig } from '@/lib/draft-defaults/LeagueDraftBootstrapService'
import { bootstrapLeagueWaiverSettings } from '@/lib/waiver-defaults/LeagueWaiverBootstrapService'
import { bootstrapLeaguePlayoffConfig } from '@/lib/playoff-defaults/LeaguePlayoffBootstrapService'
import { bootstrapLeagueScheduleConfig } from '@/lib/schedule-defaults/LeagueScheduleBootstrapService'
import { getDefaultScheduleConfig, type ScheduleSport } from '@/lib/fantasy-schedule/types'
import { updateScheduleConfigForLeague } from '@/lib/fantasy-schedule/ScheduleConfigService'
import { createDefaultLeagueRosterConfig, getRosterEngineRegistry, type SupportedRosterSport } from '@/lib/roster-engine'
import { warmLeagueSportsDataAfterCreate } from '@/lib/league-creation/warmLeagueSportsData'

export interface BootstrapResult {
  roster: { templateId: string }
  settings: { settingsApplied: boolean; waiverApplied: boolean }
  scoring: { templateId: string; isDefault: boolean }
  playerPool: { playerCount: number; teamCount: number }
  draft: { draftConfigApplied: boolean }
  waiver: { waiverSettingsApplied: boolean }
  playoff: { playoffConfigApplied: boolean }
  schedule: { scheduleConfigApplied: boolean }
}

/**
 * Run full sport-specific bootstrap after league create.
 * Call once after League is created; idempotent where applicable.
 * When League.settings has roster_format_type or scoring_format_type (e.g. dynasty), those are used for roster/scoring.
 */
export async function runLeagueBootstrap(
  leagueId: string,
  leagueSport: LeagueSport,
  scoringFormat?: string
): Promise<BootstrapResult> {
  const config = resolveSportConfigForLeague(leagueSport)
  const settings = await prisma.league
    .findUnique({ where: { id: leagueId }, select: { settings: true } })
    .then((l) => (l?.settings as Record<string, unknown>) ?? {})
  const rosterFormat =
    (settings.roster_format_type as string) ?? (settings.roster_format as string) ?? scoringFormat ?? config.defaultFormat
  const scoringFormatResolved =
    (settings.scoring_format_type as string) ?? (settings.scoring_format as string) ?? scoringFormat ?? config.defaultFormat
  const isIdp =
    leagueSport === 'NFL' &&
    (rosterFormat === 'IDP' || rosterFormat === 'idp' || scoringFormatResolved === 'IDP' || scoringFormatResolved === 'idp')

  const rosterResult = await bootstrapLeagueRoster(leagueId, leagueSport, rosterFormat).then((r) => ({
    templateId: r.templateId,
  }))

  // Apply/merge full sport defaults first so downstream boosters only backfill true gaps.
  const settingsResult = await initializeLeagueWithSportDefaults({
    leagueId,
    sport: leagueSport,
    mergeIfExisting: true,
  })

  const scoringResult = await bootstrapLeagueScoring(leagueId, leagueSport, scoringFormatResolved).then(
    (r) => ({
      templateId: r.templateId,
      isDefault: r.isDefault,
    })
  )

  const poolResult = await bootstrapLeaguePlayerPool(leagueId, leagueSport).catch(
    () =>
      ({
        playerCount: 0,
        teamCount: 0,
      }) as { playerCount: number; teamCount: number }
  )

  // Keep settings writes sequential to avoid read-modify-write races.
  const draftResult = await bootstrapLeagueDraftConfig(leagueId).catch(() => ({
    leagueId,
    draftConfigApplied: false,
    sport: String(leagueSport),
    variant: null,
  }))
  const playoffResult = await bootstrapLeaguePlayoffConfig(leagueId).catch(() => ({
    leagueId,
    playoffConfigApplied: false,
    sport: String(leagueSport),
    variant: null,
  }))
  const scheduleResult = await bootstrapLeagueScheduleConfig(leagueId).catch(() => ({
    leagueId,
    scheduleConfigApplied: false,
    sport: String(leagueSport),
    variant: null,
  }))

  // Apply fantasy-schedule defaults (volume thresholds, dynamic low-volume days, etc.)
  // These are sport-specific and power the scheduling intelligence layer for specialty leagues.
  try {
    const sportKey = String(leagueSport).toUpperCase() as ScheduleSport
    const fantasyScheduleDefaults = getDefaultScheduleConfig(sportKey)
    await updateScheduleConfigForLeague(leagueId, fantasyScheduleDefaults)
  } catch {
    // Non-fatal — league still works with runtime defaults from getDefaultScheduleConfig()
  }

  // Apply sport-specific scoring preset defaults
  if (leagueSport === 'NBA') {
    try {
      const { applyDefaultNbaScoringOnCreate } = await import('@/lib/nba-scoring')
      await applyDefaultNbaScoringOnCreate(leagueId)
    } catch { /* non-fatal */ }
  }
  if (leagueSport === 'MLB') {
    try {
      const { applyDefaultMlbScoringOnCreate } = await import('@/lib/mlb-scoring')
      await applyDefaultMlbScoringOnCreate(leagueId)
    } catch { /* non-fatal */ }
  }
  if (leagueSport === 'NHL') {
    try {
      const { applyDefaultNhlScoringOnCreate } = await import('@/lib/nhl-scoring')
      await applyDefaultNhlScoringOnCreate(leagueId)
    } catch { /* non-fatal */ }
  }
  if (leagueSport === 'NFL') {
    try {
      const { applyDefaultNflScoringOnCreate } = await import('@/lib/nfl-scoring')
      await applyDefaultNflScoringOnCreate(leagueId)
    } catch { /* non-fatal */ }
  }
  if (leagueSport === 'NCAAF') {
    try {
      const { applyDefaultNcaafScoringOnCreate } = await import('@/lib/ncaaf-scoring')
      await applyDefaultNcaafScoringOnCreate(leagueId)
    } catch { /* non-fatal */ }
  }
  if (leagueSport === 'NCAAB') {
    try {
      const { applyDefaultNcaabScoringOnCreate } = await import('@/lib/ncaab-scoring')
      await applyDefaultNcaabScoringOnCreate(leagueId)
    } catch { /* non-fatal */ }
  }
  if (leagueSport === 'SOCCER') {
    try {
      const { applyDefaultSoccerScoringOnCreate } = await import('@/lib/soccer-scoring')
      await applyDefaultSoccerScoringOnCreate(leagueId)
    } catch { /* non-fatal */ }
  }

  // Apply unified roster defaults (one-league one-config) through the shared roster engine.
  const leagueType = (settings.league_type as string) ?? (settings.leagueType as string) ?? 'redraft'
  const rosterRegistry = getRosterEngineRegistry()
  if (rosterRegistry.isSupported(String(leagueSport))) {
    try {
      await createDefaultLeagueRosterConfig(leagueId, leagueSport as SupportedRosterSport, leagueType)
    } catch {
      // non-fatal
    }
  }

  const waiverResult = await bootstrapLeagueWaiverSettings(leagueId).catch(() => ({
    leagueId,
    waiverSettingsApplied: false,
    sport: String(leagueSport),
    variant: null,
  }))

  if (isIdp) {
    try {
      const { upsertIdpLeagueConfig } = await import('@/lib/idp')
      await upsertIdpLeagueConfig(leagueId, {})
    } catch {
      // non-fatal; league still works with in-memory IDP defaults
    }
  }

  const isSurvivor =
    leagueType === 'survivor' ||
    scoringFormat === 'survivor' ||
    Boolean((settings as Record<string, unknown>).survivorMode)
  if (isSurvivor) {
    try {
      const [{ upsertSurvivorConfig }, { getOrCreateExileLeague }, { runSurvivorLeagueBootstrap }] = await Promise.all([
        import('@/lib/survivor/SurvivorLeagueConfig'),
        import('@/lib/survivor/SurvivorExileEngine'),
        import('@/lib/survivor/survivorLeagueBootstrap'),
      ])
      const teamCount =
        (await prisma.league.findUnique({ where: { id: leagueId }, select: { leagueSize: true } }))?.leagueSize ?? 20
      const sw = settings as Record<string, unknown>
      const suggested =
        typeof sw.survivor_suggested_tribe_count === 'number' && Number.isFinite(sw.survivor_suggested_tribe_count)
          ? Math.max(2, Math.min(4, Math.round(Number(sw.survivor_suggested_tribe_count))))
          : null
      const tribeCount =
        suggested ??
        (typeof sw.tribeCount === 'number' && Number.isFinite(sw.tribeCount)
          ? Math.max(2, Math.min(4, Math.round(Number(sw.tribeCount))))
          : 4)
      const tribeSize = Math.max(1, Math.ceil(teamCount / tribeCount))
      const mode = String(sw.mode ?? 'redraft').toLowerCase() === 'bestball' ? 'bestball' : 'redraft'
      await upsertSurvivorConfig(leagueId, {
        mode,
        tribeCount,
        tribeSize,
        tribeFormation: String(sw.tribeFormation ?? 'random'),
        seasonThemeLabel:
          typeof sw.survivor_season_theme_label === 'string' && sw.survivor_season_theme_label.trim().length > 0
            ? String(sw.survivor_season_theme_label).trim()
            : null,
        challengesSystemRun: sw.survivor_challenges_system_run !== false,
      })
      await getOrCreateExileLeague(leagueId).catch(() => {})
      await runSurvivorLeagueBootstrap(leagueId).catch(() => {})
    } catch {
      // non-fatal; legacy wizard path will fill in if used
    }
  }

  /*
   * 🛑 ZOMBIE AND BIG BROTHER WERE THE ONLY TWO FORMATS THE LIVE WIZARD COULD
   * CREATE WITHOUT CONFIGURING.
   *
   * Their bootstrap lived exclusively in `legacyWizardSpecialtyBootstraps.ts`,
   * whose only two callers are in `app/api/league/create/route.ts` — the route
   * that labels itself DEPRECATED and that the wizard does not use. The wizard
   * posts to `POST /api/leagues`, offers both formats (they have team-count
   * tiers in the rules engine), and validation blocks only devy/c2c. So a
   * zombie league came out with no `ZombieLeagueConfig` and no `ZombieLeague`
   * row, and a Big Brother league with no config and no week-1 cycle. Measured
   * 2026-09-07: both config tables hold zero rows in production.
   *
   * ⚠ THE FIX IS NOT TO CALL THE LEGACY BOOTSTRAP WHOLESALE. That function
   * covers nine concepts, and this path already handles seven of them — six in
   * the create transaction (guillotine, IDP, devy, C2C, dynasty, salary cap)
   * and survivor immediately above. Calling it here would re-run every one:
   * re-seeding survivor's exile league, FAQ and draft session, and overwriting
   * the transaction's computed configs with the legacy path's bare `{}`
   * defaults. Only the two genuinely missing concepts are added, beside
   * survivor, which is the precedent this mirrors.
   *
   * ⚠ THESE ARE DEFAULTS, AND DELIBERATELY SO. The V2 wizard collects no
   * zombie or Big Brother settings at all — no whisperer mode, no universe, no
   * house rules — so everything below falls back. A valid default config that
   * the concept's own engines and settings routes can then edit is the point;
   * the alternative on this path today is no row at all, which is what makes
   * the league structurally broken from birth. `settings.conceptSetup` is read
   * anyway so the values land the moment the wizard learns to collect them.
   */
  const conceptSetup = ((settings as Record<string, unknown>).conceptSetup ?? {}) as Record<string, unknown>

  if (leagueType === 'zombie') {
    try {
      const [{ upsertZombieLeagueConfig }, { createZombieLeague }] = await Promise.all([
        import('@/lib/zombie/ZombieLeagueConfig'),
        import('@/lib/zombie/setupEngine'),
      ])
      const league = await prisma.league.findUnique({
        where: { id: leagueId },
        select: { name: true, leagueSize: true },
      })
      const whispererSelection =
        conceptSetup.zombie_whisperer_selection === 'veteran_priority' ? 'veteran_priority' : 'random'
      const universeId =
        typeof conceptSetup.zombie_universe_id === 'string' && conceptSetup.zombie_universe_id.trim()
          ? String(conceptSetup.zombie_universe_id).trim()
          : null
      const levelId =
        typeof conceptSetup.zombie_level_id === 'string' && conceptSetup.zombie_level_id.trim()
          ? String(conceptSetup.zombie_level_id).trim()
          : null

      await upsertZombieLeagueConfig(leagueId, { whispererSelection, universeId })
      await createZombieLeague(
        {
          leagueId,
          name: league?.name ?? null,
          sport: String(leagueSport),
          teamCount: typeof league?.leagueSize === 'number' ? league.leagueSize : 12,
          isPaid: false,
          buyInAmount: null,
          whispererSelectionMode: whispererSelection,
          namingMode: 'hybrid',
          isSingleLeague: !universeId,
        },
        universeId,
        levelId,
      )
    } catch (error) {
      // Non-fatal, matching survivor above: the league itself is already
      // committed, and a half-configured league is recoverable through the
      // concept's own settings route. Failing creation here is not.
      console.warn('[league-bootstrap] zombie bootstrap non-fatal:', error)
    }
  }

  if (leagueType === 'big_brother') {
    try {
      const { upsertBigBrotherConfig } = await import('@/lib/big-brother/BigBrotherLeagueConfig')
      await upsertBigBrotherConfig(leagueId, {})
      try {
        const { runBigBrotherLeagueBootstrap } = await import('@/lib/big-brother/bigBrotherLeagueBootstrap')
        const boot = await runBigBrotherLeagueBootstrap(leagueId)
        if (!boot.weekOneCycle.ok && boot.weekOneCycle.error) {
          console.warn('[league-bootstrap] big brother week-1 cycle:', boot.weekOneCycle.error)
        }
      } catch (bootError) {
        // The config is what makes the league usable; the week-1 cycle is
        // recoverable from the commissioner panel. Keep them separately
        // fallible so one cannot cost the other.
        console.warn('[league-bootstrap] big brother bootstrap non-fatal:', bootError)
      }
    } catch (error) {
      console.warn('[league-bootstrap] big brother config non-fatal:', error)
    }
  }

  void warmLeagueSportsDataAfterCreate(leagueSport).catch(() => {
    // non-fatal — chain warms on first read if this fails
  })

  try {
    const { ensureLeagueDraftSetupDefaults } = await import('@/lib/league/ensureLeagueDraftSetupDefaults')
    await ensureLeagueDraftSetupDefaults(leagueId, { scope: 'both' })
  } catch {
    /* non-fatal — pre-draft checklist columns may still be filled manually */
  }

  return {
    roster: rosterResult,
    settings: settingsResult,
    scoring: scoringResult,
    playerPool: poolResult,
    draft: { draftConfigApplied: draftResult.draftConfigApplied },
    waiver: { waiverSettingsApplied: waiverResult.waiverSettingsApplied },
    playoff: { playoffConfigApplied: playoffResult.playoffConfigApplied },
    schedule: { scheduleConfigApplied: scheduleResult.scheduleConfigApplied },
  }
}
