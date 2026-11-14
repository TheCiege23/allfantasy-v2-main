/**
 * AI Trade Builder Engine
 *
 * Proactively generates smart trade packages. Layers on top of the existing
 * packageBuilder, candidate-generator, and acceptance probability engine.
 *
 * Modes: target_player, position_upgrade, strategy, liquidation, consolidation
 * Pure deterministic. <50ms.
 */

import { z } from 'zod'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const TradeBuilderModeEnum = z.enum([
  'target_player', 'position_upgrade', 'strategy', 'liquidation', 'consolidation',
])

const StrategyGoalEnum = z.enum([
  'win_now', 'sustainable_contender', 'fast_rebuild', 'value_accumulation',
  'youth_movement', 'pick_collection', 'depth_fix', 'star_consolidation',
])

const TradeStyleEnum = z.enum([
  'balanced', 'aggressive', 'safe', 'opportunistic', 'lowball', 'premium_push',
])

interface TradeBuilderPlayer {
  id: string
  name: string
  position: string
  team: string | null
  age: number | null
  value: number
  slot: 'starter' | 'bench' | 'ir' | 'taxi'
}

interface TradeBuilderTeam {
  rosterId: number
  managerName: string
  players: TradeBuilderPlayer[]
  picks: Array<{ season: number; round: number; projected: string }>
  needs: string[]
  surplus: string[]
  contenderTier: string
  archetype?: string
}

export const TradeBuilderInputSchema = z.object({
  sport: z.string().default('NFL'),
  leagueType: z.string().default('dynasty'),
  scoringFormat: z.string().default('PPR'),
  mode: TradeBuilderModeEnum,
  strategyGoal: StrategyGoalEnum.default('sustainable_contender'),
  tradeStyle: TradeStyleEnum.default('balanced'),
  targetPlayerName: z.string().optional(),
  targetPosition: z.string().optional(),
  userTeam: z.object({
    rosterId: z.number(),
    managerName: z.string(),
    players: z.array(z.object({
      id: z.string(), name: z.string(), position: z.string(),
      team: z.string().nullable(), age: z.number().nullable(),
      value: z.number(), slot: z.enum(['starter', 'bench', 'ir', 'taxi']),
    })),
    picks: z.array(z.object({ season: z.number(), round: z.number(), projected: z.string() })).default([]),
    needs: z.array(z.string()).default([]),
    surplus: z.array(z.string()).default([]),
    contenderTier: z.string().default('middle'),
  }),
  leagueTeams: z.array(z.object({
    rosterId: z.number(),
    managerName: z.string(),
    players: z.array(z.object({
      id: z.string(), name: z.string(), position: z.string(),
      team: z.string().nullable(), age: z.number().nullable(),
      value: z.number(), slot: z.enum(['starter', 'bench', 'ir', 'taxi']),
    })),
    picks: z.array(z.object({ season: z.number(), round: z.number(), projected: z.string() })).default([]),
    needs: z.array(z.string()).default([]),
    surplus: z.array(z.string()).default([]),
    contenderTier: z.string().default('middle'),
    archetype: z.string().optional(),
  })),
  leagueSettings: z.object({
    numTeams: z.number().default(12),
    isSF: z.boolean().default(false),
    isTEP: z.boolean().default(false),
  }),
  riskTolerance: z.enum(['conservative', 'moderate', 'aggressive']).default('moderate'),
})

type TradeBuilderInput = z.infer<typeof TradeBuilderInputSchema>

interface TradePackage {
  id: string
  label: string
  targetManagerId: number
  targetManagerName: string
  targetAssets: string[]
  sendAssets: string[]
  sendPicks: string[]
  receivePicks: string[]
  fairnessScore: number
  acceptanceOdds: number
  aggressionLevel: 'safe' | 'balanced' | 'aggressive'
  improvesUserHow: string
  improvesOpponentHow: string
  strategicReason: string
  riskNotes: string[]
  fallbackVersionAvailable: boolean
}

interface FallbackPackage {
  basedOnPackageId: string
  label: string
  sendAssets: string[]
  targetAssets: string[]
  strategicAdjustment: string
}

