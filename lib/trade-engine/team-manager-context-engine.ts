/**
 * Team & Manager Context Engine
 *
 * Consolidates team profile, manager profile, and play-style signals
 * into a unified context multiplier that adjusts the deterministic
 * trade score. AI may interpret but MUST NOT override these multipliers.
 *
 * Output: per-side ContextMultiplier applied to the deterministic score.
 */

import type {
  TradeDecisionContextV1,
  AssetValuation,
} from './trade-decision-context'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PlayStyle =
  | 'aggressive_trader'
  | 'conservative'
  | 'win_now'
  | 'rebuild_focused'
  | 'balanced'

type TeamStrength = 'elite' | 'strong' | 'average' | 'weak' | 'rebuilding'

interface TeamProfile {
  teamId: string
  teamName: string
  contenderTier: string
  /** Starter strength relative to league (0-100) */
  starterStrengthIndex: number
  /** Positional needs as strings */
  needs: string[]
  /** Positional surpluses */
  surplus: string[]
  /** Roster size */
  rosterSize: number
  /** Number of picks held */
  pickCount: number
  /** Young asset count (age ≤ 25) */
  youngAssetCount: number
  /** Computed team strength label */
  strength: TeamStrength
  /** Total asset value */
  totalValue: number
}

interface ManagerProfile {
  /** Detected play style */
  playStyle: PlayStyle
  /** Trade frequency label */
  tradeFrequency: 'high' | 'medium' | 'low' | 'unknown'
  /** Risk tolerance (0-1, higher = more risk-tolerant) */
  riskTolerance: number
  /** Overpay threshold — how much they're willing to overpay (0-1) */
  overpayThreshold: number
  /** Sample size of historical trades */
  sampleSize: number
  /** Position bias map */
  positionBias: Record<string, number>
  /** Whether manager prefers consolidation (fewer, better pieces) */
  prefersConsolidation: boolean
  /** Fairness tolerance (how much imbalance they accept) */
  fairnessTolerance: number
}

interface NeedFitResult {
  /** How many of this side's needs are filled by incoming assets */
  needsFilled: number
  /** Total needs count */
  totalNeeds: number
  /** Fit score 0-1 */
  fitScore: number
  /** Whether the best incoming asset is a starter upgrade */
  starterUpgrade: boolean
  /** Positions filled */
  positionsFilled: string[]
}

interface ContextMultiplier {
  /** Overall multiplier applied to the side's perceived trade value (0.7 - 1.3) */
  multiplier: number
  /** Breakdown of adjustments */
  adjustments: ContextAdjustment[]
  /** Human-readable summary */
  summary: string
}

interface ContextAdjustment {
  factor: string
  /** Positive = value boost, negative = value reduction */
  delta: number
  reason: string
  category: 'team' | 'manager' | 'fit' | 'style'
}

interface TeamManagerContextResult {
  sideA: {
    teamProfile: TeamProfile
    managerProfile: ManagerProfile
    needFit: NeedFitResult
    contextMultiplier: ContextMultiplier
  }
  sideB: {
    teamProfile: TeamProfile
    managerProfile: ManagerProfile
    needFit: NeedFitResult
    contextMultiplier: ContextMultiplier
  }
  /** Style match analysis between the two managers */
  styleMatch: StyleMatchResult
  /** Combined prompt text for AI injection */
  promptBlock: string
}

interface StyleMatchResult {
  /** Whether trading styles are compatible */
  compatible: boolean
  /** Whether disagreement on fairness is likely */
  fairnessGapRisk: boolean
  /** Counter-trade style hints */
  counterTradeHints: string[]
  /** Description */
  description: string
}

// ---------------------------------------------------------------------------
// Team Profile
// ---------------------------------------------------------------------------

function computeTeamStrength(
  starterStrengthIndex: number,
  contenderTier: string,
): TeamStrength {
  if (contenderTier === 'champion') return 'elite'
  if (starterStrengthIndex >= 75 || contenderTier === 'contender') return 'strong'
  if (starterStrengthIndex >= 45 || contenderTier === 'middle') return 'average'
  if (contenderTier === 'rebuild') return 'rebuilding'
  return 'weak'
}

function buildTeamProfile(
  side: TradeDecisionContextV1['sideA'],
): TeamProfile {
  return {
    teamId: side.teamId,
    teamName: side.teamName,
    contenderTier: side.contenderTier,
    starterStrengthIndex: side.rosterComposition.starterStrengthIndex,
    needs: side.needs,
    surplus: side.surplus,
    rosterSize: side.rosterComposition.size,
    pickCount: side.rosterComposition.pickCount,
    youngAssetCount: side.rosterComposition.youngAssetCount,
    strength: computeTeamStrength(
      side.rosterComposition.starterStrengthIndex,
      side.contenderTier,
    ),
    totalValue: side.totalValue,
  }
}

