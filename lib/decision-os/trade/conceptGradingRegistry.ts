/**
 * 🛑 EVERY LEAGUE CONCEPT IS GRADED BY ITS OWN RULE — AND THIS TABLE IS WHERE THE RULE IS NAMED.
 *
 * `createLeagueTradeGrader` (`./leagueTradeGrader.ts`) is the one trade grader. It used to pick its
 * sub-grader with an if-chain (zombie → college → guillotine → sport points → NFL market chart), so a
 * concept nobody had thought about simply reached the last branch and got a confident letter off the
 * default dynasty/redraft chart. Nothing said it had happened.
 *
 * Now the grader asks this registry first. For every league concept × sport there is an entry naming
 * the sub-grader and the value basis it prices on — or the entry is `withheld`, with the sentence the
 * manager reads. A league type that has NO entry is withheld too (`UNREGISTERED_CONCEPT_REASON`), never
 * priced on the default chart.
 *
 * ⚠ THE TABLE STARTED AS A MAP OF WHAT THE GRADER DID, NOT WHAT IT SHOULD DO. It was written as a
 * behaviour-preserving map of the old if-chain (Phase 5, 2026-11-26), and
 * `__tests__/decision-os/concept-grading-registry.test.ts` keeps the old chain as an oracle and proves
 * every registered combination still reaches the same sub-grader — EXCEPT the rows in that test's
 * `INTENDED_CHANGES`, each a deliberate grade change with its own behaviour tests. Entries whose basis
 * still looks wrong are marked `review:` — change those the same way.
 *
 * Deliberate changes so far (owner-approved, 2026-11-26):
 *   1. NCAAF is graded on college evidence for every concept — never the NFL chart. Concepts whose
 *      rosters reset take the college rest-of-season basis; multi-season ones the college dynasty basis,
 *      or are withheld where their format adjustment (keeper costs, cap contracts) has no college form.
 *   2. Pirate and EFL grade on the league's book in every sport but NFL (in NCAAF on the college bases): five seasons + picks when it is the
 *      dynasty book (EFL always; Pirate unless the commissioner said redraft), this season otherwise.
 *   3. Guillotine in college basketball and soccer uses the guillotine grader's survival weighting.
 *
 * ADDING A CONCEPT: add its id to `CONCEPT_GRADING_REGISTRY` below with one rule per sport, and land the
 * grading tests for that rule in the same change. Until then the concept withholds — which is the point.
 *
 * Sub-graders still read the league's raw type themselves (keeper costs, multi-season refusals,
 * pick policy); the registry only decides WHICH of them grades the deal. CLIENT-SAFE: no prisma.
 */
import type { LeagueSport } from '@prisma/client'
import type { LeagueTypeId } from '@/lib/league-creation-wizard/types'
import type { LeagueConceptType } from '@/lib/league/leagueConceptOptions'
// Pure (no prisma): the one answer every value surface gives to "is this league on the dynasty book".
import { leagueVariantFor } from '@/lib/core-app/valueBook'

/** The sub-graders `createLeagueTradeGrader` can hand a deal to. */
export type ConceptGrader =
  /** `./zombieGrader.ts` — points over the slot's best free agent for the weeks left. */
  | 'zombie'
  /** `./ncaafLeagueGrader.ts` — college points over replacement on the league's stored projections. */
  | 'ncaaf_college'
  /** `./guillotineGrader.ts` — points over the slot's free agent over expected survival, FAAB at purchasing power. */
  | 'guillotine'
  /** `./sportPointsGrader.ts` — points (or categories) over replacement under the league's own scoring. */
  | 'sport_points'
  /** The NFL market chart: `resolveAssets` → devy pricing → `gradePricedSides`. */
  | 'market_chart'
  /** Not graded; `reason` is what the manager reads. */
  | 'withheld'

/** The NFL post-processor that re-prices a market-chart grade on the league's own economics (`./footballTradeFormatGrade.ts`). */
export type ConceptFormatRule = 'keeper_option' | 'salary_cap_surplus' | 'c2c_campus'

