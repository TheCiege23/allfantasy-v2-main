import { buildSeasonBlueprint, distributeSeeds } from './seasonBlueprint'

/** Preview and future provisioning use this same deterministic layout. No league is created here. */
export function buildSeasonLeagueLayout(input: unknown) {
  const plan = buildSeasonBlueprint(input)
  return plan.stages.map(stage => {
    const seedPools = stage.number === 1 ? null : distributeSeeds(
      Array.from({ length: stage.participants }, (_, i) => String(i + 1)), stage.leagueCount,
    )
    return {
      stage: stage.number,
      leagues: stage.sizes.map((slots, index) => ({
        key: 'stage-' + stage.number + '-league-' + (index + 1),
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
