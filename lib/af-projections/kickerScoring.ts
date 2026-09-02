/**
 * AF Projections — kicker component scoring.
 *
 * WHY THIS EXISTS. The engine had no kicker path at all. A kicker reached the basis ladder and
 * could only match `pts_{format}` from a provider or the DraftKings season proxy — measured on
 * production 2026-09-02, that produced **41 NFL kicker rows in the whole table**, range 1.76 to
 * 10.85, with no rule from the league ever applied. Every league that scores a 50-yarder
 * differently from a 25-yarder was mispriced, and the engine could not tell anyone why.
 *
 * Pure: scoring rules are passed in, never read from the database here. Same contract as
 * `idpScoring.ts`, deliberately — the two are the same shape of problem.
 *
 * ── 🛑 THE DATA CANNOT SCORE DISTANCE BUCKETS, AND THIS REFUSES TO PRETEND ───────────────────
 * Leagues really do score by distance. Measured across this account's leagues, these keys are set:
 *
 *     fgm_0_19  fgm_20_29  fgm_30_39  fgm_40_49  fgm_50_59  fgm_50p  fgm_60p
 *     fgmiss_0_19 … fgmiss_60p        fgm_yds    fgm_yds_over_30
 *
 * The stat source provides none of that. A kicker's season line carries exactly:
 *
 *     field_goals_made · field_goals_attempted · field_goals_long
 *     extra_points_made · extra_points_attempted
 *
 * — a TOTAL and a LONGEST, never a distribution. So a 40-49 yard rule has nothing to multiply.
 *
 * ⚠ THE TEMPTING FIX IS TO APPORTION MADES ACROSS BUCKETS WITH A POPULATION PRIOR, and this
 * deliberately does not. `idpScoring` does exactly that for the solo/assist tackle split — but
 * that prior was MEASURED from 5,186 real weekly rows carrying both keys. Here there is no source
 * of per-distance data anywhere in the pipeline, so the distribution would be invented, and an
 * invented distribution applied to a real rule produces a number that looks measured and is not.
 *
 * Bucket rules are therefore reported in `unscoredComponents` — named, never silently dropped and
 * never scored at a guessed value. A league scoring ONLY by bucket gets an honest refusal.
 */

import type { KickerScoringBreakdown, KickerSourceKind } from './types'

/** Canonical kicker components this engine can score from the available data. */
export type KickerComponent =
  | 'fieldGoalMade'
  | 'fieldGoalMissed'
  | 'extraPointMade'
  | 'extraPointMissed'

/**
 * Ordered candidate rule keys per component. FIRST MATCH WINS, for the reason `idpScoring`
 * records: presets ship aliases whose values disagree, and summing every match would double-count.
 *
 * Spans our preset names and Sleeper's, since a league's own settings are passed in directly.
 */
const COMPONENT_RULE_KEYS: Record<KickerComponent, readonly string[]> = {
  fieldGoalMade: ['fgm', 'kick_fgm', 'field_goal_made'],
  fieldGoalMissed: ['fgmiss', 'kick_fgmiss', 'field_goal_missed'],
  extraPointMade: ['xpm', 'kick_xpm', 'extra_point_made'],
  extraPointMissed: ['xpmiss', 'kick_xpmiss', 'extra_point_missed'],
}

/**
 * Rule keys this engine KNOWS it cannot honour, so it can name them rather than ignore them.
 *
 * Distance buckets and per-yard rules all require a distribution the stat source does not carry.
 * Listing them explicitly means a league that sets one is TOLD, instead of quietly receiving a
 * projection that skipped its most distinctive rule.
 */
export const UNSCOREABLE_RULE_KEYS: readonly string[] = [
  'fgm_0_19', 'fgm_20_29', 'fgm_30_39', 'fgm_40_49', 'fgm_50_59', 'fgm_50p', 'fgm_60p',
  'fgmiss_0_19', 'fgmiss_20_29', 'fgmiss_30_39', 'fgmiss_40_49', 'fgmiss_50_59',
  'fgmiss_50p', 'fgmiss_60p',
  'fgm_yds', 'fgm_yds_over_30',
]

