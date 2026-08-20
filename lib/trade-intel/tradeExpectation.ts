import type { LeagueContextEnvelope } from '@/lib/league-context/leagueContextService'
import type { MarketValuesPayload } from '@/lib/trade-intel/marketValueService'
import type { AfValue } from '@/lib/trade-intel/afValue'
import type { GradeLetter } from '@/lib/trade-intel/gradeScale'
import type { GradedTrade, TradeSideGrade } from '@/lib/trade-intel/sleeperTradeGradeService'

/**
 * tradeExpectation — what we can honestly say about a trade BEFORE it has
 * produced any points.
 *
 * The realized grade (sleeperTradeGradeService) can only speak once points
 * accrue: net = credited in − credited out. Before kickoff every net is 0, so
 * every trade lands mid-C and reports a tie. That is not "average", it is
 * "unknown", and the email used to launder one into the other.
 *
 * There is still plenty that is genuinely knowable on day one, and none of it
 * requires guessing the future:
 *
 *  - LEAGUE SETTINGS. Superflex, dynasty/keeper, team count and roster shape
 *    all change what an asset is worth. They come from the league itself.
 *  - SCORING SETTINGS. A TE-premium full-PPR league scores a tight end very
 *    differently from the generic PPR number a stat feed hands you. We rescore
 *    real stat lines with the league's own weights and say which mode we used.
 *  - PREVIOUS PERFORMANCE. Last season actually happened. Rescored under this
 *    league's rules, with games played shown so a 12-game season is never
 *    silently compared against a 17-game one.
 *  - ROSTER NEEDS. Whether a side now has enough bodies to fill its required
 *    starting slots is a fact about the roster, not a projection.
 *
 * Everything here is measured or absent. When an input is missing it is named
 * in `missing` and the corresponding number is null — never zero, because zero
 * is a claim and null is an admission.
 *
 * This module is pure. loadTradeExpectation() in tradeExpectationLoader does
 * the I/O so this stays testable without a network.
 */

export type AssetExpectation = {
  key: string
  name: string
  position: string | null
  isPick: boolean
  /** League-settings-aware market value (superflex/teams/ppr/dynasty). Null when unpriced. */
  marketValue: number | null
  /** How contested that valuation is, in the same units. Null when unknown. */
  valueStdDev: number | null
  /**
   * Cross-source disagreement in value units, from the AF Value blend.
   *
   * Preferred over valueStdDev: FantasyCalc's own deviation is a moving average
   * over TIME (15 and 2 on a real trade), so a gate built on it never fires.
   * Two independent sources disagreeing is a doubt worth acting on.
   */
  valueSpread: number | null
  /** Which valuation sources priced him. One entry means nothing corroborated it. */
  valueSources: string[]
  /** Agreement between those sources. Null when not blended. */
  valueConfidence: 'high' | 'moderate' | 'low' | null
  /** Last completed season, rescored with THIS league's scoring settings. */
  priorPoints: number | null
  priorGames: number | null
  priorPerGame: number | null
}

export type StarterGap = {
  position: string
  required: number
  rostered: number
}

/**
 * A letter for a trade that has not produced a point yet.
 *
 * Graded on VALUE, not on raw point totals. Totals structurally punish whoever
 * received fewer players — a 2-for-1 loses on totals even when it is the better
 * side, which is the entire reason consolidation trades exist. Market value
 * already prices scarcity, so a stud for two useful pieces reads correctly.
 *
 * Measured as a scale-free edge: (in − out) / mean(in, out). "Received 16% less
 * value than given" means the same thing in a deal between studs and a deal
 * between benchwarmers, where a raw point difference does not.
 *
 * NOTE this is a different quantity from the realized grade, which nets fantasy
 * points. Both answer "who won", before and after; they are not the same number
 * and the email never presents them as continuous.
 *
 * Confidence travels with the letter:
 *  - insideNoise: the edge does not exceed the combined uncertainty of the
 *    valuations themselves. A 500-point gap between players who each swing 400
 *    is not a gap, and is graded C rather than asserted as a win.
 *  - productionDisagrees: last season's totals point the other way. Two signals
 *    in opposite directions means neither is strong enough to assert alone.
 */
