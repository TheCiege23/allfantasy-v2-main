type FoundationCadenceSport = 'NFL' | 'NCAAF'

type FoundationCadencePhase =
  | 'offseason'
  | 'preseason_ramp'
  | 'season_live'
  | 'postseason'

type FoundationCadenceTask = {
  task: string
  frequencyHours: number
  priority: 'low' | 'medium' | 'high'
}

type FoundationCadencePlan = {
  sport: FoundationCadenceSport
  season: number
  phase: FoundationCadencePhase
  preseasonRampStartsOn: string
  seasonStartsOn: string
  seasonEndsOn: string
  recommendedTasks: FoundationCadenceTask[]
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10)
}

function buildTasks(phase: FoundationCadencePhase): FoundationCadenceTask[] {
  switch (phase) {
    case 'preseason_ramp':
      return [
        { task: 'players_and_identity', frequencyHours: 24, priority: 'high' },
        { task: 'headshots_and_team_logos', frequencyHours: 24, priority: 'high' },
        { task: 'historical_stats_backfill', frequencyHours: 72, priority: 'medium' },
        { task: 'projections_and_depth_charts', frequencyHours: 24, priority: 'high' },
        { task: 'injuries_and_news', frequencyHours: 24, priority: 'medium' },
        { task: 'draft_pool_cache_rebuild', frequencyHours: 24, priority: 'high' },
      ]
    case 'season_live':
      return [
        { task: 'injuries_and_news', frequencyHours: 6, priority: 'high' },
        { task: 'projections_and_depth_charts', frequencyHours: 12, priority: 'high' },
        { task: 'schedules_and_live_status', frequencyHours: 12, priority: 'high' },
        { task: 'player_and_team_images_repair', frequencyHours: 48, priority: 'medium' },
        { task: 'historical_stats_rollforward', frequencyHours: 24, priority: 'high' },
        { task: 'draft_pool_cache_rebuild', frequencyHours: 12, priority: 'high' },
      ]
    case 'postseason':
      return [
        { task: 'season_closeout_stats', frequencyHours: 48, priority: 'high' },
        { task: 'injuries_and_news', frequencyHours: 24, priority: 'medium' },
        { task: 'player_identity_cleanup', frequencyHours: 168, priority: 'medium' },
        { task: 'draft_pool_cache_rebuild', frequencyHours: 72, priority: 'medium' },
      ]
    case 'offseason':
    default:
      return [
        { task: 'historical_stats_backfill', frequencyHours: 168, priority: 'medium' },
        { task: 'player_identity_cleanup', frequencyHours: 168, priority: 'medium' },
        { task: 'rookies_and_incoming_players', frequencyHours: 72, priority: 'high' },
        { task: 'headshots_and_team_logos', frequencyHours: 168, priority: 'low' },
        { task: 'draft_pool_cache_rebuild', frequencyHours: 168, priority: 'medium' },
      ]
  }
}

export function buildFoundationCadencePlan(input: {
  sport: FoundationCadenceSport
  season: number
  now?: Date
}): FoundationCadencePlan {
  const now = input.now ?? new Date()
  const seasonYear = input.season

  const seasonStartsOn =
    input.sport === 'NCAAF'
      ? new Date(Date.UTC(seasonYear, 7, 24))
      : new Date(Date.UTC(seasonYear, 8, 1))
  const preseasonRampStartsOn = new Date(seasonStartsOn)
  preseasonRampStartsOn.setUTCMonth(preseasonRampStartsOn.getUTCMonth() - 3)
  preseasonRampStartsOn.setUTCDate(1)

  const seasonEndsOn =
    input.sport === 'NCAAF'
      ? new Date(Date.UTC(seasonYear, 11, 31))
      : new Date(Date.UTC(seasonYear + 1, 1, 20))

  let phase: FoundationCadencePhase = 'offseason'
  if (now >= preseasonRampStartsOn && now < seasonStartsOn) {
    phase = 'preseason_ramp'
  } else if (now >= seasonStartsOn && now <= seasonEndsOn) {
    phase = 'season_live'
  } else if (now > seasonEndsOn && now <= new Date(Date.UTC(seasonEndsOn.getUTCFullYear(), seasonEndsOn.getUTCMonth(), seasonEndsOn.getUTCDate() + 45))) {
    phase = 'postseason'
  }

  return {
    sport: input.sport,
    season: seasonYear,
    phase,
    preseasonRampStartsOn: isoDate(preseasonRampStartsOn),
    seasonStartsOn: isoDate(seasonStartsOn),
    seasonEndsOn: isoDate(seasonEndsOn),
    recommendedTasks: buildTasks(phase),
  }
}
