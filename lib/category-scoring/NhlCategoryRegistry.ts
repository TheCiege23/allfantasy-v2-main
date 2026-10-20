/**
 * Standard NHL head-to-head category preset — the Yahoo / ESPN default skater set (G, A, +/-, PIM,
 * PPP, SOG, HIT) plus goalie W, GA and SV%.
 *
 * Stat keys are the canonical keys `normalizeNhlGameStats`
 * (`lib/scoring-runtime/dailySportStatNormalization.ts`) writes into the weekly stat rows, every one
 * of them read from a field in `contracts/rolling-insights/fixtures/live.NHL.json`:
 *   g goals · a assists · plusminus plus_minus · pim penalty_minutes · ppp power_play_goals +
 *   power_play_assists · sog shots_on_goal · hits hits · g_win win · g_ga goals_allowed ·
 *   g_sv saves · g_sa shots_against.
 *
 * ⚠ GA STANDS IN FOR GAA, DELIBERATELY. GAA is goals allowed × 60 / goalie minutes, and goalie
 * minutes are not in our stored stats: the box carries `time_on_ice` as an "MM:SS" string, and the
 * ingest (`normalizedMapFor` in `lib/sports-data/rollingInsightsGameLogs.ts`) flattens numeric
 * fields only, so it never reaches `normalizedStatMap`. Rather than invent a denominator, the goalie
 * rate category here is total goals allowed (lower is better). A true GAA needs that minute field
 * ingested first, and should then ship as a NEW preset id so leagues on this one never change
 * categories mid-season.
 *
 * SV% is computed from the team's SUMMED components, never by averaging per-goalie rates:
 * Σ saves / Σ shots against. A team whose goalies faced no shots has no SV% and does not win it.
 *
 * PIM counts like any other skater stat (more is better), as on Yahoo and ESPN.
 */

import type { CategoryDefinition } from './types'

const count = (id: string, label: string, statKey: string, description: string): CategoryDefinition => ({
  id,
  label,
  description,
  direction: 'higher',
  computation: { kind: 'sum', statKey },
})

export const NHL_CATEGORY_GA: CategoryDefinition = {
  id: 'nhl_ga',
  label: 'GA',
  description: 'Goals allowed by your goalies — lower is better.',
  direction: 'lower',
  computation: { kind: 'sum', statKey: 'g_ga' },
}

export const NHL_CATEGORY_SV_PCT: CategoryDefinition = {
  id: 'nhl_sv_pct',
  label: 'SV%',
  description: 'Save percentage (saves / shots against, team totals).',
  direction: 'higher',
  computation: { kind: 'ratio', numeratorStatKey: 'g_sv', denominatorStatKey: 'g_sa', unqualifiedWhenZero: true },
}

/** 10-category standard: seven skater counts, goalie wins, goals allowed and save percentage. */
export const NHL_TEN_CAT: readonly CategoryDefinition[] = Object.freeze([
  count('nhl_g', 'G', 'g', 'Goals'),
  count('nhl_a', 'A', 'a', 'Assists'),
  count('nhl_plus_minus', '+/-', 'plusminus', 'Plus/minus'),
  count('nhl_pim', 'PIM', 'pim', 'Penalty minutes'),
  count('nhl_ppp', 'PPP', 'ppp', 'Power-play points'),
  count('nhl_sog', 'SOG', 'sog', 'Shots on goal'),
  count('nhl_hit', 'HIT', 'hits', 'Hits'),
  count('nhl_w', 'W', 'g_win', 'Goalie wins'),
  NHL_CATEGORY_GA,
  NHL_CATEGORY_SV_PCT,
])
