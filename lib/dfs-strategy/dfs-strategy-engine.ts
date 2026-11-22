/**
 * AI DFS Strategy Layer Engine
 *
 * Slate-level strategy intelligence: leverage, chalk, correlation, stacks,
 * contest-type optimization, and construction philosophy. Not a sportsbook.
 *
 * Pure deterministic. <15ms.
 */

import { z } from 'zod'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const ContestTypeEnum = z.enum([
  'cash', 'tournament', 'single_entry', 'large_field', 'showdown', 'small_field', 'qualifier',
])

const StrategyModeEnum = z.enum([
  'balanced', 'safe_floor', 'max_ceiling', 'anti_chalk', 'stack_hunting', 'game_theory', 'late_swap_ready',
])

interface SlatePlayer {
  playerId: string
  playerName: string
  position: string
  team: string | null
  salary: number
  projection: number
  floor: number
  ceiling: number
  ownershipEstimate: number // 0-100
  volatility: number
  injuryStatus: string
  gameEnvironment: number // 0-100 (higher = better scoring environment)
}

export const DfsStrategyInputSchema = z.object({
  sport: z.string().default('NFL'),
  slateId: z.string().default('main'),
  contestType: ContestTypeEnum.default('tournament'),
  strategyMode: StrategyModeEnum.default('balanced'),
  playerPool: z.array(z.object({
    playerId: z.string(), playerName: z.string(), position: z.string(),
    team: z.string().nullable(), salary: z.number(), projection: z.number(),
    floor: z.number(), ceiling: z.number(),
    ownershipEstimate: z.number().default(10), volatility: z.number().default(0.2),
    injuryStatus: z.string().default('healthy'),
    gameEnvironment: z.number().default(50),
  })),
  salaryCap: z.number().default(50000),
})
type DfsStrategyInput = z.infer<typeof DfsStrategyInputSchema>

interface StackIdea {
  label: string
  score: number
  players: string[]
  rationale: string
}

interface DfsStrategyResult {
  slateId: string
  contestType: string
  strategyMode: string
  confidencePct: number
  slateSummary: string
  corePlays: string[]
  leveragePlays: string[]
  chalkWarnings: string[]
  stackIdeas: StackIdea[]
  bringBackIdeas: string[]
  playerPoolTiers: {
    core: string[]
    secondary: string[]
    contrarian: string[]
    fades: string[]
  }
  constructionNotes: string[]
  riskNotes: string[]
  lateSwapNotes: string[]
  summary: string
  generatedAt: string
  leverageScore: number
  chalkFragilityScore: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, v)) }

// ---------------------------------------------------------------------------
// Analysis Functions
// ---------------------------------------------------------------------------

function scoreLeverage(player: SlatePlayer, contestType: string): number {
  // Leverage = ceiling potential relative to ownership
  // Low ownership + high ceiling = max leverage (tournament gold)
  const ceilingScore = clamp(player.ceiling / 40 * 100, 0, 100) // 40 pts = 100 ceiling score
  const ownershipPenalty = contestType === 'tournament' || contestType === 'large_field'
    ? player.ownershipEstimate * 0.8 // high ownership = less leverage in GPPs
    : player.ownershipEstimate * 0.3 // cash games care less about ownership
  return clamp(Math.round(ceilingScore - ownershipPenalty), 0, 100)
}

function isChalkFragile(player: SlatePlayer): boolean {
  // High ownership + high volatility + moderate projection = fragile chalk
  return player.ownershipEstimate >= 25 && player.volatility >= 0.25 && player.projection < player.ceiling * 0.65
}

function classifyPlayer(player: SlatePlayer, contestType: string): 'core' | 'secondary' | 'contrarian' | 'fade' {
  const leverage = scoreLeverage(player, contestType)
  const salaryEfficiency = player.projection / (player.salary / 1000)

  if (player.injuryStatus !== 'healthy' && player.injuryStatus !== 'Active') return 'fade'
  if (isChalkFragile(player) && contestType === 'tournament') return 'fade'

  if (salaryEfficiency >= 3.5 && player.projection >= 12) return 'core'
  if (leverage >= 65 && player.ownershipEstimate < 15) return 'contrarian'
  if (player.projection >= 10) return 'secondary'
  return 'fade'
}

