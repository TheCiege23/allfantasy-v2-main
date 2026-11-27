import type { Prisma } from '@prisma/client'
import { GAMES_PER_WEEK_SETTINGS_KEY, readGamesPerWeek } from '@/lib/schedule-runtime/gamesPerWeek'
import { asRecord } from './importedIdentityPlan'
import type { importedNflScoring } from './importedNflScoring'
import type { importedMlbScoring } from './importedMlbScoring'
import type { importedMlbRoster } from './importedMlbRoster'

/**
 * The native settings an imported league's own rules become — shared by the copy flow
 * (`carryOverImportedLeague`, into a new league) and the in-place switch (`convertImportedLeagueInPlace`, into the same
 * row). Moved here unchanged from the copy flow so the two cannot drift: one set of keys, one writer of each.
 */

type Tx = Prisma.TransactionClient
type NflScoring = NonNullable<ReturnType<typeof importedNflScoring>>
type MlbScoring = ReturnType<typeof importedMlbScoring>
type MlbRoster = ReturnType<typeof importedMlbRoster> | undefined

/**
 * The settings keys an imported NFL rule set writes: the commissioner panel's store, marked
 * IMPORTED_MAPPED so post-create bootstrap does not re-seed the preset over it. Any engine-key
 * `categoryPoints` is removed because it outranks the panel store, and the imported rules must
 * be what scores.
 */
export function importedNflSettings(
  target: Record<string, unknown>,
  nfl: NflScoring,
  creatorUserId: string,
): Record<string, unknown> {
  const { categoryPoints: _replaced, ...sportConfig } = asRecord(target.sportConfig)
  return {
    nfl_scoring_config: {
      presetKey: 'custom',
      source: 'IMPORTED_MAPPED',
      rules: nfl.rules,
      matchesPreset: false,
      premiumFeaturesUsed: false,
      lastUpdatedAt: new Date().toISOString(),
      lastUpdatedBy: creatorUserId,
      warningFlags: nfl.notScored.length || nfl.approximated.length ? ['imported_rules_not_exact'] : [],
      importNotScored: nfl.notScored,
      importApproximated: nfl.approximated,
    },
    sportConfig: { ...sportConfig, ...(nfl.enableTEPremium ? { enableTEPremium: true } : {}) },
  }
}

/** The settings keys an imported baseball rule set and roster write (native baseball is one lineup a week). */
export function importedMlbSettings(
  target: Record<string, unknown>,
  mlbScoring: MlbScoring,
  mlbRoster: MlbRoster,
  creatorUserId: string,
): Record<string, unknown> {
  return {
    roster: mlbRoster,
    rosterSettings: mlbRoster,
    starter_slots: mlbRoster?.starterSlots,
    bench_slots: mlbRoster?.benchSlots,
    mlb_roster_config: { templateKey: 'imported', templateLabel: 'Imported roster', slots: mlbRoster!.config.sections[0]!.slots, isCustom: true, lastUpdatedBy: creatorUserId, lastUpdatedAt: new Date().toISOString() },
    scoringSettings: mlbScoring.scoringSettings,
    scoring_mode: mlbScoring.scoringMode,
    category_preset_id: mlbScoring.categoryPresetId ?? null,
    category_record_mode: mlbScoring.categoryRecordMode ?? null,
    sportConfig: { ...asRecord(target.sportConfig), scoringMode: mlbScoring.scoringMode, categoryPoints: mlbScoring.categoryPoints, lineupLockType: 'first_game_of_week' },
    mlb_scoring_config: { presetKey: 'custom', source: 'CUSTOM', rules: mlbScoring.uiRules, lastUpdatedBy: creatorUserId, lastUpdatedAt: new Date().toISOString() },
  }
}

/** Roto baseball plays no playoffs; the League columns say so. */
export function importedMlbLeagueColumns(mlbScoring: MlbScoring | undefined): { playoffTeams: number; playoffStartWeek: null } | Record<string, never> {
  return mlbScoring?.scoringMode === 'roto' ? { playoffTeams: 0, playoffStartWeek: null } : {}
}

/** The table rows an imported baseball rule set writes beside its settings keys. */
export async function writeImportedMlbScoringTables(tx: Tx, leagueId: string, mlbScoring: MlbScoring, mlbRoster: MlbRoster): Promise<void> {
  const slots = mlbRoster!.config.sections[0]!.slots
  await tx.leagueRosterConfig.upsert({ where: { leagueId }, create: { leagueId, templateId: `custom-MLB-${leagueId}`, overrides: { customSlots: slots, customTemplateKey: 'imported', isCustom: true } }, update: { overrides: { customSlots: slots, customTemplateKey: 'imported', isCustom: true } } })
  await tx.leagueScoringOverride.deleteMany({ where: { leagueId } })
  await tx.leagueScoringOverride.createMany({ data: Object.entries(mlbScoring.templatePoints).map(([statKey, pointsValue]) => ({ leagueId, statKey, pointsValue, enabled: true })) })
  await tx.scoringSettingsSnapshot.updateMany({ where: { leagueId }, data: { scoringMode: mlbScoring.scoringMode, scoringFormat: 'custom', effectiveRules: mlbScoring.scoringSettings as Prisma.InputJsonValue, overrides: mlbScoring.categoryPoints } })
}

/** A league that played several games a week keeps doing so; the native schedule reads this setting. */
export function importedGamesPerWeekSettings(sourceSettings: unknown): Record<string, number> {
  return readGamesPerWeek(sourceSettings) > 1 ? { [GAMES_PER_WEEK_SETTINGS_KEY]: readGamesPerWeek(sourceSettings) } : {}
}
