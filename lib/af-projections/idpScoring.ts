/**
 * AF Projections — IDP component scoring.
 *
 * WHY THIS IS REQUIRED, NOT A PHASE 4 PAYOFF. Validating the core against all 1,933
 * production stat lines refused 959 players for `no_scoring_basis`, and they were
 * overwhelmingly defensive (LB 308, DB 230, DL 181, CB 116, S 76, DT 73, DE 65).
 * DraftKings classic does not score IDP and Sleeper's `pts_ppr` is absent for defenders,
 * so IDP players have no precomputed points basis at all. Both live test leagues are IDP
 * dynasty, so without component scoring the engine covers offensive skill players and
 * produces nothing for the leagues that matter.
 *
 * Pure: scoring rules are passed in, never read from the database here.
 */

import type { IdpScoringBreakdown, IdpSourceKind } from './types'

/**
 * Measured population split for combined tackles, used ONLY when a source gives a combined
 * count with no solo/assist breakdown.
 *
 * Derived from production, not assumed: across 5,186 NFL 2025 weekly rows carrying all three
 * keys, `idp_tkl` equalled `idp_tkl_solo + idp_tkl_ast` in 100.0% of cases, and the volume
 * split was 53.64% solo / 46.36% assist. Note this is far from the 2:1 that the preset VALUE
 * ratio (1.0 vs 0.5) might tempt you to assume — guessing a midpoint would have been
 * materially wrong, which is why this constant is measured and cited rather than chosen.
 *
 * It remains a population prior. Applying it to an individual is an approximation, and every
 * projection that uses it says so.
 */
export const MEASURED_SOLO_TACKLE_SHARE = 0.5364
export const MEASURED_TACKLE_SPLIT_PROVENANCE =
  'NFL 2025, 5,186 weekly rows with solo+assist present (53.64% solo / 46.36% assist)'

/**
 * Positions eligible for IDP scoring. Complete for the position vocabulary measured in
 * production: LB, DB, DL, CB, S, DT, DE, OLB, MLB, NT (plus common variants).
 *
 * WHY THIS GATE EXISTS. Offensive players record tackles too — after an interception, on a
 * fumble, or on special teams. Without a position gate they fall through the ladder to IDP
 * component scoring whenever they have no DK points and no positive format points, and get
 * projected on defensive production. Measured on the first production run: 29 offensive
 * players landed on an IDP basis, including Michael Penix Jr. (QB) at 5.97 and Jayden Daniels
 * (QB) at 3.89 — entirely from tackles made after turnovers. A quarterback must never carry
 * an IDP projection.
 *
 * Special teams (P, LS, PK, K) are excluded too: they make tackles but are not IDP-rosterable,
 * and a long snapper carrying a defensive projection is noise in every ranking it enters.
 */
const IDP_ELIGIBLE_POSITIONS = new Set([
  'LB', 'OLB', 'ILB', 'MLB',
  'DB', 'CB', 'S', 'SS', 'FS',
  'DL', 'DT', 'DE', 'NT', 'EDGE',
])

export function isIdpEligiblePosition(position: string | null | undefined): boolean {
  const p = String(position ?? '').trim().toUpperCase()
  return p !== '' && IDP_ELIGIBLE_POSITIONS.has(p)
}

/** Canonical IDP components this engine can score. */
export type IdpComponent =
  | 'soloTackle'
  | 'assistTackle'
  | 'sack'
  | 'interception'
  | 'passDefended'
  | 'forcedFumble'
  | 'fumbleRecovery'
  | 'tackleForLoss'
  | 'qbHit'
  | 'defensiveTd'
  | 'safety'
  | 'blockedKick'
  | 'sackYards'
  | 'intReturnYards'
  | 'fumbleReturnYards'