export type ConceptGradingRule = {
  grader: ConceptGrader
  /**
   * `ncaaf_college` only: which college basis prices the deal. `rest_of_season` is college points over
   * replacement for the weeks left (picks refused — the rosters do not carry over); `dynasty` is five
   * seasons by class year plus picks from freshman estimates; `league_book` is `dynasty` when the league
   * prices on the dynasty book (`leagueVariantFor` — EFL always, Pirate unless confirmed redraft) and
   * `rest_of_season` otherwise. The college view is always final: an NCAAF deal never falls through to
   * the NFL chart.
   */
  college?: 'rest_of_season' | 'dynasty' | 'league_book'
  /** `ncaaf_college` dynasty only: every pick must be a Campus pick (Canton/Combined picks are NFL rookie picks with no college price). */
  collegePicks?: 'campus_only'
  /**
   * `sport_points` only: `league_book` grades five seasons + picks when the league prices on the dynasty
   * book (`leagueVariantFor(...).dynasty` — EFL always, Pirate unless confirmed redraft), this season
   * otherwise. Absent: the league type alone decides, as before.
   */
  seasons?: 'league_book'
  /** NFL only: the format post-processor applied to the grade. `c2c_campus` also tries the Campus-draft grade first. */
  format?: ConceptFormatRule
  /** The value basis, in words — what the grade is priced on. */
  basis: string
  /** `withheld` only: the sentence the manager reads. */
  reason?: string
  /** Set when the current basis looks wrong for the concept — a finding, not yet a decision. */
  review?: string
}

export type GradedConceptId = LeagueTypeId | LeagueConceptType

// ── The rules, named once ───────────────────────────────────────────────────────────────────────────

const CHART_BASIS =
  'NFL market chart for the league’s book (dynasty/redraft × 1QB/superflex), league scoring, held devy prospects priced, roster-spot credit for uneven deals.'

const CHART: ConceptGradingRule = { grader: 'market_chart', basis: CHART_BASIS }
const ZOMBIE: ConceptGradingRule = {
  grader: 'zombie',
  basis: 'Points over the best free agent for the same lineup slot over the weeks left; withheld when the league also carries players into future seasons.',
}
const GUILLOTINE: ConceptGradingRule = {
  grader: 'guillotine',
  basis: 'Points over the slot’s free agent across the weeks a team can expect to survive; FAAB at its purchasing power.',
}
const POINTS: ConceptGradingRule = {
  grader: 'sport_points',
  basis: 'Points (or the league’s categories) over replacement under the league’s own scoring, this season.',
}
const POINTS_DYNASTY: ConceptGradingRule = {
  grader: 'sport_points',
  basis: 'Five seasons of points over replacement plus rookie-draft picks (sport dynasty grade); NCAAB uses class years.',
}
const POINTS_MULTI_SEASON_REFUSED: ConceptGradingRule = {
  grader: 'sport_points',
  basis: 'Withheld inside the points grader (`multiSeasonFormatReason`): a season-only grade would ignore every later season.',
}
const COLLEGE_REDRAFT: ConceptGradingRule = {
  grader: 'ncaaf_college',
  college: 'rest_of_season',
  basis: 'College points over replacement for the rest of the season on the league’s stored projections; picks withheld.',
}
const COLLEGE_DYNASTY: ConceptGradingRule = {
  grader: 'ncaaf_college',
  college: 'dynasty',
  basis: 'Five seasons of college points over replacement plus picks priced from freshman class estimates.',
}
/** A college concept whose rosters reset: the college redraft basis, never the NFL chart. */
const COLLEGE_THIS_SEASON: ConceptGradingRule = {
  grader: 'ncaaf_college',
  college: 'rest_of_season',
  basis: 'College points over replacement for the rest of the season on the league’s stored projections, as in college redraft; picks withheld (the rosters do not carry over).',
}
/** A multi-season college concept with no format adjustment of its own: the college dynasty basis. */
const COLLEGE_MULTI_SEASON: ConceptGradingRule = {
  grader: 'ncaaf_college',
  college: 'dynasty',
  basis: 'Five seasons of college points over replacement plus picks priced from freshman class estimates, as in college dynasty.',
}