export type ProjectedGrade = {
  letter: GradeLetter
  /** Relative value edge; -0.16 = received 16% less value than given up. */
  valueEdge: number
  /** Raw market net, in feed value units. */
  valueNet: number
  /** Combined uncertainty of the assets involved, same units. Null when unknown. */
  uncertainty: number | null
  insideNoise: boolean
  productionDisagrees: boolean
  confidence: 'high' | 'moderate' | 'low'
}

/**
 * Bands on relative value edge. Wider than they look: dynasty valuations
 * routinely disagree by a few percent, so anything inside ±10% is a fair deal
 * rather than a win, and only a quarter-value gap is a rout.
 */
export const VALUE_EDGE_BANDS: { letter: GradeLetter; minEdge: number | null }[] = [
  { letter: 'A', minEdge: 0.25 },
  { letter: 'B', minEdge: 0.1 },
  { letter: 'C', minEdge: -0.1 },
  { letter: 'D', minEdge: -0.25 },
  { letter: 'F', minEdge: null },
]

export function letterForValueEdge(edge: number): GradeLetter {
  if (edge >= 0.25) return 'A'
  if (edge >= 0.1) return 'B'
  if (edge > -0.1) return 'C'
  if (edge > -0.25) return 'D'
  return 'F'
}

export type SideExpectation = {
  rosterId: number
  managerName: string
  assetsIn: AssetExpectation[]
  assetsOut: AssetExpectation[]
  marketIn: number | null
  marketOut: number | null
  marketNet: number | null
  priorIn: number | null
  priorOut: number | null
  priorNet: number | null
  /** Net change in rostered bodies per position, from this trade alone. */
  positionDelta: Record<string, number>
  /** Required starting slots this side cannot currently fill. Null when rosters unavailable. */
  starterGaps: StarterGap[] | null
  /** Letter from last season's production. Null when we have no prior production to score. */
  projected: ProjectedGrade | null
}

export type TradeExpectation = {
  /** False when nothing could be measured at all — the email then says only that. */
  available: boolean
  /** Plain-language league shape, e.g. "12-team superflex dynasty · full PPR · TE premium". */
  leagueNote: string
  priorSeason: string | null
  /** Whether prior points used the league's own weights or a format approximation. */
  scoringMode: 'league-scored' | 'format-approx' | null
  sides: SideExpectation[]
  /** Anything upstream refused to give us, named rather than papered over. */
  missing: string[]
}

const FLEX_SLOTS = new Set(['FLEX', 'SUPER_FLEX', 'REC_FLEX', 'WRRB_FLEX', 'IDP_FLEX'])
const NON_STARTER = new Set(['BN', 'TAXI', 'IR'])

/**
 * Human-readable league shape. This is the "league settings" the manager never
 * sees stated anywhere, and it is why two identical trades grade differently in
 * two leagues.
 */
export function describeLeague(context: {
  teams: number
  variant: { superflex: boolean; dynasty: boolean; keeper: boolean; bestBall: boolean; idp: boolean }
  scoring: { format: 'ppr' | 'half_ppr' | 'std'; settings: Record<string, number> }
}): string {
  const bits: string[] = []
  const shape = [
    `${context.teams}-team`,
    context.variant.superflex ? 'superflex' : null,
    context.variant.dynasty ? 'dynasty' : context.variant.keeper ? 'keeper' : 'redraft',
  ]
    .filter(Boolean)
    .join(' ')
  bits.push(shape)

  bits.push(
    context.scoring.format === 'ppr'
      ? 'full PPR'
      : context.scoring.format === 'half_ppr'
        ? 'half PPR'
        : 'standard scoring',
  )

  // TE premium is the single most commonly missed setting when judging a trade.
  const tePremium = context.scoring.settings.bonus_rec_te ?? 0
  if (tePremium > 0) bits.push(`TE premium (+${tePremium}/rec)`)
  if (context.variant.idp) bits.push('IDP')
  if (context.variant.bestBall) bits.push('best ball')

  return bits.join(' · ')
}

