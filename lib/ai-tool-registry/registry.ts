/**
 * PROMPT 124 — AIToolRegistry. Every AI-powered tool plugs into the unified orchestration layer.
 * Supported sports: NFL, NHL, NBA, MLB, NCAAB, NCAAF, SOCCER.
 */

import type { AIMode, AIProvider } from './contracts'

export interface AIToolRegistration {
  /** Canonical tool key (featureType). */
  toolKey: string
  /** Display name. */
  toolName: string
  /** Whether deterministic context is required before AI runs. */
  deterministicRequired: boolean
  /** Allowed providers for this tool. */
  allowedProviders: AIProvider[]
  /** Supported orchestration modes. */
  supportedModes: AIMode[]
  /** Context fields required when deterministicRequired is true. */
  requiredContextFields: string[]
  /** Optional response schema hint (e.g. evidence, verdict, actionPlan). */
  responseSchema: string[]
}

const REGISTRY: AIToolRegistration[] = [
  {
    toolKey: 'trade_analyzer',
    toolName: 'Trade Analyzer',
    deterministicRequired: true,
    allowedProviders: ['openai', 'deepseek', 'grok'],
    supportedModes: ['single_model', 'specialist', 'consensus', 'unified_brain'],
    requiredContextFields: ['fairnessScore', 'valueDelta', 'sideATotalValue', 'sideBTotalValue'],
    responseSchema: ['evidence', 'valueVerdict', 'viabilityVerdict', 'actionPlan', 'confidence', 'uncertainty'],
  },
  {
    toolKey: 'waiver_ai',
    toolName: 'Waiver Wire AI',
    deterministicRequired: true,
    allowedProviders: ['openai', 'deepseek', 'grok'],
    supportedModes: ['single_model', 'specialist', 'consensus', 'unified_brain'],
    requiredContextFields: ['candidates', 'leagueSettings'],
    responseSchema: ['evidence', 'aiExplanation', 'actionPlan', 'confidence', 'uncertainty'],
  },
  {
    toolKey: 'draft_helper',
    toolName: 'Draft Helper',
    deterministicRequired: true,
    allowedProviders: ['openai', 'deepseek', 'grok'],
    supportedModes: ['single_model', 'specialist', 'consensus', 'unified_brain'],
    requiredContextFields: ['board', 'roster', 'scoring'],
    responseSchema: ['evidence', 'aiExplanation', 'actionPlan', 'confidence', 'uncertainty'],
  },
  {
    toolKey: 'matchup',
    toolName: 'Matchup Explainer',
    deterministicRequired: true,
    allowedProviders: ['openai', 'deepseek', 'grok'],
    supportedModes: ['single_model', 'specialist', 'consensus', 'unified_brain'],
    requiredContextFields: ['matchupSummary', 'projections'],
    responseSchema: ['evidence', 'aiExplanation', 'actionPlan', 'confidence', 'uncertainty'],
  },
  {
    toolKey: 'rankings',
    toolName: 'League Rankings Explainer',
    deterministicRequired: true,
    allowedProviders: ['openai', 'deepseek', 'grok'],
    supportedModes: ['single_model', 'specialist', 'consensus', 'unified_brain'],
    requiredContextFields: ['ordering', 'tiers'],
    responseSchema: ['evidence', 'aiExplanation', 'actionPlan', 'confidence', 'uncertainty'],
  },
  // 🛑 No `psychological` tool (owner decision 2026-09-29, Milestone 32: manager
  // characterisation is shown to nobody). It asked an LLM to explain a
  // caller-supplied manager profile. Its aliases are gone too, so every spelling
  // is "Unsupported tool" on /api/ai/run and /api/ai/compare.
  {
    toolKey: 'legacy_score',
    toolName: 'Legacy / Dynasty Explainer',
    deterministicRequired: true,
    allowedProviders: ['openai', 'deepseek', 'grok'],
    supportedModes: ['single_model', 'specialist', 'consensus', 'unified_brain'],
    requiredContextFields: ['score'],
    responseSchema: ['evidence', 'aiExplanation', 'actionPlan', 'confidence', 'uncertainty'],
  },
  {
    toolKey: 'rivalries',
    toolName: 'Rivalry Explainer',
    deterministicRequired: true,
    allowedProviders: ['openai', 'deepseek', 'grok'],
    supportedModes: ['single_model', 'specialist', 'consensus', 'unified_brain'],
    requiredContextFields: ['compositeScore'],
    responseSchema: ['evidence', 'aiExplanation', 'actionPlan', 'confidence', 'uncertainty'],
  },
  {
    toolKey: 'story_creator',
    toolName: 'League Story Creator',
    deterministicRequired: true,
    allowedProviders: ['openai', 'deepseek', 'grok'],
    supportedModes: ['single_model', 'consensus', 'unified_brain'],
    requiredContextFields: ['leagueSummary', 'facts'],
    responseSchema: ['evidence', 'aiExplanation', 'actionPlan', 'confidence', 'uncertainty'],
  },
  {
    toolKey: 'ai_commissioner',
    toolName: 'AI Commissioner',
    deterministicRequired: true,
    allowedProviders: ['openai', 'deepseek', 'grok'],
    supportedModes: ['single_model', 'specialist', 'consensus', 'unified_brain'],
    requiredContextFields: ['leagueSettings', 'activity'],
    responseSchema: ['evidence', 'aiExplanation', 'actionPlan', 'confidence', 'uncertainty'],
  },
  {
    toolKey: 'fantasy_coach',
    toolName: 'Fantasy Coach Mode',
    deterministicRequired: false,
    allowedProviders: ['openai', 'deepseek', 'grok'],
    supportedModes: ['single_model', 'consensus', 'unified_brain'],
    requiredContextFields: [],
    responseSchema: ['evidence', 'aiExplanation', 'actionPlan', 'confidence', 'uncertainty'],
  },
  {
    toolKey: 'content',
    toolName: 'Content Generator',
    deterministicRequired: false,
    allowedProviders: ['openai', 'deepseek', 'grok'],
    supportedModes: ['single_model', 'specialist', 'consensus', 'unified_brain'],
    requiredContextFields: [],
    responseSchema: ['evidence', 'aiExplanation', 'actionPlan', 'confidence', 'uncertainty'],
  },
  {
    toolKey: 'blog_generator',
    toolName: 'Blog Generator',
    deterministicRequired: false,
    allowedProviders: ['openai', 'deepseek', 'grok'],
    supportedModes: ['single_model', 'consensus', 'unified_brain'],
    requiredContextFields: [],
    responseSchema: ['evidence', 'aiExplanation', 'actionPlan', 'confidence', 'uncertainty'],
  },
  {
    toolKey: 'social_clip_generator',
    toolName: 'Social Clip Generator',
    deterministicRequired: false,
    allowedProviders: ['openai', 'deepseek', 'grok'],
    supportedModes: ['single_model', 'consensus', 'unified_brain'],
    requiredContextFields: [],
    responseSchema: ['evidence', 'aiExplanation', 'actionPlan', 'confidence', 'uncertainty'],
  },
  {
    toolKey: 'chimmy_chat',
    toolName: 'Chimmy Chat',
    deterministicRequired: false,
    allowedProviders: ['openai', 'deepseek', 'grok'],
    supportedModes: ['single_model', 'consensus', 'unified_brain'],
    requiredContextFields: [],
    responseSchema: ['aiExplanation', 'confidence', 'uncertainty'],
  },
  {
    toolKey: 'start_vs',
    toolName: 'Start A vs B (Player Comparison)',
    deterministicRequired: true,
    allowedProviders: ['openai', 'deepseek', 'grok'],
    supportedModes: ['single_model', 'specialist', 'consensus', 'unified_brain'],
    requiredContextFields: ['deterministic', 'playerA', 'playerB', 'sport'],
    responseSchema: ['shortVerdict', 'fullReasoning', 'confidence', 'floorPick', 'upsidePick', 'riskFlags'],
  },
]