/**
 * Ordered candidate scoring-rule keys per component. FIRST MATCH WINS — this is deliberate.
 *
 * Candidates span THREE vocabularies so a league's own settings can be passed straight in:
 * our preset names (`idp_solo_tackle`), Sleeper's prefixed names (`idp_tkl_solo`), and
 * Sleeper's bare names (`tkl_solo`).
 *
 * The bare forms accepted here are ONLY tackles and TFL, which have no team-defense
 * equivalent. Bare `sack`, `int`, `ff`, `fum_rec`, `safe`, `blk_kick` and `def_td` are the
 * DEF-unit settings every Sleeper league carries by default — measured across 57 leagues, 45
 * score exactly those and nothing else defensive. Accepting them would apply a team weight to
 * an individual player and manufacture points for defenders in leagues that never roster them.
 *
 * The presets ship aliases whose values DISAGREE: in `tackle_heavy`, `idp_forced_fumble` is 2
 * while `idp_fumble_forced` is 3. Iterating every preset key and summing would double-count
 * forced fumbles and silently inflate every linebacker. One component resolves to exactly one
 * rule key.
 */
const COMPONENT_RULE_KEYS: Record<IdpComponent, readonly string[]> = {
  soloTackle: ['idp_solo_tackle', 'idp_tackle_solo', 'idp_tkl_solo', 'tkl_solo'],
  assistTackle: ['idp_assist_tackle', 'idp_tackle_assist', 'idp_assisted_tackle', 'idp_tkl_ast', 'tkl_ast'],
  sack: ['idp_sack'],
  interception: ['idp_interception', 'idp_int'],
  passDefended: ['idp_pass_defended', 'idp_pass_def'],
  forcedFumble: ['idp_forced_fumble', 'idp_fumble_forced', 'idp_ff'],
  fumbleRecovery: ['idp_fumble_recovery', 'idp_fum_rec'],
  tackleForLoss: ['idp_tackle_for_loss', 'idp_tkl_loss', 'tkl_loss'],
  qbHit: ['idp_qb_hit'],
  defensiveTd: ['idp_defensive_touchdown', 'idp_td', 'idp_def_td'],
  safety: ['idp_safety', 'idp_safe'],
  blockedKick: ['idp_blocked_kick', 'idp_blk_kick'],
  // Yardage components. Small per-unit weights (typically 0.1) but they close the residual
  // gap against Sleeper's own scoring — leaving them out left Jack Campbell 0.09 light.
  sackYards: ['idp_sack_yd'],
  intReturnYards: ['idp_int_ret_yd'],
  fumbleReturnYards: ['idp_fum_ret_yd'],
}

/** Sleeper weekly (`normalizedStatMap`) keys -> component. Verified against production. */
const SLEEPER_WEEKLY_KEYS: Record<string, IdpComponent> = {
  idp_tkl_solo: 'soloTackle',
  idp_tkl_ast: 'assistTackle',
  idp_sack: 'sack',
  idp_int: 'interception',
  idp_pass_def: 'passDefended',
  idp_ff: 'forcedFumble',
  idp_fum_rec: 'fumbleRecovery',
  idp_tkl_loss: 'tackleForLoss',
  idp_qb_hit: 'qbHit',
  idp_sack_yd: 'sackYards',
  idp_int_ret_yd: 'intReturnYards',
  idp_fum_ret_yd: 'fumbleReturnYards',
  idp_safe: 'safety',
  idp_def_td: 'defensiveTd',
  idp_blk_kick: 'blockedKick',
}
/** Combined-tackle keys, which carry no split and trigger the measured prior. */
const SLEEPER_COMBINED_TACKLE_KEY = 'idp_tkl'

/** Rolling Insights season-aggregate (`regular_season`) keys -> component. */
const RI_SEASON_KEYS: Record<string, IdpComponent> = {
  sacks: 'sack',
  interceptions: 'interception',
  forced_fumbles: 'forcedFumble',
  fumbles_recoveries: 'fumbleRecovery',
  defense_fumble_recoveries: 'fumbleRecovery',
  interception_touchdowns: 'defensiveTd',
  fumble_return_touchdowns: 'defensiveTd',
}
const RI_COMBINED_TACKLE_KEY = 'tackles'