function findStacks(pool: SlatePlayer[]): StackIdea[] {
  // Group by team and find QB + pass catchers on same team
  const byTeam = new Map<string, SlatePlayer[]>()
  for (const p of pool) {
    if (!p.team) continue
    if (!byTeam.has(p.team)) byTeam.set(p.team, [])
    byTeam.get(p.team)!.push(p)
  }

  const stacks: StackIdea[] = []
  for (const [team, players] of byTeam) {
    const qbs = players.filter(p => p.position === 'QB' && p.projection >= 15)
    const passCatchers = players.filter(p => ['WR', 'TE'].includes(p.position) && p.projection >= 8)
      .sort((a, b) => b.projection - a.projection)

    for (const qb of qbs) {
      if (passCatchers.length === 0) continue
      const target = passCatchers[0]
      const score = clamp(Math.round(
        (qb.projection + target.projection) * 1.5 +
        (qb.gameEnvironment + target.gameEnvironment) * 0.2 -
        (qb.ownershipEstimate + target.ownershipEstimate) * 0.3
      ), 0, 100)

      stacks.push({
        label: `${qb.playerName} + ${target.playerName} (${team})`,
        score,
        players: [qb.playerName, target.playerName],
        rationale: `${team} stack: ${qb.playerName} to ${target.playerName}. Game environment ${qb.gameEnvironment}/100. Combined projection ${(qb.projection + target.projection).toFixed(1)}.`,
      })

      // Two-target stack
      if (passCatchers.length >= 2) {
        stacks.push({
          label: `${qb.playerName} + ${passCatchers[0].playerName} + ${passCatchers[1].playerName}`,
          score: clamp(score - 5, 0, 100), // slightly lower for 3-man
          players: [qb.playerName, passCatchers[0].playerName, passCatchers[1].playerName],
          rationale: `Double stack through ${team}. High correlation, high ceiling, higher variance.`,
        })
      }
    }
  }

  return stacks.sort((a, b) => b.score - a.score).slice(0, 6)
}

// ---------------------------------------------------------------------------
// Main Entry Point
// ---------------------------------------------------------------------------

