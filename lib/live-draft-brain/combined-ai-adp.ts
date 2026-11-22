import { normalizeToSupportedSport } from '@/lib/sport-scope'
import type { CombinedAdpInputs, LiveDraftBrainContext } from './types'

interface CombinedAdpResult {
  externalAdp: number | null
  siteAdp: number | null
  combinedAdp: number
  trend: string
  trendArrow: 'up' | 'down' | 'flat'
  confidence: number
  contextLabel: string
  sourceCoverageNote: string
}

const DEFAULT_WEIGHTS = { external: 0.55, site: 0.35, context: 0.1 } as const

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

function validAdp(n: number | null | undefined): n is number {
  return n != null && Number.isFinite(n) && n > 0 && n < 9000
}

/** Exclude ADP values from sources that do not match the current draft context. */
export function resolveComparableAdpValues(input: CombinedAdpInputs): {
  external: number | null
  site: number | null
} {
  const sport = String(input.brainContext?.sport ?? 'NFL')
  const normSport = normalizeToSupportedSport(sport)

  let extOk =
    input.externalSource == null ||
    normalizeToSupportedSport(input.externalSource.sport) === normSport
  if (input.externalSource && input.externalSource.matchesContext === false) extOk = false

  let siteOk =
    input.siteSource == null || normalizeToSupportedSport(input.siteSource.sport) === normSport
  if (input.siteSource && input.siteSource.matchesContext === false) siteOk = false

  const external = validAdp(input.externalAdp) && extOk ? input.externalAdp : null
  const site = validAdp(input.siteAdp) && siteOk ? input.siteAdp : null

  return { external, site }
}

function baseAdpForContext(external: number | null, site: number | null): number {
  if (validAdp(external) && validAdp(site)) return (external + site) / 2
  if (validAdp(external)) return external
  if (validAdp(site)) return site
  return 120
}

/**
 * Context anchor (ADP-scale overall pick #). Lower = earlier expected draft position.
 */
export function computeContextAnchorAdp(args: CombinedAdpInputs, baseAdp: number): number {
  const ctx = args.brainContext
  const pos = String(args.playerMeta?.position ?? '').toUpperCase()
  const sport = ctx ? normalizeToSupportedSport(String(ctx.sport)) : 'NFL'
  const nflLike = sport === 'NFL' || sport === 'NCAAF'

  let anchor = baseAdp

  if (nflLike && ctx?.isSuperflex && pos === 'QB') anchor -= 6
  if (nflLike && ctx?.isTePremium && pos === 'TE') anchor -= 4

  const league = ctx?.leagueType ?? 'redraft'
  if (league === 'dynasty') {
    if (args.playerMeta?.isRookie) anchor -= 5
    else if (args.playerMeta?.age != null && args.playerMeta.age >= 28) anchor -= 3
  }

  const phase = ctx?.startupVsRookie ?? 'na'
  if (phase === 'rookie' && args.playerMeta?.isRookie) anchor -= 8
  if (phase === 'supplemental') anchor += 5
  if (phase === 'dispersal') {
    if (args.playerMeta?.age != null && args.playerMeta.age >= 26) anchor -= 4
    if (args.playerMeta?.isRookie) anchor += 2
  }
  if (phase === 'startup' && league === 'dynasty' && args.playerMeta?.isRookie) anchor -= 3

  if (String(ctx?.draftFormat).toUpperCase() === 'AUCTION') {
    anchor += (args.auctionInflationScore ?? 0) * 8
  }

  anchor -= ((args.scarcitySurge ?? 0) / 100) * 12
  anchor -= (args.siteTrendMomentum ?? 0) * 5

  return clamp(anchor, 1, 500)
}

function buildContextLabel(ctx?: LiveDraftBrainContext): string {
  if (!ctx) return 'Unknown context'
  const sport = normalizeToSupportedSport(String(ctx.sport))
  const fmt = String(ctx.draftFormat ?? 'CUSTOM')
  const league = ctx.leagueType ?? 'redraft'
  const sf = ctx.isSuperflex ? 'SF' : '1QB'
  const tep = ctx.isTePremium ? 'TE+' : ''
  const phase = ctx.startupVsRookie && ctx.startupVsRookie !== 'na' ? ctx.startupVsRookie : null
  const bits = [sport, league, fmt, phase, `${sf}${tep ? ` · ${tep}` : ''}`].filter(Boolean)
  return bits.join(' · ')
}