// ---------------------------------------------------------------------------
// Manager Profile
// ---------------------------------------------------------------------------

function detectPlayStyle(
  prefs: TradeDecisionContextV1['sideA']['managerPreferences'],
  contenderTier: string,
): PlayStyle {
  if (!prefs || prefs.sampleSize < 3) {
    // Infer from team state
    if (contenderTier === 'champion' || contenderTier === 'contender') return 'win_now'
    if (contenderTier === 'rebuild') return 'rebuild_focused'
    return 'balanced'
  }

  const { riskTolerance, starterPremium, positionBias } = prefs

  // Aggressive: high risk tolerance + high trade count + not picky about fairness
  if (riskTolerance > 0.4 && prefs.fairnessTolerance > 0.3) return 'aggressive_trader'

  // Conservative: low risk + low overpay + low fairness tolerance
  if (riskTolerance < -0.2 && prefs.overpayThreshold < 0.1) return 'conservative'

  // Win-now: high starter premium + contender tier
  if (starterPremium > 0.3 && (contenderTier === 'contender' || contenderTier === 'champion')) {
    return 'win_now'
  }

  // Rebuild-focused: high pick bias + youth preference
  if (positionBias.PICK > 0.15 && contenderTier === 'rebuild') return 'rebuild_focused'

  return 'balanced'
}

function inferTradeFrequency(
  sampleSize: number,
): 'high' | 'medium' | 'low' | 'unknown' {
  if (sampleSize === 0) return 'unknown'
  if (sampleSize >= 8) return 'high'
  if (sampleSize >= 4) return 'medium'
  return 'low'
}

function buildManagerProfile(
  prefs: TradeDecisionContextV1['sideA']['managerPreferences'],
  contenderTier: string,
): ManagerProfile {
  if (!prefs) {
    return {
      playStyle: detectPlayStyle(null, contenderTier),
      tradeFrequency: 'unknown',
      riskTolerance: 0,
      overpayThreshold: 0,
      sampleSize: 0,
      positionBias: { QB: 0, RB: 0, WR: 0, TE: 0, PICK: 0 },
      prefersConsolidation: false,
      fairnessTolerance: 0,
    }
  }

  return {
    playStyle: detectPlayStyle(prefs, contenderTier),
    tradeFrequency: inferTradeFrequency(prefs.sampleSize),
    riskTolerance: prefs.riskTolerance,
    overpayThreshold: prefs.overpayThreshold,
    sampleSize: prefs.sampleSize,
    positionBias: prefs.positionBias,
    prefersConsolidation: prefs.consolidationBias > 0.4,
    fairnessTolerance: prefs.fairnessTolerance,
  }
}

// ---------------------------------------------------------------------------
// Need Fit
// ---------------------------------------------------------------------------

function computeNeedFit(
  receivingSide: TradeDecisionContextV1['sideA'],
  incomingAssets: AssetValuation[],
): NeedFitResult {
  const needsLower = new Set(receivingSide.needs.map(n => n.toLowerCase()))
  const positionsFilled: string[] = []
  let starterUpgrade = false

  for (const asset of incomingAssets) {
    const pos = asset.position.toLowerCase()
    if (needsLower.has(pos)) {
      positionsFilled.push(asset.position)
      // A starter upgrade if asset is high-value and fills a need
      if (asset.marketValue >= 4000) {
        starterUpgrade = true
      }
    }
  }

  const needsFilled = positionsFilled.length
  const totalNeeds = receivingSide.needs.length
  const fitScore = totalNeeds > 0 ? Math.min(1, needsFilled / totalNeeds) : 0.5

  return { needsFilled, totalNeeds, fitScore, starterUpgrade, positionsFilled }
}

// ---------------------------------------------------------------------------
// Context Multiplier Computation
// ---------------------------------------------------------------------------

