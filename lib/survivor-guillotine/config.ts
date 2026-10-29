import type { SGConfig, SGMode, SGPeriod, SGSport } from './types'

export const SG_MODE_LABELS: Record<SGMode, string> = {
  match_play: 'Match Play', tribe_champion: 'Tribe Champion', gauntlet: 'Gauntlet',
  merged: 'Individual Guilly', final_three: 'Final Three', off: 'No elimination',
}

/** Reject unknown/malformed live inputs rather than storing unchecked client JSON as league rules. */
export function parseSGLiveConfig(value: unknown): SGConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('A rules object is required.')
  const input = value as Record<string, unknown>
  const sport = input.sport
  if (sport !== 'NFL' && sport !== 'NBA') throw new Error('Choose NFL or NBA.')
  const base = defaultSGConfig(sport)
  for (const key of Object.keys(base)) if (!(key in input)) throw new Error(`Missing rule: ${key}.`)
  for (const key of Object.keys(input)) if (!(key in base)) throw new Error(`Unknown rule: ${key}.`)
  const integers = ['teamCount', 'tribeCount', 'championshipPeriod', 'gauntletPeriods', 'mergedChopPeriods', 'matchupBatchSize', 'faabBudget', 'nbaGameCap']
  for (const key of integers) if (!Number.isInteger(input[key]) || Number(input[key]) < 0) throw new Error(`Invalid ${key}.`)
  const booleans = ['gauntletTribeImmunity', 'gauntletIdolAuction', 'tradesEnabled', 'ceremonyPresentation']
  for (const key of booleans) if (typeof input[key] !== 'boolean') throw new Error(`Invalid ${key}.`)
  const choices: Record<string, string[]> = {
    tribeFormation: ['random', 'commissioner', 'captain_draft', 'manager_choice'],
    submissionMode: ['first_valid', 'tribe_vote', 'captain', 'commissioner'],
    matchupOrder: ['alternating', 'random', 'commissioner'], matchupBatchSize: ['2', '3'],
    gauntletDraft: ['snake', 'alternating', 'commissioner'], gauntletCaptains: ['previous_period_top_two', 'commissioner'],
    gauntletElimination: ['per_tribe', 'league_lowest_two'], nbaScoring: ['total_points', 'capped_games'],
    ceremonyMode: ['automatic', 'hosted'], immunityDeadline: ['scheduled_ceremony', 'custom'],
    playerPowerDeadline: ['next_game_lock', 'custom'], missingSubmission: ['commissioner', 'random'],
  }
  for (const [key, options] of Object.entries(choices)) if (!options.includes(String(input[key]))) throw new Error(`Invalid ${key}.`)
  if (!input.periodOverrides || typeof input.periodOverrides !== 'object' || Array.isArray(input.periodOverrides)) throw new Error('Invalid period overrides.')
  if (!Array.isArray(input.shufflePeriods) || input.shufflePeriods.some(x => !Number.isInteger(x))) throw new Error('Invalid shuffle periods.')
  if (!Array.isArray(input.enabledPowers) || input.enabledPowers.some(x => !['personal_immunity', 'ally_immunity', 'steal_player', 'tribe_swap', 'faab_bonus'].includes(x))) throw new Error('Invalid power pool.')
  for (const key of ['customImmunityDeadline', 'customPlayerPowerDeadline']) if (input[key] !== null && typeof input[key] !== 'string') throw new Error(`Invalid ${key}.`)
  const parsed = input as unknown as SGConfig
  const result = buildSGSchedule(parsed)
  if (result.errors.length) throw new Error(result.errors.join(' '))
  return parsed
}

/** NBA championship period must be selected from the league's actual scoring calendar. */
export function defaultSGConfig(sport: SGSport = 'NFL', championshipPeriod = 17): SGConfig {
  return {
    sport, teamCount: 22, tribeCount: 2, championshipPeriod,
    gauntletPeriods: 3, mergedChopPeriods: 3, periodOverrides: {},
    tribeFormation: 'commissioner', submissionMode: 'first_valid',
    matchupOrder: 'alternating', matchupBatchSize: 3,
    gauntletDraft: 'snake', gauntletCaptains: 'previous_period_top_two',
    gauntletElimination: 'per_tribe', gauntletTribeImmunity: false,
    gauntletIdolAuction: false, shufflePeriods: [], faabBudget: 1000,
    tradesEnabled: false, nbaScoring: 'total_points', nbaGameCap: 40,
    ceremonyMode: 'automatic', ceremonyPresentation: true,
    immunityDeadline: 'scheduled_ceremony', customImmunityDeadline: null,
    playerPowerDeadline: 'next_game_lock', customPlayerPowerDeadline: null,
    missingSubmission: 'commissioner',
    enabledPowers: ['personal_immunity', 'ally_immunity', 'steal_player', 'tribe_swap', 'faab_bonus'],
  }
}

