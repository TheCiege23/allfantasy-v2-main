/**
 * ToolContextToChimmyRouter — map from tool/surface to Chimmy suggested prompt and context.
 * Supports: matchup, draft, trade, waiver, league forecast, and generic.
 */

import type { ToolChimmyContext } from './types'
import { normalizeToSupportedSport } from '@/lib/sport-scope'

export type ToolContextSource =
  | 'matchup'
  | 'draft'
  | 'trade'
  | 'waiver'
  | 'league_forecast'
  | 'rankings'
  | 'devy'
  | 'c2c'
  | 'generic'

const AI_SOURCE_TO_TOOL_CONTEXT: Record<string, ToolContextSource> = {
  trade_analyzer: 'trade',
  waiver_tool: 'waiver',
  draft_tool: 'draft',
  matchup_tool: 'matchup',
  league_forecast: 'league_forecast',
  lineup_tool: 'generic',
  dashboard: 'generic',
  dashboard_widget: 'generic',
  dashboard_rankings: 'rankings',
  tool_hub: 'generic',
  ai_hub: 'generic',
  quick_action: 'generic',
  top_bar: 'generic',
  right_rail: 'generic',
  search: 'generic',
  fallback: 'generic',
  unknown: 'generic',
  war_room: 'generic',
  injury_impact: 'generic',
  injury_player: 'generic',
  matchup_prep: 'matchup',
  power_rankings: 'rankings',
  power_rankings_team: 'rankings',
  long_term_coaching: 'league_forecast',
}

const TOOL_DISPLAY_NAMES: Record<string, string> = {
  matchup_simulator: 'Matchup Simulator',
  mock_draft: 'Draft Helper',
  trade_analyzer: 'Trade Analyzer',
  waiver_ai: 'Waiver Chimmy',
  league_forecast: 'League Forecast',
  rankings: 'Rankings',
  devy_league: 'Devy',
  c2c_league: 'College-to-Canton',
  generic: 'Chimmy',
}

export function mapAIContextSourceToToolContextSource(source: string | null | undefined): ToolContextSource | null {
  if (!source) return null
  return AI_SOURCE_TO_TOOL_CONTEXT[source] ?? null
}

export function getChimmyToolDisplayName(toolId: string | null | undefined): string {
  if (!toolId) return 'Chimmy'
  return TOOL_DISPLAY_NAMES[toolId] ?? toolId.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

/**
 * Build tool context for Chimmy: suggested prompt and optional context hint.
 */
export function getToolContextForChimmy(
  source: ToolContextSource,
  payload: Record<string, unknown> = {}
): ToolChimmyContext {
  switch (source) {
    case 'matchup': {
      const teamAName = String(payload.teamAName ?? 'Team A')
      const teamBName = String(payload.teamBName ?? 'Team B')
      const sport = normalizeToSupportedSport(payload.sport as string | null | undefined)
      let prompt = `Explain this matchup: ${teamAName} vs ${teamBName}.`
      if (payload.projectedScoreA != null && payload.projectedScoreB != null) {
        prompt += ` Projected score: ${Number(payload.projectedScoreA).toFixed(1)} – ${Number(payload.projectedScoreB).toFixed(1)}.`
      }
      if (payload.winProbA != null && payload.winProbB != null) {
        prompt += ` Win probability: ${Number(payload.winProbA).toFixed(0)}% – ${Number(payload.winProbB).toFixed(0)}%.`
      }
      if (payload.upsetChance != null && Number(payload.upsetChance) > 5) {
        prompt += ` Upset chance: ${Number(payload.upsetChance)}%.`
      }
      if (payload.volatilityTag) prompt += ` Volatility: ${payload.volatilityTag}.`
      prompt += ` Sport: ${sport}. What should I know about this matchup?`
      return { toolId: 'matchup_simulator', suggestedPrompt: prompt.slice(0, 500), contextHint: `Matchup: ${teamAName} vs ${teamBName}` }
    }
    case 'draft': {
      const parts = ['I need draft advice.']
      if (payload.sport) parts.push(`Sport: ${payload.sport}.`)
      if (payload.round != null) parts.push(`Round ${payload.round}.`)
      if (payload.pick != null) parts.push(`Pick ${payload.pick}.`)
      if (payload.queueLength != null && Number(payload.queueLength) > 0) {
        parts.push(`I have ${payload.queueLength} players in my queue.`)
      }
      if (payload.leagueName) parts.push(`League: ${payload.leagueName}.`)
      parts.push('What should I consider for my next pick?')
      return { toolId: 'mock_draft', suggestedPrompt: parts.join(' ').slice(0, 500), contextHint: 'Draft room context' }
    }
    case 'trade': {
      const prompt = 'Help me evaluate this trade. Who wins, and what should I consider?'
      return { toolId: 'trade_analyzer', suggestedPrompt: prompt, contextHint: payload.contextHint as string | undefined }
    }
    case 'waiver': {
      const prompt = 'Who should I target on the waiver wire this week, and what FAAB or priority should I use?'
      return { toolId: 'waiver_ai', suggestedPrompt: prompt, contextHint: payload.leagueName as string | undefined }
    }
    case 'league_forecast': {
      const prompt = 'Explain my league’s playoff odds and what I should do next.'
      return { toolId: 'league_forecast', suggestedPrompt: prompt, contextHint: 'League forecast / playoff odds' }
    }
    case 'rankings': {
      const leagueName = payload.leagueName ? ` in "${payload.leagueName}"` : ''
      const prompt = `How do my team and league${leagueName} look? What moves should I consider?`
      return { toolId: 'rankings', suggestedPrompt: prompt.slice(0, 500), contextHint: payload.leagueName as string | undefined }
    }
    case 'devy': {
      const leagueId = payload.leagueId as string | undefined
      const hint = leagueId ? `Devy league ${leagueId}` : 'Devy Dynasty'
      const prompt = (payload.promptType as string) === 'promotion'
        ? 'Who should I promote from my devy rights, and what is the roster impact?'
        : (payload.promptType as string) === 'trade_pick'
        ? 'Should I trade this devy pick? Compare to rookie capital and my pipeline.'
        : (payload.promptType as string) === 'pipeline'
        ? 'Is my devy class pipeline healthy? Rookie vs devy capital?'
        : 'Help with my Devy Dynasty league: promotion, devy picks, or pipeline.'
      return { toolId: 'devy_league', suggestedPrompt: prompt.slice(0, 500), contextHint: hint }
    }
    case 'c2c': {
      const leagueId = payload.leagueId as string | undefined
      const hint = leagueId ? `C2C league ${leagueId}` : 'College-to-Canton'
      const promptType = payload.promptType as string
      const prompt =
        promptType === 'promotion'
          ? 'Should I promote this player now or later? What is the impact on college vs pro standings?'
          : promptType === 'college_depth'
          ? 'Do I need more college depth? How does my pipeline look?'
          : promptType === 'pro_age'
          ? 'Am I too old on the pro side? Should I balance with college assets?'
          : promptType === 'trade_picks'
          ? 'Should I trade rookie picks for college assets (or vice versa)?'
          : promptType === 'build_direction'
          ? 'Should I build for college points now or pro points later?'
          : 'Help with my C2C league: promotion, college vs pro balance, pipeline, or draft strategy.'
      return { toolId: 'c2c_league', suggestedPrompt: prompt.slice(0, 500), contextHint: hint }
    }
    default:
      return { toolId: 'generic', suggestedPrompt: 'I have a fantasy sports question.', contextHint: undefined }
  }
}