function computeContextMultiplier(
  teamProfile: TeamProfile,
  managerProfile: ManagerProfile,
  needFit: NeedFitResult,
  incomingAssets: AssetValuation[],
  contenderTier: string,
): ContextMultiplier {
  const adjustments: ContextAdjustment[] = []
  let totalDelta = 0

  // --- TEAM PROFILE adjustments ---

  // Contender receiving win-now pieces → boost
  const isContender = contenderTier === 'contender' || contenderTier === 'champion'
  const isRebuilder = contenderTier === 'rebuild'
  const incomingPrimeVets = incomingAssets.filter(
    a => a.type === 'PLAYER' && a.age != null && a.age >= 26 && a.age <= 30,
  )
  const incomingYouth = incomingAssets.filter(
    a => a.type === 'PLAYER' && a.age != null && a.age <= 25,
  )
  const incomingPicks = incomingAssets.filter(a => a.type === 'PICK')

  if (isContender && incomingPrimeVets.length > 0) {
    const boost = Math.min(0.10, incomingPrimeVets.length * 0.05)
    adjustments.push({
      factor: 'contender_win_now_boost',
      delta: boost,
      reason: `Contender acquires ${incomingPrimeVets.length} prime-age player(s) — win-now value boost`,
      category: 'team',
    })
    totalDelta += boost
  }

  if (isRebuilder && incomingYouth.length > 0) {
    const boost = Math.min(0.08, incomingYouth.length * 0.04)
    adjustments.push({
      factor: 'rebuilder_youth_boost',
      delta: boost,
      reason: `Rebuilder acquires ${incomingYouth.length} young asset(s) — future value boost`,
      category: 'team',
    })
    totalDelta += boost
  }

  if (isRebuilder && incomingPicks.length > 0) {
    const boost = Math.min(0.08, incomingPicks.length * 0.03)
    adjustments.push({
      factor: 'rebuilder_pick_boost',
      delta: boost,
      reason: `Rebuilder acquires ${incomingPicks.length} draft pick(s)`,
      category: 'team',
    })
    totalDelta += boost
  }

  // Contender acquiring mostly picks/youth → mismatch penalty
  if (isContender && incomingPicks.length >= 2 && incomingPrimeVets.length === 0) {
    const penalty = -0.06
    adjustments.push({
      factor: 'contender_rebuild_mismatch',
      delta: penalty,
      reason: `Contender acquiring picks/youth instead of win-now assets — window mismatch`,
      category: 'team',
    })
    totalDelta += penalty
  }

  // Rebuilder acquiring aging vets → mismatch penalty
  const incomingDecline = incomingAssets.filter(
    a => a.type === 'PLAYER' && a.age != null && a.age >= 29,
  )
  if (isRebuilder && incomingDecline.length > 0 && incomingYouth.length === 0) {
    const penalty = -0.08
    adjustments.push({
      factor: 'rebuilder_aging_mismatch',
      delta: penalty,
      reason: `Rebuilder acquiring ${incomingDecline.length} aging player(s) with no youth — rebuild mismatch`,
      category: 'team',
    })
    totalDelta += penalty
  }

  // --- NEED FIT adjustments ---

  if (needFit.starterUpgrade) {
    const boost = 0.08
    adjustments.push({
      factor: 'starter_need_fill',
      delta: boost,
      reason: `Fills starting roster need with high-value asset (${needFit.positionsFilled.join(', ')})`,
      category: 'fit',
    })
    totalDelta += boost
  } else if (needFit.needsFilled > 0) {
    const boost = Math.min(0.05, needFit.needsFilled * 0.025)
    adjustments.push({
      factor: 'need_fill',
      delta: boost,
      reason: `Fills ${needFit.needsFilled} positional need(s)`,
      category: 'fit',
    })
    totalDelta += boost
  }

  // Bench stash penalty — incoming assets that don't fill any need
  const needsSet = new Set(teamProfile.needs.map(n => n.toLowerCase()))
  const benchStashCount = incomingAssets.filter(a => {
    if (a.type !== 'PLAYER') return false
    return !needsSet.has(a.position.toLowerCase())
  }).length

  if (benchStashCount >= 2 && needFit.needsFilled === 0) {
    const penalty = -0.05
    adjustments.push({
      factor: 'bench_stash_penalty',
      delta: penalty,
      reason: `${benchStashCount} incoming player(s) don't fill any positional need — bench stash`,
      category: 'fit',
    })
    totalDelta += penalty
  }

  // --- MANAGER STYLE adjustments ---

  // Aggressive trader with high risk tolerance → slight fairness boost (they accept lopsided deals)
  if (managerProfile.playStyle === 'aggressive_trader') {
    const boost = 0.03
    adjustments.push({
      factor: 'aggressive_trader_tolerance',
      delta: boost,
      reason: `Manager has aggressive trade history — higher tolerance for value gaps`,
      category: 'manager',
    })
    totalDelta += boost
  }

  // Conservative manager → tighter fairness requirement (penalty if deal is lopsided against them)
  if (managerProfile.playStyle === 'conservative' && managerProfile.fairnessTolerance < 0.15) {
    const penalty = -0.03
    adjustments.push({
      factor: 'conservative_fairness_tightening',
      delta: penalty,
      reason: `Manager is conservative — stricter fairness perception`,
      category: 'manager',
    })
    totalDelta += penalty
  }

  // Consolidation preference — boost if deal consolidates assets
  if (managerProfile.prefersConsolidation && incomingAssets.length < 2) {
    const boost = 0.03
    adjustments.push({
      factor: 'consolidation_preference',
      delta: boost,
      reason: `Manager prefers consolidation — receiving fewer, higher-value pieces`,
      category: 'style',
    })
    totalDelta += boost
  }

  // Strong starter strength → less urgency for upgrades
  if (teamProfile.starterStrengthIndex >= 80 && needFit.needsFilled === 0) {
    const penalty = -0.03
    adjustments.push({
      factor: 'already_strong_penalty',
      delta: penalty,
      reason: `Roster already strong (SSI: ${teamProfile.starterStrengthIndex}) — less marginal impact from incoming assets`,
      category: 'team',
    })
    totalDelta += penalty
  }

  // Clamp total delta to [-0.30, +0.30]
  totalDelta = Math.max(-0.30, Math.min(0.30, totalDelta))
  const multiplier = Math.round((1.0 + totalDelta) * 1000) / 1000

  const summary = adjustments.length > 0
    ? adjustments.map(a => `${a.delta > 0 ? '+' : ''}${(a.delta * 100).toFixed(0)}% ${a.reason}`).join('; ')
    : 'No contextual adjustments'

  return { multiplier, adjustments, summary }
}