/** Required starters per position from roster_positions, flex slots kept separate. */
export function requiredStarters(rosterPositions: string[]): Record<string, number> {
  const required: Record<string, number> = {}
  for (const slot of rosterPositions) {
    if (NON_STARTER.has(slot)) continue
    const key = FLEX_SLOTS.has(slot) ? 'FLEX' : slot
    required[key] = (required[key] ?? 0) + 1
  }
  return required
}

function sumOrNull(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => typeof v === 'number')
  if (present.length === 0) return null
  return Math.round(present.reduce((a, b) => a + b, 0) * 10) / 10
}

function netOrNull(a: number | null, b: number | null): number | null {
  if (a == null && b == null) return null
  return Math.round(((a ?? 0) - (b ?? 0)) * 10) / 10
}

function deltaFor(assetsIn: AssetExpectation[], assetsOut: AssetExpectation[]): Record<string, number> {
  const delta: Record<string, number> = {}
  for (const a of assetsIn) {
    if (a.isPick || !a.position) continue
    delta[a.position] = (delta[a.position] ?? 0) + 1
  }
  for (const a of assetsOut) {
    if (a.isPick || !a.position) continue
    delta[a.position] = (delta[a.position] ?? 0) - 1
  }
  for (const k of Object.keys(delta)) if (delta[k] === 0) delete delta[k]
  return delta
}

/**
 * Starting slots a side cannot fill with the bodies it actually rosters.
 *
 * Deliberately counts bodies, not quality — "you have two TEs for one TE slot"
 * is a fact; "your TE room is bad" is an opinion we have not earned. Flex slots
 * are excluded because any skill position fills them, so a flex is never a hole.
 */
export function starterGapsFor(
  rosteredByPosition: Record<string, number>,
  required: Record<string, number>,
): StarterGap[] {
  const gaps: StarterGap[] = []
  for (const [position, count] of Object.entries(required)) {
    if (position === 'FLEX') continue
    const rostered = rosteredByPosition[position] ?? 0
    if (rostered < count) gaps.push({ position, required: count, rostered })
  }
  return gaps.sort((a, b) => a.position.localeCompare(b.position))
}

export type BuildParams = {
  trade: GradedTrade
  context: Pick<LeagueContextEnvelope, 'teams' | 'variant' | 'scoring' | 'roster'>
  marketValues: MarketValuesPayload | null
  /** Prior-season league-scored totals keyed by Sleeper player id. */
  priorSeason: {
    season: string
    /** Mode is per player; the trade's own assets decide what we claim. */
    byPlayerId: Record<
      string,
      { points: number; games: number | null; mode?: 'league-scored' | 'format-approx' }
    >
  } | null
  /** Rostered players by position per rosterId, AFTER the trade. Null when unavailable. */
  rosteredByPosition: Record<number, Record<string, number>> | null
  /** Round-average pick values keyed `${season}:${round}`. */
  pickValueLookup?: (season: string, round: number) => number | null
  /** Blended multi-source AF Values keyed by Sleeper id. Absent = single source only. */
  afValues?: Map<string, AfValue> | null
}

