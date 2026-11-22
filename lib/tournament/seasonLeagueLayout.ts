import { buildSeasonBlueprint, distributeSeeds, seasonLeagueKey, type SeasonBlueprint } from './seasonBlueprint'
import { resolveSeasonDraftWindow } from './seasonRules'

/** Preview and future provisioning use this same deterministic layout. No league is created here. */
export function buildSeasonLeagueLayout(input: unknown) {
  const plan = buildSeasonBlueprint(input)
  return plan.stages.map(stage => {
    const seedPools = stage.number === 1 ? null : distributeSeeds(
      Array.from({ length: stage.participants }, (_, i) => String(i + 1)), stage.leagueCount,
    )
    if (plan.config.competition?.draftOrder === 'best_seed_last') seedPools?.forEach(pool => pool.reverse())
    return {
      stage: stage.number,
      leagues: stage.sizes.map((slots, index) => ({
        key: seasonLeagueKey(stage.number, index + 1),
        name: stage.number === 1
          ? plan.config.leagueNames[index] ?? 'Opening League ' + String(index + 1).padStart(2, '0')
          : (stage.number === 2 ? 'Qualifier League ' : 'Final League ') + String(index + 1).padStart(2, '0'),
        slots,
        division: stage.number === 1 && plan.config.divisions.length
          ? plan.config.divisions[index % plan.config.divisions.length]!
          : null,
        seeds: seedPools?.[index]?.map(Number) ?? [],
      })),
    }
  })
}

export function earliestOpeningDraft(config: SeasonBlueprint) {
  const calendar = config.rules?.calendar
  if (!calendar) return ''
  if (!calendar.draftOverrides?.length) return calendar.drafts.find(row => row.stage === 1)?.startsAt ?? ''
  const starts = buildSeasonLeagueLayout({ ...config, rules: undefined })[0]!.leagues.map(league => resolveSeasonDraftWindow(calendar, 1, league)?.startsAt)
  return starts.reduce<string>((first, date) => date && (!first || Date.parse(date) < Date.parse(first)) ? date : first, '')
}
