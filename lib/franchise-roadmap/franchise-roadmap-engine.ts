/**
 * Franchise Roadmap Engine — Core Deterministic Planner
 *
 * Computes multi-year franchise strategy from roster, picks, and league
 * context. Produces phase classification, championship window detection,
 * year-by-year plans, and asset strategy. Pure deterministic. <30ms.
 *
 * Reuses: sport-tuning-registry (age curves), league-intelligence patterns.
 */

import { getAgeCurve, computeAgeMultiplier } from '@/lib/trade-engine/sport-tuning-registry'
import {
  computeDynastyExtension,
  computeDevyExtension,
  computeC2CExtension,
} from './franchise-mode-adapters'
import type {
  FranchiseRoadmapInput,
  FranchiseRoadmap,
  FranchisePhase,
  ChampionshipWindow,
  WindowStrength,
  YearPlan,
  AssetStrategy,
  RoadmapPlayer,
} from './franchise-roadmap-types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

function avgAge(players: RoadmapPlayer[]): number {
  const ages = players.map(p => p.age).filter((a): a is number => a != null)
  return ages.length > 0 ? ages.reduce((s, a) => s + a, 0) / ages.length : 26
}

function topValuePlayers(players: RoadmapPlayer[], n: number): RoadmapPlayer[] {
  return [...players].sort((a, b) => b.value - a.value).slice(0, n)
}

// ---------------------------------------------------------------------------
// Phase Classification
// ---------------------------------------------------------------------------

function classifyPhase(input: FranchiseRoadmapInput): FranchisePhase {
  const starters = input.teamRoster.filter(p => p.slot === 'starter')
  const starterValue = starters.reduce((s, p) => s + p.value, 0)
  const avgStarterAge = avgAge(starters)
  const pickCount = input.draftPicks.length
  const youngCount = input.teamRoster.filter(p => p.age != null && p.age <= 25).length
  const agingCount = input.teamRoster.filter(p => {
    if (p.age == null) return false
    const curve = getAgeCurve(input.sport, p.position)
    return curve ? p.age > curve.declineAge : p.age > 28
  }).length

  // C2C misalignment check
  if (input.mode === 'c2c') {
    const collegeValue = input.c2cCollegeRoster.reduce((s, p) => s + p.value, 0)
    const proValue = input.c2cProRoster.reduce((s, p) => s + p.value, 0)
    if (collegeValue > 0 && proValue > 0) {
      const ratio = Math.min(collegeValue, proValue) / Math.max(collegeValue, proValue)
      if (ratio < 0.3) return 'misaligned'
    }
  }

  // Devy prospect-heavy
  if (input.mode === 'devy' && input.devyAssets.length >= 8 && starterValue < 40000) {
    return 'prospect_heavy'
  }

  // Aging contender
  if (starterValue >= 50000 && avgStarterAge > 28 && agingCount >= 3) {
    return 'aging_contender'
  }

  // Contending
  if (starterValue >= 50000 && avgStarterAge <= 28) return 'contending'
  if (starterValue >= 45000) return 'contending'

  // Emerging
  if (youngCount >= 5 && starterValue >= 30000 && pickCount >= 3) return 'emerging'

  // Retooling
  if (starterValue >= 35000 && (pickCount >= 3 || youngCount >= 4)) return 'retooling'

  // Rebuilding
  if (starterValue < 30000 || (agingCount >= 4 && pickCount < 2)) return 'rebuilding'

  return 'retooling'
}

// ---------------------------------------------------------------------------
// Championship Window
// ---------------------------------------------------------------------------

