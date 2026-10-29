import type { CategoryDefinition } from './types'

/**
 * Standard NHL categories for H2H-category / roto leagues (the Yahoo / ESPN default set):
 * skaters G, A, +/-, PIM, PPP, SOG, HIT, BLK; goalies W, GAA, SV%, SO.
 *
 * Stat keys are the NHL engine's own (`lib/sportConfig/configs/nhl.ts`), which is what
 * `normalizeNhlGameStats` writes into `PlayerWeeklyScore.stats` — so a category league scores from
 * the same ingested lines as a points league, with no new ingestion.
 *
 * ⚠ PIM is HIGHER-is-better, as in the standard Yahoo/ESPN set: the category rewards physical
 *   players. A league wanting it inverted needs a custom set, not this preset.
 * ⚠ GAA's denominator is goalie time on ice (`g_toi`), stored only on lines ingested since
 *   `time_on_ice` was parsed (rollingInsightsGameLogs.ts). A week whose goalie lines predate that
 *   has no minutes, so GAA is unqualified for that team rather than a perfect 0.00.
 */
const count = (id: string, label: string, statKey: string): CategoryDefinition => ({
  id,
  label,
  direction: 'higher',
  computation: { kind: 'sum', statKey },
})

export const NHL_STANDARD_CATEGORIES: readonly CategoryDefinition[] = Object.freeze([
  count('nhl_g', 'G', 'g'),
  count('nhl_a', 'A', 'a'),
  count('nhl_pm', '+/-', 'plusminus'),
  count('nhl_pim', 'PIM', 'pim'),
  count('nhl_ppp', 'PPP', 'ppp'),
  count('nhl_sog', 'SOG', 'sog'),
  count('nhl_hit', 'HIT', 'hits'),
  count('nhl_blk', 'BLK', 'blks'),
  count('nhl_w', 'W', 'g_win'),
  {
    id: 'nhl_gaa',
    label: 'GAA',
    description: 'Goals against per 60 goalie minutes (team totals) — lower is better.',
    direction: 'lower',
    computation: { kind: 'ratio', numeratorStatKey: 'g_ga', denominatorStatKey: 'g_toi', multiplier: 60, unqualifiedWhenZero: true },
  },
  {
    id: 'nhl_sv_pct',
    label: 'SV%',
    description: 'Saves over shots against (team totals).',
    direction: 'higher',
    computation: { kind: 'ratio', numeratorStatKey: 'g_sv', denominatorStatKey: 'g_sa', unqualifiedWhenZero: true },
  },
  count('nhl_so', 'SO', 'g_so'),
])