/** Counts scoring periods, not calendar weeks. All-Star breaks are explicit overrides. */
export function buildSGSchedule(config: SGConfig): { periods: SGPeriod[]; errors: string[] } {
  const errors: string[] = []
  if (!['NFL', 'NBA'].includes(config.sport)) errors.push('Choose NFL or NBA.')
  if (!Number.isInteger(config.teamCount) || config.teamCount < 4 || config.teamCount > 64) errors.push('Choose 4–64 starting teams.')
  if (!Number.isInteger(config.tribeCount) || config.tribeCount < 2 || config.tribeCount > 4 || config.tribeCount > config.teamCount) errors.push('Choose 2–4 tribes with at least one team each.')
  if (!Number.isInteger(config.championshipPeriod) || config.championshipPeriod < 2 || config.championshipPeriod > 60) errors.push('Choose a championship scoring period between 2 and 60.')
  if (!Number.isInteger(config.gauntletPeriods) || config.gauntletPeriods < 0 || config.gauntletPeriods > 20) errors.push('Gauntlet length must be 0–20 scoring periods.')
  if (config.gauntletIdolAuction && config.gauntletPeriods === 0) errors.push('Gauntlet idol bidding needs at least one Gauntlet period.')
  if (!Number.isInteger(config.mergedChopPeriods) || config.mergedChopPeriods < 1 || config.mergedChopPeriods > 20) errors.push('Choose 1–20 individual elimination periods.')
  if (!Number.isFinite(config.faabBudget) || config.faabBudget < 0) errors.push('FAAB budget must be zero or greater.')
  if (config.nbaScoring === 'capped_games' && (!Number.isInteger(config.nbaGameCap) || config.nbaGameCap < 1)) errors.push('Choose a positive player-game cap.')
  if (!config.enabledPowers.includes('personal_immunity')) errors.push('Personal immunity must remain in the power pool.')
  for (const key of Object.keys(config.periodOverrides)) {
    const period = Number(key)
    const mode = config.periodOverrides[period]
    if (!Number.isInteger(period) || period < 1 || period >= config.championshipPeriod || !Object.hasOwn(SG_MODE_LABELS, mode) || mode === 'final_three') errors.push(`Invalid schedule override at period ${key}.`)
  }
  for (const [kind, value] of [[config.immunityDeadline, config.customImmunityDeadline], [config.playerPowerDeadline, config.customPlayerPowerDeadline]]) {
    if (kind === 'custom' && (!value || !Number.isFinite(Date.parse(value)))) errors.push('Custom deadlines require a valid date and time.')
  }
  if (errors.length) return { periods: [], errors }

  const active = Array.from({ length: config.championshipPeriod - 1 }, (_, i) => i + 1)
    .filter(period => config.periodOverrides[period] !== 'off')
  const mergeIndex = active.length - config.mergedChopPeriods
  const gauntletIndex = mergeIndex - config.gauntletPeriods
  if (gauntletIndex < 0) return { periods: [], errors: ['Season is too short for the selected Gauntlet and merge lengths.'] }
  let remaining = config.teamCount
  let tribalIndex = 0
  const periods: SGPeriod[] = []
  for (let period = 1; period <= config.championshipPeriod; period++) {
    const index = active.indexOf(period)
    const defaultMode: SGMode = period === config.championshipPeriod ? 'final_three'
      : index < 0 ? 'off'
      : index >= mergeIndex ? 'merged'
      : index >= gauntletIndex ? 'gauntlet'
      : tribalIndex % 2 === 0 ? 'match_play' : 'tribe_champion'
    const mode = config.periodOverrides[period] ?? defaultMode
    if (mode === 'match_play' || mode === 'tribe_champion') tribalIndex++
    const chops = mode === 'off' || mode === 'final_three' ? 0 : mode === 'gauntlet' ? 2 : 1
    if (mode === 'gauntlet' && remaining % 2 !== 0) errors.push(`Period ${period}: the Gauntlet requires two equal tribes; ${remaining} teams remain.`)
    if (chops > 0 && remaining - chops < 3) errors.push(`Period ${period}: elimination would leave fewer than three finalists.`)
    periods.push({ period, mode, teamsEntering: remaining, teamsLeaving: remaining - chops, chops,
      tribeImmunity: mode === 'match_play' || mode === 'tribe_champion' || (mode === 'gauntlet' && config.gauntletTribeImmunity) })
    remaining -= chops
  }
  if (remaining !== 3) errors.push(`Schedule leaves ${remaining} finalists; adjust starting teams or elimination periods to finish with three.`)
  let merged = false
  for (const period of periods) {
    if (period.mode === 'merged') merged = true
    if (merged && ['match_play', 'tribe_champion', 'gauntlet'].includes(period.mode)) errors.push(`Period ${period.period}: tribe competition cannot resume after the merge.`)
  }
  if (config.shufflePeriods.some(period => !Number.isInteger(period) || period < 1 || !periods.some(row => row.period === period && ['match_play', 'tribe_champion'].includes(row.mode)))) errors.push('Schedule shuffles during the tribal phase only.')
  return { periods, errors: [...new Set(errors)] }
}