/** Rolling Insights season-aggregate keys. Verified against production kicker rows. */
const RI_SEASON_KEYS = {
  made: 'field_goals_made',
  attempted: 'field_goals_attempted',
  xpMade: 'extra_points_made',
  xpAttempted: 'extra_points_attempted',
} as const

/** Sleeper weekly (`normalizedStatMap`) keys. */
const SLEEPER_WEEKLY_KEYS = {
  made: 'fgm',
  attempted: 'fga',
  xpMade: 'xpm',
  xpAttempted: 'xpa',
} as const

/** Positions this scoring applies to. Punters are NOT kickers and must not be scored here. */
const KICKER_POSITIONS: ReadonlySet<string> = new Set(['K', 'PK'])

export function isKickerPosition(position: string | null | undefined): boolean {
  const p = String(position ?? '').trim().toUpperCase()
  return p !== '' && KICKER_POSITIONS.has(p)
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function ruleValue(rules: Record<string, number>, component: KickerComponent): number | null {
  for (const key of COMPONENT_RULE_KEYS[component]) {
    const v = rules[key]
    if (typeof v === 'number' && Number.isFinite(v)) return v
  }
  return null
}

/**
 * Extract kicker components from a raw stat map.
 *
 * ⚠ MISSES ARE DERIVED (attempted − made), NEVER READ. No source carries a miss count directly,
 * and deriving it is exact rather than approximate — but it is only possible when BOTH halves are
 * present. When either is missing the miss component is absent rather than zero, because "he
 * missed none" and "we do not know how many he missed" are different claims and only one of them
 * should cost a kicker points.
 */
export function extractKickerComponents(
  statMap: Record<string, unknown>,
  source: KickerSourceKind,
): Partial<Record<KickerComponent, number>> {
  const k = source === 'sleeper_weekly' ? SLEEPER_WEEKLY_KEYS : RI_SEASON_KEYS
  const out: Partial<Record<KickerComponent, number>> = {}

  const made = num(statMap[k.made])
  const attempted = num(statMap[k.attempted])
  if (made != null) out.fieldGoalMade = made
  if (made != null && attempted != null) out.fieldGoalMissed = Math.max(0, attempted - made)

  const xpMade = num(statMap[k.xpMade])
  const xpAttempted = num(statMap[k.xpAttempted])
  if (xpMade != null) out.extraPointMade = xpMade
  if (xpMade != null && xpAttempted != null) out.extraPointMissed = Math.max(0, xpAttempted - xpMade)

  return out
}

/**
 * Score kicker components under a league's rules.
 *
 * Returns null when nothing was scoreable — the caller then falls through the basis ladder rather
 * than recording a zero, exactly as `scoreIdpComponents` does.
 */
export function scoreKickerComponents(args: {
  components: Partial<Record<KickerComponent, number>>
  rules: Record<string, number>
}): KickerScoringBreakdown | null {
  const { rules } = args
  let points = 0
  let anyScored = false
  const scored: string[] = []
  const unscored: string[] = []

  for (const [component, amount] of Object.entries(args.components) as Array<[KickerComponent, number]>) {
    if (amount == null || !Number.isFinite(amount)) continue
    const value = ruleValue(rules, component)
    if (value == null) {
      unscored.push(component)
      continue
    }
    points += amount * value
    anyScored = true
    if (amount !== 0) scored.push(component)
  }

  /*
   * Name every distance rule this league set that the data cannot honour. This is the difference
   * between a projection that quietly ignored the league's most distinctive setting and one that
   * says so — and it is the whole reason `UNSCOREABLE_RULE_KEYS` is enumerated rather than the
   * rules simply being skipped.
   */
  const approximations: string[] = []
  const setButUnscoreable = UNSCOREABLE_RULE_KEYS.filter(
    (key) => typeof rules[key] === 'number' && Number.isFinite(rules[key]) && rules[key] !== 0,
  )
  if (setButUnscoreable.length > 0) {
    unscored.push(...setButUnscoreable)
    approximations.push(
      `This league scores field goals by distance (${setButUnscoreable.join(', ')}), and the stat ` +
        `source carries only totals — field_goals_made, field_goals_attempted and field_goals_long, ` +
        `never a per-distance breakdown. Those rules were NOT applied. The projection reflects the ` +
        `league's flat rules only, so a strong long-range kicker is understated here.`,
    )
  }

  if (!anyScored) return null

  const componentAmounts: Record<string, number> = {}
  for (const [key, value] of Object.entries(args.components)) {
    if (typeof value === 'number' && Number.isFinite(value)) componentAmounts[key] = value
  }

  return {
    points: Math.round(points * 100) / 100,
    componentAmounts,
    scoredComponents: scored,
    unscoredComponents: unscored,
    approximations,
    /** True whenever a distance rule was set and could not be honoured. */
    distanceRulesIgnored: setButUnscoreable.length > 0,
  }
}

/**
 * The canonical rule set the WRITER scores with, so one stored snapshot can serve every league.
 *
 * ⚠ THESE ARE DEFAULTS, NOT LAWS — the same status `categoryScoring.ts` gives its DraftKings
 * rules. A real league scores what its commissioner says it scores, and
 * {@link rescoreKickerForLeague} is the path for that. What these give is a defensible baseline so
 * a kicker projection can exist at all, where previously there was none.
 *
 * DraftKings conventions, for the reason already recorded in `categoryScoring.ts`: this codebase
 * already treats DK as the house baseline for football (`season_dk_fppg_proxy` reads the provider's
 * own DK points), and DK's published scoring is a public, checkable reference rather than a number
 * somebody made up here.
 *
 * ⚠ DK actually scores field goals BY DISTANCE (3 points plus 1 per 10 yards over 30). That cannot
 * be applied — see the header — so this uses DK's floor of 3 for every make. A long-range kicker is
 * understated by this baseline, which is exactly what `distanceRulesIgnored` exists to say.
 */
export const KICKER_CANONICAL_RULES: Readonly<Record<string, number>> = {
  fgm: 3,
  fgmiss: -1,
  xpm: 1,
  xpmiss: -1,
}

/** The subset of stored `adjustmentFactors` a kicker rescore needs. All optional — it is JSON. */
export interface StoredKickerFactors {
  kicker?: { componentAmounts?: Record<string, number> | null } | null
}

/**
 * Rescore a stored kicker projection under a league's own rules.
 *
 * Mirrors `rescoreIdpForLeague` exactly, and exists for the same reason: `AFProjectionSnapshot`
 * physically holds ONE scoring format per player, so the writer stores a canonical baseline and the
 * league's real rules are applied at READ time. A league scoring `fgm: 5` and one scoring `fgm: 3`
 * must not share a number.
 *
 * Returns null whenever it cannot do better than the stored value — the caller then falls back
 * rather than substituting something worse.
 */
export function rescoreKickerForLeague(
  factors: StoredKickerFactors | null | undefined,
  leagueRules: Record<string, number> | null | undefined,
): KickerScoringBreakdown | null {
  if (!factors || !leagueRules) return null
  const amounts = factors.kicker?.componentAmounts
  if (!amounts || typeof amounts !== 'object') return null

  const components: Partial<Record<KickerComponent, number>> = {}
  for (const [key, value] of Object.entries(amounts)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    if (key === 'fieldGoalMade' || key === 'fieldGoalMissed' ||
        key === 'extraPointMade' || key === 'extraPointMissed') {
      components[key] = value
    }
  }
  if (Object.keys(components).length === 0) return null

  return scoreKickerComponents({ components, rules: leagueRules })
}