/** College Pirate and EFL: the league's book decides, exactly as outside football (fix 2). */
const COLLEGE_LEAGUE_BOOK: ConceptGradingRule = {
  grader: 'ncaaf_college',
  college: 'league_book',
  basis: 'On the dynasty book (EFL always; Pirate unless the commissioner confirmed a redraft base): five seasons of college points over replacement plus picks from freshman class estimates. On a redraft base: college points over replacement for the rest of the season; picks withheld.',
}

export const NCAAF_KEEPER_REASON =
  'This college keeper league’s keeper costs have no college price yet — the keeper option is only modelled on NFL draft values — so this deal is not graded rather than priced on NFL values.'
export const NCAAF_SALARY_CAP_REASON =
  'This college salary-cap league’s contracts have no college price yet — cap surplus is only modelled against NFL auction values — so this deal is not graded rather than priced on NFL values.'
export const NCAAF_UNCONFIRMED_REASON =
  'This college league’s type is not confirmed yet, and a college deal is graded on its type’s own basis, so this deal is not graded. Confirm the league type in League Settings.'

/** Pirate and EFL outside football: the league's book decides the seasons (2026-11-26). */
const POINTS_LEAGUE_BOOK: ConceptGradingRule = {
  grader: 'sport_points',
  seasons: 'league_book',
  basis: 'On the dynasty book (EFL always; Pirate unless the commissioner confirmed a redraft base): five seasons of points over replacement plus rookie-draft picks (sport dynasty grade). On a redraft base: points over replacement, this season.',
}

const pointsSports = (rule: ConceptGradingRule) => ({ NBA: rule, NCAAB: rule, NHL: rule, MLB: rule, SOCCER: rule })

/**
 * 🛑 THE CONTRACT. One entry per concept, one rule per sport. `satisfies` makes a missing concept or
 * sport a type error; the guard test makes it a red CI run with the file and line to edit.
 */