interface TradeBuilderResult {
  strategyGoal: string
  tradeStyle: string
  recommendedTarget: string
  whyThisTarget: string
  confidencePct: number
  marketTiming: string
  summary: string
  packages: TradePackage[]
  fallbackPackages: FallbackPackage[]
  avoidTargets: string[]
  overpayWarnings: string[]
  marketNotes: string[]
  managerPsychologyNotes: string[]
  nextBestAlternatives: string[]
  generatedAt: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

function findBestPartner(
  userTeam: TradeBuilderInput['userTeam'],
  leagueTeams: TradeBuilderTeam[],
  targetPosition?: string,
): TradeBuilderTeam | null {
  // Score each team by need/surplus alignment
  let bestTeam: TradeBuilderTeam | null = null
  let bestScore = -1

  for (const team of leagueTeams) {
    if (team.rosterId === userTeam.rosterId) continue
    let score = 0

    // They need what we have surplus
    for (const surplus of userTeam.surplus) {
      if (team.needs.includes(surplus)) score += 20
    }
    // We need what they have surplus
    for (const need of userTeam.needs) {
      if (team.surplus.includes(need)) score += 20
    }
    // Target position match
    if (targetPosition && team.surplus.includes(targetPosition)) score += 30
    if (targetPosition && team.players.some(p => p.position === targetPosition && p.value >= 4000)) score += 15

    // Prefer active traders
    if (team.archetype === 'Gambler' || team.archetype === 'Fair Dealer') score += 10
    if (team.archetype === 'Hoarder') score -= 15

    if (score > bestScore) { bestScore = score; bestTeam = team }
  }

  return bestTeam
}

function buildPackage(
  userTeam: TradeBuilderInput['userTeam'],
  partner: TradeBuilderTeam,
  targetPlayer: TradeBuilderPlayer | null,
  style: string,
  goal: string,
  id: string,
): TradePackage | null {
  if (!targetPlayer) return null

  const targetValue = targetPlayer.value
  const userPlayers = [...userTeam.players].sort((a, b) => b.value - a.value)

  // Find assets to send that match target value within tolerance
  const toleranceMap: Record<string, [number, number]> = {
    safe: [0.95, 1.15],
    balanced: [0.88, 1.10],
    aggressive: [0.78, 1.0],
    lowball: [0.70, 0.90],
    premium_push: [1.0, 1.25],
    opportunistic: [0.85, 1.05],
  }
  const [minRatio, maxRatio] = toleranceMap[style] ?? [0.88, 1.10]

  // Try 1-for-1 first
  const oneForOne = userPlayers.find(p =>
    p.value >= targetValue * minRatio &&
    p.value <= targetValue * maxRatio &&
    p.slot !== 'ir' &&
    p.id !== targetPlayer.id,
  )

  let sendAssets: string[] = []
  let sendValue = 0

  if (oneForOne) {
    sendAssets = [oneForOne.name]
    sendValue = oneForOne.value
  } else {
    // Try 2-for-1
    const candidates = userPlayers.filter(p => p.value < targetValue && p.slot !== 'ir' && p.value >= 1000)
    for (let i = 0; i < candidates.length - 1; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        const combo = candidates[i].value + candidates[j].value
        if (combo >= targetValue * minRatio && combo <= targetValue * maxRatio * 1.15) {
          sendAssets = [candidates[i].name, candidates[j].name]
          sendValue = combo
          break
        }
      }
      if (sendAssets.length > 0) break
    }
  }

  if (sendAssets.length === 0) return null

  // Fairness
  const ratio = sendValue / targetValue
  const fairnessScore = clamp(Math.round(100 - Math.abs(1 - ratio) * 100), 0, 100)

  // Acceptance odds (simplified)
  let acceptanceOdds = 40
  if (fairnessScore >= 85) acceptanceOdds += 25
  else if (fairnessScore >= 70) acceptanceOdds += 15
  if (partner.needs.some(n => userPlayers.some(p => sendAssets.includes(p.name) && p.position === n))) acceptanceOdds += 15
  if (partner.archetype === 'Taco') acceptanceOdds += 10
  if (partner.archetype === 'Shark') acceptanceOdds -= 10
  acceptanceOdds = clamp(acceptanceOdds, 10, 90)

  const aggressionLevel: TradePackage['aggressionLevel'] =
    ratio < 0.90 ? 'aggressive' : ratio > 1.05 ? 'safe' : 'balanced'

  return {
    id,
    label: aggressionLevel === 'safe' ? 'Safe Offer' : aggressionLevel === 'aggressive' ? 'Aggressive Offer' : 'Balanced Offer',
    targetManagerId: partner.rosterId,
    targetManagerName: partner.managerName,
    targetAssets: [targetPlayer.name],
    sendAssets,
    sendPicks: [],
    receivePicks: [],
    fairnessScore,
    acceptanceOdds,
    aggressionLevel,
    improvesUserHow: `Adds ${targetPlayer.name} (${targetPlayer.position}) — fills a roster need`,
    improvesOpponentHow: `Gets ${sendAssets.join(' + ')} — fills their ${partner.needs[0] ?? 'depth'} need`,
    strategicReason: goal === 'win_now' ? 'Win-now upgrade at a key position' : goal === 'fast_rebuild' ? 'Acquiring youth/future value' : 'Strategic roster improvement',
    riskNotes: aggressionLevel === 'aggressive' ? ['May be rejected — have fallback ready'] : [],
    fallbackVersionAvailable: true,
  }
}