function ruleValue(rules: Record<string, number>, component: IdpComponent): number | null {
  for (const key of COMPONENT_RULE_KEYS[component]) {
    const v = rules[key]
    if (typeof v === 'number' && Number.isFinite(v)) return v
  }
  return null
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** First key present with a finite numeric weight. */
function firstNumeric(rules: Record<string, number>, keys: readonly string[]): number | null {
  for (const k of keys) {
    const v = rules[k]
    if (typeof v === 'number' && Number.isFinite(v)) return v
  }
  return null
}

/**
 * Extract IDP components from a raw stat map.
 *
 * Returns the components found plus, separately, any combined tackle count. Splitting is the
 * caller's decision so the approximation stays visible rather than buried here.
 */
export function extractIdpComponents(
  statMap: Record<string, unknown>,
  source: IdpSourceKind,
): { components: Partial<Record<IdpComponent, number>>; combinedTackles: number | null } {
  const keyMap = source === 'sleeper_weekly' ? SLEEPER_WEEKLY_KEYS : RI_SEASON_KEYS
  const combinedKey = source === 'sleeper_weekly' ? SLEEPER_COMBINED_TACKLE_KEY : RI_COMBINED_TACKLE_KEY

  const components: Partial<Record<IdpComponent, number>> = {}
  for (const [rawKey, component] of Object.entries(keyMap)) {
    const v = num(statMap[rawKey])
    if (v == null) continue
    components[component] = (components[component] ?? 0) + v
  }
  return { components, combinedTackles: num(statMap[combinedKey]) }
}

/**
 * Score IDP components under a league's scoring rules.
 *
 * `combinedTackles` is used ONLY when neither solo nor assist is present. When the real split
 * exists it always wins — the measured prior is a fallback, never an override.
 *
 * Components with no rule in this league are skipped and named in `unscoredComponents`, not
 * silently dropped and not scored at a default value.
 */
export function scoreIdpComponents(args: {
  components: Partial<Record<IdpComponent, number>>
  combinedTackles?: number | null
  rules: Record<string, number>
}): IdpScoringBreakdown | null {
  const { rules } = args
  const components: Partial<Record<IdpComponent, number>> = { ...args.components }
  const approximations: string[] = []

  const hasRealSplit = components.soloTackle != null || components.assistTackle != null
  if (!hasRealSplit && args.combinedTackles != null && args.combinedTackles > 0) {
    const solo = args.combinedTackles * MEASURED_SOLO_TACKLE_SHARE
    components.soloTackle = solo
    components.assistTackle = args.combinedTackles - solo
    approximations.push(
      `Source reported ${args.combinedTackles} combined tackles with no solo/assist split; ` +
        `apportioned using the measured population split — ${MEASURED_TACKLE_SPLIT_PROVENANCE}. ` +
        `This is an estimate for this player, not an observation.`,
    )
  }

  let points = 0
  const scored: string[] = []
  const unscored: string[] = []
  let anyScored = false

  // Sleeper's tackle scoring is ADDITIVE, not exclusive. A league may set `idp_tkl` (points
  // for EVERY tackle) alongside `idp_tkl_solo` / `idp_tkl_ast` (an ADDITIONAL bonus on top,
  // per type). Resolving each component to a single key missed the base entirely.
  //
  // Measured against Guap's two IDP leagues on the same Jack Campbell projection:
  //   "Defense IDP For Life"   idp_tkl_solo only        -> ours 17.17, Sleeper 17.17  ✓
  //   "The Last IDP Dynasty!!" idp_tkl=1 + idp_tkl_solo=2 -> ours 17.17, Sleeper 26.31  ✗
  // The 9.14 gap is exactly the base rate applied to (solo + assist).
  const combinedWeight = firstNumeric(rules, ['idp_tkl', 'tkl'])
  if (combinedWeight != null && combinedWeight !== 0) {
    const solo = components.soloTackle ?? 0
    const assist = components.assistTackle ?? 0
    const allTackles = solo + assist
    if (allTackles > 0) {
      points += allTackles * combinedWeight
      anyScored = true
      scored.push('combinedTackle')
    }
  }

  for (const [component, amount] of Object.entries(components) as Array<[IdpComponent, number]>) {
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

  if (!anyScored) return null

  const componentAmounts: Record<string, number> = {}
  for (const [k, v] of Object.entries(components)) {
    if (typeof v === 'number' && Number.isFinite(v)) componentAmounts[k] = v
  }

  return {
    points: Math.round(points * 100) / 100,
    componentAmounts,
    scoredComponents: scored,
    unscoredComponents: unscored,
    approximations,
    usedMeasuredTackleSplit: approximations.length > 0,
  }
}