export const CONCEPT_GRADING_REGISTRY = {
  redraft: { NFL: CHART, NCAAF: COLLEGE_REDRAFT, ...pointsSports(POINTS) },
  dynasty: {
    NFL: CHART,
    NCAAF: COLLEGE_DYNASTY,
    ...pointsSports(POINTS_DYNASTY),
  },
  keeper: {
    NFL: { grader: 'market_chart', format: 'keeper_option', basis: `${CHART_BASIS} Then a one-season keeper option at 85% of surplus over the verified keeper cost.` },
    NCAAF: { grader: 'withheld', basis: 'Withheld: the keeper option is priced on NFL draft values, and no college form of it exists.', reason: NCAAF_KEEPER_REASON },
    ...pointsSports(POINTS_MULTI_SEASON_REFUSED),
  },
  salary_cap: {
    NFL: { grader: 'market_chart', format: 'salary_cap_surplus', basis: `${CHART_BASIS} Then surplus over present salary, priced from this season’s startup auction.` },
    NCAAF: { grader: 'withheld', basis: 'Withheld: cap surplus is priced against NFL auction values, and no college form of it exists.', reason: NCAAF_SALARY_CAP_REASON },
    ...pointsSports(POINTS_MULTI_SEASON_REFUSED),
  },
  c2c: {
    NFL: {
      grader: 'market_chart',
      format: 'c2c_campus',
      basis: `${CHART_BASIS} Campus-draft deals graded on the Campus division first (native leagues); campus players and combined picks re-priced from college points over replacement.`,
    },
    NCAAF: {
      ...COLLEGE_MULTI_SEASON,
      collegePicks: 'campus_only',
      basis: 'The Campus side of Campus-to-Canton: five seasons of college points over replacement plus Campus picks from freshman class estimates. A Canton or Combined pick (an NFL rookie pick) has no college price and is withheld.',
    },
    ...pointsSports(POINTS_MULTI_SEASON_REFUSED),
    NBA: { grader: 'sport_points', basis: 'Native leagues: the NBA Campus-to-Canton grade. Other platforms: withheld as multi-season.' },
  },
  devy: {
    NFL: { ...CHART, review: 'Devy NFL prices on the market chart with held prospects as devy options; the type itself adds nothing.' },
    NCAAF: COLLEGE_MULTI_SEASON,
    ...pointsSports(POINTS_MULTI_SEASON_REFUSED),
  },
  zombie: { NFL: ZOMBIE, NCAAF: ZOMBIE, NBA: ZOMBIE, NCAAB: ZOMBIE, NHL: ZOMBIE, MLB: ZOMBIE, SOCCER: ZOMBIE },
  guillotine: {
    NFL: GUILLOTINE,
    NCAAF: COLLEGE_THIS_SEASON,
    NBA: GUILLOTINE,
    NHL: GUILLOTINE,
    MLB: GUILLOTINE,
    // The daily-sport guillotine model: the points board put on the week, chop weeks from the season calendar.
    NCAAB: GUILLOTINE,
    SOCCER: GUILLOTINE,
  },
  best_ball: { NFL: CHART, NCAAF: COLLEGE_THIS_SEASON, ...pointsSports(POINTS) },
  survivor: { NFL: CHART, NCAAF: COLLEGE_THIS_SEASON, ...pointsSports(POINTS) },
  tournament: { NFL: CHART, NCAAF: COLLEGE_THIS_SEASON, ...pointsSports(POINTS) },
  big_brother: { NFL: CHART, NCAAF: COLLEGE_THIS_SEASON, ...pointsSports(POINTS) },
  pirate: {
    NFL: CHART,
    NCAAF: COLLEGE_LEAGUE_BOOK,
    ...pointsSports(POINTS_LEAGUE_BOOK),
  },
  survivor_guillotine: {
    NFL: { ...CHART, review: 'Survivor Guilly allows no trades, yet a deal reaching the grader is priced on the market chart, not on the guillotine rule.' },
    NCAAF: COLLEGE_THIS_SEASON,
    ...pointsSports(POINTS),
  },
  efl: {
    NFL: CHART,
    NCAAF: COLLEGE_LEAGUE_BOOK,
    ...pointsSports(POINTS_LEAGUE_BOOK),
  },
} as const satisfies Record<GradedConceptId, Record<LeagueSport, ConceptGradingRule>>

/**
 * League-type column values that are not concepts but are written by our own code, so leagues carry
 * them. Each grades exactly as it did before the registry — registered here so it is a decision.
 */
const LEGACY_COLUMN_RULES: Record<string, Record<LeagueSport, ConceptGradingRule>> = {
  /** `app/api/league/create` writes it for an imported league before a type is confirmed. */
  imported: {
    NFL: { ...CHART, review: 'An unconfirmed imported league prices on the chart its settings imply.' },
    // Never the NFL chart for a college league, and no college basis can be chosen without the type.
    NCAAF: { grader: 'withheld', basis: 'Withheld until the league type is confirmed: a college deal is graded on its type’s own college basis.', reason: NCAAF_UNCONFIRMED_REASON },
    ...pointsSports(POINTS),
  },
}

export const UNREGISTERED_CONCEPT_REASON = (type: string) =>
  `This league’s type (“${type}”) has no trade-grading rule yet, so this deal is not graded. Confirm the league type in League Settings.`

export type ResolvedConceptGrading = {
  /** The registry row the core rule came from; null when nothing is registered for the type. */
  key: string | null
  /** How the row was found. */
  via: 'concept' | 'dynasty_family' | 'legacy_column' | 'guillotine_variant' | 'unregistered'
  /** Which sub-grader grades the deal, and on what basis. */
  rule: ConceptGradingRule
  /** The NFL format post-processor, from the league's OWN type (a guillotine variant keeps its keeper costs). */
  format: ConceptFormatRule | null
}