function formatTrendString(
  delta: number | undefined,
  momentum: number | undefined
): { trend: string; arrow: CombinedAdpResult['trendArrow'] } {
  const d = delta ?? 0
  let arrow: CombinedAdpResult['trendArrow'] = 'flat'
  if (d < -2) arrow = 'up'
  else if (d > 2) arrow = 'down'

  let trend: string
  if (!Number.isFinite(d) || (d === 0 && !(momentum ?? 0))) {
    trend = 'Flat vs consensus'
  } else if (d < -0.5) {
    trend = `Rising on site (≈ ${Math.abs(d).toFixed(1)} slots vs external)`
  } else if (d > 0.5) {
    trend = `Falling on site (≈ ${d.toFixed(1)} slots vs external)`
  } else {
    trend = 'Aligned external vs site'
  }
  if (momentum != null && Math.abs(momentum) > 0.2) {
    trend += momentum > 0 ? ' · site momentum ↑' : ' · site momentum ↓'
  }
  return { trend, arrow }
}

function computeConfidence(input: CombinedAdpInputs, hasExternal: boolean, hasSite: boolean): number {
  const siteConf = input.siteSource?.coverageConfidence
  const sample = input.siteSource?.sampleSize ?? 0
  let base = 50
  if (hasExternal && hasSite) base = 88
  else if (hasExternal || hasSite) base = 64

  if (typeof siteConf === 'number' && Number.isFinite(siteConf)) {
    base = base * 0.65 + siteConf * 100 * 0.35
  } else if (sample > 80) base += 8
  else if (sample > 20) base += 4
  else if (sample > 0 && sample < 8) base -= 12

  if (input.siteSource?.matchesContext === false || input.externalSource?.matchesContext === false) {
    base -= 15
  }
  if (!hasExternal && !hasSite) base = 28

  return clamp(Math.round(base), 5, 98)
}

/**
 * Combined AI ADP — comparable contexts only; mismatched sources are excluded from the blend.
 */
export function blendCombinedAdp(
  input: CombinedAdpInputs,
  weights: { external: number; site: number; context: number } = {
    external: DEFAULT_WEIGHTS.external,
    site: DEFAULT_WEIGHTS.site,
    context: DEFAULT_WEIGHTS.context,
  }
): CombinedAdpResult {
  const { external, site } = resolveComparableAdpValues(input)
  const hasE = validAdp(external)
  const hasS = validAdp(site)

  const base = baseAdpForContext(external, site)
  const explicitContext = input.contextAdjustmentAdp ?? input.formatAdjustment
  const contextTerm =
    typeof explicitContext === 'number' && Number.isFinite(explicitContext)
      ? explicitContext
      : input.brainContext && input.playerMeta
        ? computeContextAnchorAdp(input, base)
        : base

  let combined: number
  if (hasE && hasS) {
    combined = weights.external * external! + weights.site * site! + weights.context * contextTerm
  } else if (hasE && !hasS) {
    combined = 0.9 * external! + 0.1 * contextTerm
  } else if (!hasE && hasS) {
    combined = 0.9 * site! + 0.1 * contextTerm
  } else {
    combined = contextTerm < 9000 ? contextTerm : 999
  }

  const delta =
    input.trendDeltaSlots != null && Number.isFinite(input.trendDeltaSlots)
      ? input.trendDeltaSlots
      : hasE && hasS
        ? site! - external!
        : 0

  const { trend, arrow } = formatTrendString(delta, input.siteTrendMomentum)

  const confidence = computeConfidence(input, hasE, hasS)
  const contextLabel = buildContextLabel(input.brainContext)

  let sourceCoverageNote = 'Blended external + AllFantasy site ADP (comparable context).'
  if (hasE && !hasS) sourceCoverageNote = 'External ADP weighted; site thin or filtered for this context.'
  if (!hasE && hasS) sourceCoverageNote = 'AllFantasy site ADP weighted; external missing or filtered.'
  if (!hasE && !hasS) sourceCoverageNote = 'No comparable ADP rows — context anchor only.'
  if (input.externalSource?.matchesContext === false) {
    sourceCoverageNote = 'External source excluded (context mismatch); site + context used where available.'
  }
  if (input.siteSource?.matchesContext === false) {
    sourceCoverageNote = 'Site ADP excluded (context mismatch); external + context used where available.'
  }

  return {
    externalAdp: hasE ? external : input.externalAdp,
    siteAdp: hasS ? site : input.siteAdp,
    combinedAdp: Math.round(combined * 10) / 10,
    trend,
    trendArrow: arrow,
    confidence,
    contextLabel,
    sourceCoverageNote,
  }
}