function detectChampionshipWindow(
  input: FranchiseRoadmapInput,
  phase: FranchisePhase,
): ChampionshipWindow {
  const year = input.currentSeasonYear
  const starters = input.teamRoster.filter(p => p.slot === 'starter')

  if (phase === 'rebuilding' || phase === 'prospect_heavy') {
    return { startYear: null, endYear: null, windowStrength: 'weak' }
  }

  // Project forward: when does starter value decay past threshold
  let windowEnd = year
  let totalValueNow = starters.reduce((s, p) => s + p.value, 0)

  for (let offset = 0; offset <= 5; offset++) {
    let projectedValue = 0
    for (const p of starters) {
      if (p.age == null) { projectedValue += p.value * 0.9; continue }
      const mult = computeAgeMultiplier(input.sport, p.position, p.age + offset)
      projectedValue += p.value * mult
    }
    if (projectedValue >= totalValueNow * 0.65) {
      windowEnd = year + offset
    } else {
      break
    }
  }

  const windowLength = windowEnd - year
  let strength: WindowStrength = 'weak'
  if (phase === 'contending' && windowLength >= 3) strength = 'strong'
  else if (phase === 'contending' || windowLength >= 2) strength = 'moderate'
  else if (phase === 'aging_contender') strength = 'weak'

  return {
    startYear: phase === 'contending' || phase === 'aging_contender' ? year : year + 1,
    endYear: windowEnd > year ? windowEnd : null,
    windowStrength: strength,
  }
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

function computeRosterAgeScore(players: RoadmapPlayer[], sport: string): number {
  if (players.length === 0) return 50

  let totalWeight = 0
  let weightedAge = 0

  for (const p of players) {
    if (p.age == null) continue
    const curve = getAgeCurve(sport, p.position)
    if (!curve) continue
    const yearsFromPeak = p.age - curve.peakAge
    const score = clamp(80 - yearsFromPeak * 8, 0, 100)
    const weight = p.value / 1000
    totalWeight += weight
    weightedAge += score * weight
  }

  return totalWeight > 0 ? clamp(Math.round(weightedAge / totalWeight), 0, 100) : 50
}

function computeContenderScore(input: FranchiseRoadmapInput): number {
  const starters = input.teamRoster.filter(p => p.slot === 'starter')
  const starterValue = starters.reduce((s, p) => s + p.value, 0)
  const benchValue = input.teamRoster.filter(p => p.slot === 'bench').reduce((s, p) => s + p.value, 0)

  let score = 30
  if (starterValue >= 60000) score += 30
  else if (starterValue >= 45000) score += 20
  else if (starterValue >= 30000) score += 10

  if (benchValue >= 20000) score += 15
  else if (benchValue >= 10000) score += 8

  const needs = identifyPositionalNeeds(input)
  score -= needs.length * 5

  return clamp(score, 0, 100)
}

function computeFutureFlexibilityScore(input: FranchiseRoadmapInput): number {
  let score = 30
  score += Math.min(25, input.draftPicks.length * 5)
  const youngCount = input.teamRoster.filter(p => p.age != null && p.age <= 25).length
  score += Math.min(25, youngCount * 4)
  if (input.mode === 'devy') score += Math.min(20, input.devyAssets.length * 3)
  return clamp(score, 0, 100)
}

// ---------------------------------------------------------------------------
// Positional Analysis
// ---------------------------------------------------------------------------

function identifyPositionalNeeds(input: FranchiseRoadmapInput): string[] {
  const starters = input.teamRoster.filter(p => p.slot === 'starter')
  const requirements = input.lineupRequirements ?? { QB: 1, RB: 2, WR: 2, TE: 1 }
  const needs: string[] = []

  for (const [pos, req] of Object.entries(requirements)) {
    const have = starters.filter(p => p.position === pos).length
    if (have < req) needs.push(pos)
  }

  return needs
}

function identifyPositionalSurplus(input: FranchiseRoadmapInput): string[] {
  const counts: Record<string, number> = {}
  for (const p of input.teamRoster) {
    counts[p.position] = (counts[p.position] || 0) + 1
  }
  const requirements = input.lineupRequirements ?? { QB: 1, RB: 2, WR: 2, TE: 1 }
  const surplus: string[] = []
  for (const [pos, count] of Object.entries(counts)) {
    const req = requirements[pos] ?? 1
    if (count > req + 2) surplus.push(pos)
  }
  return surplus
}

// ---------------------------------------------------------------------------
// Strategy Generation
// ---------------------------------------------------------------------------

function buildOverallStrategy(phase: FranchisePhase, goal: string, window: ChampionshipWindow): string {
  const strategies: Record<string, string> = {
    contending: 'Your roster is built to win now. Maximize this championship window by adding proven starters and depth. Don\'t sacrifice the present for the future.',
    aging_contender: 'You\'re competitive but the clock is ticking. Your core is aging — either push all-in for this year or start transitioning key assets before value craters.',
    retooling: 'Your roster has a foundation but isn\'t championship-caliber yet. Target 2-3 strategic upgrades while preserving long-term flexibility.',
    rebuilding: 'Hard truth: this roster needs a full reset. Sell veterans for picks and young players. The goal is building a sustainable contender in 2-3 years, not patching holes now.',
    emerging: 'Your young core is developing. Be patient — don\'t force trades to compete immediately. Let the talent mature and add pieces strategically.',
    prospect_heavy: 'You\'re prospect-rich but production-poor. Start converting devy assets into near-term contributors or trade some for proven talent.',
    misaligned: 'Your college and pro rosters are out of sync. Focus on aligning both timelines — you can\'t contend on one side while rebuilding the other.',
  }

  let base = strategies[phase] ?? 'Evaluate your roster objectively and pick a direction.'

  if (goal === 'win_now' && phase !== 'contending') {
    base += ' Your win-now goal may require aggressive moves given your current roster state.'
  }
  if (goal === 'fast_rebuild' && phase === 'contending') {
    base += ' Warning: tearing down a contender is rarely the right move. Consider sustainable contending instead.'
  }

  return base
}

function buildAssetStrategy(input: FranchiseRoadmapInput, phase: FranchisePhase): AssetStrategy {
  switch (phase) {
    case 'contending':
      return {
        veterans: 'Hold productive veterans. Trade for win-now depth at weak positions.',
        youngCore: 'Protect your young stars. Don\'t trade them for marginal upgrades.',
        picks: 'Trade future picks (2nd/3rd rounders) for proven production. Keep 1st rounders unless getting a difference-maker.',
        prospects: 'Convert high-value prospects into immediate contributors if possible.',
      }
    case 'aging_contender':
      return {
        veterans: 'Sell aging veterans (28+ RBs, 30+ WRs) at peak value before the cliff. Keep only elite producers.',
        youngCore: 'These are your future. Build around them. Do not trade for short-term fixes.',
        picks: 'Accumulate picks. You\'ll need them when the window closes.',
        prospects: 'Hold prospects — they\'re your insurance policy for the rebuild.',
      }
    case 'rebuilding':
      return {
        veterans: 'Sell every veteran with trade value. Even productive ones. Extract maximum pick and young player capital.',
        youngCore: 'Accumulate young talent aggressively. These are the foundation of your next contender.',
        picks: 'Hoard picks — especially 1st and early 2nd rounders. Quantity creates flexibility.',
        prospects: 'Stash high-upside prospects. The cost is low and the ceiling is high.',
      }
    case 'emerging':
      return {
        veterans: 'Selectively add veterans who complement your young core. No overpays.',
        youngCore: 'Your best assets. Let them develop. Trade only from surplus positions.',
        picks: 'Use picks to fill remaining gaps. Don\'t trade all of them for one player.',
        prospects: 'Hold prospects that align with your competitive window timeline.',
      }
    default:
      return {
        veterans: 'Evaluate each veteran individually. Sell declining assets, hold productive ones.',
        youngCore: 'Protect and develop. Trade only if the return is significant.',
        picks: 'Maintain balance. Don\'t hoard but don\'t spend recklessly.',
        prospects: 'Hold high-upside prospects. Flip low-ceiling ones for near-term value.',
      }
  }
}

// ---------------------------------------------------------------------------
// Year Plans
// ---------------------------------------------------------------------------

function buildYearPlans(
  input: FranchiseRoadmapInput,
  phase: FranchisePhase,
  window: ChampionshipWindow,
  contenderScore: number,
): YearPlan[] {
  const plans: YearPlan[] = []
  const year = input.currentSeasonYear
  const needs = identifyPositionalNeeds(input)

  for (let offset = 0; offset < input.horizonYears; offset++) {
    const planYear = year + offset
    let label: string
    let objective: string
    let priorities: string[]
    let targetPositions: string[]
    let recommendedMoves: string[]
    let riskWatch: string[]
    let milestone: string

    if (offset === 0) {
      // Year 1: immediate actions
      switch (phase) {
        case 'contending':
          label = 'Championship Push'
          objective = 'Win the title this year'
          priorities = ['Add depth at weak positions', 'Secure handcuffs for key starters', 'Monitor trade deadline for upgrades']
          targetPositions = needs.length > 0 ? needs : ['FLEX depth']
          recommendedMoves = ['Trade late picks for proven starters', 'Claim high-floor waiver adds']
          riskWatch = ['Injury to top-3 assets', 'Unexpected veteran decline']
          milestone = 'Secure playoff berth by Week 10'
          break
        case 'aging_contender':
          label = 'Last Dance or Transition'
          objective = 'Compete while preparing for transition'
          priorities = ['Sell aging assets at peak value', 'Identify which veterans to keep vs sell', 'Start accumulating youth']
          targetPositions = needs
          recommendedMoves = ['Trade RBs 27+ for picks + young WRs', 'Sell declining veterans before value drops']
          riskWatch = ['Core injuries accelerating rebuild timeline', 'Holding too long on declining assets']
          milestone = 'Complete 2+ trades that net future value while staying competitive'
          break
        case 'rebuilding':
          label = 'Full Teardown'
          objective = 'Maximize future asset accumulation'
          priorities = ['Sell every tradeable veteran', 'Accumulate 1st round picks', 'Target young breakout candidates']
          targetPositions = ['QB', 'WR'] // Long-shelf-life positions
          recommendedMoves = ['Trade veterans for 1sts', 'Add young upside on waivers', 'Tank for better pick positioning']
          riskWatch = ['Selling too cheap', 'Getting impatient and buying back in too early']
          milestone = 'Accumulate 3+ additional 1st round picks'
          break
        case 'emerging':
          label = 'Development Year'
          objective = 'Let young core develop while adding strategic pieces'
          priorities = ['Protect young assets', 'Fill 1-2 starting gaps', 'Maintain pick capital']
          targetPositions = needs
          recommendedMoves = ['Trade from surplus positions for needs', 'Target undervalued veterans on rebuilding teams']
          riskWatch = ['Overpaying to compete too early', 'Trading young core for marginal upgrades']
          milestone = 'Improve starting lineup by 2+ positions without sacrificing youth'
          break
        default:
          label = 'Assessment Year'
          objective = 'Evaluate roster direction and pick a lane'
          priorities = ['Decide: push in or sell out', 'Identify core keepers', 'Assess league landscape']
          targetPositions = needs
          recommendedMoves = ['Make 1 directional trade to commit to a path']
          riskWatch = ['Staying in the middle too long']
          milestone = 'Commit to contending or rebuilding'
      }
    } else if (offset === 1) {
      // Year 2: transition
      label = phase === 'contending' ? 'Window Maintenance' : phase === 'rebuilding' ? 'Foundation Building' : 'Acceleration'
      objective = phase === 'contending' ? 'Maintain championship-level roster' : phase === 'rebuilding' ? 'Start converting picks into contributors' : 'Accelerate toward contention'
      priorities = phase === 'contending'
        ? ['Replace any declining starters', 'Reload draft capital', 'Target value trades']
        : ['Draft high-ceiling players', 'Develop young talent', 'Monitor trade market for buy-low opportunities']
      targetPositions = needs
      recommendedMoves = phase === 'contending'
        ? ['Sell any non-core veteran who peaked', 'Draft replacement-level depth']
        : ['Draft best available talent', 'Trade picks for proven young players if value is right']
      riskWatch = ['Misjudging player timelines', 'League mates catching on to your strategy']
      milestone = phase === 'contending' ? 'Maintain top-3 roster ranking' : 'Have 3+ young starters under 25'
    } else {
      // Year 3+: long-term
      label = offset === 2 ? 'Maturation' : offset === 3 ? 'Harvest' : 'Sustainability'
      objective = phase === 'rebuilding' ? `Competitive by Year ${offset + 1}` : 'Sustain competitive advantage'
      priorities = ['Evaluate competitive position', 'Make strategic adjustments', 'Plan next cycle']
      targetPositions = needs.length > 0 ? needs.slice(0, 2) : ['best available']
      recommendedMoves = ['Re-evaluate roadmap based on results', 'Adjust strategy based on league landscape']
      riskWatch = ['Complacency', 'Failing to adapt to league changes']
      milestone = `Top-${Math.ceil(input.leagueSettings.numTeams * 0.4)} roster by power ranking`
    }

    plans.push({ year: planYear, label, objective, priorities, targetPositions, recommendedMoves, riskWatch, milestoneToReach: milestone })
  }

  return plans
}

// ---------------------------------------------------------------------------
// Urgent/Avoid Moves, Risk Factors, Market Inefficiencies
// ---------------------------------------------------------------------------

function identifyUrgentMoves(input: FranchiseRoadmapInput, phase: FranchisePhase): string[] {
  const moves: string[] = []
  const needs = identifyPositionalNeeds(input)

  if (phase === 'aging_contender') {
    const agingRBs = input.teamRoster.filter(p => p.position === 'RB' && p.age != null && p.age >= 27 && p.value >= 3000)
    if (agingRBs.length > 0) moves.push(`Sell ${agingRBs.map(p => p.name).join(', ')} before value craters`)
  }

  if (needs.length >= 2) moves.push(`Address ${needs.join(' and ')} — multiple starting holes`)
  if (phase === 'rebuilding' && input.teamRoster.filter(p => p.age != null && p.age >= 28 && p.value >= 4000).length > 0) {
    moves.push('Trade remaining veterans for picks — every week of delay reduces return')
  }

  if (phase === 'contending' && input.draftPicks.filter(p => p.round <= 2).length >= 4) {
    moves.push('Convert excess early picks into win-now starters')
  }

  return moves.slice(0, 4)
}

function identifyAvoidMoves(input: FranchiseRoadmapInput, phase: FranchisePhase): string[] {
  const moves: string[] = []

  if (phase === 'rebuilding') {
    moves.push('Do NOT trade picks for aging veterans')
    moves.push('Do NOT chase playoff spots with short-term rentals')
  }
  if (phase === 'contending') {
    moves.push('Do NOT sell your young core for marginal upgrades')
    moves.push('Do NOT overpay for depth when the waiver wire has options')
  }
  if (phase === 'emerging') {
    moves.push('Do NOT force contention — let the timeline play out')
  }
  if (phase === 'aging_contender') {
    moves.push('Do NOT pretend the window is longer than it is')
  }

  return moves.slice(0, 3)
}

function identifyRiskFactors(input: FranchiseRoadmapInput, ageScore: number): string[] {
  const risks: string[] = []

  if (ageScore < 40) risks.push('Aging roster — multiple players approaching or past their prime')
  const injuredCount = input.teamRoster.filter(p => p.slot === 'ir').length
  if (injuredCount >= 2) risks.push(`${injuredCount} players on IR — health risk is elevated`)
  if (input.draftPicks.length <= 1) risks.push('Minimal draft capital — no safety net if roster underperforms')

  const topPlayer = topValuePlayers(input.teamRoster, 1)[0]
  const totalValue = input.teamRoster.reduce((s, p) => s + p.value, 0)
  if (topPlayer && totalValue > 0 && topPlayer.value / totalValue > 0.25) {
    risks.push(`${topPlayer.name} represents ${Math.round((topPlayer.value / totalValue) * 100)}% of total value — concentration risk`)
  }

  return risks.slice(0, 5)
}

function identifyMarketInefficiencies(input: FranchiseRoadmapInput): string[] {
  const inefficiencies: string[] = []

  const surplus = identifyPositionalSurplus(input)
  if (surplus.length > 0) {
    inefficiencies.push(`Surplus at ${surplus.join(', ')} — trade from strength to fill weaknesses`)
  }

  const youngBench = input.teamRoster.filter(p => p.slot === 'bench' && p.age != null && p.age <= 24 && p.value >= 3000)
  if (youngBench.length >= 2) {
    inefficiencies.push(`${youngBench.length} high-value young players stuck on the bench — unlock or flip`)
  }

  return inefficiencies.slice(0, 3)
}

// ---------------------------------------------------------------------------
// Roster Identity
// ---------------------------------------------------------------------------

function buildRosterIdentity(input: FranchiseRoadmapInput, phase: FranchisePhase, ageScore: number): string {
  const starters = input.teamRoster.filter(p => p.slot === 'starter')
  const topPlayers = topValuePlayers(starters, 2).map(p => p.name)

  const ageLabel = ageScore >= 70 ? 'young' : ageScore >= 45 ? 'balanced-age' : 'aging'
  const depthLabel = input.teamRoster.length >= 20 ? 'deep' : input.teamRoster.length >= 14 ? 'adequate' : 'thin'
  const pickLabel = input.draftPicks.length >= 5 ? 'pick-rich' : input.draftPicks.length >= 2 ? 'moderate picks' : 'pick-poor'

  return `${phase.replace('_', ' ')} roster — ${ageLabel}, ${depthLabel} depth, ${pickLabel}${topPlayers.length > 0 ? `. Built around ${topPlayers.join(' and ')}` : ''}.`
}

// ---------------------------------------------------------------------------
// Confidence
// ---------------------------------------------------------------------------

function computeConfidence(input: FranchiseRoadmapInput): number {
  let conf = 50
  const rosterSize = input.teamRoster.length
  if (rosterSize >= 15) conf += 15
  else if (rosterSize >= 8) conf += 8

  const agesKnown = input.teamRoster.filter(p => p.age != null).length
  if (agesKnown >= rosterSize * 0.8) conf += 10

  if (input.draftPicks.length > 0) conf += 5
  if (input.leagueSettings.numTeams >= 10) conf += 5

  return clamp(conf, 20, 90)
}

// ---------------------------------------------------------------------------
// Main Entry Point
// ---------------------------------------------------------------------------

export function computeFranchiseRoadmap(input: FranchiseRoadmapInput): FranchiseRoadmap {
  const phase = classifyPhase(input)
  const window = detectChampionshipWindow(input, phase)
  const ageScore = computeRosterAgeScore(input.teamRoster, input.sport)
  const contenderScore = computeContenderScore(input)
  const futureScore = computeFutureFlexibilityScore(input)
  const needs = identifyPositionalNeeds(input)
  const yearPlans = buildYearPlans(input, phase, window, contenderScore)

  const base: FranchiseRoadmap = {
    mode: input.mode,
    horizonYears: input.horizonYears,
    currentPhase: phase,
    confidencePct: computeConfidence(input),
    overallStrategy: buildOverallStrategy(phase, input.userGoal, window),
    championshipWindow: window,
    rosterIdentity: buildRosterIdentity(input, phase, ageScore),
    strengths: [
      ...(contenderScore >= 65 ? ['Strong starting lineup'] : []),
      ...(ageScore >= 65 ? ['Young roster profile'] : []),
      ...(futureScore >= 65 ? ['Strong future flexibility'] : []),
      ...(input.draftPicks.filter(p => p.round === 1).length >= 2 ? ['Multiple 1st round picks'] : []),
    ],
    weaknesses: [
      ...needs.map(n => `Need at ${n}`),
      ...(ageScore < 40 ? ['Aging roster'] : []),
      ...(futureScore < 35 ? ['Limited future capital'] : []),
      ...(contenderScore < 35 ? ['Weak starting lineup'] : []),
    ],
    marketInefficiencies: identifyMarketInefficiencies(input),
    urgentMoves: identifyUrgentMoves(input, phase),
    avoidMoves: identifyAvoidMoves(input, phase),
    riskFactors: identifyRiskFactors(input, ageScore),
    priorityPositions: needs.length > 0 ? needs : identifyPositionalSurplus(input).length > 0 ? ['trade from surplus'] : [],
    draftCapitalAdvice: input.draftPicks.length >= 5
      ? 'Pick-rich. Use surplus picks to acquire proven talent or trade up for premium selections.'
      : input.draftPicks.length <= 1
        ? 'Pick-poor. Prioritize acquiring draft capital in any trade negotiation.'
        : 'Moderate pick capital. Use strategically — don\'t overspend or hoard.',
    tradeStrategy: phase === 'contending'
      ? 'Buy proven production. Sell late picks and expendable depth for upgrades.'
      : phase === 'rebuilding'
        ? 'Sell everything with trade value. Target picks and young players. Be patient.'
        : 'Be selective. Trade from surplus positions. Don\'t overpay to accelerate.',
    timelineSummary: window.startYear && window.endYear
      ? `Championship window: ${window.startYear}-${window.endYear} (${window.windowStrength}). Plan accordingly.`
      : phase === 'rebuilding'
        ? `No current window. Target competitive by ${input.currentSeasonYear + 2}-${input.currentSeasonYear + 3}.`
        : 'Window is uncertain. Build flexibility to respond to opportunities.',
    yearPlans,
    assetStrategy: buildAssetStrategy(input, phase),
    aiNotes: [],
    generatedAt: new Date().toISOString(),

    // Mode extensions
    dynastyExtension: input.mode === 'dynasty' ? computeDynastyExtension(input, { ageScore, contenderScore, futureScore }) : null,
    devyExtension: input.mode === 'devy' ? computeDevyExtension(input) : null,
    c2cExtension: input.mode === 'c2c' ? computeC2CExtension(input) : null,
  }

  return base
}