// ---------------------------------------------------------------------------
// Style Match
// ---------------------------------------------------------------------------

function computeStyleMatch(
  mgrA: ManagerProfile,
  mgrB: ManagerProfile,
  teamA: TeamProfile,
  teamB: TeamProfile,
): StyleMatchResult {
  const hints: string[] = []
  let compatible = true
  let fairnessGapRisk = false

  // Check if styles align or conflict
  const bothAggressive = mgrA.playStyle === 'aggressive_trader' && mgrB.playStyle === 'aggressive_trader'
  const oneConservative = mgrA.playStyle === 'conservative' || mgrB.playStyle === 'conservative'
  const windowOpposite =
    (mgrA.playStyle === 'win_now' && mgrB.playStyle === 'rebuild_focused') ||
    (mgrA.playStyle === 'rebuild_focused' && mgrB.playStyle === 'win_now')

  if (windowOpposite) {
    hints.push('Classic window trade: contender gets production, rebuilder gets future value — frame counter-offers around this axis')
    compatible = true
  }

  if (bothAggressive) {
    hints.push('Both managers are aggressive traders — bigger moves are possible, but competition for value is high')
    compatible = true
  }

  if (oneConservative) {
    const conservative = mgrA.playStyle === 'conservative' ? 'Side A' : 'Side B'
    const otherAggressive =
      (mgrA.playStyle === 'conservative' && mgrB.playStyle === 'aggressive_trader') ||
      (mgrB.playStyle === 'conservative' && mgrA.playStyle === 'aggressive_trader')
    if (otherAggressive) {
      compatible = false
      hints.push(`${conservative} is conservative vs an aggressive counterpart — high friction risk`)
    } else {
      hints.push(`${conservative} is conservative — keep counter-offers close to market value to avoid rejection`)
    }
    fairnessGapRisk = true
  }

  // Fairness gap risk
  const toleranceDiff = Math.abs(mgrA.fairnessTolerance - mgrB.fairnessTolerance)
  if (toleranceDiff > 0.3) {
    fairnessGapRisk = true
    hints.push('Large fairness tolerance gap between managers — one side may perceive the deal as unfair even if data says otherwise')
  }

  // Position bias alignment
  const posKeys = ['QB', 'RB', 'WR', 'TE', 'PICK'] as const
  for (const pos of posKeys) {
    const aBias = mgrA.positionBias[pos] ?? 0
    const bBias = mgrB.positionBias[pos] ?? 0
    // If one side undervalues a position the other overvalues → opportunity
    if (aBias > 0.15 && bBias < -0.1) {
      hints.push(`Side A overvalues ${pos}, Side B undervalues it — potential counter axis`)
    }
    if (bBias > 0.15 && aBias < -0.1) {
      hints.push(`Side B overvalues ${pos}, Side A undervalues it — potential counter axis`)
    }
  }

  // Consolidation mismatch
  if (mgrA.prefersConsolidation !== mgrB.prefersConsolidation) {
    const consolidator = mgrA.prefersConsolidation ? 'Side A' : 'Side B'
    hints.push(`${consolidator} prefers consolidation — counter with 2-for-1 or 3-for-1 structures`)
  }

  const description = windowOpposite
    ? 'Window-aligned trade between contender and rebuilder — strong compatibility'
    : compatible
      ? 'Trading styles are compatible'
      : 'Style mismatch may complicate negotiations'

  return {
    compatible,
    fairnessGapRisk,
    counterTradeHints: hints.slice(0, 5),
    description,
  }
}