function assetFromPlayer(
  playerId: string,
  name: string,
  position: string | null,
  params: BuildParams,
): AssetExpectation {
  const entry = params.marketValues?.bySleeperId[playerId]
  // Blended AF Value wins when available; the single-source value is the
  // fallback so a DynastyProcess outage narrows confidence rather than removing
  // the player's price entirely.
  const blended = params.afValues?.get(playerId) ?? null
  const market = blended?.value ?? entry?.value ?? null
  const prior = params.priorSeason?.byPlayerId[playerId] ?? null
  const games = prior?.games ?? null
  return {
    key: playerId,
    name,
    position,
    isPick: false,
    marketValue: typeof market === 'number' ? market : null,
    valueStdDev: typeof entry?.stdDev === 'number' ? entry.stdDev : null,
    valueSpread: blended?.valueSpread ?? null,
    valueSources: blended?.sources ?? (entry ? ['fantasycalc'] : []),
    valueConfidence: blended?.confidence ?? null,
    priorPoints: prior ? Math.round(prior.points * 10) / 10 : null,
    priorGames: games,
    priorPerGame:
      prior && games && games > 0 ? Math.round((prior.points / games) * 10) / 10 : null,
  }
}

function assetFromPick(
  label: string,
  season: string,
  round: number,
  params: BuildParams,
): AssetExpectation {
  return {
    // Keyed by the label the grade payload already uses, so a renderer can look
    // an asset up without re-deriving it.
    key: label,
    name: label,
    position: null,
    isPick: true,
    // A pick has a market price long before it is drafted — that is the whole
    // point of trading one, and treating it as 0 is what made the old grade wrong.
    marketValue: params.pickValueLookup?.(season, round) ?? null,
    // The feed publishes no dispersion for picks; unknown, not zero.
    valueStdDev: null,
    valueSpread: null,
    // Picks are priced from one source only until their scales are fitted.
    valueSources: [],
    valueConfidence: null,
    priorPoints: null,
    priorGames: null,
    priorPerGame: null,
  }
}

/**
 * Combined uncertainty of a set of valuations.
 *
 * Root-sum-square rather than a plain sum: the individual valuations are close
 * enough to independent that adding their deviations linearly would overstate
 * the doubt badly on a multi-player side, and an overstated doubt silently
 * turns every real edge into "inside the noise".
 *
 * Null when no asset carried a deviation — unknown uncertainty must not read
 * as zero uncertainty.
 */
export function combinedUncertainty(deviations: (number | null)[]): number | null {
  const present = deviations.filter((d): d is number => typeof d === 'number' && d > 0)
  if (present.length === 0) return null
  return Math.round(Math.sqrt(present.reduce((acc, d) => acc + d * d, 0)) * 10) / 10
}

/**
 * Grade the trade on value.
 *
 * Null when nothing was priced — a letter with nothing behind it is the exact
 * failure this module exists to prevent.
 */
export function projectGrade(args: {
  marketIn: number | null
  marketOut: number | null
  priorNet: number | null
  uncertainty: number | null
}): ProjectedGrade | null {
  const { marketIn, marketOut } = args
  if (marketIn == null || marketOut == null) return null

  const valueNet = Math.round((marketIn - marketOut) * 10) / 10
  const scale = (marketIn + marketOut) / 2
  // Nothing of value moved either way; there is no edge to express.
  if (scale <= 0) return null
  const valueEdge = Math.round((valueNet / scale) * 1000) / 1000

  const insideNoise = args.uncertainty != null && Math.abs(valueNet) <= args.uncertainty
  const productionDisagrees =
    args.priorNet != null &&
    args.priorNet !== 0 &&
    valueNet !== 0 &&
    Math.sign(args.priorNet) !== Math.sign(valueNet)

  // An edge the valuations themselves cannot resolve is a fair deal, not a win.
  const letter = insideNoise ? 'C' : letterForValueEdge(valueEdge)

  const confidence: ProjectedGrade['confidence'] = insideNoise
    ? 'low'
    : productionDisagrees || args.uncertainty == null
      ? 'moderate'
      : 'high'

  return { letter, valueEdge, valueNet, uncertainty: args.uncertainty, insideNoise, productionDisagrees, confidence }
}

