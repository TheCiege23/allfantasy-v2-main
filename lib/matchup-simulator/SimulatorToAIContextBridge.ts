/**
 * SimulatorToAIContextBridge — route from Matchup Simulator into AI Chat with context.
 */

import { getToolToAIChatHref } from "@/lib/chimmy-chat"

type AIChatContextOptions = {
  leagueId?: string
  insightType?: 'matchup' | 'playoff' | 'dynasty' | 'trade' | 'waiver' | 'draft'
  teamId?: string
  sport?: string
  season?: number
  week?: number
}

/**
 * URL to open AI Chat (Legacy). Optionally pass a suggested prompt for matchup explanation.
 */
export function getMatchupAIChatUrl(suggestedPrompt?: string, options?: AIChatContextOptions): string {
  return getToolToAIChatHref("matchup", {
    prompt: suggestedPrompt,
    leagueId: options?.leagueId,
    insightType: options?.insightType,
    teamId: options?.teamId,
    sport: options?.sport,
    season: options?.season,
    week: options?.week,
  })
}

type MatchupContextForAI = {
  teamAName: string
  teamBName: string
  projectedScoreA?: number
  projectedScoreB?: number
  scoreRangeA?: [number, number]
  scoreRangeB?: [number, number]
  winProbA?: number
  winProbB?: number
  upsetChance?: number
  volatilityTag?: string
  sport?: string
  strengths?: string[]
  weaknesses?: string[]
  positionEdgeSummary?: string
}

/**
 * Build a short suggested prompt for "Explain this matchup" so Chimmy has context.
 */
export function buildMatchupSummaryForAI(ctx: MatchupContextForAI): string {
  const parts = [
    `Explain this matchup: ${ctx.teamAName} vs ${ctx.teamBName}.`,
  ]
  if (ctx.projectedScoreA != null && ctx.projectedScoreB != null) {
    parts.push(`Projected score: ${ctx.projectedScoreA.toFixed(1)} – ${ctx.projectedScoreB.toFixed(1)}.`)
  }
  if (ctx.winProbA != null && ctx.winProbB != null) {
    parts.push(`Win probability: ${ctx.winProbA.toFixed(0)}% – ${ctx.winProbB.toFixed(0)}%.`)
  }
  if (ctx.scoreRangeA && ctx.scoreRangeB) {
    parts.push(
      `Likely score range: ${ctx.teamAName} ${ctx.scoreRangeA[0].toFixed(0)}-${ctx.scoreRangeA[1].toFixed(0)}, ${ctx.teamBName} ${ctx.scoreRangeB[0].toFixed(0)}-${ctx.scoreRangeB[1].toFixed(0)}.`
    )
  }
  if (ctx.upsetChance != null && ctx.upsetChance > 5) {
    parts.push(`Upset chance: ${ctx.upsetChance}%.`)
  }
  if (ctx.volatilityTag) {
    parts.push(`Volatility: ${ctx.volatilityTag}.`)
  }
  if (ctx.positionEdgeSummary) {
    parts.push(`Position edges: ${ctx.positionEdgeSummary}.`)
  }
  if (ctx.strengths?.length) {
    parts.push(`Strengths: ${ctx.strengths.slice(0, 3).join(' ')}`)
  }
  if (ctx.weaknesses?.length) {
    parts.push(`Weaknesses: ${ctx.weaknesses.slice(0, 3).join(' ')}`)
  }
  if (ctx.sport) {
    parts.push(`Sport: ${ctx.sport}.`)
  }
  parts.push('What should I know about this matchup?')
  return parts.join(' ')
}