const BY_KEY = new Map<string, AIToolRegistration>()
REGISTRY.forEach((r) => BY_KEY.set(r.toolKey, r))
const TOOL_ALIASES: Record<string, string> = {
  'trade-analyzer': 'trade_analyzer',
  tradeanalyzer: 'trade_analyzer',
  trade_analyzer: 'trade_analyzer',
  'trade analyzer': 'trade_analyzer',
  'waiver-wire': 'waiver_ai',
  'waiver-wire-ai': 'waiver_ai',
  'waiver wire ai': 'waiver_ai',
  waiver: 'waiver_ai',
  waiver_ai: 'waiver_ai',
  'draft-helper': 'draft_helper',
  'draft helper': 'draft_helper',
  draft_helper: 'draft_helper',
  'matchup-explainer': 'matchup',
  'matchup explainer': 'matchup',
  matchup_explainer: 'matchup',
  'league-rankings-explainer': 'rankings',
  'league rankings explainer': 'rankings',
  league_rankings_explainer: 'rankings',
  story: 'story_creator',
  'league-story-creator': 'story_creator',
  'league story creator': 'story_creator',
  story_creator: 'story_creator',
  'ai-commissioner': 'ai_commissioner',
  'ai commissioner': 'ai_commissioner',
  ai_commissioner: 'ai_commissioner',
  'fantasy-coach': 'fantasy_coach',
  'fantasy-coach-mode': 'fantasy_coach',
  'fantasy coach mode': 'fantasy_coach',
  fantasy_coach: 'fantasy_coach',
  'content-generator': 'content',
  'content generator': 'content',
  content_generator: 'content',
  'blog-generator': 'blog_generator',
  'blog generator': 'blog_generator',
  'social-clip-generator': 'social_clip_generator',
  'social clip generator': 'social_clip_generator',
  'chimmy-chat': 'chimmy_chat',
  'chimmy chat': 'chimmy_chat',
  chimmy_chat: 'chimmy_chat',
  'start-vs': 'start_vs',
  start_vs: 'start_vs',
  'start vs b': 'start_vs',
  player_comparison: 'start_vs',
  'player-comparison': 'start_vs',
  legacy: 'legacy_score',
  rivalry: 'rivalries',
  simulation: 'matchup',
}