// ---------------------------------------------------------------------------
// Prompt Formatting
// ---------------------------------------------------------------------------

function formatContextForPrompt(result: TeamManagerContextResult): string {
  const lines: string[] = []

  lines.push('=== TEAM & MANAGER CONTEXT INTELLIGENCE (deterministic — AI must not override) ===')
  lines.push('')

  for (const [label, side] of [['SIDE A', result.sideA], ['SIDE B', result.sideB]] as const) {
    const { teamProfile: tp, managerProfile: mp, needFit: nf, contextMultiplier: cm } = side

    lines.push(`--- ${label}: ${tp.teamName} ---`)
    lines.push(`Team: ${tp.strength} (${tp.contenderTier}) | SSI: ${tp.starterStrengthIndex} | Value: ${tp.totalValue}`)
    lines.push(`Roster: ${tp.rosterSize} players, ${tp.pickCount} picks, ${tp.youngAssetCount} young assets`)
    if (tp.needs.length) lines.push(`Needs: ${tp.needs.join(', ')}`)
    if (tp.surplus.length) lines.push(`Surplus: ${tp.surplus.join(', ')}`)
    lines.push(`Manager: ${mp.playStyle} | frequency=${mp.tradeFrequency} | risk=${mp.riskTolerance.toFixed(2)} | samples=${mp.sampleSize}`)
    lines.push(`Need fit: ${nf.needsFilled}/${nf.totalNeeds} filled (score: ${nf.fitScore.toFixed(2)})${nf.starterUpgrade ? ' [STARTER UPGRADE]' : ''}`)
    lines.push(`Context multiplier: ${cm.multiplier.toFixed(3)}x — ${cm.summary}`)
    lines.push('')
  }

  lines.push('--- STYLE MATCH ---')
  lines.push(result.styleMatch.description)
  if (result.styleMatch.fairnessGapRisk) {
    lines.push('[FAIRNESS GAP RISK] Managers have different fairness perceptions')
  }
  if (result.styleMatch.counterTradeHints.length) {
    lines.push('Counter-trade hints:')
    for (const hint of result.styleMatch.counterTradeHints) {
      lines.push(`  - ${hint}`)
    }
  }

  lines.push('')
  lines.push('RULES FOR AI:')
  lines.push('- Context multipliers are AUTHORITATIVE. Factor them into your confidence and reasoning.')
  lines.push('- Use play style data to tailor counter_suggestions to each manager.')
  lines.push('- If fairnessGapRisk is flagged, mention it in risk_flags.')
  lines.push('- Reference specific needs/surplus in key_factors when relevant.')
  lines.push('=== END TEAM & MANAGER CONTEXT ===')

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Main Entry Point
// ---------------------------------------------------------------------------

export function computeTeamManagerContext(
  ctx: TradeDecisionContextV1,
): TeamManagerContextResult {
  const teamA = buildTeamProfile(ctx.sideA)
  const teamB = buildTeamProfile(ctx.sideB)

  const mgrA = buildManagerProfile(ctx.sideA.managerPreferences, ctx.sideA.contenderTier)
  const mgrB = buildManagerProfile(ctx.sideB.managerPreferences, ctx.sideB.contenderTier)

  // Side A receives Side B's assets
  const needFitA = computeNeedFit(ctx.sideA, ctx.sideB.assets)
  // Side B receives Side A's assets
  const needFitB = computeNeedFit(ctx.sideB, ctx.sideA.assets)

  const ctxMultA = computeContextMultiplier(teamA, mgrA, needFitA, ctx.sideB.assets, ctx.sideA.contenderTier)
  const ctxMultB = computeContextMultiplier(teamB, mgrB, needFitB, ctx.sideA.assets, ctx.sideB.contenderTier)

  const styleMatch = computeStyleMatch(mgrA, mgrB, teamA, teamB)

  const result: TeamManagerContextResult = {
    sideA: {
      teamProfile: teamA,
      managerProfile: mgrA,
      needFit: needFitA,
      contextMultiplier: ctxMultA,
    },
    sideB: {
      teamProfile: teamB,
      managerProfile: mgrB,
      needFit: needFitB,
      contextMultiplier: ctxMultB,
    },
    styleMatch,
    promptBlock: '', // populated below
  }

  result.promptBlock = formatContextForPrompt(result)

  return result
}