export function analyzeDfsSlate(input: DfsStrategyInput): DfsStrategyResult {
  const pool = input.playerPool
  const contestType = input.contestType
  const mode = input.strategyMode

  // Classify all players
  const classified = pool.map(p => ({
    player: p,
    tier: classifyPlayer(p, contestType),
    leverage: scoreLeverage(p, contestType),
  }))

  const core = classified.filter(c => c.tier === 'core').sort((a, b) => b.player.projection - a.player.projection)
  const secondary = classified.filter(c => c.tier === 'secondary').sort((a, b) => b.player.projection - a.player.projection)
  const contrarian = classified.filter(c => c.tier === 'contrarian').sort((a, b) => b.leverage - a.leverage)
  const fades = classified.filter(c => c.tier === 'fade')

  // Core plays
  const corePlays = core.slice(0, 5).map(c => `${c.player.playerName} (${c.player.position}, $${c.player.salary}) — ${c.player.projection.toFixed(1)} proj, ${c.player.ownershipEstimate}% owned`)

  // Leverage plays
  const leveragePlays = contrarian.slice(0, 4).map(c => `${c.player.playerName} (${c.player.position}, $${c.player.salary}) — ${c.leverage}/100 leverage, ${c.player.ownershipEstimate}% owned, ceiling ${c.player.ceiling.toFixed(1)}`)

  // Chalk warnings
  const fragileChalk = pool.filter(p => isChalkFragile(p))
  const chalkWarnings = fragileChalk.slice(0, 3).map(p => `${p.playerName} (${p.ownershipEstimate}% owned) — fragile chalk: high variance + moderate projection. Consider fading in GPPs.`)

  // Stacks
  const stackIdeas = findStacks(pool)

  // Bring-back ideas
  const bringBackIdeas = stackIdeas.slice(0, 2).map(s => {
    const oppTeam = pool.find(p => p.team !== s.players[0] && ['WR', 'TE', 'RB'].includes(p.position) && p.projection >= 10)
    return oppTeam ? `Bring back: ${oppTeam.playerName} against ${s.label.split('(')[1]?.replace(')', '') ?? 'stack team'}` : ''
  }).filter(Boolean)

  // Construction notes per mode
  const constructionNotes: string[] = []
  switch (mode) {
    case 'safe_floor': constructionNotes.push('Prioritize floor. Start chalky, proven, high-floor options. Minimize bust risk.'); break
    case 'max_ceiling': constructionNotes.push('Maximize ceiling. Stack aggressively. Accept bust risk for tournament-winning upside.'); break
    case 'anti_chalk': constructionNotes.push('Fade the field. Target players under 10% ownership with real ceilings. Accept lower floor.'); break
    case 'stack_hunting': constructionNotes.push('Build around stacks. Choose your stack first, then fill around it efficiently.'); break
    case 'game_theory': constructionNotes.push('Think about the field. Where is leverage? What does the majority miss?'); break
    default: constructionNotes.push('Balance floor and ceiling. Use 1-2 leverage plays with a core of proven options.')
  }

  if (contestType === 'cash') constructionNotes.push('Cash game: floor > ceiling. Avoid volatile players. Maximize median.')
  if (contestType === 'tournament' || contestType === 'large_field') constructionNotes.push('Tournament: ceiling > floor. Differentiate from the field. Stacks are mandatory.')
  if (contestType === 'showdown') constructionNotes.push('Showdown: Captain selection is everything. Pick the highest-ceiling player as captain.')

  // Risk notes
  const riskNotes: string[] = []
  const injuredInPool = pool.filter(p => p.injuryStatus !== 'healthy' && p.injuryStatus !== 'Active')
  if (injuredInPool.length > 0) riskNotes.push(`${injuredInPool.length} player(s) with injury designations — monitor status before lock`)
  if (fragileChalk.length >= 3) riskNotes.push('Multiple fragile chalk plays — field is vulnerable to a bust')

  const lateSwapNotes: string[] = []
  if (injuredInPool.length > 0) lateSwapNotes.push(`Watch ${injuredInPool.map(p => p.playerName).join(', ')} for game-time decisions`)

  // Overall scores
  const avgLeverage = classified.length > 0 ? classified.reduce((s, c) => s + c.leverage, 0) / classified.length : 50
  const leverageScore = clamp(Math.round(avgLeverage), 0, 100)
  const chalkFragilityScore = clamp(Math.round(fragileChalk.length * 20), 0, 100)

  const slateSummary = `${pool.length} players on the slate. ${core.length} core plays, ${contrarian.length} contrarian options, ${fades.length} fades. ${stackIdeas.length} viable stacks.`

  const confidence = clamp(50 + (core.length >= 3 ? 15 : 0) + (stackIdeas.length >= 2 ? 10 : 0) + (pool.length >= 30 ? 10 : 0), 30, 85)

  return {
    slateId: input.slateId, contestType, strategyMode: mode, confidencePct: confidence,
    slateSummary, corePlays, leveragePlays, chalkWarnings,
    stackIdeas, bringBackIdeas,
    playerPoolTiers: {
      core: core.slice(0, 8).map(c => c.player.playerName),
      secondary: secondary.slice(0, 8).map(c => c.player.playerName),
      contrarian: contrarian.slice(0, 6).map(c => c.player.playerName),
      fades: fades.slice(0, 5).map(c => c.player.playerName),
    },
    constructionNotes, riskNotes, lateSwapNotes,
    summary: `${contestType} slate (${mode}): ${corePlays.length} core, ${leveragePlays.length} leverage, ${stackIdeas.length} stacks. Leverage score: ${leverageScore}/100. Chalk fragility: ${chalkFragilityScore}/100.`,
    generatedAt: new Date().toISOString(),
    leverageScore, chalkFragilityScore,
  }
}