function sideFrom(side: TradeSideGrade, params: BuildParams): SideExpectation {
  const assetsIn: AssetExpectation[] = [
    ...side.playersIn.map((p) => assetFromPlayer(p.playerId, p.name, p.position, params)),
    ...side.picksIn.map((p) => assetFromPick(p.label, p.season, p.round, params)),
  ]
  const assetsOut: AssetExpectation[] = [
    ...side.playersOut.map((p) => assetFromPlayer(p.playerId, p.name, p.position, params)),
    ...side.picksOut.map((p) => assetFromPick(p.label, p.season, p.round, params)),
  ]

  const marketIn = sumOrNull(assetsIn.map((a) => a.marketValue))
  const marketOut = sumOrNull(assetsOut.map((a) => a.marketValue))
  const priorIn = sumOrNull(assetsIn.map((a) => a.priorPoints))
  const priorOut = sumOrNull(assetsOut.map((a) => a.priorPoints))

  const required = requiredStarters(params.context.roster.positions)
  const rostered = params.rosteredByPosition?.[side.rosterId] ?? null

  const marketNet = netOrNull(marketIn, marketOut)
  const priorNet = netOrNull(priorIn, priorOut)

  return {
    rosterId: side.rosterId,
    managerName: side.managerName,
    assetsIn,
    assetsOut,
    marketIn,
    marketOut,
    marketNet,
    priorIn,
    priorOut,
    priorNet,
    positionDelta: deltaFor(assetsIn, assetsOut),
    starterGaps: rostered ? starterGapsFor(rostered, required) : null,
    projected: projectGrade({
      marketIn,
      marketOut,
      priorNet,
      // Half the cross-source spread is the +/- on that asset. Fall back to the
      // feed's own deviation only when nothing corroborated the value.
      uncertainty: combinedUncertainty(
        [...assetsIn, ...assetsOut].map((a) =>
          a.valueSpread != null ? a.valueSpread / 2 : a.valueStdDev,
        ),
      ),
    }),
  }
}

export function buildTradeExpectation(params: BuildParams): TradeExpectation {
  const missing: string[] = []
  if (!params.marketValues) missing.push('market values unavailable')
  if (!params.priorSeason) missing.push('prior-season stats unavailable')
  if (!params.rosteredByPosition) missing.push('rosters unavailable — roster needs not assessed')

  const sides = params.trade.sides.map((s) => sideFrom(s, params))

  // Scoring mode reflects the assets in THIS trade, not the whole stat board.
  // Claim league-scored only when every traded player we priced genuinely was.
  let scoringMode: 'league-scored' | 'format-approx' | null = null
  if (params.priorSeason) {
    const modes: ('league-scored' | 'format-approx')[] = []
    for (const side of params.trade.sides) {
      for (const p of [...side.playersIn, ...side.playersOut]) {
        const hit = params.priorSeason.byPlayerId[p.playerId]
        if (hit?.mode) modes.push(hit.mode)
      }
    }
    scoringMode = modes.length === 0
      ? null
      : modes.every((m) => m === 'league-scored')
        ? 'league-scored'
        : 'format-approx'
  }

  // Say so when no asset here got a second opinion. A single-source value is
  // still a value, but nothing corroborated it and the reader deserves to know
  // which of those two situations they are looking at.
  const anyCorroborated = sides.some((s) =>
    [...s.assetsIn, ...s.assetsOut].some((a) => a.valueSources.length > 1),
  )
  if (params.marketValues && !anyCorroborated) {
    missing.push('second value source unavailable — values are single-source')
  }

  const measuredSomething = sides.some(
    (s) => s.marketNet != null || s.priorNet != null || s.starterGaps != null,
  )

  return {
    available: measuredSomething,
    leagueNote: describeLeague(params.context),
    priorSeason: params.priorSeason?.season ?? null,
    scoringMode,
    sides,
    missing,
  }
}