/** All registered tools. */
export function getAIToolRegistry(): AIToolRegistration[] {
  return [...REGISTRY]
}

/** Get one tool by key. Returns null if unsupported. */
export function getToolRegistration(toolKey: string): AIToolRegistration | null {
  const key = (toolKey || '').trim().toLowerCase()
  const underscored = key.replace(/[\s-]+/g, '_')
  const canonicalKey = TOOL_ALIASES[key] ?? TOOL_ALIASES[underscored] ?? underscored
  return BY_KEY.get(canonicalKey) ?? null
}

/** Check if tool is supported. */
export function isToolSupported(toolKey: string): boolean {
  return getToolRegistration(toolKey) != null
}

/** Validate request: tool must be registered; if deterministicRequired, deterministicContext must have required fields. */
export function validateToolRequest(
  toolKey: string,
  deterministicContext?: Record<string, unknown> | null,
  options?: {
    leagueSettings?: Record<string, unknown> | null
    sport?: string | null
  }
): { valid: boolean; error?: string } {
  const reg = getToolRegistration(toolKey)
  if (!reg) {
    return { valid: false, error: `Unsupported tool: ${toolKey}. Use GET /api/ai/tools for allowed tools.` }
  }
  if (!reg.deterministicRequired) return { valid: true }
  if (!deterministicContext || typeof deterministicContext !== 'object') {
    return { valid: false, error: `Tool "${reg.toolName}" requires deterministicContext.` }
  }
  const missing = reg.requiredContextFields.filter((field) => {
    const deterministicValue = deterministicContext[field]
    if (deterministicValue !== undefined && deterministicValue !== null) return false
    if (field === 'leagueSettings' && options?.leagueSettings && typeof options.leagueSettings === 'object') {
      return false
    }
    if (field === 'sport' && typeof options?.sport === 'string' && options.sport.trim().length > 0) {
      return false
    }
    return true
  })
  if (missing.length > 0) {
    return { valid: false, error: `Missing required context fields: ${missing.join(', ')}.` }
  }
  return { valid: true }
}

/** Resolve effective mode for tool (requested mode if allowed, else first supported). */
export function resolveModeForTool(toolKey: string, requestedMode?: AIMode | null): AIMode {
  const reg = getToolRegistration(toolKey)
  if (!reg) return 'unified_brain'
  if (requestedMode && reg.supportedModes.includes(requestedMode)) return requestedMode
  return reg.supportedModes[0] ?? 'unified_brain'
}

/** Allowed provider list for tool (for UI). */
export function getAllowedProvidersForTool(toolKey: string): AIProvider[] {
  const reg = getToolRegistration(toolKey)
  return reg?.allowedProviders ?? ['openai', 'deepseek', 'grok']
}