// ---------------------------------------------------------------------------
// Main Entry Point
// ---------------------------------------------------------------------------

export function generateTradePackages(input: TradeBuilderInput): TradeBuilderResult {
  const { userTeam, leagueTeams, mode, strategyGoal, tradeStyle, targetPlayerName, targetPosition } = input

  // Find target
  let targetPlayer: TradeBuilderPlayer | null = null
  let targetPartner: TradeBuilderTeam | null = null

  if (mode === 'target_player' && targetPlayerName) {
    for (const team of leagueTeams) {
      const found = team.players.find(p => p.name.toLowerCase() === targetPlayerName.toLowerCase())
      if (found && team.rosterId !== userTeam.rosterId) {
        targetPlayer = found
        targetPartner = team
        break
      }
    }
  } else if (mode === 'position_upgrade' && targetPosition) {
    targetPartner = findBestPartner(userTeam, leagueTeams, targetPosition)
    if (targetPartner) {
      targetPlayer = targetPartner.players
        .filter(p => p.position === targetPosition && p.value >= 3000)
        .sort((a, b) => b.value - a.value)[0] ?? null
    }
  } else {
    // Strategy/liquidation/consolidation — find best partner
    targetPartner = findBestPartner(userTeam, leagueTeams)
    if (targetPartner) {
      const needs = userTeam.needs
      targetPlayer = targetPartner.players
        .filter(p => needs.includes(p.position) && p.value >= 3000)
        .sort((a, b) => b.value - a.value)[0] ?? null
    }
  }

  // Generate packages
  const packages: TradePackage[] = []
  const styles = tradeStyle === 'balanced'
    ? ['safe', 'balanced', 'aggressive']
    : [tradeStyle]

  for (let i = 0; i < styles.length; i++) {
    const pkg = buildPackage(userTeam, targetPartner ?? leagueTeams[0], targetPlayer, styles[i], strategyGoal, `pkg_${i + 1}`)
    if (pkg) packages.push(pkg)
  }

  // Fallback packages
  const fallbackPackages: FallbackPackage[] = packages
    .filter(p => p.aggressionLevel !== 'safe')
    .map(p => ({
      basedOnPackageId: p.id,
      label: `Sweetened ${p.label}`,
      sendAssets: [...p.sendAssets, '(+ late pick)'],
      targetAssets: p.targetAssets,
      strategicAdjustment: 'Add a late-round pick to sweeten the deal if initial offer is rejected',
    }))

  // Avoid targets
  const avoidTargets: string[] = []
  for (const team of leagueTeams) {
    if (team.archetype === 'Hoarder') avoidTargets.push(`${team.managerName} — rarely trades`)
    if (team.archetype === 'Shark' && input.riskTolerance === 'conservative') {
      avoidTargets.push(`${team.managerName} — skilled negotiator, risky for conservative style`)
    }
  }

  const confidence = packages.length >= 2 ? 70 : packages.length === 1 ? 55 : 25

  return {
    strategyGoal,
    tradeStyle,
    recommendedTarget: targetPlayer?.name ?? 'No suitable target found',
    whyThisTarget: targetPlayer
      ? `${targetPlayer.name} fills your ${targetPlayer.position} need and is attainable from ${targetPartner?.managerName ?? 'a trade partner'}`
      : 'Could not identify a suitable trade target given your roster and league context',
    confidencePct: confidence,
    marketTiming: 'Standard market conditions — no urgent timing factor detected',
    summary: packages.length > 0
      ? `Generated ${packages.length} trade package${packages.length > 1 ? 's' : ''} targeting ${targetPlayer?.name ?? 'roster improvement'}. ${packages[0]?.aggressionLevel === 'safe' ? 'Lead with the safe offer.' : 'Start balanced, escalate if needed.'}`
      : 'Unable to generate viable trade packages with current roster and league context.',
    packages,
    fallbackPackages,
    avoidTargets: avoidTargets.slice(0, 3),
    overpayWarnings: packages.filter(p => p.fairnessScore < 70).map(p => `${p.label} may be an overpay (fairness: ${p.fairnessScore})`),
    marketNotes: [],
    managerPsychologyNotes: targetPartner?.archetype ? [`${targetPartner.managerName} is a "${targetPartner.archetype}" — adjust approach accordingly`] : [],
    nextBestAlternatives: [],
    generatedAt: new Date().toISOString(),
  }
}