function rowFor(type: string): { key: string; via: ResolvedConceptGrading['via']; row: Record<LeagueSport, ConceptGradingRule> } | null {
  if (Object.prototype.hasOwnProperty.call(CONCEPT_GRADING_REGISTRY, type)) {
    return { key: type, via: 'concept', row: CONCEPT_GRADING_REGISTRY[type as GradedConceptId] }
  }
  // Every sub-grader reads a dynasty league by substring (`isDynastyLeagueType`), so any such stored type dispatches as dynasty.
  if (type.includes('dynasty')) return { key: 'dynasty', via: 'dynasty_family', row: CONCEPT_GRADING_REGISTRY.dynasty }
  if (Object.prototype.hasOwnProperty.call(LEGACY_COLUMN_RULES, type)) return { key: type, via: 'legacy_column', row: LEGACY_COLUMN_RULES[type]! }
  return null
}

/**
 * Which sub-grader grades a deal in this league, and on what basis. PURE.
 *
 * `type` is `leagueTypeBasis(...).type` (already folded: a person's confirmation, the provider's
 * keeper/dynasty fact, the native C2C variant, the column, the `redraft` default). `variant` is the
 * raw `League.leagueVariant`: a `guillotine` variant is graded as guillotine wherever guillotine has
 * its own rule for the sport, whatever the base type — except Zombie, whose own rule always wins.
 */
export function resolveConceptGrading(args: { type: string | null | undefined; variant?: string | null; sport: string }): ResolvedConceptGrading {
  const type = String(args.type ?? '').trim().toLowerCase() || 'redraft'
  const variant = String(args.variant ?? '').trim().toLowerCase()
  const sport = String(args.sport ?? '').trim().toUpperCase() as LeagueSport
  const own = rowFor(type)
  const ownRule = own?.row[sport]
  const format = ownRule?.format ?? null

  if (type !== 'zombie' && variant === 'guillotine') {
    const guillotine = (CONCEPT_GRADING_REGISTRY.guillotine as Record<string, ConceptGradingRule>)[sport]
    if (guillotine?.grader === 'guillotine') return { key: 'guillotine', via: 'guillotine_variant', rule: guillotine, format }
  }
  if (!own || !ownRule) {
    return {
      key: null,
      via: 'unregistered',
      rule: { grader: 'withheld', basis: 'No grading rule is registered for this league type.', reason: UNREGISTERED_CONCEPT_REASON(type) },
      format: null,
    }
  }
  return { key: own.key, via: own.via, rule: ownRule, format }
}

/**
 * How the college grader (`./ncaafLeagueGrader.ts`) grades an NCAAF league of this type — read from the
 * registry so the one grader and the Trade Center console, which both build that grader, cannot disagree.
 * PURE. Null when another sub-grader owns the type (Zombie). `settings` decides a `league_book` row.
 */
export function collegeGradingFor(type: string | null | undefined, settings?: unknown):
  | { basis: 'rest_of_season' | 'dynasty'; campusPicksOnly: boolean }
  | { withheld: string }
  | null {
  const { rule } = resolveConceptGrading({ type, sport: 'NCAAF' })
  if (rule.grader === 'withheld') return { withheld: rule.reason ?? UNREGISTERED_CONCEPT_REASON(String(type ?? '')) }
  if (rule.grader !== 'ncaaf_college' || !rule.college) return null
  const basis = rule.college === 'league_book'
    ? leagueVariantFor(settings ?? null, String(type ?? '')).dynasty ? 'dynasty' : 'rest_of_season'
    : rule.college
  return { basis, campusPicksOnly: rule.collegePicks === 'campus_only' }
}

/**
 * Whether the points grader (`./sportPointsGrader.ts`) reads the seasons from the league's BOOK rather than
 * from its type — Pirate and EFL outside football. PURE.
 */
export function pointsSeasonsFromLeagueBook(type: string | null | undefined, sport: string): boolean {
  return resolveConceptGrading({ type, sport }).rule.seasons === 'league_book'
}

/** Every concept the registry grades — what the guard test walks. */
export function registeredGradedConcepts(): string[] {
  return Object.keys(CONCEPT_GRADING_REGISTRY)
}
