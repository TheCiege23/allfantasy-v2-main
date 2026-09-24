import { NextRequest, NextResponse } from 'next/server'
import { isAiSpendEnabled } from '@/lib/ai/aiSpendGuard'
import { z } from 'zod'
import { getServerSession } from 'next-auth'
import OpenAI from 'openai'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { parseHomeSignals, renderHomeSignalsPrompt } from '@/lib/core-app/homeSignals'
import { CORE_SURFACE_KEYS, renderCoreSurfacePrompt } from '@/lib/core-app/coreSurface'
import { requireAgeConfirmedUser } from '@/lib/auth-guard'
import { buildUserTemporalContextForAI } from '@/lib/preferences/userTemporalContextForAI'
import { CHIMMY_REFERENCE_TIMEZONE, CHIMMY_TOOL_LOOP_SYSTEM_PROMPT } from '@/lib/chimmy/tools/toolLoopSystemPrompt'
import { runPECR } from '@/lib/ai/pecr'
import { runAiProtection } from '@/lib/ai-protection'
import { runUnifiedOrchestration } from '@/lib/ai-orchestration/orchestration-service'
import {
  requestContractToUnified,
  unifiedResponseToContract,
  validateToolRequest,
  type AIToolResponseContract,
} from '@/lib/ai-tool-registry'
import { getInsightBundle } from '@/lib/ai-simulation-integration'
import type { InsightType } from '@/lib/ai-simulation-integration'
import { DEFAULT_SPORT, normalizeToSupportedSport, type SupportedSport } from '@/lib/sport-scope'
import {
  loadLeagueGroundingForUser,
  type ChimmyLeagueGroundingFailure,
  type ChimmyLeagueSnapshot,
} from '@/lib/chimmy/chimmy-league-snapshot'
import { buildPsychologyGroundingLines } from '@/lib/psychological-profiles/ProfileAccess'
import { resolveNormalizedLeagueContext } from '@/lib/league-context-engine'
import type { NormalizedLeagueContext } from '@/lib/league-context-engine/types'
import { buildChimmySportDataDigest } from '@/lib/chimmy/chimmy-sport-data-digest'
import { resolveEffectiveSeason } from '@/lib/chimmy/effectiveSeason'
import {
  buildChimmySourceReferences,
  buildChimmyStalenessWarning,
  detectManagerAmbiguity,
  resolveChimmyLeagueSelection,
} from '@/lib/chimmy/chimmy-league-resolution'
import { enrichChatWithData } from '@/lib/chat-data-enrichment'
import {
  buildBehaviorRulesPrompt,
  checkBehaviorRules,
  checkCustomRules,
  loadCustomRules,
  logRuleViolations,
} from '@/lib/ai/behavior-rules'
import { buildMemoryPromptSection, getFullAIContext } from '@/lib/ai-memory'
import { getChimmyMemoryContext } from '@/lib/ai-memory/chimmy-memory-context'
import {
  appendChatHistory,
  buildChimmyConversationId,
  getRecentChatHistory,
} from '@/lib/ai-memory/chat-history-store'
import { rememberChimmyAssistantMemory, rememberChimmyUserMessageMemory } from '@/lib/ai-memory/ai-memory-store'
import {
  prepareWorkingMemory,
  recordAIResponse,
  recordDecision,
  recordToolCall,
} from '@/lib/ai/working-memory'
import { buildAgentPrompt, inferAgentFromMessage } from '@/lib/agents/pipeline'
import { buildTournamentContextForChimmy } from '@/lib/tournament-mode/ai/tournamentContextForChimmy'
import { buildBigBrotherContextForChimmy } from '@/lib/big-brother/ai/bigBrotherContextForChimmy'
import { buildIdpContextForChimmy } from '@/lib/idp/ai/idpContextForChimmy'
import { buildSurvivorContextForChimmy } from '@/lib/survivor/ai/survivorContextForChimmy'
import { buildRedraftContextForChimmy } from '@/lib/redraft-war-room/redraftChimmyGrounding'
import { buildZombieContextForChimmy } from '@/lib/zombie/ai/zombieContextForChimmy'
import { buildDevyContextForChimmy } from '@/lib/devy/ai/devyContextForChimmy'
import { buildGuillotineContextForChimmy } from '@/lib/guillotine/ai/guillotineContextForChimmy'
import { buildC2CContextForChimmy } from '@/lib/merged-devy-c2c/ai/c2cContextForChimmy'
import { buildSalaryCapContextForChimmy } from '@/lib/salary-cap/ai/salaryCapContextForChimmy'
import { buildDynastyContextForChimmy } from '@/lib/dynasty-core/dynastyContextForChimmy'
import { buildDynastyWarRoomContextForChimmy } from '@/lib/dynasty-war-room/dynastyChimmyGrounding'
import { buildKeeperContextForChimmy } from '@/lib/keeper-war-room/keeperChimmyGrounding'
import { buildBestBallContextForChimmy } from '@/lib/best-ball-war-room/bestBallChimmyGrounding'
import { buildGuillotineWarRoomContextForChimmy } from '@/lib/guillotine-war-room/guillotineChimmyGrounding'
import { buildTradeContextForChimmy } from '@/lib/chimmy-trade/tradeChimmyGrounding'
import { buildTradeBlockContext } from '@/lib/chimmy/tradeBlockGrounding'
import { buildPendingTradeDecisionContext } from '@/lib/chimmy-trade/pendingTradeDecisionGrounding'
import {
  buildLeagueTradeHistoryOutcome,
  TRADE_HISTORY_BLOCK_MARKER,
} from '@/lib/chimmy-trade/leagueTradeHistoryGrounding'
import { buildLeagueStandingsContext } from '@/lib/chimmy/leagueStandingsGrounding'
import { buildRuleGroundingGap } from '@/lib/chimmy/leagueRulesGrounding'
import { buildDecisionEnvelopeGrounding } from '@/lib/chimmy/decisionEnvelopeGrounding'
import {
  classifyScreenshotEvidence,
  fenceScreenshotEvidence,
  screenshotNeedsClarification,
} from '@/lib/chimmy/screenshotEvidence'
import { buildHeadToHeadGrounding } from '@/lib/chimmy/headToHeadGrounding'
import { buildDescribedTradeContext } from '@/lib/chimmy-trade/describedTradeEvaluator'
import {
  buildTradeScenario,
  looksLikeDescribedTrade,
  renderTradeScenarioBlock,
  type TradeScenario,
} from '@/lib/chimmy/tradeScenarioGrounding'
import {
  buildStartSitScenario,
  buildWaiverScenario,
  renderStartSitScenarioBlock,
  renderWaiverScenarioBlock,
} from '@/lib/chimmy/lineupScenarioGrounding'
import type { ReadyChimmyScenario, StartSitScenario, WaiverScenario } from '@/lib/chimmy/tradeScenarioTypes'
import { parseTradeTargetQuestion } from '@/lib/chimmy/tradeTargetQuestion'
import { buildTradeTargetVerdict, type TradeTargetResult } from '@/lib/chimmy/tradeTargetVerdict'
import { renderTradeTargetVerdict } from '@/lib/chimmy/tradeTargetDecision'
import { buildDraftContext } from '@/lib/chimmy/draftGrounding'
import { buildWaiverContext } from '@/lib/chimmy/waiverGrounding'
import { buildPlayerNewsContext } from '@/lib/chimmy/playerNewsGrounding'
import { buildCommissionerContext } from '@/lib/chimmy/commissionerGrounding'
import { buildLiveSlateContext } from '@/lib/chimmy/liveSlateGrounding'
import { applyGroundingBudget } from '@/lib/chimmy/groundingBudget'
import { buildChimmyPlayerCards } from '@/lib/chimmy/chimmyPlayerCards'
import { resolveImagesByPlayerName } from '@/lib/players/sleeperPlayerCrosswalk'
import { CHIMMY_GENERIC_ERROR_MESSAGE } from '@/lib/chimmy-chat/response-copy'
import { judgeChimmyDelivery } from '@/lib/chimmy/chargeOnDelivery'
import {
  buildChimmyResponseForAssistantMode,
  normalizeChimmyAssistantMode,
} from '@/lib/chimmy-chat/assistant-mode'
import { getChimmyFeatureFlags } from '@/lib/chimmy-chat/feature-flags'
import { isLikelySportsResultQuestion } from '@/lib/chimmy-chat/sports-question-intent'
import { classifyPecrIntent, requiresLeagueGrounding } from '@/lib/chimmy-chat/question-routing'
/*
 * ⚠ NOT IMPORTED AT MODULE SCOPE. The loop pulls in the OpenAI SDK and every
 * grounding builder its tools wrap, and the flag is OFF by default — so a
 * static import would load all of it on every chat request for a feature almost
 * nobody has enabled. It is imported inside the guard instead. Measured: the
 * static version pushed route module init past a 30s test timeout.
 */
import { buildChimmyAnswerContract } from '@/lib/chimmy-chat/response-contract'
import { persistChimmyAIAnalyticsEvent } from '@/lib/chimmy-chat/analytics-events'
import { checkChimmyHallucination } from '@/lib/chimmy-chat/hallucination-guard'
import { tryDeterministicAnswerDetailed, DETERMINISTIC_SOURCE, isOwnRosterInjuryQuestion } from '@/lib/ai/deterministic'
import { grantDailyFreeTokens } from '@/lib/tokens/dailyFreeTokens'

/** Provenance for an answer that came from the web, not from our rows. */
const LIVE_SEARCH_SOURCE = 'live_web_search' as const
import {
  buildLeagueDataUsageAnswer,
  buildLeagueSportsGroundingPacket,
  serializeLeagueGroundingForPrompt,
} from '@/lib/ai/leagueSportsGroundingPacket'
import { buildPortfolioPlayerGrounding } from '@/lib/chimmy/chimmyPortfolioPlayerGrounding'
import { buildMyRosterInjuriesContext } from '@/lib/chimmy/tools/myRosterInjuriesTool'
import { buildDecisionOsGroundingPacket } from '@/lib/decision-os/grounding/packet'
import { recordChatWaiverAdvice } from '@/lib/chimmy-advice/chatWaiverAdvice'
import { resolveCallerTeamId } from '@/lib/chimmy/callerTeam'
import { readAdviceLearningSnapshot } from '@/lib/chimmy-outcomes/adviceLearning'
import { trackRecordsFrom } from '@/lib/chimmy-outcomes/learningSnapshot'
import { serializeDecisionOsGroundingForPrompt } from '@/lib/decision-os/grounding/serialize'
import { resolveLanguage } from '@/lib/i18n/constants'
import {
  TokenInsufficientBalanceError,
  TokenSpendConfirmationRequiredError,
  TokenSpendService,
  TokenSpendRuleNotFoundError,
  type TokenSpendPreview,
} from '@/lib/tokens/TokenSpendService'
import {
  buildChimmyPromptPersonalizationDirectives,
  resolveChimmyPersonalizationProfile,
} from '@/lib/chimmy-personalization'
import { recordChimmyQualityEvent } from '@/lib/chimmy-quality/ChimmyQualityAnalytics'
import { getAiMemory } from '@/lib/ai-memory/ai-memory-store'
import { COACHING_PROFILE_KEY, mergeCoachingProfiles } from '@/lib/chimmy-personalization/remembered'
import {
  appendOrchestrationFooterIfMissing,
  buildOrchestrationMeta,
  buildOrchestrationPromptSection,
  buildMemorySummaryLine,
  classifyChimmyIntent,
  parseOrchestrationResponseSections,
} from '@/lib/chimmy-orchestration'
import { deriveWantFromIntent } from '@/lib/decision-os/grounding/intentToWant'
import { resolvePairedHalf } from '@/lib/core-app/leaguePairing'
import { renderConnectedFranchiseGrounding } from '@/lib/chimmy/connectedFranchiseGrounding'

type ConversationTurn = {
  role: 'user' | 'assistant'
  content: string
}

type ChimmyPECRExecutionOutput = {
  responseContract: AIToolResponseContract
  modelOutputs?: Array<{
    model?: string
    modelName?: string
    skipped?: boolean
    /** What the model returned — read by `judgeChimmyDelivery` to decide whether the charge stands. */
    raw?: string
    error?: string
    tokensPrompt?: number
    tokensCompletion?: number
  }>
  sanitizedAiExplanation: string
  sanitizedActionPlan: string
  sanitizedUncertainty: string
  providerStatus: Record<string, string>
  quantData?: Record<string, unknown>
  trendData?: Record<string, unknown>
  recommendedTool: string
  toolLinks: string[]
  responseStructure: ReturnType<typeof buildResponseStructure>
  processingMs: number
}

type ChimmyPECRPlanContext = {
  legacyEnrichmentContext: string
  enrichmentLoaded: boolean
  enrichmentSources: string[]
  legacyMemoryLoaded: boolean
  legacyMemorySection: string
}

const PECR_VALID_TOOL_ROUTES = new Set([
  '/trade-analyzer',
  '/trade-evaluator',
  '/waiver-wire',
  '/waiver-ai',
  '/draft-helper',
  '/rankings',
  '/mock-draft',
  '/fantasy-coach',
  '/player-comparison',
  '/tools/player-decision',
  '/matchup-simulator',
  '/social-clips',
  '/ai/tools',
])

function isAllowedChimmyToolLink(link: string): boolean {
  if (PECR_VALID_TOOL_ROUTES.has(link.split('?')[0] ?? link)) return true
  const path = link.split('?')[0] ?? ''
  const prefixes = [
    '/app/league/',
    '/tools/',
    '/trade-evaluator',
    '/waiver-ai',
    '/rankings',
    '/mock-draft',
    '/matchup-simulator',
    '/social-clips',
    '/player-compare',
    '/chimmy/',
    '/ai/',
    '/app/matchup-simulation',
  ]
  return prefixes.some((p) => path.startsWith(p))
}

class ChimmyPECRExecutionError extends Error {
  status: number
  userMessage: string
  traceId?: string

  constructor(message: string, status: number, userMessage: string, traceId?: string) {
    super(message)
    this.name = 'ChimmyPECRExecutionError'
    this.status = status
    this.userMessage = userMessage
    this.traceId = traceId
  }
}

const INSIGHT_TYPE_VALUES = [
  'matchup',
  'playoff',
  'dynasty',
  'trade',
  'waiver',
  'draft',
] as const satisfies readonly InsightType[]

const MAX_MESSAGE_CHARS = 4_000
const MAX_CONVERSATION_TURNS = 20
const MAX_CONVERSATION_CONTEXT_TURNS = 10
const MAX_CONVERSATION_CONTENT_CHARS = 4_000
const MAX_GENERIC_FIELD_CHARS = 120
const MAX_USERNAME_CHARS = 80
const MAX_SOURCE_CHARS = 64
const MAX_ASSISTANT_MODE_CHARS = 32
const MAX_STRATEGY_MODE_CHARS = 48
const MAX_SPORT_CHARS = 32
const MAX_LEAGUE_FORMAT_CHARS = 48
const MAX_SCORING_CHARS = 48
const MAX_TONE_CHARS = 48
const MAX_DETAIL_LEVEL_CHARS = 32
const MAX_RISK_MODE_CHARS = 32
const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024
const ALLOWED_SCREENSHOT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
])

const ConversationTurnSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().trim().min(1).max(MAX_CONVERSATION_CONTENT_CHARS),
})

const optionalTrimmedStringField = (maxLength: number) =>
  z.preprocess((value) => {
    if (value == null) return undefined
    if (typeof value !== 'string') return value
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : undefined
  }, z.string().max(maxLength).optional())

const booleanFormField = z.preprocess((value) => {
  if (value == null || value === '') return false
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return value

  const normalized = value.trim().toLowerCase()
  if (normalized === 'true') return true
  if (normalized === 'false') return false
  return value
}, z.boolean())

function optionalIntFormField(min: number, max: number) {
  return z.preprocess((value) => {
    if (value == null || value === '') return undefined
    if (typeof value === 'number') return value
    if (typeof value !== 'string') return value

    const trimmed = value.trim()
    if (!trimmed) return undefined
    return Number(trimmed)
  }, z.number().int().min(min).max(max).optional())
}

const ChimmyFormSchema = z.object({
  message: z.preprocess((value) => {
    if (value == null) return ''
    if (typeof value !== 'string') return value
    return value.trim()
  }, z.string().max(MAX_MESSAGE_CHARS)),
  confirmTokenSpend: booleanFormField,
  conversationId: optionalTrimmedStringField(MAX_GENERIC_FIELD_CHARS),
  sessionId: optionalTrimmedStringField(MAX_GENERIC_FIELD_CHARS),
  privateMode: booleanFormField,
  targetUsername: optionalTrimmedStringField(MAX_USERNAME_CHARS),
  assistantMode: optionalTrimmedStringField(MAX_ASSISTANT_MODE_CHARS),
  mode: optionalTrimmedStringField(MAX_ASSISTANT_MODE_CHARS),
  strategyMode: optionalTrimmedStringField(MAX_STRATEGY_MODE_CHARS),
  source: optionalTrimmedStringField(MAX_SOURCE_CHARS),
  leagueId: optionalTrimmedStringField(MAX_GENERIC_FIELD_CHARS),
  sleeperUsername: optionalTrimmedStringField(MAX_USERNAME_CHARS),
  teamId: optionalTrimmedStringField(MAX_GENERIC_FIELD_CHARS),
  sport: optionalTrimmedStringField(MAX_SPORT_CHARS),
  leagueFormat: optionalTrimmedStringField(MAX_LEAGUE_FORMAT_CHARS),
  scoring: optionalTrimmedStringField(MAX_SCORING_CHARS),
  tone: optionalTrimmedStringField(MAX_TONE_CHARS),
  detailLevel: optionalTrimmedStringField(MAX_DETAIL_LEVEL_CHARS),
  riskMode: optionalTrimmedStringField(MAX_RISK_MODE_CHARS),
  season: optionalIntFormField(1900, 3000),
  week: optionalIntFormField(1, 100),
  insightType: z.preprocess((value) => {
    if (value == null) return undefined
    if (typeof value !== 'string') return value
    const trimmed = value.trim().toLowerCase()
    return trimmed.length > 0 ? trimmed : undefined
  }, z.enum(INSIGHT_TYPE_VALUES).optional()),
  /** When set to `all`, Chimmy pulls multi-sport injury/news digest (no single-sport filter). */
  sportScope: z.preprocess((value) => {
    if (value == null || value === '') return undefined
    if (typeof value !== 'string') return value
    return value.trim().toLowerCase() === 'all' ? 'all' : undefined
  }, z.enum(['all']).optional()),
  leagueName: optionalTrimmedStringField(120),
  connectedLeagueIds: optionalTrimmedStringField(2000),
  /**
   * The /core home's own signals — a validated id/count payload, never prose.
   * See lib/core-app/homeSignals.ts for why nothing free-text crosses this
   * boundary: @chimmy answers are posted publicly in the league tab.
   */
  homeSignals: optionalTrimmedStringField(2000),
  coreSurface: z.preprocess(
    (value) => (value == null || value === '' ? undefined : value),
    z.enum(CORE_SURFACE_KEYS).optional(),
  ),
  conversation: z.array(ConversationTurnSchema).max(MAX_CONVERSATION_TURNS),
  hasImage: z.boolean(),
})

/** A question about the trade block itself, whatever its intent classifies as. */
const TRADE_BLOCK_WORDS = /\b(?:trade|trading)\s+block\b|\bon\s+the\s+block\b|\btrade\s+bait\b/i

/**
 * The tool loop's system prompt.
 *
 * ⚠ IT CARRIES THE SAME REFUSAL RULES AS THE PUSH PATH. When the model fetches
 * its own context, nothing upstream can guarantee the context is there — so the
 * instruction not to invent has to travel with the tools, or the loop quietly
 * becomes the one path in this assistant that guesses.
 */

const SPORTS_KEYWORDS = [
  'trade', 'waiver', 'draft', 'player', 'pick', 'roster', 'lineup',
  'start', 'sit', 'drop', 'add', 'quarterback', 'receiver', 'running back',
  'tight end', 'kicker', 'defense', 'fantasy', 'points', 'league', 'playoffs',
  // 'injury' -> 'injur': every other entry pluralizes with a plain +s/+es, which
  // keeps the singular a substring of the plural ("trade" in "trades"). Injury's
  // plural is irregular (y -> ies), so "injuries" does not contain "injury" and
  // a completely ordinary question ("any injuries I should know about?") was
  // silently gated out before ever reaching Chimmy. The stem covers injury,
  // injuries and injured without the same gap reappearing.
  'standings', 'bench', 'injur', 'bye week', 'matchup', 'projection',
  'qb', 'rb', 'wr', 'te', 'flex', 'superflex', 'ppr', 'dynasty', 'keeper',
  'faab', 'auction', 'nfl', 'nba', 'mlb', 'basketball', 'baseball', 'football',
  'nhl', 'hockey', 'soccer', 'futbol', 'fútbol', 'ncaab', 'ncaaf',
  'world cup', 'fifa', 'mundial', 'bracket', 'pool', 'champion', 'knockout',
  'group stage', 'leaderboard', 'commissioner',
  /*
   * ⚠ ADDED AFTER A PLAIN SPORTS QUESTION WAS SILENTLY DEFLECTED. "is there any
   * preseason games today?" matched NOTHING above — there was no `game`, no
   * `season`, no `schedule`, no `score` — so it never reached a provider and
   * came back as the generic "I can help with trades, waivers..." blurb, which
   * reads exactly like Chimmy ignoring you. Same shape as the `injuries` gap
   * already documented a few lines up; the list was the problem both times.
   *
   * The asymmetry that matters: a FALSE POSITIVE here costs one model call. A
   * FALSE NEGATIVE costs a user who now believes the assistant is broken. This
   * list should stay deliberately generous, and anything resembling a sports or
   * league noun belongs in it.
   */
  'game', 'season', 'schedule', 'score', 'week', 'team', 'stat', 'news',
  'kickoff', 'snap', 'target', 'yard', 'touchdown', 'sleeper', 'espn', 'yahoo',
  'opponent', 'starter', 'sunday', 'monday', 'thursday', 'coach', 'depth chart',
  'sportsbook', 'odds', 'spread', 'over/under', 'preseason', 'postseason',
  /*
   * Stat vocabulary for the stored-stats tools (2026-09-23): "who leads college in rushing",
   * "most sacks this year", "Arch Manning passing numbers" named no noun above.
   */
  'rushing', 'passing', 'receiving', 'reception', 'sack', 'tackle', 'interception', 'leader',
  'leads', 'college', 'conference', 'record', 'games played', 'box score', 'game log',
  /* MLB / NBA / NHL stat vocabulary (Phase 3, 2026-09-24). */
  'home run', 'homer', 'rbi', 'batting', 'pitching', 'strikeout', 'rebound', 'assist',
  'goalie', 'hat trick', 'three-pointer', 'last night', 'march madness', 'ncaa tournament',
]

function hasSportsContent(text: string, hasImage: boolean): boolean {
  if (hasImage) return true
  const lower = text.toLowerCase()
  return SPORTS_KEYWORDS.some((keyword) => lower.includes(keyword)) || isLikelySportsResultQuestion(text)
}

function parseConversationPayload(raw: FormDataEntryValue | null): unknown {
  if (raw == null) return []
  if (typeof raw !== 'string') {
    throw new Error('Conversation payload must be a JSON string.')
  }

  if (raw.trim().length === 0) return []
  try {
    return JSON.parse(raw)
  } catch {
    throw new Error('Conversation payload must be valid JSON.')
  }
}

function validateScreenshotFile(raw: FormDataEntryValue | null): {
  file: File | null
  hasImage: boolean
  error?: string
} {
  if (raw == null) {
    return { file: null, hasImage: false }
  }

  if (!(raw instanceof File)) {
    return {
      file: null,
      hasImage: false,
      error: 'Image must be uploaded as a file.',
    }
  }

  if (raw.size <= 0) {
    return { file: null, hasImage: false }
  }

  if (!ALLOWED_SCREENSHOT_TYPES.has(raw.type)) {
    return {
      file: null,
      hasImage: false,
      error: 'Unsupported image type. Use JPEG, PNG, GIF, or WebP.',
    }
  }

  if (raw.size > MAX_SCREENSHOT_BYTES) {
    return {
      file: null,
      hasImage: false,
      error: 'Image too large (max 5MB).',
    }
  }

  return { file: raw, hasImage: true }
}

function extractFirstSentence(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, ' ')
  if (!trimmed) return ''
  const match = trimmed.match(/(.+?[.!?])(\s|$)/)
  return (match?.[1] ?? trimmed).slice(0, 220)
}

function safeParseJson(raw: string): Record<string, unknown> | null {
  if (!raw || !raw.trim()) return null
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    const candidate = raw
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim()
    try {
      return JSON.parse(candidate) as Record<string, unknown>
    } catch {
      return null
    }
  }
}

function findJsonLikeObjectRanges(text: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = []
  let depth = 0
  let start = -1
  let inString = false
  let stringQuote = ''
  let escaped = false

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]

    if (escaped) {
      escaped = false
      continue
    }

    if (inString) {
      if (char === '\\') {
        escaped = true
        continue
      }
      if (char === stringQuote) {
        inString = false
        stringQuote = ''
      }
      continue
    }

    if (char === '"' || char === "'") {
      inString = true
      stringQuote = char
      continue
    }

    if (char === '{') {
      if (depth === 0) {
        start = i
      }
      depth += 1
      continue
    }

    if (char === '}' && depth > 0) {
      depth -= 1
      if (depth === 0 && start >= 0) {
        const candidate = text.slice(start, i + 1)
        if (candidate.includes(':')) {
          ranges.push({ start, end: i + 1 })
        }
        start = -1
      }
    }
  }

  return ranges
}

function sanitizeAssistantDisplayText(raw: string | null | undefined): string {
  const normalized = String(raw ?? '')
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim()

  if (!normalized) return ''

  const jsonRanges = findJsonLikeObjectRanges(normalized)
  if (jsonRanges.length === 0) {
    return normalized
  }

  const trailingText = normalized
    .slice(jsonRanges[jsonRanges.length - 1].end)
    .replace(/^[\s\-:;,.!?)\]}]+/, '')
    .trim()

  if (trailingText) {
    return trailingText
  }

  let stripped = ''
  let cursor = 0
  for (const range of jsonRanges) {
    stripped += normalized.slice(cursor, range.start)
    cursor = range.end
  }
  stripped += normalized.slice(cursor)

  const cleaned = stripped
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([:;,.!?])(?:\s*\1)+/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim()

  return cleaned || normalized
}

function compactRecord<T extends Record<string, unknown>>(record: T): Record<string, unknown> {
  const entries = Object.entries(record).filter(([, value]) => value !== undefined)
  return Object.fromEntries(entries)
}

/**
 * What to tell the user when Chimmy cannot see the league they selected.
 *
 * Each reason gets its own sentence on purpose. "You are not in this league" and
 * "I could not reach the league right now" call for different next actions, and
 * collapsing them into one message trains people to ignore the message.
 */
function describeLeagueGroundingFailure(reason: ChimmyLeagueGroundingFailure): string {
  switch (reason) {
    /*
     * 🛑 `not_member` AND `not_found` SHARE ONE BRANCH AND ONE STRING. THEY MUST
     * NOT MERELY BE 'SIMILAR'.
     *
     * A previous pass removed the words "I can see that league exists" from the
     * not_member copy and claimed the two were now identical. They were not:
     * not_member said "could not open that league" and not_found said "could not
     * find that league". That is still an enumeration oracle — walk ids, read the
     * verb, learn which leagues are real. The claim was wrong and the test that
     * was supposed to cover it asserted /could not open that league/, pinning the
     * distinguishable string instead of comparing the two cases.
     *
     * ⚠ SHARED FALLTHROUGH RATHER THAN TWO IDENTICAL RETURNS. Two branches that
     * happen to hold the same literal drift the moment someone improves one of
     * them, and the drift is invisible in review. One branch cannot drift.
     *
     * ⚠ `anonymous` AND `error` STAY DISTINCT, DELIBERATELY. Anonymous is an
     * authentication problem the user can fix and telling them costs nothing —
     * it reveals nothing about which leagues exist. `error` is transient
     * infrastructure, and collapsing it into this message would tell a member of
     * their own league that they are not in it.
     */
    case 'not_member':
    case 'not_found':
      return 'I could not open that league for your account. If it is yours and you just imported it, claim your team and ask again.'
    case 'anonymous':
      return 'I could not confirm who you are signed in as, so I cannot read that league.'
    case 'error':
    default:
      return 'I could not reach that league just now, so I will not guess about your roster. Try again in a moment.'
  }
}

function buildLeagueGroundingErrorPayload() {
  return {
    error:
      'League context is required for trade, waiver, and team-specific planning requests. Open Chimmy from a league context or include leagueId.',
  }
}

function buildProviderStatusMap(responseContract: AIToolResponseContract): Record<string, string> {
  const status: Record<string, string> = {
    openai: 'skipped',
    deepseek: 'skipped',
    grok: 'skipped',
  }

  for (const provider of responseContract.reliability?.providerStatus ?? []) {
    status[provider.provider] =
      provider.status === 'ok'
        ? 'ok'
        : provider.status === 'timeout'
          ? 'error'
          : provider.status === 'invalid_response'
            ? 'error'
            : 'error'
  }

  return status
}

function extractQuantData(responseContract: AIToolResponseContract): Record<string, unknown> | undefined {
  const deepseek = responseContract.providerResults.find((provider) => provider.provider === 'deepseek')
  if (!deepseek?.raw) return undefined
  const parsed = safeParseJson(deepseek.raw)
  return parsed ?? undefined
}

function extractTrendData(responseContract: AIToolResponseContract): Record<string, unknown> | undefined {
  const grok = responseContract.providerResults.find((provider) => provider.provider === 'grok')
  if (!grok?.raw) return undefined
  const parsed = safeParseJson(grok.raw)
  return parsed ?? undefined
}

function buildResponseStructure(
  answer: string,
  actionPlan?: string | null,
  uncertainty?: string | null
): {
  shortAnswer: string
  whatDataSays?: string
  whatItMeans?: string
  recommendedAction?: string
  caveats?: string[]
  sectionTitles?: {
    shortAnswer: string
    whatDataSays: string
    whatItMeans: string
    recommendedAction: string
    caveats: string
  }
} {
  const parsed = parseOrchestrationResponseSections(answer)
  if (parsed) {
    const caveats: string[] = []
    if (parsed.confidence?.trim()) {
      caveats.push(parsed.confidence.trim())
    }
    if (uncertainty?.trim()) {
      caveats.push(uncertainty.trim())
    }
    return {
      shortAnswer: parsed.direct.trim() || extractFirstSentence(answer) || 'Chimmy response available.',
      whatDataSays: parsed.tool?.trim() || undefined,
      whatItMeans: parsed.why?.trim() || undefined,
      recommendedAction: parsed.followUp?.trim() || actionPlan?.trim() || undefined,
      caveats: caveats.length > 0 ? caveats : undefined,
      sectionTitles: {
        shortAnswer: 'Direct',
        whatItMeans: 'Why',
        whatDataSays: 'Tool',
        caveats: 'Confidence',
        recommendedAction: 'Follow-up',
      },
    }
  }

  const shortAnswer = extractFirstSentence(answer) || 'Chimmy response available.'
  return {
    shortAnswer,
    whatDataSays: extractFirstSentence(answer),
    whatItMeans: actionPlan ? extractFirstSentence(actionPlan) : undefined,
    recommendedAction: actionPlan ?? undefined,
    caveats: uncertainty ? [uncertainty] : undefined,
  }
}

function resolveUsageLogModel(args: {
  providerUsed?: string | null
  modelOutputs?: Array<{
    model?: string
    modelName?: string
    skipped?: boolean
  }>
}): string {
  const outputs = Array.isArray(args.modelOutputs) ? args.modelOutputs : []
  const selectedOutput =
    (args.providerUsed
      ? outputs.find((output) => output.model === args.providerUsed && output.skipped !== true)
      : undefined) ??
    outputs.find((output) => output.skipped !== true) ??
    outputs[0]

  return selectedOutput?.modelName || selectedOutput?.model || args.providerUsed || 'unknown'
}

function resolveUsageLogTokensUsed(modelOutputs?: Array<{
  tokensPrompt?: number
  tokensCompletion?: number
}>): number {
  if (!Array.isArray(modelOutputs) || modelOutputs.length === 0) {
    return 0
  }

  return modelOutputs.reduce((sum, output) => {
    return sum + Math.max(0, output.tokensPrompt ?? 0) + Math.max(0, output.tokensCompletion ?? 0)
  }, 0)
}

function getVisionClient(): OpenAI | null {
  // PROVIDER BOUNDARY. Non-throwing on purpose: this returns `OpenAI | null`
  // and callers treat null as "vision unavailable", so a spend refusal
  // degrades exactly the way a missing key already does rather than
  // surfacing as a 500 from a chat turn.
  if (!isAiSpendEnabled()) return null
  const key = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY
  if (!key) return null
  try {
    return new OpenAI({
      apiKey: key,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    })
  } catch {
    return null
  }
}

async function parseScreenshotWithVision(imageFile: File, userQuestion: string): Promise<string> {
  const openai = getVisionClient()
  if (!openai) {
    return 'Image uploaded; vision extraction unavailable (provider not configured).'
  }
  try {
    const buffer = Buffer.from(await imageFile.arrayBuffer())
    const base64 = buffer.toString('base64')
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 500,
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content:
            'You are extracting deterministic fantasy context from an uploaded screenshot. ' +
            'Return a concise plain-text summary with only what is visible (players, teams, values, injuries, lineup/draft/trade context).',
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: userQuestion || 'Summarize visible fantasy context from this screenshot.' },
            { type: 'image_url', image_url: { url: `data:${imageFile.type};base64,${base64}`, detail: 'high' } },
          ],
        },
      ],
    })
    return response.choices[0]?.message?.content?.trim() || 'Image uploaded; no extractable fantasy context returned.'
  } catch {
    return 'Image uploaded; vision extraction failed.'
  }
}

function buildUserMessage(input: {
  message: string
  conversation: ConversationTurn[]
  screenshotSummary?: string
  insightSummary?: string
  memorySection?: string
  leagueGroundingLine?: string
  leagueFormat?: string
  scoring?: string
  strategyMode?: string
  tone?: string
  detailLevel?: string
  riskMode?: string
  privateMode: boolean
  targetUsername?: string
}): string {
  const parts: string[] = []
  parts.push(`USER QUESTION:\n${input.message || 'Analyze my fantasy context and recommend next moves.'}`)

  if (input.leagueGroundingLine) {
    parts.push(`LEAGUE GROUNDING (AllFantasy — use this for league-specific facts; do not substitute another league):\n${input.leagueGroundingLine}`)
  }

  if (input.strategyMode) {
    parts.push(`STRATEGY MODE:\n${input.strategyMode}`)
  }

  if (input.leagueFormat || input.scoring) {
    const leagueContext = [
      input.leagueFormat ? `Format: ${input.leagueFormat}` : null,
      input.scoring ? `Scoring: ${input.scoring}` : null,
    ]
      .filter(Boolean)
      .join('\n')

    if (leagueContext) {
      parts.push(`LEAGUE CONTEXT:\n${leagueContext}`)
    }
  }

  if (input.tone || input.detailLevel || input.riskMode) {
    const preferenceContext = [
      input.tone ? `Tone: ${input.tone}` : null,
      input.detailLevel ? `Detail Level: ${input.detailLevel}` : null,
      input.riskMode ? `Risk Mode: ${input.riskMode}` : null,
    ]
      .filter(Boolean)
      .join('\n')

    if (preferenceContext) {
      parts.push(`RESPONSE PREFERENCES:\n${preferenceContext}`)
    }
  }

  if (input.privateMode && input.targetUsername) {
    parts.push(`PRIVATE MODE TARGET:\n${input.targetUsername}`)
  }

  if (input.conversation.length > 0) {
    const convo = input.conversation
      .slice(-8)
      .map((turn) => `${turn.role === 'user' ? 'User' : 'Chimmy'}: ${turn.content}`)
      .join('\n')
    parts.push(`RECENT CONVERSATION:\n${convo}`)
  }

  if (input.screenshotSummary) {
    /*
     * 🛑 IMAGE TEXT ARRIVES FENCED, AS EVIDENCE. It used to be spliced in as
     * `SCREENSHOT SUMMARY:\n<free-form model text>`, which put whatever was written inside
     * a user's image into the same position — and the same register — as our own
     * directives. Anything photographed into a screenshot read as an instruction.
     *
     * Brief scenario 8: "An ambiguous screenshot asks for clarification; malicious text
     * inside it cannot trigger an action." The fencing is clause b; the clarification
     * line below is clause a, and both decisions are made deterministically in
     * lib/chimmy/screenshotEvidence rather than left to the model to get right.
     */
    const evidence = classifyScreenshotEvidence(input.screenshotSummary)
    parts.push(fenceScreenshotEvidence(evidence))
    const clarification = screenshotNeedsClarification(evidence)
    if (clarification.needed && clarification.question) {
      parts.push(
        `SCREENSHOT IS NOT FULLY LEGIBLE. Ask before computing or saving anything from it: ${clarification.question}`,
      )
    }
  }

  if (input.insightSummary) {
    parts.push(`SIMULATION / WAREHOUSE CONTEXT:\n${input.insightSummary}`)
  }

  if (input.memorySection) {
    parts.push(`MEMORY CONTEXT:\n${input.memorySection}`)
  }

  return parts.join('\n\n---\n\n')
}

function isLeagueDataUsageQuestion(message: string): boolean {
  return /what\s+(player\s+)?data\s+(and\s+league\s+settings\s+)?(are\s+you|you're)\s+using/i.test(message) ||
    /what\s+league\s+settings\s+(are\s+you|you're)\s+using/i.test(message) ||
    /what\s+data\s+sources\s+(are\s+you|you're)\s+using/i.test(message)
}

const NEWLINE = String.fromCharCode(10)

function buildLeagueGroundingLine(args: {
  leagueSnapshot: ChimmyLeagueSnapshot | null
  leagueNameHint?: string
  /** Set when a league WAS selected but could not be grounded. */
  groundingFailure?: ChimmyLeagueGroundingFailure | null
  /** The season the answer is actually about, and where it came from. */
  season?: { season: number | null; source: 'question' | 'league' | 'request' | 'none' }
}): string | undefined {
  if (args.leagueSnapshot) {
    const s = args.leagueSnapshot

    /*
     * 🛑 SCORING WAS ABSENT FROM THIS LINE AND IS THE REASON THIS FUNCTION
     * CHANGED. The snapshot has carried a verified `scoring` all along, and the
     * only scoring statement reaching the model came from a CLIENT form field,
     * rendered under a separate `LEAGUE CONTEXT:` block with equal apparent
     * authority to this one. Nothing compared them. A client claiming
     * "Scoring: Full PPR" over a half-PPR league got a confidently wrong
     * start/sit call with a grounded-looking answer around it.
     *
     * ⚠ AND AN ABSENT SCORING IS STATED, NOT OMITTED. `.filter(Boolean)` below
     * would drop a null, and silence reads to a model as "nothing worth
     * mentioning" — the same reasoning as the NOT AVAILABLE branch further down.
     * A league whose scoring we never stored must produce a refusal to name one,
     * not a guess.
     */
    const scoring = s.scoring?.trim()
      ? `scoring=${s.scoring}`
      : 'scoring=UNKNOWN (not stored — do not state a scoring rule for this league)'

    /*
     * When the question reopened a past season, SAY SO and give this league's
     * current season alongside it. A past-season answer that does not announce
     * itself is indistinguishable from a current-season answer that is wrong.
     */
    const askedSeason = args.season
    const seasonLine =
      askedSeason?.source === 'question' && askedSeason.season != null && askedSeason.season !== s.season
        ? `season=${askedSeason.season} (asked about in the question; this league's current season is ${s.season})`
        : `season=${s.season}`

    return [
      `League: ${s.name ?? s.id}`,
      `id=${s.id}`,
      `sport=${s.sport}`,
      seasonLine,
      scoring,
      s.leagueSize != null ? `teams=${s.leagueSize}` : null,
      `dynasty=${s.isDynasty}`,
      s.leagueVariant ? `variant=${s.leagueVariant}` : null,
      `platform=${s.platform}`,
      `platformLeagueId=${s.platformLeagueId}`,
      s.importedAt ? `imported=${s.importedAt.toISOString()}` : null,
      s.lastSyncedAt ? `lastSyncedAt=${s.lastSyncedAt.toISOString()}` : null,
    ]
      .filter(Boolean)
      .join(' | ')
  }
  /*
   * ⚠ NO BARE-LABEL FALLBACK. This used to return
   * `Selected league (label): <name>` when the snapshot was missing, which is
   * strictly worse than saying nothing: it asserts that a specific league IS in
   * scope while supplying zero facts about it, and a model handed a named league
   * and no roster fills the gap from general knowledge in the same confident
   * voice it uses for grounded answers. The caller refuses instead — see the
   * `leagueGrounding` handling in POST.
   *
   * For the questions that do NOT require league facts we still answer, but the
   * absence is stated OUT LOUD rather than left blank. Silence reads to the model
   * as "nothing worth mentioning"; an explicit negative is the only version that
   * reliably stops it from describing a roster it was never given.
   */
  if (args.groundingFailure) {
    return [
      'League: NOT AVAILABLE.',
      'You have NO roster, standings, matchup or transaction data for the league the user selected.',
      'Answer only what is true without it, and say plainly that you cannot see their league rather than inferring its contents.',
    ].join(' ')
  }
  return undefined
}

/**
 * The transcript this conversation already wrote down.
 *
 * ── 🛑 EVERY TURN WAS ALREADY BEING PERSISTED, AND NOTHING EVER READ IT BACK ────────────────
 *
 * `POST` has stamped both halves of every exchange into `chat_history` since PROMPT 234, under a
 * deterministic `chimmy:<userId>:<leagueId>` key, and `chimmy-memory-context.ts` already feeds the
 * last 12 into the prompt — so Chimmy has always REMEMBERED across tabs. The drawer just could not
 * SHOW it: `useScopedConversation` kept the transcript in `sessionStorage`, which dies with the
 * tab. A user closing the tab lost a conversation the database still held in full.
 *
 * ⚠ A `GET` ON THIS FILE, NOT A NEW ROUTE. The repo sits at Vercel's hard 2048-route ceiling and
 * `/api/chat/chimmy` already exists — adding a method to it costs nothing, adding a path costs one
 * of the last slots. The drawer's own comment says the same about the POST it calls.
 *
 * ⚠ NO AGE GATE HERE, DELIBERATELY, AND IT IS NOT AN OVERSIGHT. `POST` enforces
 * `requireAgeConfirmedUser` because it GENERATES and SPENDS. This reads back words the user has
 * already been shown, spends nothing, and `getRecentChatHistory` filters on `userId` as well as
 * the conversation key — so the worst a forged `leagueId` can do is return your own turns under a
 * different heading. Gating it would lock a user out of their own transcript for a reason that
 * does not apply to reading.
 */
const MAX_HISTORY_TURNS = 80

export async function GET(req: NextRequest): Promise<NextResponse> {
  const session = (await getServerSession(authOptions as any)) as {
    user?: { id?: string }
  } | null
  const userId = session?.user?.id ?? null
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const requested = Number.parseInt(url.searchParams.get('limit') ?? '', 10)
  const limit = Number.isFinite(requested)
    ? Math.min(Math.max(requested, 1), MAX_HISTORY_TURNS)
    : MAX_HISTORY_TURNS

  /*
   * 🛑 ONE THREAD — `leagueId` IS STILL ACCEPTED AND NOW IGNORED, DELIBERATELY.
   *
   * Until 2026-09-20 this read the LEAGUE's conversation, which is why "my previous conversation
   * from mobile is not showing up on PC" was reported: the read worked fine, mobile had simply
   * been in a different league. The user's decision is one continuous transcript.
   *
   * The client still sends its current scope and this still tolerates it, so a bundle already
   * cached by the service worker keeps working instead of breaking on an argument that stopped
   * mattering. Each turn carries its own `leagueId` back instead — which is what lets the UI show
   * a cross-league thread without implying every line is about the league now on screen.
   */
  const conversationId = buildChimmyConversationId({ userId })
  const rows = await getRecentChatHistory({ userId, limit }).catch(() => [])

  return NextResponse.json({
    conversationId,
    turns: rows.map((row, index) => {
      const display = readStoredDisplay(row.meta)
      return {
        id: `hist-${index}`,
        role: row.role === 'assistant' ? 'chimmy' : 'you',
        text: row.content,
        at: row.createdAt instanceof Date ? row.createdAt.toISOString() : null,
        leagueId: row.leagueId ?? null,
        ...display,
      }
    }),
  })
}

/**
 * The display fields a stored turn can carry back.
 *
 * 🛑 `grounding` IS THE ONE THAT MUST SURVIVE, and it is the reason this is not just text.
 * An answer Chimmy gave WITHOUT being able to read your league renders a "could not read your
 * league" badge. Rehydrate that answer as bare prose and the badge is gone — so an ungrounded
 * answer comes back looking exactly like a grounded one, which is the precise failure the drawer's
 * own comment warns about ("a grounding bug is invisible from the UI if the UI never looks").
 *
 * ⚠ AND WHAT IS DELIBERATELY *NOT* RESTORED MATTERS AS MUCH. `advice` carries a live vote and
 * `scenario` a before/after built from rosters as they were; replaying either would put a stale
 * interactive control in front of someone, inviting them to act on a board that has since moved.
 * Player cards are dropped for the same reason in miniature — a headshot row implies the answer
 * still stands. `isPublic` is a property of the TAB the question was asked from, not of the
 * answer, so the server never knew it and does not pretend to. Text, grounding, cost and mode are
 * the parts that are still true later.
 *
 * `evidence` is accepted here but is not written today — see the note at the `display` write.
 */
function readStoredDisplay(meta: unknown): Record<string, unknown> {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return {}
  const display = (meta as Record<string, unknown>).display
  if (!display || typeof display !== 'object' || Array.isArray(display)) return {}
  const source = display as Record<string, unknown>
  const out: Record<string, unknown> = {}
  if (source.grounding && typeof source.grounding === 'object') out.grounding = source.grounding
  if (source.evidence && typeof source.evidence === 'object') out.evidence = source.evidence
  if (typeof source.cost === 'number' && Number.isFinite(source.cost)) out.cost = source.cost
  if (typeof source.mode === 'string' && source.mode) out.mode = source.mode
  return out
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const startMs = Date.now()
  const session = (await getServerSession(authOptions as any)) as {
    user?: { id?: string; email?: string | null }
  } | null
  const userId = session?.user?.id ?? null
  const userEmail = session?.user?.email ?? null

  const limitRes = await runAiProtection(req, {
    action: 'chimmy',
    getUserId: async () => userId,
  })
  if (limitRes) return limitRes
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  /*
   * ⚠ EMAIL VERIFICATION IS DELIBERATELY NOT REQUIRED HERE. It was, and it locked
   * 17 of 48 production accounts — a third of signups — out of Chimmy entirely,
   * answering an ordinary question with a raw VERIFICATION_REQUIRED code. The
   * daily token grant could not reach them either: this guard runs ~400 lines
   * ahead of it, so an unverified user never got as far as having a balance.
   *
   * Age IS still enforced (compliance, not UX), as is a signed-in session — so
   * this is not an open endpoint. Spend stays bounded by the daily token floor,
   * which is what makes relaxing verification safe HERE and would not make it
   * safe on a surface that writes or spends without a cap.
   */
  const verifiedAuth = await requireAgeConfirmedUser()
  if (!verifiedAuth.ok) return verifiedAuth.response

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid request format.' }, { status: 400 })
  }

  const imageValidation = validateScreenshotFile(formData.get('image'))
  if (imageValidation.error) {
    return NextResponse.json({ error: 'Invalid request format.' }, { status: 400 })
  }

  let conversationPayload: unknown
  try {
    conversationPayload = parseConversationPayload(
      formData.get('messages') ?? formData.get('conversation')
    )
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Conversation payload is invalid.',
      },
      { status: 400 }
    )
  }

  const parseResult = ChimmyFormSchema.safeParse({
    message: formData.get('message'),
    confirmTokenSpend: formData.get('confirmTokenSpend'),
    conversationId: formData.get('conversationId'),
    sessionId: formData.get('sessionId'),
    privateMode: formData.get('privateMode'),
    targetUsername: formData.get('targetUsername'),
    assistantMode: formData.get('assistantMode'),
    mode: formData.get('mode'),
    strategyMode: formData.get('strategyMode'),
    source: formData.get('source'),
    leagueId: formData.get('leagueId'),
    sleeperUsername: formData.get('sleeperUsername'),
    teamId: formData.get('teamId'),
    sport: formData.get('sport'),
    leagueFormat: formData.get('leagueFormat'),
    scoring: formData.get('scoring'),
    tone: formData.get('tone'),
    detailLevel: formData.get('detailLevel'),
    riskMode: formData.get('riskMode'),
    season: formData.get('season'),
    week: formData.get('week'),
    insightType: formData.get('insightType'),
    sportScope: formData.get('sportScope'),
    leagueName: formData.get('leagueName'),
    connectedLeagueIds: formData.get('connectedLeagueIds'),
    homeSignals: formData.get('homeSignals'),
    coreSurface: formData.get('coreSurface'),
    conversation: conversationPayload,
    hasImage: imageValidation.hasImage,
  })

  if (!parseResult.success) {
    return NextResponse.json(
      {
        error: 'Invalid request format.',
        details: parseResult.error.flatten(),
      },
      { status: 400 }
    )
  }

  const {
    message,
    confirmTokenSpend,
    conversationId: explicitConversationId,
    sessionId: rawSessionId,
    privateMode,
    targetUsername,
    assistantMode,
    mode,
    strategyMode,
    source,
    leagueId: requestedLeagueId,
    sleeperUsername,
    teamId,
    sport: sportRaw,
    leagueFormat,
    scoring,
    tone,
    detailLevel,
    riskMode,
    season,
    week,
    insightType,
    sportScope,
    leagueName: requestedLeagueNameHint,
    connectedLeagueIds: rawConnectedLeagueIds,
    homeSignals: rawHomeSignals,
    coreSurface,
    conversation: parsedConversation,
    hasImage,
  } = parseResult.data
  const requestedConnectedLeagueIds = (() => {
    if (!rawConnectedLeagueIds) return null
    try {
      const parsed = JSON.parse(rawConnectedLeagueIds)
      if (!Array.isArray(parsed)) return new Set<string>()
      return new Set(parsed.filter((value): value is string => typeof value === 'string' && value.length <= MAX_GENERIC_FIELD_CHARS).slice(0, 20))
    } catch {
      return new Set<string>()
    }
  })()
  const homeSignals = parseHomeSignals(rawHomeSignals)
  const coreSurfaceBlock = coreSurface ? renderCoreSurfacePrompt(coreSurface) : null
  const selectedAssistantMode = normalizeChimmyAssistantMode(
    mode ?? assistantMode ?? strategyMode ?? riskMode
  )
  let leagueId = requestedLeagueId ?? null
  let leagueNameHint = requestedLeagueNameHint ?? null
  const conversation = parsedConversation.slice(-MAX_CONVERSATION_CONTEXT_TURNS)
  const imageFile = imageValidation.file

  const initialIntent = classifyPecrIntent(message)
  const leagueGroundingRequired = requiresLeagueGrounding({
    message,
    intent: initialIntent,
    source,
    teamId: teamId ?? undefined,
    insightType,
  })

  let accessibleLeaguesForUser: Array<{ id: string; teams: Array<{ ownerName: string; teamName: string }> }> = []
  if (leagueGroundingRequired && !leagueId) {
    try {
      const selection = await resolveChimmyLeagueSelection({
        userId,
        message,
        leagueNameHint,
        threshold: 0.85,
      })
      accessibleLeaguesForUser = selection.leagues.map((league) => ({
        id: league.id,
        teams: league.teams,
      }))

      if (selection.kind === 'selected') {
        leagueId = selection.leagueId
        leagueNameHint = selection.matchedLabel
      } else {
        return NextResponse.json(
          {
            ...buildLeagueGroundingErrorPayload(),
            details: {
              message: selection.message,
              choices: selection.choices,
            },
          },
          { status: 412 }
        )
      }
    } catch {
      return NextResponse.json(
        {
          ...buildLeagueGroundingErrorPayload(),
          details: {
            message: 'I could not resolve league matches right now. Please include an exact league name.',
          },
        },
        { status: 412 }
      )
    }
  }

  /*
   * ⚠ A FAILED LOOKUP IS AN OUTCOME, NOT A ZERO. This was
   * `loadLeagueSnapshotForUser(...).catch(() => null)`, so every way of having no
   * league — not a member, not a League row, query threw — collapsed into the
   * same `null` that "no league was selected" produces, and the route answered
   * anyway. `loadLeagueGroundingForUser` keeps the reason so we can refuse and
   * say which one it was.
   */
  const leagueGrounding =
    leagueId && userId
      ? await loadLeagueGroundingForUser(userId, leagueId)
      : ({ ok: false, reason: 'not_found' } as const)
  const leagueSnapshot = leagueGrounding.ok ? leagueGrounding.snapshot : null

  /*
   * Connected-roster grounding is intentionally enabled for league-specific
   * questions. The selected league has already passed membership verification above, and
   * `resolvePairedHalf` independently scopes the franchise to this owner. Only
   * the signed-in manager's roster on each side is returned; other managers'
   * rosters never enter this payload.
   */
  const connectedFranchise =
    leagueSnapshot && userId && leagueGroundingRequired && rawConnectedLeagueIds
      ? await resolvePairedHalf(leagueSnapshot.id, userId, { includeOperationalSummary: false })
          .catch((err) => {
            console.warn('[chimmy] connected franchise grounding failed', {
              kind: err instanceof Error ? err.constructor.name : 'unknown',
            })
            return null
          })
      : null
  const allowedConnectedLeagueIds = connectedFranchise
    ? new Set(
        connectedFranchise.sides
          .map((side) => side.leagueId)
          .filter((id): id is string => typeof id === 'string' && (!requestedConnectedLeagueIds || requestedConnectedLeagueIds.has(id))),
      )
    : null
  const connectedFranchiseGrounding = renderConnectedFranchiseGrounding(connectedFranchise, allowedConnectedLeagueIds)

  /*
   * The user named a league and we cannot see it. If the question needs league
   * facts, refusing is the answer — a wrong lineup call on someone's real roster
   * costs more trust than an empty one. Deliberately BEFORE the token spend
   * below: a refusal must not bill.
   */
  if (leagueId && !leagueGrounding.ok && leagueGroundingRequired) {
    return NextResponse.json(
      {
        ...buildLeagueGroundingErrorPayload(),
        /*
         * ⚠ NO `leagueId` AND NO `groundingReason`. Echoing the id back confirms
         * it addresses something, and the reason code distinguishes "not yours"
         * from "not real" — together they are an enumeration oracle. The reason
         * is still available in logs, where the caller cannot read it.
         */
        details: {
          message: describeLeagueGroundingFailure(leagueGrounding.reason),
        },
      },
      { status: leagueGrounding.reason === 'error' ? 503 : 412 }
    )
  }

  /*
   * 🛑 THE CLIENT'S `teamId`, KEPT ONLY IF IT IS THE CALLER'S OWN TEAM IN THE VERIFIED LEAGUE.
   * Every reader below takes `verifiedTeamId`, never `teamId`: the dynasty insight
   * (`getInsightBundle` → `DynastyProjection` by league + team), the memory context's team
   * snapshots (`getFullAIContext`), and the context the prompt calls "your team". Before this, a
   * member could name another member's team and have it read back as their own.
   *
   * ⚠ The raw field still decides one thing: `requiresLeagueGrounding` above treats ANY team id as
   * "this question is about a league", which only ever makes the route stricter, and it has to run
   * before membership is known.
   */
  const verifiedTeamId = await resolveCallerTeamId({ leagueId: leagueSnapshot?.id, userId, teamId })

  // How the managers in this league have actually behaved. Entitlement is checked
  // inside, so an unentitled user grounds exactly as before; and the block names
  // the managers it has NOT observed, because a model handed a partial roster of
  // personalities will invent the rest in the same confident voice.
  const psychologyGroundingLines =
    leagueSnapshot && userId
      ? await buildPsychologyGroundingLines({
          leagueId: leagueSnapshot.id,
          userId,
        }).catch(() => [] as string[])
      : []

  let normalizedLeagueContext: NormalizedLeagueContext | null = null
  if (leagueId && userId) {
    const lce = await resolveNormalizedLeagueContext({ userId, leagueId })
    if (lce.ok) normalizedLeagueContext = lce.context
  }

  const sportExplicit =
    typeof sportRaw === 'string' && sportRaw.trim().length > 0
      ? normalizeToSupportedSport(sportRaw)
      : undefined

  const digestSport: SupportedSport | 'all' =
    sportScope === 'all' && !leagueSnapshot ? 'all' : (sportExplicit ?? leagueSnapshot?.sport ?? DEFAULT_SPORT)

  /*
   * 🛑 THE LEAGUE'S OWN SPORT WINS OVER THE CLIENT'S. It did not, and `sport`
   * is not a label — it keys the sports reads inside
   * `buildLeagueSportsGroundingPacket` (`loadPlayerPoolSummary`,
   * `loadFantasyData`, `loadScheduleSummary`, provider health) and the insight
   * bundle. A client field could therefore put an NBA player pool behind an
   * answer about an NFL league, under a grounding line that said `sport=NFL`.
   *
   * ⚠ THE FLIP IS DELIBERATELY NOT APPLIED TO `digestSport` ABOVE, AND THAT IS
   * THE WHOLE POINT OF SPLITTING THEM. The digest is world data — news,
   * injuries, tonight's games — and it should follow the QUESTION. Somebody
   * scoped to an NFL league who asks what NBA games are on tonight is asking a
   * real question, and making the league outrank them there would answer a
   * different one. League-scoped reads take the league's sport; world-data reads
   * take the asker's.
   *
   * With no league in scope there is nothing to outrank the client field, so it
   * still decides — unchanged behaviour for every global question.
   */
  const sport: SupportedSport = leagueSnapshot?.sport ?? sportExplicit ?? DEFAULT_SPORT

  /*
   * One resolution, used everywhere `season` used to go. See
   * `resolveEffectiveSeason` for why the league wins by default and why an
   * explicit year in the question reopens the past.
   */
  const effectiveSeasonResult = resolveEffectiveSeason({
    leagueSeason: leagueSnapshot?.season ?? null,
    requestedSeason: season ?? null,
    message,
  })
  const effectiveSeason = effectiveSeasonResult.season
  const effectiveStrategyMode = selectedAssistantMode

  const selectedLeagueForManagerCheck =
    leagueId != null ? accessibleLeaguesForUser.find((league) => league.id === leagueId) ?? null : null
  const managerAmbiguity = detectManagerAmbiguity({
    message,
    league: selectedLeagueForManagerCheck,
  })
  if (managerAmbiguity.kind === 'ambiguous') {
    return NextResponse.json(
      {
        error: managerAmbiguity.message,
        details: {
          managerOptions: managerAmbiguity.options,
          token: managerAmbiguity.token,
        },
      },
      { status: 412 }
    )
  }

  const conversationId = buildChimmyConversationId({
    userId,
    leagueId: leagueId ?? null,
    explicitConversationId,
  })
  const sessionId = String(rawSessionId ?? `${userId}-${Date.now()}`)
  const behaviorRulesBlock = buildBehaviorRulesPrompt()
  const workingMemoryMessage = message || '[image-only request]'
  const { prompt: memPrompt, currentTags } = await prepareWorkingMemory({
    sessionId,
    userId,
    message: workingMemoryMessage,
    featureTags: [initialIntent],
  })
  const customRulesTask = loadCustomRules()

  if (!message && !hasImage) {
    return NextResponse.json({
      response: 'Ask me a fantasy sports question, share roster context, or upload a screenshot for analysis.',
      sessionId,
    })
  }

  if (leagueGroundingRequired && !leagueId) {
    return NextResponse.json(buildLeagueGroundingErrorPayload(), { status: 412 })
  }

  const staleness = buildChimmyStalenessWarning({
    lastSyncedAt: leagueSnapshot?.lastSyncedAt ?? null,
    intent: initialIntent,
  })
  const sourceReferences = buildChimmySourceReferences({
    leagueId: leagueId ?? null,
    intent: initialIntent,
  })

  const domainInput = [message, ...conversation.map((turn) => turn.content)].join(' ')
  if (!hasSportsContent(domainInput, hasImage)) {
    /*
     * ⚠ THIS DEFLECTION USED TO BE INDISTINGUISHABLE FROM AN ANSWER. It replied
     * "I'm Chimmy, your fantasy sports assistant. I can help with trades,
     * waivers..." — which, to somebody who just asked a real question, reads as
     * being ignored rather than being filtered. It has to SAY that it did not
     * run, and say what would get through, or a gap in the keyword list looks
     * like a broken product.
     */
    return NextResponse.json({
      response:
        "That didn't look like a fantasy sports question to me, so I didn't run it — no tokens were spent. Try naming a player, team, league or week and I'll take another go.",
      sessionId,
      meta: {
        /*
         * ⚠ NOT 100. This used to claim total confidence about a non-answer,
         * which is the same class of lie as a trade grade with no data behind
         * it. Nothing was evaluated, so there is no confidence to report.
         */
        confidencePct: 0,
        /** Nothing was charged — the spend happens far below this return. */
        free: true,
        providerStatus: {
          openai: 'skipped',
          deepseek: 'skipped',
          grok: 'skipped',
        },
        recommendedTool: 'none',
        dataSources: [],
        responseStructure: {
          shortAnswer: 'That did not look like a fantasy sports question.',
          recommendedAction: 'Name a player, team, league or week and ask again.',
          caveats: ['This was filtered before any model ran; nothing was charged.'],
        },
      },
    })
  }

  /*
   * ⚠ THE FREE FLOOR IS TOPPED UP HERE, AHEAD OF EVERY SPEND CHECK IN THIS
   * ROUTE — and the position is the point. TWO paths price the balance: the
   * live-search fallback a few lines below, and the main spend ~500 lines down.
   * Granting before the later one but after the earlier one would refuse a user
   * who is, moments later, able to pay. I made exactly that mistake first.
   *
   * A free account starts at zero and every Chimmy message costs 10, so the
   * first question anybody ever asked failed on insufficient balance. Two a day
   * was the intended free tier and had never been implemented.
   */
  await grantDailyFreeTokens(userId).catch(() => null)

  const requestLocale = resolveLanguage(req.cookies.get('af_lang')?.value)
  /*
   * ⚠ `leagueId` IS PASSED (BUG-1). It is resolved at line ~1159 above and was previously withheld
   * from this call, so the FantasyCalc value path derived dynasty/superflex by regexing the user's
   * SENTENCE and hardcoded "12-team PPR" — a dynasty league was answered with a redraft price,
   * measured 3779 against a correct 6644. This short-circuit returns before the grounding packet
   * is built at ~1667, so nothing downstream could have corrected it.
   *
   * 🛑 BUT IT PASSED THE RAW `leagueId`, WHICH IS `formData.get('leagueId')` — THE SAME ROOT CAUSE
   * AS THE THREE DISCLOSURES ALREADY CLOSED IN THIS FILE, REACHED THROUGH A FOURTH DOOR.
   * `buildFantasyCalcValueAnswer` calls `createLeagueOsLoaders().loadRules(leagueId)`, and that
   * loader performs no membership check — `resolveLeagueMembership` does not appear in it. So a
   * stranger's league format came back priced INTO the answer text: a dynasty league answers
   * "dynasty value 6644 … Settings read from your league: superflex, 10-team" and a redraft league
   * answers differently. The price itself was the oracle; the settings sentence merely narrated it.
   *
   * ⚠ AND IT SITS ABOVE EVERY GUARD IN THIS ROUTE. This short-circuit returns before the 412
   * refusal path, before the token spend, and before the grounding packet — so the two commits
   * that closed the refusal-side oracles could not have covered it, and the indistinguishability
   * suite could not have seen it: it never reaches the code those tests drive.
   *
   * `leagueSnapshot` exists only because `loadLeagueGroundingForUser` proved membership, so passing
   * `leagueSnapshot?.id ?? null` closes this by construction. The second argument keeps the
   * fallback sentence TRUE for a caller who named a league they may not read — it says a league was
   * requested without saying which, so `not_member` and `not_found` stay indistinguishable here too.
   */
  const deterministic = await tryDeterministicAnswerDetailed(
    message,
    requestLocale,
    leagueSnapshot?.id ?? null,
    leagueId != null,
  )
  if (deterministic !== null) {
    /*
     * ⚠ A REFUSAL IS NOT A FINAL ANSWER — it is a statement that OUR DATABASE
     * has nothing. Until now both kinds returned here identically, so "how many
     * home runs were hit in the majors yesterday" dead-ended on a refusal while
     * the answer sat on a public box score. A data-backed answer still wins and
     * still costs nothing; only a refusal gets to look further.
     */
    if (deterministic.kind === 'refusal' && getChimmyFeatureFlags().liveSearchFallback) {
      /*
       * ⚠ THIS PATH SHIPPED FREE AND IT SHOULD NOT HAVE BEEN. It sits above the
       * spend block, so a live search — the most expensive call we make — cost
       * the platform real money and the reader nothing. With open signup that is
       * an uncapped spend path.
       *
       * ORDER MATTERS IN BOTH DIRECTIONS:
       *  - Check they CAN pay BEFORE searching, so we never buy a search for
       *    somebody who cannot be charged for it.
       *  - Charge only AFTER a sourced answer exists. The refusal below stays
       *    free, which is the honest deal and what the copy already promises:
       *    an unavailable-data answer "should not charge tokens". You pay for an
       *    answer, never for us admitting we have none.
       *
       * An unconfirmed client falls through to the free refusal rather than
       * getting a 409 here. This path used to always be free, and turning it
       * into a new confirmation prompt would be a worse surprise than a refusal.
       */
      const spendService = new TokenSpendService()
      const preview = userId
        ? await spendService
            .previewSpend(userId, 'ai_chimmy_chat_message', userEmail)
            .catch(() => null)
        : null

      const mayCharge = Boolean(userId && confirmTokenSpend && preview?.canSpend)

      if (mayCharge) {
        const { answerSportsQuestionFromSearch } = await import('@/lib/ai/liveSportsAnswer')
        const searched = await answerSportsQuestionFromSearch(message).catch(() => null)

        if (searched) {
        /*
         * The answer exists, so the search has already been paid for upstream.
         * If the charge now fails — a balance race against the preview above —
         * we serve it anyway with tokenSpend null rather than eat the provider
         * cost AND withhold the answer. Losing the fee is bad; losing the fee
         * and the answer is worse.
         */
        const ledger = await spendService
          .spendTokensForRule({
            userId: userId as string,
            ruleCode: 'ai_chimmy_chat_message',
            confirmed: confirmTokenSpend,
            sourceType: 'chimmy_chat',
            sourceId: conversationId,
            description: 'Chimmy live web search answer',
            metadata: { conversationId, source: source ?? null, path: LIVE_SEARCH_SOURCE },
            userEmail,
          })
          .catch(() => null)

        const sourceLines = searched.citations.map((c) => `- ${c.label}: ${c.url}`).join('\n')
        const body = `${searched.text}\n\nSources consulted:\n${sourceLines}`
        return NextResponse.json({
          response: body,
          result: body,
          source: LIVE_SEARCH_SOURCE,
          sessionId,
          tokenSpend:
            ledger && preview
              ? {
                  ruleCode: preview.ruleCode,
                  tokenCost: preview.tokenCost,
                  balanceAfter: ledger.balanceAfter,
                  ledgerId: ledger.id,
                }
              : undefined,
          citations: searched.citations,
          meta: {
            /*
             * NOT 100. The deterministic answers claim total confidence because
             * they are reading our own rows. This is a summary of pages we did
             * not write, and saying otherwise would make the two look alike.
             */
            confidencePct: 70,
            providerStatus:
              searched.provider === 'claude'
                ? { anthropic: 'ok', openai: 'skipped', deepseek: 'skipped', grok: 'skipped' }
                : { openai: 'skipped', deepseek: 'skipped', grok: 'ok' },
            ...(searched.model ? { model: searched.model } : {}),
            dataSources: [LIVE_SEARCH_SOURCE],
            responseStructure: {
              shortAnswer: searched.text,
              caveats: [
                'Answered from live web search, not from AllFantasy data.',
                'Sources are what the search consulted — not evidence for any one sentence.',
              ],
            },
          },
        })
        }
        /* Nothing sourced came back. Fall through to the honest refusal. */
      }
      /*
       * Not chargeable — anonymous, unconfirmed, or out of balance. We do NOT
       * search in that case: buying a provider call we cannot bill is the exact
       * leak this block was added to close. The free refusal is still served.
       */
    }

    const deterministicAnswer = deterministic.text
    return NextResponse.json({
      response: deterministicAnswer,
      result: deterministicAnswer,
      source: DETERMINISTIC_SOURCE,
      sessionId,
      tokenSpend: null,
      meta: {
        confidencePct: 100,
        providerStatus: {
          openai: 'skipped',
          deepseek: 'skipped',
          grok: 'skipped',
        },
        dataSources: [DETERMINISTIC_SOURCE],
        responseStructure: {
          shortAnswer: deterministicAnswer,
          caveats: ['No live provider call was made for this answer.'],
        },
      },
    })
  }

  /*
   * 🛑 SAME DEFECT AS THE INSIGHT BUNDLE, AND A LARGER PAYLOAD.
   * `buildLeagueSportsGroundingPacket` performs NO membership check —
   * `resolveLeagueMembership` does not appear in that module, and its `userId`
   * is used only to locate the caller's own team WITHIN the league
   * (`claimedByUserId: userId`), never to decide whether they may see it. It
   * reads name, settings, scoring, roster and draft state and this route
   * serializes the result into the prompt.
   */
  if (leagueSnapshot && userId && isLeagueDataUsageQuestion(message)) {
    try {
      const packet = await buildLeagueSportsGroundingPacket({
        leagueId: leagueSnapshot.id,
        userId,
        sport: sport ?? undefined,
        season: effectiveSeason ?? undefined,
      })
      const usageAnswer = buildLeagueDataUsageAnswer(packet)
      return NextResponse.json({
        response: usageAnswer,
        result: usageAnswer,
        source: 'league_sports_grounding_packet',
        sessionId,
        tokenSpend: null,
        meta: {
          confidencePct: 100,
          providerStatus: {
            openai: 'skipped',
            deepseek: 'skipped',
            grok: 'skipped',
          },
          dataSources: ['league_sports_grounding_packet'],
          grounding: {
            sport: packet.sport,
            season: packet.season,
            freshness: packet.freshness,
            providerHealth: packet.providerHealth,
            unavailable: packet.unavailable,
          },
          responseStructure: {
            shortAnswer: usageAnswer,
            caveats: ['No live model call was made for this answer.'],
          },
        },
      })
    } catch {
      // Fall through to the normal model path if deterministic grounding cannot load.
    }
  }

  const dataSources: string[] = []
  let chimmySportDigestFreshness: {
    overallLastSyncedAt: string | null
    perSource: Record<string, string | null>
  } | null = null

  const screenshotTask: Promise<string | undefined> =
    hasImage && imageFile
      ? parseScreenshotWithVision(imageFile, message)
      : Promise.resolve(undefined)
  const insightTask: Promise<{ summary?: string; sources: string[] } | undefined> =
    /*
     * 🛑 THE MEMBERSHIP-AUTHORIZED ID, NOT THE REQUEST FIELD.
     *
     * This guard was the raw request field, and that field is
     * `formData.get('leagueId')` — a value the client sends, not one anybody
     * verified. `getInsightBundle` declares no `userId` parameter and
     * `lib/ai-simulation-integration/AIInsightRouter.ts` contains zero
     * occurrences of one, so it read matchup predictions, playoff odds,
     * warehouse summaries and a league settings summary for whatever id it was
     * handed — and the result was placed in the prompt.
     *
     * ⚠ THE EXISTING REFUSAL DID NOT COVER IT, AND THE GAP IS EXACTLY
     * MEASURABLE. `requiresLeagueGrounding` forces grounding when `insightType`
     * is trade, waiver or dynasty. `InsightType` has SIX values. For `matchup`,
     * `playoff` or `draft`, with no `teamId` and a message tripping none of the
     * phrase patterns, nothing refused and the raw field flowed straight
     * through.
     *
     * `leagueSnapshot` is `leagueGrounding.ok ? leagueGrounding.snapshot : null`
     * — it exists only because `loadLeagueGroundingForUser` proved membership.
     * Reading its id closes this by construction rather than by adding another
     * conditional a later edit could get wrong.
     */
    leagueSnapshot && insightType
      ? getInsightBundle(leagueSnapshot.id, insightType, {
          teamId: verifiedTeamId ?? undefined,
          season: effectiveSeason ?? undefined,
          week,
          sport,
        })
          .then((bundle) => ({
            summary: bundle.contextText || undefined,
            sources: bundle.sources.map((source) => `ai_${source}`),
          }))
          .catch(() => undefined)
      : Promise.resolve(undefined)
  /*
   * 🛑 `getFullAIContext` HAS TWO CALL SITES IN THIS REQUEST AND THE PREVIOUS COMMIT CLOSED ONE.
   *
   * That commit's message says the reader is closed. It was closed at ~2401 (inside the PECR
   * plan) and NOT here, where `getChimmyMemoryContext` reaches the identical function through
   * `lib/ai-memory/chimmy-memory-context.ts` — so `aILeagueContext.findUnique({ where:
   * { leagueId } })` and `getRecentMemoryEvents({ leagueId })` still ran on the raw request field.
   *
   * ⚠ AND THE READER-AUTHORIZATION SUITE COULD NOT HAVE CAUGHT IT, because it MOCKS
   * `@/lib/ai-memory/chimmy-memory-context` wholesale — so the real module, and the second route
   * into the real `getFullAIContext`, never executed under test. Mocking a module hides every
   * path through it, including the unguarded one. The regression test added for this asserts on
   * the `leagueId` handed to that mock instead.
   *
   * The lesson worth keeping: "I fixed function F" is not the same claim as "every call site of
   * F is fixed", and a census of CALL SITES is what closes the second one.
   */
  const memoryTask: Promise<string | undefined> =
    userId
      ? getChimmyMemoryContext({
          userId,
          leagueId: leagueSnapshot?.id ?? null,
          conversationId,
          sleeperUsername: sleeperUsername ?? null,
        })
          .then((ctx) => (ctx.promptSection?.trim().length ? ctx.promptSection : undefined))
          .catch(() => undefined)
      : Promise.resolve(undefined)

  /**
   * Decision OS grounding (4.2), BESIDE the existing packet rather than instead of it.
   *
   * 🛑 OFF UNLESS `DECISION_OS_GROUNDING_ENABLED === 'true'`. This is the highest-traffic route in
   * the product — `app/core`, both CommsDrawer entry points and the mock-draft room all reach it —
   * and adding a section to a live prompt changes what the model says. The flag makes landing this
   * a genuine no-op, so the wiring can be reviewed and the content compared before anything moves.
   *
   * ⚠ IT ADDS A PROMPT SECTION AND REMOVES NOTHING. D1's end state is that Decision OS becomes the
   * SOLE grounding source, but getting there means moving the twelve providers and three resolvers
   * behind it first (4.3). Cutting the existing packet now would delete grounding that has no
   * replacement yet — the "surface pointed at a table nothing writes" failure, reached from the
   * prompt side.
   */
  /**
   * 🛑 A HARD CEILING, BECAUSE THE PACKET'S PARTS ARE BOUNDED AND THEIR SUM IS NOT.
   *
   * Each contributor limits itself — `ChimmyContextEngine` gives every provider a timeout,
   * `portfolioGrounding` wraps `getCommandCenter` in 4.5s, `leagueIntelligenceGrounding` bounds
   * each sub-fetch — but nothing bounds the TOTAL, and this task sits inside the
   * `Promise.allSettled` the chat turn waits on. A slow league could add several seconds to every
   * message on the busiest route in the product.
   *
   * ⚠ THE FAILURE IT PREVENTS IS NOT AN ERROR, IT IS A SLOW ANSWER, which is why nothing would
   * have caught it: no exception, no failed test, just a chat that got worse. 3s is generous
   * against the parts' own limits and still caps the tail.
   *
   * Losing the section is the correct outcome when it is late — the packet is ADDITIVE while the
   * existing grounding still runs, so a timeout costs freshness annotations, not facts.
   */
  /**
   * 🛑 THREE DIFFERENT OUTCOMES USED TO COLLAPSE INTO ONE OBSERVABLE NOTHING.
   *
   * The ceiling resolves `null`, an empty serialization resolves `null`, and the `.catch` resolves
   * `null`. All three then produce no prompt section and no `dataSources` entry, so from outside
   * they are the same event — and one of them means "we paid to build a packet and threw it away
   * on every turn", which needs the opposite response from the other two.
   *
   * ⚠ THAT IS §2.20's FAILURE IN THIS ROUTE'S OWN WIRING: an absence that does not announce
   * itself. The packet was given a taxonomy of named gaps precisely so a reader could tell
   * "missing" from "broken". What surrounds it had none.
   *
   * ⚠ AND THE TIMEOUT DOES NOT CANCEL THE WORK. `Promise.race` abandons the result; it does not
   * stop the producers, so every read still completes and is still billed. A packet that is
   * routinely late is therefore strictly WORSE than one that is switched off — and switched off
   * is exactly what it looks like from outside.
   */
  type GroundingOutcome = 'off' | 'ok' | 'empty' | 'timeout' | 'error'
  /*
   * ⚠ A HOLDER RATHER THAN TWO `let`s, AND THAT IS A TYPE-SYSTEM REASON NOT A STYLE ONE.
   * TypeScript narrows `let x: GroundingOutcome = 'off'` to the literal `'off'` and does not
   * track the assignments made inside the callbacks below, so every comparison against another
   * member is reported as impossible (TS2367 — "'off' and 'timeout' have no overlap"). Property
   * narrowing is invalidated by the intervening calls, so a holder is correct without a cast.
   * A cast would have silenced the same diagnostic while teaching the next reader nothing.
   */
  const grounding: { outcome: GroundingOutcome; buildMs: number | null } = {
    outcome: 'off',
    buildMs: null,
  }

  const withPacketCeiling = <T,>(p: Promise<T>, ms: number): Promise<T | null> =>
    Promise.race([
      p,
      new Promise<null>((resolve) =>
        setTimeout(() => {
          grounding.outcome = 'timeout'
          resolve(null)
        }, ms),
      ),
    ])

  /*
   * ⚠ THE INTENT ROUTER GAP — R2/R3.1/R3.3/R4b.5's opt-in slices were built, tested, wired into
   * the packet, and never requested here. `want` below was hardcoded to four always-on flags;
   * nothing decided, per question, whether a lineup/commissioner-health/psychology-consistency/
   * roster-value read was worth its cost. This is the fix: a SECOND, early call to the intent
   * classifier already used later in this route (line ~1789, with full conversation history) —
   * using only `message`, which is available this early, rather than reordering existing working
   * code to share one call. `classifyChimmyIntent` is pure and synchronous (regex matching, no
   * I/O), so calling it twice costs microseconds, not a second network hop. The intent -> want
   * mapping itself lives in `lib/decision-os/grounding/intentToWant.ts` — see its own header for
   * why only four of the seven opt-in slices are mapped.
   */
  const earlyWant = deriveWantFromIntent(classifyChimmyIntent(message).intent)
  /*
   * 🛑 THE THIRD BYPASS FAMILY, AND THE ONLY ONE GATED BEHIND A FLAG.
   *
   * This was `DECISION_OS_GROUNDING_ENABLED === 'true' && leagueId` passing the RAW request field,
   * exactly like `getInsightBundle`, `buildLeagueSportsGroundingPacket` and the sixteen specialty
   * builders before them. `buildDecisionOsGroundingPacket` performs no membership check of its own:
   * `resolveLeagueMembership` appears nowhere in `lib/decision-os/grounding/`, and its `userId` is
   * used only to scope slices WITHIN the league (`loadLineupDecisionSlice({ userId, leagueId })`),
   * never to decide whether the caller may see it. It is also the WIDEST of the four — it fans out
   * to league rules, values, projections, lineup, waiver, roster-value, commissioner-health,
   * psychology-consistency, saved analysis, league intelligence and league context.
   *
   * ⚠ THE FLAG IS WHY THIS ONE IS SCOPED CONDITIONALLY, NOT WHY IT IS SAFE. A flag being off in
   * tests says nothing about production.
   *
   * 🛑 AND THE ANSWER IS NOW MEASURED, NOT ASSUMED: `DECISION_OS_GROUNDING_ENABLED` reads `true`
   * on the Railway `allfantasy-v2-main` production service (read off the service's own variables,
   * 2026-09-12). This paragraph previously said the deployed value "was NOT verified" and the live
   * exposure was "UNKNOWN". It is verified, and the answer is the unfavourable one: the packet WAS
   * assembling on every chat turn carrying a league, so this was LIVE rather than latent, on the
   * widest of the four reader families. The code defect is identical either way and is closed
   * here — what changes is the severity, and severity is not something to leave as a coin flip in
   * a comment when one lookup settles it.
   *
   * ⚠ NOTE THE REPO CONTRADICTED ITSELF ON THIS FOR AS LONG AS IT WENT UNMEASURED.
   * `app/api/admin/decision-os/grounding-proof/route.ts` asserted "`DECISION_OS_GROUNDING_ENABLED`
   * is now on" while this comment said it was unknown — two files, opposite claims, neither
   * carrying a measurement. The flag being SET is not the same fact as its value: it appears in
   * the service's variable list regardless, and the code requires the literal string `'true'`.
   *
   * ⚠ AND DO NOT READ IT BACK WITH `list-variables`. That call has no filter and returns every
   * variable on the service in plaintext — `DATABASE_URL`, `STRIPE_SECRET_KEY`, `NEXTAUTH_SECRET`,
   * both `ROLLING_INSIGHTS_RSC_TOKEN`s — so fetching one boolean drags the entire production
   * secret set into whatever is reading. Use the dashboard, or
   * `/api/admin/decision-os/grounding-proof`, which returns `groundingEnabled` as a bare boolean.
   * Same family as the `RSC_token` query parameter already recorded in CLAUDE.md: a secret escaping
   * through an ordinary, careful action that nobody thinks of as touching secrets.
   *
   * Gating on `leagueSnapshot` is strictly stronger than the old gate AND than adding a `userId`
   * check: the snapshot is `leagueGrounding.ok ? … : null`, and `leagueGrounding` is only ever
   * computed when `leagueId && userId`, so a non-null snapshot already implies an authenticated
   * caller whose membership was proved. The flag check stays exactly where it was.
   */
  /*
   * An object, not a `let`: it is assigned inside a callback, and TypeScript would narrow a
   * `let … = null` to `null` at every later read.
   */
  const waiverClaimsSeen: { claims: Parameters<typeof recordChatWaiverAdvice>[0]['claims'] | null } = {
    claims: null,
  }
  const decisionOsGroundingTask: Promise<string | null> =
    process.env.DECISION_OS_GROUNDING_ENABLED === 'true' && leagueSnapshot && userId
      ? withPacketCeiling(buildDecisionOsGroundingPacket({
          leagueId: leagueSnapshot.id,
          userId,
          sport: normalizeToSupportedSport(sport),
          season: effectiveSeason ?? new Date().getFullYear(),
          question: message,
          /*
           * ⚠ `values` WAS MISSING, AND THAT SILENTLY REMOVED THE WHOLE VALUATION LANE (R1.2).
           * The packet's own default is `{ values, projections, leagueRules }` — this call site
           * was NARROWER than the default and dropped the one feed the product is built around.
           *
           * `valueFormat` and `leagueIdpRules` are deliberately NOT passed: the packet derives
           * both from the league rules it already loads, so there is no second read here and no
           * second derivation to drift.
           *
           * ⚠ `devy` IS SCOPED TO NCAAF ON PURPOSE. The board is college-football only, so asking
           * for it on an NFL league returns a `no_producer` gap — true, unfixable, and printed
           * into every NFL answer. An unrequested slice raises no gap at all, which is the honest
           * shape for "this question could never have wanted it".
           * ⚠ Known follow-up: a C2C / devy-slot NFL dynasty league DOES want the board, and this
           * test does not find it. Tracked as R1.5 rather than guessed at here.
           */
          want: {
            values: true,
            devy: normalizeToSupportedSport(sport) === 'NCAAF',
            projections: true,
            leagueRules: true,
            // The intent router's four low-risk mappings — see the comment above this block.
            ...earlyWant,
          },
          /*
           * The waiver engine's claims, HELD — not recorded here. A side channel: never in the
           * prompt, and it cannot change or fail this turn.
           *
           * 🛑 THIS USED TO RECORD THE ADVICE IMMEDIATELY, and three things were wrong with that:
           *   - it ran BEFORE the token-spend confirmation, so the drawer's first, unconfirmed
           *     call recorded advice for an answer the user never paid for or saw;
           *   - the packet ceiling abandons without cancelling, so a TIMED-OUT packet — one the
           *     model never read — still recorded "Chimmy said add X";
           *   - it stored the engine's confidence, not the one the user was shown.
           * It is now recorded after the answer exists (see `waiverClaimsSeen` below), only when
           * the packet was used and the answer actually names the player.
           */
          onWaiverClaims: (claims) => {
            waiverClaimsSeen.claims = claims
          },
        })
          .then((packet) => {
            grounding.buildMs = packet.meta.durationMs
            const text = serializeDecisionOsGroundingForPrompt(packet)
            // ⚠ Never overwrite a verdict the ceiling has already reached. The race abandons this
            // promise but does not stop it, so this callback still runs AFTER a timeout — and
            // reporting 'ok' for a packet nobody used is worse than reporting nothing at all.
            if (grounding.outcome !== 'timeout') grounding.outcome = text.length > 0 ? 'ok' : 'empty'
            return text.length > 0 ? text : null
          })
          // Never fail the chat turn for grounding. An unavailable packet is one missing section,
          // and every other source in this handler degrades the same way.
          .catch(() => {
            if (grounding.outcome !== 'timeout') grounding.outcome = 'error'
            return null
          }),
          3000,
        )
      : Promise.resolve(null)

  const leagueSportsGroundingTask: Promise<{ serialized: string; packet: Awaited<ReturnType<typeof buildLeagueSportsGroundingPacket>> } | null> =
    leagueSnapshot && userId
      ? buildLeagueSportsGroundingPacket({
          leagueId: leagueSnapshot.id,
          userId,
          sport: sport ?? undefined,
          season: effectiveSeason ?? undefined,
        })
          .then((packet) => ({
            packet,
            serialized: serializeLeagueGroundingForPrompt(packet),
          }))
          .catch(() => null)
      : Promise.resolve(null)

  /*
   * ── CROSS-LEAGUE PLAYER LOOKUP — the inverse gate of `leagueSportsGroundingTask` ──────────
   *
   * 🛑 IT RUNS ONLY WHEN NO LEAGUE IS SELECTED, BECAUSE THAT IS THE CASE WITH NO PLAYER FACTS.
   * With a league in scope the packet above already carries full rosters. Without one, the only
   * player data in the whole packet is `resolvePortfolioGrounding`'s
   * `exposure.rows.filter((r) => r.count > 1).slice(0, 4)` — four players, and only ones rostered
   * more than once. A question naming anybody else grounded on nothing, and Chimmy correctly said
   * so: "this session returned no player-level data, so I can't evaluate a Rashee Rice trade in
   * any league right now."
   *
   * ⚠ BOUNDED WITH ITS OWN RACE RATHER THAN `withPacketCeiling`, which writes
   * `grounding.outcome = 'timeout'` — an observable that belongs to the Decision OS packet. Sharing
   * it would report THAT packet as timed out whenever this one was slow, corrupting the one signal
   * used to tell those three outcomes apart.
   *
   * ⚠ A TIMEOUT YIELDS null AND THE TURN CONTINUES. This section is additive: losing it costs the
   * lookup, never the answer, which is how every other contributor here degrades.
   */
  const portfolioPlayerGroundingTask: Promise<string | null> =
    !leagueSnapshot && userId
      ? Promise.race([
          buildPortfolioPlayerGrounding({ message, userId })
            .then((r) => (r ? r.serialized : null))
            .catch(() => null),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500)),
        ])
      : Promise.resolve(null)

  /*
   * ── MY ROSTER INJURIES — "who's out in my leagues" on the push path ─────────────────────────
   *
   * The same report the tool loop's `get_my_injuries` returns. It is pushed here too because the
   * tool loop runs ONLY on xAI: measured 2026-09-22, the xAI account was out of credits, so every
   * answer came through this path with no way to call a tool — and no path here could answer the
   * question at all. Gated on the ONE predicate the deterministic injury builder yields on, so
   * the two agree on who owns the question and the 40-league scan runs only when it is asked.
   *
   * ⚠ Own race, for the reason given on `portfolioPlayerGroundingTask`: a timeout costs this
   * section, never the answer.
   */
  const myRosterInjuriesTask: Promise<string | null> =
    userId && isOwnRosterInjuryQuestion(message)
      ? Promise.race([
          buildMyRosterInjuriesContext({ userId }).catch(() => null),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
        ])
      : Promise.resolve(null)

  const [
    screenshotResult,
    insightResult,
    memoryResult,
    leagueSportsGroundingResult,
    decisionOsGroundingResult,
    portfolioPlayerGroundingResult,
    myRosterInjuriesResult,
  ] =
    await Promise.allSettled([
      screenshotTask,
      insightTask,
      memoryTask,
      leagueSportsGroundingTask,
      decisionOsGroundingTask,
      portfolioPlayerGroundingTask,
      myRosterInjuriesTask,
    ])
  const [personalizationResult, profileClock] = await Promise.all([
    resolveChimmyPersonalizationProfile(userId).catch(() => null),
    prisma.userProfile.findUnique({
      where: { userId },
      select: { timezone: true, preferredLanguage: true },
    }),
  ])
  const userTemporalContext = buildUserTemporalContextForAI({
    timezone: CHIMMY_REFERENCE_TIMEZONE,
    preferredLanguage: profileClock?.preferredLanguage,
  })
  const personalizationDirectives = personalizationResult
    ? buildChimmyPromptPersonalizationDirectives(personalizationResult)
    : undefined
  const effectiveDetailLevel =
    detailLevel ??
    (personalizationResult?.effective.explanationStyle === 'concise'
      ? 'concise'
      : personalizationResult?.effective.explanationStyle === 'balanced'
      ? 'balanced'
      : personalizationResult?.effective.explanationStyle)
  const effectiveRiskMode = riskMode ?? personalizationResult?.effective.riskPreference
  const effectiveTone =
    tone ??
    (personalizationResult?.effective.storyContentPreferences.includes('likes-humor')
      ? 'engaging'
      : 'professional')
  const effectiveStrategyModeFinal = selectedAssistantMode

  const screenshotSummary = screenshotResult.status === 'fulfilled' ? screenshotResult.value : undefined
  const insightSummary = insightResult.status === 'fulfilled' ? insightResult.value?.summary : undefined
  const insightSources = insightResult.status === 'fulfilled' ? insightResult.value?.sources ?? [] : []
  const memorySection = memoryResult.status === 'fulfilled' ? memoryResult.value : undefined
  const leagueSportsGrounding =
    leagueSportsGroundingResult.status === 'fulfilled' ? leagueSportsGroundingResult.value : null
  const decisionOsGrounding =
    decisionOsGroundingResult.status === 'fulfilled' ? decisionOsGroundingResult.value : null
  const portfolioPlayerGrounding =
    portfolioPlayerGroundingResult.status === 'fulfilled' ? portfolioPlayerGroundingResult.value : null
  const myRosterInjuries = myRosterInjuriesResult.status === 'fulfilled' ? myRosterInjuriesResult.value : null

  const recentUserSnippet = conversation
    .filter((t) => t.role === 'user')
    .slice(-2)
    .map((t) => t.content)
    .join('\n')
  const chimmyOrchestrationClassification = classifyChimmyIntent(message, recentUserSnippet)
  let coachingProfileForOrchestration: Record<string, unknown> | null = null
  if (userId) {
    /*
     * What the user told Chimmy everywhere, overlaid by what they told it in THIS league — and
     * THIS league is the membership-proven one. It used to read only the row under the client's
     * `leagueId`, so "keep it short" said with no league selected vanished once one was, and the
     * row consulted was whichever id the request carried. Users edit both rows in Settings →
     * Preferences (`lib/chimmy-personalization/remembered.ts`).
     */
    const [globalCoaching, leagueCoaching] = await Promise.all([
      getAiMemory(userId, 'user_preferences', { leagueId: null, key: COACHING_PROFILE_KEY }),
      leagueSnapshot
        ? getAiMemory(userId, 'user_preferences', { leagueId: leagueSnapshot.id, key: COACHING_PROFILE_KEY })
        : Promise.resolve(null),
    ])
    coachingProfileForOrchestration = mergeCoachingProfiles(globalCoaching, leagueCoaching)
  }
  const chimmyMemorySummaryLine = buildMemorySummaryLine(coachingProfileForOrchestration)
  const chimmyOrchestrationPrompt = buildOrchestrationPromptSection({
    classification: chimmyOrchestrationClassification,
    ctx: { leagueId: leagueId ?? null, sport: sport ?? undefined, week: week ?? undefined },
    memorySummary: chimmyMemorySummaryLine,
  })
  const chimmyOrchestrationMeta = buildOrchestrationMeta({
    classification: chimmyOrchestrationClassification,
    ctx: { leagueId: leagueId ?? null, sport: sport ?? undefined, week: week ?? undefined },
    memorySummary: chimmyMemorySummaryLine,
  })

  /*
   * The home's own claims, so the assistant a user opens from the brief holds
   * the facts that brief stated instead of re-deriving them and possibly
   * disagreeing on the same screen.
   *
   * ⚠ NAMES COME FROM THE DATABASE, SCOPED TO THIS USER — never from the
   * request. The client sends ids and counts only (see homeSignals.ts); an id
   * this query does not return is dropped, so a caller cannot use this to read
   * the name of a league they do not hold, and cannot put text of their own
   * choosing into a prompt whose answers get posted publicly in the league tab.
   */
  let homeSignalsBlock: string | null = null
  if (homeSignals && userId) {
    const ids = [...new Set([...homeSignals.urgent, ...homeSignals.drafting])]
    const owned = ids.length
      ? await prisma.league
          .findMany({ where: { id: { in: ids }, userId }, select: { id: true, name: true } })
          .catch(() => [])
      : []
    homeSignalsBlock = renderHomeSignalsPrompt(
      homeSignals,
      // League.name is nullable; an unnamed league is an unresolved one, and
      // the renderer already drops those rather than printing a blank.
      new Map(
        owned
          .filter((l): l is { id: string; name: string } => typeof l.name === 'string' && l.name.length > 0)
          .map((l) => [l.id, l.name] as const),
      ),
    )
  }

  const combinedMemorySection = [
    memPrompt.contextBlock,
    homeSignalsBlock ?? undefined,
    coreSurfaceBlock ?? undefined,
    memorySection,
    portfolioPlayerGrounding
      ? `## CROSS-LEAGUE PLAYER LOOKUP\n${portfolioPlayerGrounding}`
      : undefined,
    myRosterInjuries ? `## MY ROSTER INJURIES (ALL LEAGUES)\n${myRosterInjuries}` : undefined,
    leagueSportsGrounding
      ? `## NFL/NCAAF LEAGUE SPORTS GROUNDING\n${leagueSportsGrounding.serialized}`
      : undefined,
    // Placed AFTER the existing grounding deliberately: while both are live the older packet is
    // still the authority on league facts, and this section's job is to add what it cannot say —
    // how fresh each fact is, and what is missing and why.
    decisionOsGrounding ? `## DECISION OS GROUNDING\n${decisionOsGrounding}` : undefined,
    personalizationDirectives,
    chimmyOrchestrationPrompt,
  ]
    .concat(
      staleness.warning
        ? [`## DATA FRESHNESS\n${staleness.warning}\nAlways include this warning when answering.`]
        : [],
      sourceReferences.length > 0
        ? [
            `## SOURCE REFERENCES\n${sourceReferences
              .map((reference) => `- ${reference.label}: ${reference.href}`)
              .join('\n')}\nReference these links in responses when relevant.`,
          ]
        : []
    )
    .filter(Boolean)
    .join('\n\n')
  const promptPrelude = [userTemporalContext.promptLine, behaviorRulesBlock, memPrompt.systemBlock]
    .filter(Boolean)
    .join('\n\n')

  if (screenshotSummary) dataSources.push('screenshot_vision')
  if (insightSources.length > 0) dataSources.push(...insightSources)
  if (memorySection) dataSources.push('ai_memory', 'chat_history')
  if (memPrompt.contextBlock) dataSources.push('working_memory')
  if (homeSignalsBlock) dataSources.push('core_home_signals')
  if (coreSurfaceBlock) dataSources.push('core_surface_context')
  if (leagueSportsGrounding) dataSources.push('league_sports_grounding_packet')
  if (portfolioPlayerGrounding) dataSources.push('cross_league_player_lookup')
  if (myRosterInjuries) dataSources.push('cross_league_roster_injuries')
  if (connectedFranchiseGrounding) dataSources.push('connected_franchise_rosters')
  // Declared so a response can be attributed. A grounding source the answer used but does not
  // name is untraceable afterwards, which is the whole reason dataSources exists.
  if (decisionOsGrounding) dataSources.push('decision_os_grounding_packet')
  /*
   * ⚠ A NON-OK OUTCOME IS ATTRIBUTED TOO, which is the opposite of how every other source on
   * this line behaves — deliberately. The others are additive niceties whose absence is
   * unremarkable. This one is a flagged feature somebody has to be able to make a decision about,
   * and "produced nothing", "was too slow" and "threw" are three different decisions.
   */
  else if (grounding.outcome !== 'off') dataSources.push(`decision_os_grounding_${grounding.outcome}`)

  if (grounding.outcome === 'timeout') {
    // Loud, because the cost is paid on EVERY turn and nothing else would surface it.
    console.warn(
      `[chimmy] Decision OS grounding exceeded its 3000ms ceiling and was discarded (league ${leagueId}). ` +
        `The producers still ran and were still billed.`,
    )
  } else if (grounding.buildMs != null && grounding.buildMs >= 2000) {
    // The near miss is the early warning. By the time it times out it has been costing for a
    // while, so the threshold sits below the ceiling rather than at it.
    console.warn(
      `[chimmy] Decision OS grounding took ${grounding.buildMs}ms against a 3000ms ceiling (league ${leagueId}).`,
    )
  }
  if (personalizationDirectives) dataSources.push('chimmy_personalization')
  if (sourceReferences.length > 0) dataSources.push('league_source_references')
  if (staleness.warning) dataSources.push('stale_data_warning')
  dataSources.push('chimmy_orchestration')

  const baseUserMessageBody = buildUserMessage({
    message,
    conversation,
    screenshotSummary,
    insightSummary,
    memorySection: combinedMemorySection || undefined,
    leagueGroundingLine: [
      buildLeagueGroundingLine({
        leagueSnapshot,
        leagueNameHint: leagueNameHint ?? undefined,
        groundingFailure: leagueId && !leagueGrounding.ok ? leagueGrounding.reason : null,
        season: effectiveSeasonResult,
      }),
      connectedFranchiseGrounding,
      ...(psychologyGroundingLines.length > 0
        ? [psychologyGroundingLines.join(NEWLINE)]
        : []),
    ]
      .filter(Boolean)
      .join(NEWLINE) || undefined,
    leagueFormat,
    scoring,
    strategyMode: effectiveStrategyModeFinal,
    tone: effectiveTone,
    detailLevel: effectiveDetailLevel,
    riskMode: effectiveRiskMode,
    privateMode,
    targetUsername,
  })
  const baseUserMessage = promptPrelude
    ? `${promptPrelude}\n\n${baseUserMessageBody}`
    : baseUserMessageBody

  const deterministicContext = compactRecord({
    userTemporalContext: compactRecord({
      userTimezone: userTemporalContext.userTimezone,
      userLocalDateTime: userTemporalContext.userLocalDateTime,
      userLocalCalendarDate: userTemporalContext.userLocalCalendarDate,
      utcNowIso: userTemporalContext.utcNowIso,
      promptLine: userTemporalContext.promptLine,
    }),
    chimmySportDataScope: digestSport,
    activeLeagueSnapshot: leagueSnapshot
      ? compactRecord({
          id: leagueSnapshot.id,
          name: leagueSnapshot.name,
          sport: leagueSnapshot.sport,
          platform: leagueSnapshot.platform,
          platformLeagueId: leagueSnapshot.platformLeagueId,
          season: leagueSnapshot.season,
          leagueSize: leagueSnapshot.leagueSize,
          scoring: leagueSnapshot.scoring,
          isDynasty: leagueSnapshot.isDynasty,
          timezone: leagueSnapshot.timezone,
          lastSyncedAt: leagueSnapshot.lastSyncedAt?.toISOString() ?? null,
          importedAt: leagueSnapshot.importedAt?.toISOString() ?? null,
        })
      : undefined,
    leagueSportsGrounding: leagueSportsGrounding
      ? compactRecord({
          sport: leagueSportsGrounding.packet.sport,
          season: leagueSportsGrounding.packet.season,
          settings: leagueSportsGrounding.packet.settings,
          leagueContext: leagueSportsGrounding.packet.leagueContext,
          fantasyData: leagueSportsGrounding.packet.fantasyData,
          freshness: leagueSportsGrounding.packet.freshness,
          providerHealth: leagueSportsGrounding.packet.providerHealth,
          unavailable: leagueSportsGrounding.packet.unavailable,
          newsDigest: leagueSportsGrounding.packet.newsDigest,
          weatherEvidence: leagueSportsGrounding.packet.weatherEvidence,
          scheduleSummary: leagueSportsGrounding.packet.scheduleSummary,
          standingsSummary: leagueSportsGrounding.packet.standingsSummary,
        })
      : undefined,
    leagueContextEngine: normalizedLeagueContext ?? undefined,
    contextSnapshot: compactRecord({
      leagueId,
      leagueNameHint: leagueNameHint ?? undefined,
      sportScope: sportScope ?? undefined,
      sleeperUsername,
      teamId: verifiedTeamId ?? undefined,
      sport,
      season: effectiveSeason,
      week,
      insightType,
      privateMode,
      targetUsername,
      strategyMode: effectiveStrategyModeFinal,
      leagueFormat,
      scoring,
      tone: effectiveTone,
      detailLevel: effectiveDetailLevel,
      riskMode: effectiveRiskMode,
      source,
      conversationId,
      sessionId,
    }),
    matchupData: insightType === 'matchup'
      ? compactRecord({ leagueId, teamId: verifiedTeamId ?? undefined, week, season: effectiveSeason, summary: insightSummary })
      : undefined,
    projections: insightType === 'playoff' || /projection|projected|win probability/i.test(message)
      ? compactRecord({ season: effectiveSeason, week, summary: insightSummary })
      : undefined,
    rosterNeeds: /roster|lineup|need|depth/i.test(message)
      ? compactRecord({ summary: insightSummary || message.slice(0, 280) })
      : undefined,
    adpComparisons: /adp|value pick|reach/i.test(message)
      ? compactRecord({ summary: message.slice(0, 280) })
      : undefined,
    rankings: /rank|ranking|tiers/i.test(message)
      ? compactRecord({ summary: insightSummary || message.slice(0, 280) })
      : undefined,
    scoringOutputs: /score|points|scoring|projection/i.test(message)
      ? compactRecord({ summary: insightSummary || message.slice(0, 280) })
      : undefined,
    screenshotEvidence: screenshotSummary,
    memoryContext: combinedMemorySection
      ? compactRecord({
          conversationId,
          promptSection: combinedMemorySection.slice(0, 4000),
        })
      : undefined,
    workingMemoryContext: memPrompt.contextBlock
      ? compactRecord({
          sessionId,
          tags: currentTags,
          promptSection: memPrompt.contextBlock.slice(0, 4000),
        })
      : undefined,
  })

  const leagueSettings = compactRecord({
    sport,
    season: effectiveSeason,
    week,
    insightType,
    source,
    privateMode,
    targetUsername,
    leagueFormat,
    scoring,
    tone: effectiveTone,
    detailLevel: effectiveDetailLevel,
    riskMode: effectiveRiskMode,
  })

  /*
   * ⚠ THE AGENT FOLLOWS THE ORCHESTRATION INTENT, so the specialist prompt and the intent label
   * the model is shown cannot disagree. The mode and league format are hints for a question that
   * names no workflow — they used to be joined into the classified text, which sent every
   * Dynasty Lens trade question to the dynasty agent. See `inferAgentFromMessage`.
   */
  const specialistAgent = inferAgentFromMessage(message, {
    intent: chimmyOrchestrationClassification.intent,
    insightType,
    mode: effectiveStrategyMode,
    leagueFormat,
  })
  const recentConversationContext = conversation
    .slice(-6)
    .map((turn) => `${turn.role}: ${turn.content}`)
    .join('\n')
  let userMessage = baseUserMessage
  try {
    userMessage = await buildAgentPrompt({
      agent: specialistAgent,
      userMessage: baseUserMessage,
      sport,
      deterministicContext,
      conversationContext: recentConversationContext || undefined,
    })
    dataSources.push(`agent_prompt_${specialistAgent}`)
  } catch {
    userMessage = baseUserMessage
  }

  const validation = validateToolRequest('chimmy_chat', deterministicContext, {
    leagueSettings,
    sport,
  })
  if (!validation.valid) {
    return NextResponse.json(
      {
        error: validation.error ?? 'Invalid Chimmy request.',
      },
      { status: 400 }
    )
  }

  const customRules = await customRulesTask

  const spendService = new TokenSpendService()
  let tokenPreview: TokenSpendPreview | null = null
  let tokenPreviewFailed = false
  try {
    tokenPreview = await spendService.previewSpend(userId, 'ai_chimmy_chat_message', userEmail)
  } catch (error) {
    if (error instanceof TokenSpendRuleNotFoundError) {
      return NextResponse.json(
        {
          error: error.message,
          code: 'token_spend_rule_missing',
        },
        { status: 500 }
      )
    }
    tokenPreviewFailed = true
    console.error(
      '[api/chat/chimmy] Token preview failed, continuing without preflight:',
      error instanceof Error ? error.message : error
    )
  }
  if (!tokenPreviewFailed && tokenPreview?.requiresConfirmation !== false && !confirmTokenSpend) {
    return NextResponse.json(
      {
        error: 'Token spend confirmation required before sending to Chimmy.',
        code: 'token_confirmation_required',
        preview: tokenPreview,
      },
      { status: 409 }
    )
  }

  /*
   * ── 🛑 "SHOULD I TRADE FOR X?" IS DECIDED BY CODE, NOT BY A MODEL ─────────────────────────────
   *
   * User report, 2026-09-16: "is it worth me trading for Rashee Rice in this league?" came back as
   * Rice's FantasyCalc price and nothing else. Asked again, still no answer. What was wanted: "yes
   * because…" or "no because…", from their roster, the league's scoring and their record.
   *
   * A trade has roster consequences, so the verdict is explanation-only for AI (product rule,
   * 2026-08-20). `buildTradeTargetVerdict` computes it from the league — the same trade read the
   * /core player card shows, plus this week's lineup under the league's own scoring — and the
   * route returns its sentences as written. No model runs on this path.
   *
   * ⚠ COMPUTED AFTER THE CONFIRMATION CHECK, BEFORE THE CHARGE, AND CHARGED ONLY WHEN IT DECIDES.
   *   - After the 409: the /core drawer sends every paid question unconfirmed first and retries with
   *     consent, so a verdict computed above the check would be computed twice per question.
   *   - Before the charge: a name that is not on a roster, or on two, is an honest "I could not
   *     tell" and costs nothing — the same deal the live-search fallback makes: you pay for an
   *     answer, never for us saying we have none. A decided verdict is charged below like any other.
   *
   * 🛑 `leagueSnapshot.id` ONLY. The verdict reads every roster in the league.
   */
  const tradeTargetQuestion = leagueSnapshot ? parseTradeTargetQuestion(message) : null
  const tradeTargetRead: TradeTargetResult | null =
    tradeTargetQuestion && leagueSnapshot
      ? await buildTradeTargetVerdict({
          playerName: tradeTargetQuestion.playerName,
          leagueId: leagueSnapshot.id,
          userId,
        }).catch(() => null)
      : null
  /*
   * One word that matches nobody ("should I trade for depth?" slipped past the parser's word list)
   * was probably not a name at all — that question goes on to the ordinary path rather than being
   * told "I could not find Depth".
   */
  const tradeTargetResult =
    tradeTargetRead?.status === 'unresolved' &&
    tradeTargetRead.reason === 'not_rostered' &&
    !/\s/.test(tradeTargetQuestion?.playerName ?? '')
      ? null
      : tradeTargetRead
  const tradeTargetGrounding = leagueSnapshot
    ? {
        grounded: true as const,
        leagueId: leagueSnapshot.id,
        leagueName: leagueSnapshot.name,
        platform: leagueSnapshot.platform,
        season: leagueSnapshot.season,
        lastSyncedAt: leagueSnapshot.lastSyncedAt?.toISOString() ?? null,
      }
    : null
  if (tradeTargetResult?.status === 'unresolved') {
    return NextResponse.json({
      response: tradeTargetResult.detail,
      result: tradeTargetResult.detail,
      source: 'chimmy_trade_target_verdict',
      sessionId,
      meta: {
        /* Nothing was decided, so nothing is charged. */
        free: true,
        confidencePct: 0,
        providerStatus: { openai: 'skipped', deepseek: 'skipped', grok: 'skipped' },
        leagueGrounding: tradeTargetGrounding,
        tradeTarget: { status: 'unresolved', reason: tradeTargetResult.reason },
        dataSources: ['league_rosters'],
        responseStructure: {
          shortAnswer: tradeTargetResult.detail,
          caveats: ['No verdict was reached, so nothing was charged.'],
        },
      },
    })
  }

  let spendLedger: { id: string; balanceAfter: number } | null = null
  if (!tokenPreviewFailed) {
    try {
      const ledger = await spendService.spendTokensForRule({
        userId,
        ruleCode: 'ai_chimmy_chat_message',
        confirmed: confirmTokenSpend,
        sourceType: 'chimmy_chat',
        sourceId: conversationId,
        description: 'Chimmy chat message',
        metadata: {
          conversationId,
          leagueId: leagueId ?? null,
          sport,
          source: source ?? null,
        },
        userEmail,
      })
      spendLedger = {
        id: ledger.id,
        balanceAfter: ledger.balanceAfter,
      }
    } catch (error) {
      if (error instanceof TokenInsufficientBalanceError) {
        return NextResponse.json(
          {
            error: 'Insufficient token balance',
            code: 'insufficient_token_balance',
            requiredTokens: error.requiredTokens,
            currentBalance: error.currentBalance,
          },
          { status: 402 }
        )
      }
      if (error instanceof TokenSpendConfirmationRequiredError) {
        return NextResponse.json(
          {
            error: 'Token spend confirmation required.',
            code: 'token_confirmation_required',
            requiredTokens: error.tokenCost,
            ruleCode: error.ruleCode,
          },
          { status: 409 }
        )
      }
      if (error instanceof TokenSpendRuleNotFoundError) {
        return NextResponse.json(
          {
            error: error.message,
            code: 'token_spend_rule_missing',
          },
          { status: 500 }
        )
      }
      return NextResponse.json({ error: 'Unable to process token spend.' }, { status: 500 })
    }
  }

  /*
   * The trade-target verdict, now that it has been paid for. Returned before the tool loop and PECR
   * so no model writes a second opinion over it — see the note above the spend.
   */
  if (tradeTargetResult?.status === 'decided') {
    const v = tradeTargetResult.verdict
    const text = renderTradeTargetVerdict(v)
    return NextResponse.json({
      response: text,
      result: text,
      source: 'chimmy_trade_target_verdict',
      sessionId,
      meta: {
        tokenSpend:
          spendLedger && tokenPreview
            ? {
                ruleCode: tokenPreview.ruleCode,
                tokenCost: tokenPreview.tokenCost,
                balanceAfter: spendLedger.balanceAfter,
                ledgerId: spendLedger.id,
              }
            : undefined,
        providerStatus: { openai: 'skipped', deepseek: 'skipped', grok: 'skipped' },
        leagueGrounding: tradeTargetGrounding,
        tradeTarget: { status: 'decided', verdict: v.verdict, player: tradeTargetResult.targetName },
        dataSources: ['league_rosters', 'league_scoring', 'weekly_projections', 'market_values', 'trade_engine'],
        responseStructure: {
          shortAnswer: `${v.headline}, because ${v.because}.`,
          whatDataSays: v.reasons.join(' '),
          recommendedAction: v.openWith ? `Open with ${v.openWith}.` : v.headline,
          caveats: v.basis,
        },
      },
    })
  }

  /*
   * ⚠ TOOL LOOP: CLAUDE FIRST (Grok when no Anthropic key), AND SILENT WHEN IT DOES NOT RUN.
   * This is where Chimmy's main model is chosen — see `lib/chimmy/tools/chimmyToolLoop.ts`.
   *
   * Placed HERE on purpose — after the spend is settled, before PECR. It is an
   * ALTERNATIVE to the push path, not an addition: running both would make two
   * paid provider journeys for one charged message. Returning null (flag off,
   * no key, provider error, turn ceiling, empty text) falls through to PECR
   * exactly as before, so a failure here is invisible rather than an error the
   * reader has to interpret.
   *
   * It is deliberately NOT given the assembled grounding: the point of the loop
   * is that the model fetches what it needs. Handing it the push context as
   * well would pay for both and prove nothing about whether the tools work.
   */
  const chimmyToolLoopEnabled = getChimmyFeatureFlags().toolLoop

  if (chimmyToolLoopEnabled) {
    const { runChimmyToolLoop } = await import('@/lib/chimmy/tools/chimmyToolLoop')
    /*
     * Held in a variable because the loop MUTATES it: `find_league_by_name` rebinds `leagueId` to a
     * league the user is a member of (it is the only writer — `lib/chimmy/tools/chimmyTools.ts`).
     * Read back below so the drawer learns which league the answer was about.
     */
    const toolContext = { leagueId: leagueSnapshot?.id ?? null, userId: userId ?? null }
    const loop = await runChimmyToolLoop({
      question: message,
      /*
       * The PECR path has always carried the user's clock; the tool loop — the path that answers
       * first — did not, so "tonight", "this week" and "last Sunday" were resolved against the
       * model's training cutoff. Same line, same authority, both paths. Passed separately from
       * the instructions because it changes every minute and Claude caches the instructions.
       */
      systemPrompt: CHIMMY_TOOL_LOOP_SYSTEM_PROMPT,
      clockLine: userTemporalContext.promptLine,
      conversation: conversation.slice(-6).map((turn) => ({
        role: turn.role === 'assistant' ? ('assistant' as const) : ('user' as const),
        content: turn.content,
      })),
      /*
       * 🛑 THE MEMBERSHIP-PROVEN ID ONLY — NEVER `leagueId`. `leagueId` is the client's field,
       * and the route refuses an unproven one only when the question REQUIRES a league. A
       * general question with a stranger's league id reached this line unchanged, and two
       * tools read it with no membership check of their own: `get_league_standings`
       * (`buildLeagueStandingsContext` uses the user id only to mark the viewer's row) and
       * `get_head_to_head` (`buildHeadToHeadGrounding` takes no user id at all). With the loop
       * on by default, that was any league's standings and rivalry records for anyone signed
       * in. Pinned in `__tests__/chimmy-unproven-league-id-readers.test.ts`.
       */
      context: toolContext,
      enabled: true,
    }).catch(() => null)

    if (loop?.text) {
      /*
       * ⚠ THE ANSWER MODE, HONOURED HERE ONLY WHEN A CLIENT ASKED FOR ONE. This path used to ignore
       * the mode entirely, so the /core drawer's Fast/Deep toggle would have done nothing whenever the
       * tool loop answered — which, with the loop on by default, is often. A caller that sends no mode
       * keeps the full answer it has always had here: the main path's "absent means fast" default was
       * never applied to this path, and changing that for every surface is a separate decision.
       */
      const loopModeRequested = [mode, assistantMode].some((v) => typeof v === 'string' && v.trim().length > 0)
      const loopText = loopModeRequested
        ? buildChimmyResponseForAssistantMode({ mode: selectedAssistantMode, fullResponse: loop.text })
        : loop.text
      /*
       * 🛑 THE LOOP'S ANSWERS NEVER SAID WHICH LEAGUE THEY WERE ABOUT. The PECR path reports
       * `meta.leagueGrounding`; this return did not, so a league the route resolved — or one the model
       * found by name — was invisible to the drawer, and the next message went out unscoped again
       * (user report, 2026-09-16: "even after opening the league, Chimmy was lost").
       *
       * The same shape as the PECR path. A tool-bound id is a membership-proven one
       * (`findLeagueByName` returns only the caller's leagues), and its row is read only for the label.
       */
      const boundLeagueId = toolContext.leagueId
      const boundLeague =
        boundLeagueId == null
          ? null
          : boundLeagueId === leagueSnapshot?.id
            ? leagueSnapshot
            : await prisma.league
                .findUnique({
                  where: { id: boundLeagueId },
                  select: { id: true, name: true, platform: true, season: true, lastSyncedAt: true },
                })
                .catch(() => null)
      return NextResponse.json({
        response: loopText,
        result: loopText,
        source: 'chimmy_tool_loop',
        sessionId,
        meta: {
          /* The mode that shaped this answer — only when one was asked for and applied. */
          ...(loopModeRequested ? { mode: selectedAssistantMode } : {}),
          /* The spend already happened above; report what it actually cost. */
          tokenSpend:
            spendLedger && tokenPreview
              ? {
                  ruleCode: tokenPreview.ruleCode,
                  tokenCost: tokenPreview.tokenCost,
                  balanceAfter: spendLedger.balanceAfter,
                  ledgerId: spendLedger.id,
                }
              : undefined,
          providerStatus:
            loop.provider === 'claude'
              ? { anthropic: 'ok', openai: 'skipped', deepseek: 'skipped', grok: 'skipped' }
              : { openai: 'skipped', deepseek: 'skipped', grok: 'ok' },
          /* The model that actually answered — the one thing a quality complaint needs first. */
          ...(loop.model ? { model: loop.model } : {}),
          leagueGrounding: boundLeague
            ? {
                grounded: true as const,
                leagueId: boundLeague.id,
                leagueName: boundLeague.name,
                platform: boundLeague.platform,
                season: boundLeague.season,
                lastSyncedAt: boundLeague.lastSyncedAt?.toISOString() ?? null,
              }
            : { grounded: false as const, leagueId: null, reason: 'no_league_selected' as const },
          /* Which lookups the model chose, so the answer's sourcing is visible. */
          toolsUsed: loop.toolsUsed,
          turns: loop.turns,
          dataSources: loop.toolsUsed,
          responseStructure: {
            shortAnswer: loop.text.split('\n')[0]?.slice(0, 200) ?? '',
            caveats: [
              'Answered by the experimental tool loop; the model chose which data to read.',
            ],
          },
        },
      })
    }
  }

  let pecrIntent = 'general'
  /** Set inside `plan` when a described trade resolves against this league's rosters. */
  let scenarioForMeta: ReadyChimmyScenario | null = null
  try {
    const pecrResult = await runPECR(
      {
        message,
        userId,
        leagueId: leagueId ?? undefined,
        sleeperUsername: sleeperUsername ?? undefined,
        teamId: verifiedTeamId ?? undefined,
      },
      {
        feature: 'chimmy',
        plan: async (planInput) => {
          const intent = classifyPecrIntent(planInput.message)
          pecrIntent = intent

          /*
           * 🛑 A FOURTH BYPASS FAMILY, FOUND WHILE PROVING THE THIRD, AND NOT PREVIOUSLY REPORTED.
           *
           * `getFullAIContext` makes THREE league-scoped reads with no membership check of its
           * own — `prisma.aILeagueContext.findUnique({ where: { leagueId } })`,
           * `getTeamSnapshots(leagueId, teamId, 6)` and `getRecentMemoryEvents({ leagueId })`.
           * `resolveLeagueMembership` appears nowhere in `lib/ai-memory.ts`. Its result is not
           * discarded either: `buildMemoryPromptSection(legacyMemory.value)` becomes
           * `legacyMemorySection`, which is passed straight into the prompt at ~2843. So a
           * stranger's league phase, team snapshots and memory events were model-visible.
           *
           * ⚠ `enrichChatWithData` IS NOT A BYPASS AND IS ONLY CHANGED FOR SYMMETRY. `leagueId`
           * occurs exactly once in `lib/chat-data-enrichment.ts` — in its own options type — and
           * is never read, so it discloses nothing today. It is switched to the authorized id so
           * that whoever eventually implements it inherits the guard instead of the hole.
           *
           * ✅ `teamId` IS NOW THE VERIFIED ONE (`resolveCallerTeamId`, 2026-09-16). It used to be
           * the raw client field here, so once `leagueId` was authorized `getTeamSnapshots` could
           * still read ANOTHER MEMBER'S team within a league the caller belongs to. `planInput.teamId`
           * is `verifiedTeamId`: the caller's own claimed team in the verified league, or nothing.
           */
          const [legacyEnrichment, legacyMemory] = await Promise.allSettled([
            enrichChatWithData(planInput.message, {
              leagueId: leagueSnapshot?.id,
              sleeperUsername: planInput.sleeperUsername,
            }),
            getFullAIContext({
              userId: planInput.userId,
              sleeperUsername: planInput.sleeperUsername,
              leagueId: leagueSnapshot?.id,
              teamId: planInput.teamId,
            }),
          ])

          let legacyEnrichmentContext =
            legacyEnrichment.status === 'fulfilled' ? legacyEnrichment.value.context : ''

          /*
           * Why the league trade-history block is or is not in this prompt.
           *
           * 🛑 TWO FAILURES LOOK IDENTICAL FROM THE ANSWER. Chimmy saying "I
           * cannot see this league's trade history" is produced BOTH by the
           * block never being built (wrong league id, non-Sleeper league, no
           * ingested rows) and by it being built and then dropped by
           * `applyGroundingBudget`, which drops from the END and is where this
           * block sits. They need opposite fixes, and until now nothing
           * recorded which had happened. Logged once per planned turn, beside
           * the labels of whatever the budget actually dropped.
           */
          let tradeHistoryDiag = 'not-attempted'

          try {
            const digest = await buildChimmySportDataDigest({
              sport: digestSport,
              question: planInput.message,
              includeNewsApi: true,
              timezone: CHIMMY_REFERENCE_TIMEZONE,
            })
            chimmySportDigestFreshness = digest.freshness
            if (digest.text) {
              legacyEnrichmentContext = legacyEnrichmentContext
                ? `${legacyEnrichmentContext}\n\n## CHIMMY SPORT DATA DIGEST (deterministic DB-backed sports ingest)\n${digest.text}`
                : `## CHIMMY SPORT DATA DIGEST (deterministic DB-backed sports ingest)\n${digest.text}`
            }
          } catch {
            /* non-fatal */
          }

          // Inject specialty league context for tournament and Big Brother leagues
            /*
             * 🛑 ONE CALL. The rule grounding, the context resolver, evidence
             * validation, scoped refusals and the envelope all live in
             * lib/decision-os/envelope — this route orchestrates them rather than
             * containing another implementation. The block this replaces was ~40
             * lines and was the eighth inline section in this file.
             *
             * ⚠ IT RESOLVES OFF `leagueSnapshot`, WHICH MEMBERSHIP ALREADY PROVED.
             * The resolver authorizes the id again — it cannot know one was
             * checked, and should not be told. The worst case is a redundant
             * membership read; the alternative is a trusted claim.
             *
             * ⚠ THE SPECIALTY BLOCKS BELOW STILL RUN. This is the frame they are
             * read against, exactly as the rule grounding was. Dropping them to
             * look tidy would lose contexts that work today.
             */
            try {
              const envelopeGrounding = await buildDecisionEnvelopeGrounding({
                message: planInput.message,
                userId,
                snapshot: leagueSnapshot,
                orchestrationIntent: pecrIntent,
                sportHint: sport ?? null,
              })
              if (envelopeGrounding) {
                legacyEnrichmentContext = legacyEnrichmentContext
                  ? `${envelopeGrounding.promptBlock}

${legacyEnrichmentContext}`
                  : envelopeGrounding.promptBlock
              }
            } catch (err) {
              /*
               * ⚠ NO EMPTY CATCH, AND NO ERROR TEXT IN THE DIAGNOSTIC. Only the
               * constructor name: an upstream message can carry a URL, and this
               * repo has had a credential escape that way. The envelope emits its
               * own evidence gap, so a failure here is visible to the model rather
               * than indistinguishable from a league with no rules.
               */
              console.warn('[chimmy] decision envelope grounding failed', {
                kind: err instanceof Error ? err.constructor.name : 'unknown',
              })
              legacyEnrichmentContext = legacyEnrichmentContext
                ? `${buildRuleGroundingGap('resolve_threw')}

${legacyEnrichmentContext}`
                : buildRuleGroundingGap('resolve_threw')
            }
          /*
           * 🛑 THE AUTHORIZED SNAPSHOT, NOT THE PLAN INPUT — AND THIS GUARDS SIXTEEN
           * BUILDERS, NOT ONE.
           *
           * `planInput.leagueId` traces back to `formData.get('leagueId')`. Every
           * `build*ContextForChimmy` below reads league configuration directly —
           * guillotine mode, dynasty config, best-ball mode, leagueVariant, settings,
           * leagueSize — and NONE of them performs a membership check:
           * `resolveLeagueMembership` appears in none of those modules. So an
           * unauthorized id reached sixteen readers, and their output goes into the
           * prompt.
           *
           * ⚠ FOUND BY A TEST, NOT BY READING. The assertion "no downstream league
           * read happens after authorization fails" came back with six selects that
           * were not the membership shape — `guillotineMode,sport`,
           * `dynastyConfig,id,leagueSize,settings,sport`, and four more. Reading the
           * route had already missed them twice.
           *
           * `leagueSnapshot` exists only because `loadLeagueGroundingForUser` proved
           * membership, so gating here closes all sixteen at once rather than
           * per-builder.
           */
          if (leagueSnapshot && planInput.userId) {
            try {
              const tournamentCtx = await buildTournamentContextForChimmy(leagueSnapshot.id, planInput.userId)
              if (tournamentCtx) {
                legacyEnrichmentContext = legacyEnrichmentContext
                  ? `${legacyEnrichmentContext}\n\n${tournamentCtx}`
                  : tournamentCtx
              }
            } catch { /* non-fatal */ }
            try {
              const bbCtx = await buildBigBrotherContextForChimmy(leagueSnapshot.id, planInput.userId)
              if (bbCtx) {
                legacyEnrichmentContext = legacyEnrichmentContext
                  ? `${legacyEnrichmentContext}\n\n${bbCtx}`
                  : bbCtx
              }
            } catch { /* non-fatal */ }
            try {
              /*
               * IDP values, for the ~10 leagues that genuinely roster defenders. The builder
               * self-gates on the STRICT scoring predicate and returns null everywhere else,
               * so this costs a resolved league read and nothing more for the other ~100.
               *
               * ⚠ THIS IS THE ONLY IDP GROUNDING CALL. A second, identical block was added
               * further down importing `buildIdpContext` from '@/lib/idp/idpChimmyGrounding'
               * — a module that does not exist, and a symbol that does not exist either; the
               * real export is `buildIdpContextForChimmy`, already imported above. Had it
               * resolved it would have appended the SAME context to the prompt twice and
               * paid for the league read twice. Removed; its comment is the one you are
               * reading.
               */
              const idpCtx = await buildIdpContextForChimmy(leagueSnapshot.id, planInput.userId)
              if (idpCtx) {
                legacyEnrichmentContext = legacyEnrichmentContext
                  ? `${legacyEnrichmentContext}\n\n${idpCtx}`
                  : idpCtx
              }
            } catch { /* non-fatal */ }
            try {
              const survivorCtx = await buildSurvivorContextForChimmy(leagueSnapshot.id, planInput.userId)
              if (survivorCtx) {
                legacyEnrichmentContext = legacyEnrichmentContext
                  ? `${legacyEnrichmentContext}\n\n${survivorCtx}`
                  : survivorCtx
              }
            } catch { /* non-fatal */ }
            try {
              const zombieCtx = await buildZombieContextForChimmy(leagueSnapshot.id, planInput.userId)
              if (zombieCtx) {
                legacyEnrichmentContext = legacyEnrichmentContext
                  ? `${legacyEnrichmentContext}\n\n${zombieCtx}`
                  : zombieCtx
              }
            } catch { /* non-fatal */ }
            try {
              const devyCtx = await buildDevyContextForChimmy(leagueSnapshot.id, planInput.userId)
              if (devyCtx) {
                legacyEnrichmentContext = legacyEnrichmentContext
                  ? `${legacyEnrichmentContext}\n\n${devyCtx}`
                  : devyCtx
              }
            } catch { /* non-fatal */ }
            try {
              const guillotineCtx = await buildGuillotineContextForChimmy(leagueSnapshot.id, planInput.userId)
              if (guillotineCtx) {
                legacyEnrichmentContext = legacyEnrichmentContext
                  ? `${legacyEnrichmentContext}\n\n${guillotineCtx}`
                  : guillotineCtx
              }
            } catch { /* non-fatal */ }
            try {
              const c2cCtx = await buildC2CContextForChimmy(leagueSnapshot.id, planInput.userId)
              if (c2cCtx) {
                legacyEnrichmentContext = legacyEnrichmentContext
                  ? `${legacyEnrichmentContext}\n\n${c2cCtx}`
                  : c2cCtx
              }
            } catch { /* non-fatal */ }
            try {
              const salaryCapCtx = await buildSalaryCapContextForChimmy(leagueSnapshot.id, planInput.userId)
              if (salaryCapCtx) {
                legacyEnrichmentContext = legacyEnrichmentContext
                  ? `${legacyEnrichmentContext}\n\n${salaryCapCtx}`
                  : salaryCapCtx
              }
            } catch { /* non-fatal */ }
            try {
              const dynastyCtx = await buildDynastyContextForChimmy(leagueSnapshot.id, planInput.userId)
              if (dynastyCtx) {
                legacyEnrichmentContext = legacyEnrichmentContext
                  ? `${legacyEnrichmentContext}\n\n${dynastyCtx}`
                  : dynastyCtx
              }
            } catch { /* non-fatal */ }
            try {
              const dynastyWarRoomCtx = await buildDynastyWarRoomContextForChimmy(leagueSnapshot.id, planInput.userId)
              if (dynastyWarRoomCtx) {
                legacyEnrichmentContext = legacyEnrichmentContext
                  ? `${legacyEnrichmentContext}\n\n${dynastyWarRoomCtx}`
                  : dynastyWarRoomCtx
              }
            } catch { /* non-fatal */ }
            try {
              const redraftCtx = await buildRedraftContextForChimmy(leagueSnapshot.id, planInput.userId)
              if (redraftCtx) {
                legacyEnrichmentContext = legacyEnrichmentContext
                  ? `${legacyEnrichmentContext}\n\n${redraftCtx}`
                  : redraftCtx
              }
            } catch { /* non-fatal */ }
            try {
              const keeperCtx = await buildKeeperContextForChimmy(leagueSnapshot.id, planInput.userId)
              if (keeperCtx) {
                legacyEnrichmentContext = legacyEnrichmentContext
                  ? `${legacyEnrichmentContext}\n\n${keeperCtx}`
                  : keeperCtx
              }
            } catch { /* non-fatal */ }
            try {
              const bestBallCtx = await buildBestBallContextForChimmy(leagueSnapshot.id, planInput.userId)
              if (bestBallCtx) {
                legacyEnrichmentContext = legacyEnrichmentContext
                  ? `${legacyEnrichmentContext}\n\n${bestBallCtx}`
                  : bestBallCtx
              }
            } catch { /* non-fatal */ }
            try {
              const guillotineWarRoomCtx = await buildGuillotineWarRoomContextForChimmy(leagueSnapshot.id, planInput.userId)
              if (guillotineWarRoomCtx) {
                legacyEnrichmentContext = legacyEnrichmentContext
                  ? `${legacyEnrichmentContext}\n\n${guillotineWarRoomCtx}`
                  : guillotineWarRoomCtx
              }
            } catch { /* non-fatal */ }
            try {
              // T10 — grounded trade intelligence (deterministic T2–T9; reuses this route, no new route).
              const tradeCtx = await buildTradeContextForChimmy(leagueSnapshot.id, planInput.userId)
              if (tradeCtx) {
                legacyEnrichmentContext = legacyEnrichmentContext
                  ? `${legacyEnrichmentContext}\n\n${tradeCtx}`
                  : tradeCtx
              }
            } catch { /* non-fatal */ }
            try {
              /*
               * The league's trade block — only what managers marked in AllFantasy, because Sleeper does
               * not share its own (measured 2026-09-17). Read for trade questions and anything naming the
               * block, and always said with that caveat, so an empty list is never read as "nobody is
               * available". The builder above covers native leagues only and gives a count, not names.
               */
              if (intent === 'trade' || TRADE_BLOCK_WORDS.test(planInput.message)) {
                const blockCtx = await buildTradeBlockContext(leagueSnapshot.id)
                legacyEnrichmentContext = legacyEnrichmentContext
                  ? `${legacyEnrichmentContext}\n\n${blockCtx}`
                  : blockCtx
              }
            } catch { /* non-fatal */ }
            try {
              /*
               * Trades actually sitting in this user's inbox, with the Decision
               * OS evaluation attached. The adapter above only describes a
               * proposal it is HANDED an id for, and this route has never had one
               * to hand it — so "should I accept this trade?" was answered
               * without the trade.
               */
              const pendingTradeCtx = await buildPendingTradeDecisionContext(
                leagueSnapshot.id,
                planInput.userId,
              )
              if (pendingTradeCtx) {
                legacyEnrichmentContext = legacyEnrichmentContext
                  ? `${legacyEnrichmentContext}

${pendingTradeCtx}`
                  : pendingTradeCtx
              }
            } catch { /* non-fatal */ }
            try {
              /*
               * The trades that actually exist. The pending block above reads
               * AllFantasy's own proposal table, which is empty in production
               * because imported leagues trade on Sleeper — this reads what came
               * back from there.
               */
              const tradeHistory = await buildLeagueTradeHistoryOutcome(
                leagueSnapshot.id,
                planInput.userId,
              )
              tradeHistoryDiag =
                tradeHistory.kind === 'ok'
                  ? `built(trades=${tradeHistory.uniqueTrades},shown=${tradeHistory.shown},unnamed=${tradeHistory.unresolvedPlayers},chars=${tradeHistory.text.length})`
                  : tradeHistory.kind
              if (tradeHistory.kind === 'ok') {
                legacyEnrichmentContext = legacyEnrichmentContext
                  ? `${legacyEnrichmentContext}

${tradeHistory.text}`
                  : tradeHistory.text
              }
            } catch {
              // The surrounding catch is deliberately non-fatal, but a swallowed
              // throw used to be indistinguishable from "no trades on file".
              tradeHistoryDiag = 'threw'
            }
            try {
              /*
               * Who is actually winning this league, and which team is the
               * user's. The grounding packet reports only that a standings table
               * EXISTS — its rowCount and sync time — so none of it reached the
               * answer.
               */
              const standingsCtx = await buildLeagueStandingsContext(
                leagueSnapshot.id,
                planInput.userId,
              )
              if (standingsCtx) {
                legacyEnrichmentContext = legacyEnrichmentContext
                  ? `${legacyEnrichmentContext}

${standingsCtx}`
                  : standingsCtx
              }
            } catch { /* non-fatal */ }
            try {
              /*
               * Rivalry history. "Am I any good against him?" is the question
               * league members ask each other most, and it was the one Chimmy
               * could not answer: the aggregation behind this has three live
               * callers and the chat route referenced none of them.
               */
              const h2h = await buildHeadToHeadGrounding(leagueSnapshot.id)
              if (h2h) {
                legacyEnrichmentContext = legacyEnrichmentContext
                  ? `${legacyEnrichmentContext}

${h2h.text}`
                  : h2h.text
              }
            } catch { /* non-fatal */ }
            try {
              /*
               * The draft. Live for 7 leagues and paused for 2 as of writing —
               * the one surface with rich data while the season has not started.
               */
              const draftCtx = await buildDraftContext(leagueSnapshot.id, planInput.userId)
              if (draftCtx) {
                legacyEnrichmentContext = legacyEnrichmentContext
                  ? `${legacyEnrichmentContext}

${draftCtx}`
                  : draftCtx
              }
            } catch { /* non-fatal */ }
            try {
              /*
               * Waiver RULES, which exist for 92 leagues — carrying with them the
               * explicit statement that waiver ACTIVITY does not exist at all.
               */
              const waiverCtx = await buildWaiverContext(leagueSnapshot.id, planInput.userId)
              if (waiverCtx) {
                legacyEnrichmentContext = legacyEnrichmentContext
                  ? `${legacyEnrichmentContext}

${waiverCtx}`
                  : waiverCtx
              }
            } catch { /* non-fatal */ }
            try {
              /*
               * League-wide facts, and ONLY for a commissioner — the adapter
               * gates itself on `resolveLeagueMembership` and returns null for
               * everyone else, because everything in it is other managers' data.
               */
              const commishCtx = await buildCommissionerContext(
                leagueSnapshot.id,
                planInput.userId,
              )
              if (commishCtx) {
                legacyEnrichmentContext = legacyEnrichmentContext
                  ? `${legacyEnrichmentContext}

${commishCtx}`
                  : commishCtx
              }
            } catch { /* non-fatal */ }
          }

          try {
            /*
             * Which starters have already played. The single most checkable claim
             * Chimmy makes during a game week, which is why it refuses to guess.
             */
            const slateCtx = await buildLiveSlateContext({
              rosters: leagueSportsGrounding?.packet.rosters ?? null,
              sport,
              season: effectiveSeason ?? null,
              week: week ?? null,
            })
            if (slateCtx) {
              legacyEnrichmentContext = legacyEnrichmentContext
                ? `${legacyEnrichmentContext}

${slateCtx}`
                : slateCtx
            }
          } catch { /* non-fatal */ }

          try {
            /*
             * Why a number might have moved. The packet states projections and
             * explains none of them; this supplies the dated news beside them and
             * forbids turning it into a causal claim.
             */
            const newsCtx = await buildPlayerNewsContext({
              rosters: leagueSportsGrounding?.packet.rosters ?? null,
              sport,
            })
            if (newsCtx) {
              legacyEnrichmentContext = legacyEnrichmentContext
                ? `${legacyEnrichmentContext}

${newsCtx}`
                : newsCtx
            }
          } catch { /* non-fatal */ }

          try {
            /*
             * OUTSIDE the league-scoped block on purpose. "Is Chase for Gibbs
             * fair?" is answerable with no league selected at all — it needs
             * player values, not a roster — and gating it behind a league would
             * withhold the one trade question that never required one.
             *
             * 🛑 BUT THE ID IT TAKES IS STILL THE AUTHORIZED ONE. This read
             * `planInput.leagueId ?? null`, which traces to `formData.get('leagueId')`.
             * `describedTradeEvaluator.ts` then runs `prisma.league.findUnique` on it
             * and selects `scoring`, `leagueVariant`, `starters`, `settings`,
             * `rosterSize`, `irSlots`, `taxiSlots` and a team count — so an unproven
             * id still returned that league's CONFIGURATION. Smaller than the roster
             * and member reads closed alongside it, and not nothing.
             *
             * ⚠ THE "WORKS WITH NO LEAGUE" PROPERTY ABOVE IS PRESERVED, NOT TRADED
             * AWAY. `leagueSnapshot?.id` is null for an unauthorized league exactly as
             * it is for a caller who named none, and the evaluator's own `if (leagueId)`
             * already treats null as "value the trade on market prices". An
             * unauthorized caller therefore gets the same generic answer a
             * league-less one gets — which is also what keeps `not_member` and
             * `not_found` indistinguishable here.
             */
            /*
             * Chimmy item 8 — the trade the message describes, run against THIS league's real
             * rosters by the canonical evaluator: value on each side and the starting lineup
             * before and after. See `lib/chimmy/tradeScenarioGrounding.ts`.
             *
             * 🛑 ONLY THE MEMBERSHIP-PROVEN LEAGUE AND A SIGNED-IN USER. It reads every roster in
             * the league.
             *
             * ⚠ PREPENDED, because `applyGroundingBudget` drops blocks from the END and this is the
             * most decision-bearing block a trade question can have. And when it resolves it
             * SUPERSEDES the described-trade grade below — two grades for one sentence from two
             * pricing paths is a contradiction the model would have to choose between.
             */
            /*
             * ⚠ START/SIT AND WAIVER FIRST, THEN TRADE (Chimmy item 8, 2026-09-16). "Start Bijan
             * Robinson vs Jahmyr Gibbs" also has the shape of a described trade (`vs` is a trade
             * separator), and before these existed it produced "TRADE SCENARIO: NOT COMPUTED" for a
             * lineup question. The more specific reading is tried first; each returns null when the
             * message is not its kind, and the waiver engine's claims are used only when its packet
             * actually grounded this turn.
             */
            let scenario: TradeScenario | WaiverScenario | StartSitScenario | null = null
            /*
             * ⚠ ITS OWN TRY, SEPARATE FROM THE READER BELOW. The scenario is an addition; a fault in
             * it — including the synchronous shape check — must fall back to the described-trade
             * grade, not skip it. Sharing one try made any scenario throw silently remove BOTH, which
             * is how the first version of this failed `chimmy-unproven-league-id-readers`.
             */
            try {
              if (leagueSnapshot && userId) {
                const scenarioArgs = { message: planInput.message, leagueId: leagueSnapshot.id, userId }
                scenario = await buildStartSitScenario(scenarioArgs)
                if (!scenario) {
                  scenario = await buildWaiverScenario({
                    ...scenarioArgs,
                    engineClaims: grounding.outcome === 'ok' ? waiverClaimsSeen.claims : null,
                  })
                }
                if (!scenario && looksLikeDescribedTrade(planInput.message)) {
                  scenario = await buildTradeScenario({
                    message: planInput.message,
                    leagueId: leagueSnapshot.id,
                    userId,
                  })
                }
              }
            } catch {
              scenario = null
            }
            if (scenario) {
              const kind = 'kind' in scenario && scenario.kind ? scenario.kind : 'trade'
              const scenarioBlock =
                kind === 'start_sit'
                  ? renderStartSitScenarioBlock(scenario as StartSitScenario)
                  : kind === 'waiver'
                    ? renderWaiverScenarioBlock(scenario as WaiverScenario)
                    : renderTradeScenarioBlock(scenario as TradeScenario)
              legacyEnrichmentContext = legacyEnrichmentContext
                ? `${scenarioBlock}\n\n${legacyEnrichmentContext}`
                : scenarioBlock
              if (scenario.status === 'ready') {
                scenarioForMeta = scenario as ReadyChimmyScenario
                dataSources.push(`${kind}_scenario`)
              }
            }

            /*
             * A resolved scenario of ANY kind means this message was understood as that question, so
             * the described-trade grade (which would read "A vs B" as a trade) is not added beside it.
             */
            const describedTradeCtx = scenario?.status === 'ready'
              ? null
              : await buildDescribedTradeContext({
                  message: planInput.message,
                  leagueId: leagueSnapshot?.id ?? null,
                  sport,
                })
            if (describedTradeCtx) {
              legacyEnrichmentContext = legacyEnrichmentContext
                ? `${legacyEnrichmentContext}

${describedTradeCtx}`
                : describedTradeCtx
            }
          } catch { /* non-fatal */ }

          if (legacyEnrichment.status === 'fulfilled') {
            recordToolCall(
              sessionId,
              userId,
              'enrichChatWithData',
              `loaded ${legacyEnrichment.value.audit.sourcesUsed.length} data sources`
            ).catch(() => {})
          }

          /*
           * Bound the assembled grounding before it reaches the model. Nine
           * sources now append to this string and nothing capped the total — the
           * memory section beside it has always been capped at 4,000 characters,
           * this was not capped at all. Blocks are dropped WHOLE: each one ends
           * with its own constraint line ("do not grade these trades", "only a
           * NOT STARTED player can still be benched"), and a cut landing
           * mid-block would keep the data and lose the rule.
           */
          const budgeted = applyGroundingBudget(legacyEnrichmentContext)
          if (budgeted.droppedBlocks > 0) {
            console.warn(
              `[chimmy] grounding truncated: dropped ${budgeted.droppedBlocks} of ${budgeted.droppedBlocks + budgeted.keptBlocks} blocks (${budgeted.originalLength} chars): ${budgeted.droppedLabels.join(' | ')}`,
            )
          }
          legacyEnrichmentContext = budgeted.text

          /*
           * The one line that separates the two failures.
           *
           * `built(...)` plus `survivedBudget=false` means the block existed and
           * the budget dropped it — raise the budget, or move this block earlier
           * in the chain. Any other `tradeHistoryDiag` names the reason it was
           * never built, and `league-not-found` in particular means the id handed
           * to the builder is not a `leagues.id`.
           *
           * ⚠ READ AGAINST THE SAME TURN'S `grounding truncated` LINE. The labels
           * there say what else went, which is how you tell "this block is too far
           * down the chain" from "the whole prompt is oversized".
           */
          if (tradeHistoryDiag !== 'not-attempted') {
            console.info(
              `[chimmy] trade-history grounding: ${tradeHistoryDiag}; survivedBudget=${legacyEnrichmentContext.includes(TRADE_HISTORY_BLOCK_MARKER)}`,
            )
          }

          const enrichmentLoaded =
            legacyEnrichment.status === 'fulfilled' &&
            (legacyEnrichmentContext.trim().length > 0 ||
              legacyEnrichment.value.audit.sourcesUsed.length > 0)

          if (leagueGroundingRequired && !enrichmentLoaded) {
            throw new ChimmyPECRExecutionError(
              'League-specific request blocked due to missing live league context.',
              503,
              'Unable to load current league data for a league-specific request. Refresh league data and retry.',
            )
          }

          const legacyMemorySection =
            legacyMemory.status === 'fulfilled'
              ? buildMemoryPromptSection(legacyMemory.value).trim()
              : ''

          if (legacyMemory.status === 'fulfilled' && legacyMemorySection.length > 0) {
            const memoryItemsUsedCount =
              legacyMemory.value.recentEvents.length +
              legacyMemory.value.teamSnapshots.length +
              legacyMemory.value.patterns.length +
              (legacyMemory.value.userProfile ? 1 : 0) +
              (legacyMemory.value.leagueContext ? 1 : 0)

            await recordChimmyQualityEvent({
              userId: planInput.userId,
              leagueId: planInput.leagueId ?? null,
              eventType: 'memory_item_used_in_response',
              meta: {
                source: 'chat_chimmy_route',
                memoryItemsUsedCount,
              },
            })
          }

          return {
            intent,
            steps: ['classify intent', 'run current chimmy orchestration', 'validate answer'],
            context: {
              legacyEnrichmentContext,
              enrichmentLoaded,
              enrichmentSources:
                legacyEnrichment.status === 'fulfilled'
                  ? legacyEnrichment.value.audit.sourcesUsed
                  : [],
              legacyMemoryLoaded: legacyMemorySection.length > 0,
              legacyMemorySection,
            },
            refineHints: [],
          }
        },
        execute: async (plan) => {
          const planContext = plan.context as ChimmyPECRPlanContext
          const pecrDeterministicContext = compactRecord({
            ...deterministicContext,
            pecrContext: compactRecord({
              intent: plan.intent,
              legacyEnrichmentContext: planContext.legacyEnrichmentContext || undefined,
              enrichmentLoaded: planContext.enrichmentLoaded,
              enrichmentSources: planContext.enrichmentSources,
              legacyMemorySection: planContext.legacyMemorySection || undefined,
              legacyMemoryLoaded: planContext.legacyMemoryLoaded,
              refineHints: plan.refineHints.length > 0 ? plan.refineHints : undefined,
            }),
          })
          const pecrUnifiedRequest = requestContractToUnified(
            {
              tool: 'chimmy_chat',
              sport,
              leagueId: leagueId ?? null,
              userId,
              leagueSettings,
              deterministicContext: pecrDeterministicContext,
              userMessage,
              aiMode: 'unified_brain',
              provider: null,
            },
            userId
          )
          const run = await runUnifiedOrchestration(pecrUnifiedRequest)
          if (!run.ok) {
            throw new ChimmyPECRExecutionError(
              run.error.message,
              run.status,
              run.error.userMessage || 'Unable to process Chimmy request.',
              run.error.traceId
            )
          }

          const responseContract = unifiedResponseToContract(run.response)
          const sanitizedAiExplanation = sanitizeAssistantDisplayText(responseContract.aiExplanation)
          const sanitizedActionPlan = sanitizeAssistantDisplayText(responseContract.actionPlan)
          const sanitizedUncertainty = sanitizeAssistantDisplayText(responseContract.uncertainty)
          const providerStatus = buildProviderStatusMap(responseContract)
          const quantData = extractQuantData(responseContract)
          const trendData = extractTrendData(responseContract)
          const recommendedTool = chimmyOrchestrationMeta.recommendedToolId
          const toolLinks = [
            ...(chimmyOrchestrationMeta.primaryLaunch ? [chimmyOrchestrationMeta.primaryLaunch.href] : []),
            ...chimmyOrchestrationMeta.secondaryLaunches.map((l) => l.href),
          ]
          const responseStructure = buildResponseStructure(
            sanitizedAiExplanation,
            sanitizedActionPlan,
            sanitizedUncertainty
          )

          return {
            responseContract,
            modelOutputs: run.response.modelOutputs,
            sanitizedAiExplanation,
            sanitizedActionPlan,
            sanitizedUncertainty,
            providerStatus,
            quantData,
            trendData,
            recommendedTool,
            toolLinks,
            responseStructure,
            processingMs: Date.now() - startMs,
          }
        },
        check: (output, plan) => {
          const failures: string[] = []
          const answer = output.sanitizedAiExplanation.trim()
          const fullAnswer = [output.sanitizedAiExplanation, output.sanitizedActionPlan]
            .filter(Boolean)
            .join('\n\n')

          if (answer.length <= 30) {
            failures.push('answer length must be greater than 30 characters')
          }

          if (
            ['trade', 'waiver', 'roster'].includes(plan.intent) &&
            plan.context.enrichmentLoaded === true &&
            /i don't have access|i cannot access/i.test(answer)
          ) {
            failures.push('answer claims context is unavailable despite loaded enrichment')
          }

          const invalidToolLinks = output.toolLinks.filter((link) => !isAllowedChimmyToolLink(link))
          if (invalidToolLinks.length > 0) {
            failures.push(`invalid tool links: ${invalidToolLinks.join(', ')}`)
          }

          const builtInCheck = checkBehaviorRules(fullAnswer, {
            input: message,
            featureName: 'chimmy',
            contextBlock: combinedMemorySection,
          })
          const customViolations = checkCustomRules(fullAnswer, customRules)
          const hardRuleViolations = [
            ...builtInCheck.violations,
            ...customViolations,
          ].filter((violation) => violation.severity === 'hard')

          if (hardRuleViolations.length > 0) {
            failures.push(
              ...hardRuleViolations.map(
                (violation) => `behavior rule ${violation.ruleId} violated: ${violation.reason}`
              )
            )
          }

          return {
            passed: failures.length === 0,
            failures,
            refineHint:
              failures.length > 0
                ? 'Player and league context is loaded. Reference it explicitly and stay within the requested scope.'
                : undefined,
          }
        },
      }
    )

    const pecrOutput = pecrResult.output
    if (chimmySportDigestFreshness) {
      dataSources.push('sports_digest_db')
    }
    const displayExplanation = appendOrchestrationFooterIfMissing(
      pecrOutput.sanitizedAiExplanation || '',
      chimmyOrchestrationMeta
    )
    const displayWithStaleness = staleness.warning
      ? `${displayExplanation}\n\nData freshness: ${staleness.warning}`
      : displayExplanation
    const finalAnswer = [displayWithStaleness, pecrOutput.sanitizedActionPlan].filter(Boolean).join('\n\n')

    // Anti-hallucination check — deterministic scan before the response reaches the client.
    const hallucinationCheck = checkChimmyHallucination(finalAnswer, {
      groundingText: combinedMemorySection,
      hasLeagueContext: Boolean(leagueId),
      userMessage: message,
    })
    if (!hallucinationCheck.safe) {
      persistChimmyAIAnalyticsEvent({
        event_name: 'contract_validation_failed',
        user_id: userId ?? 'anonymous',
        league_id: leagueId ?? null,
        surface: 'chimmy_chat',
        mode: selectedAssistantMode,
        topic: null,
        action: hallucinationCheck.action,
        timestamp: new Date().toISOString(),
        metadata: {
          issueCount: hallucinationCheck.issues.length,
          hardIssues: hallucinationCheck.issues.filter((i) => i.severity === 'hard').length,
          softIssues: hallucinationCheck.issues.filter((i) => i.severity === 'soft').length,
          kinds: [...new Set(hallucinationCheck.issues.map((i) => i.kind))],
        },
      }).catch(() => {})
    }
    // Use potentially annotated/replaced display text going forward.
    const guardedAnswer = hallucinationCheck.displayText
    /*
     * ⚠ FAST TAKE IS THE DEFAULT MODE, AND IT USED TO BYPASS THE GUARD ABOVE. It returns
     * `shortAnswer` verbatim when one exists, and `shortAnswer` was parsed from the model's
     * UNGUARDED text — so a replaced or annotated answer reached the user in its original form,
     * and the freshness warning appended to `finalAnswer` was dropped with it. When the guard
     * changed anything, fall back to trimming the guarded text; and never drop the warning.
     */
    const guardChangedAnswer = guardedAnswer !== finalAnswer
    const fastTakeBody = buildChimmyResponseForAssistantMode({
      mode: selectedAssistantMode,
      fullResponse: guardedAnswer,
      shortAnswer: guardChangedAnswer ? null : pecrOutput.responseStructure.shortAnswer,
    })
    const modeAdjustedAnswer =
      staleness.warning && !fastTakeBody.includes(staleness.warning)
        ? `${fastTakeBody}\n\nData freshness: ${staleness.warning}`
        : fastTakeBody

    const builtInRuleCheck = checkBehaviorRules(modeAdjustedAnswer, {
      input: message,
      featureName: 'chimmy',
      contextBlock: combinedMemorySection,
    })
    const customViolations = checkCustomRules(modeAdjustedAnswer, customRules)
    const allRuleViolations = [...builtInRuleCheck.violations, ...customViolations]

    logRuleViolations(userId, 'chimmy', allRuleViolations, pecrResult.iterations).catch(() => {})

    if (
      builtInRuleCheck.hardFailed ||
      customViolations.some((violation) => violation.severity === 'hard')
    ) {
      console.warn(
        '[Chimmy] Hard behavior rule violated:',
        allRuleViolations
          .filter((violation) => violation.severity === 'hard')
          .map((violation) => violation.ruleId)
      )
    }

    /*
     * Chimmy's track record (brief item 10): how start/sit calls shown at each confidence band have
     * actually turned out. A bounded ±10 in the rubric, silent until enough calls are resolved;
     * memoised per instance and never throws, so it costs at most one read every few minutes.
     */
    const trackRecords = trackRecordsFrom(await readAdviceLearningSnapshot())
    const answerContractResult = buildChimmyAnswerContract({
      message,
      insightType: insightType ?? null,
      specialistAgent,
      trackRecords,
      confidencePct: pecrOutput.responseContract.confidence ?? null,
      stalenessWarning: staleness.warning,
      staleMinutes: staleness.staleMinutes ?? null,
      thresholdMinutes: staleness.thresholdMinutes ?? null,
      dataSources,
      sourceLinks: sourceReferences,
      hasLeagueContext: Boolean(leagueId),
      responseStructure: {
        shortAnswer: pecrOutput.responseStructure.shortAnswer,
        whatDataSays: pecrOutput.responseStructure.whatDataSays,
        whatItMeans: pecrOutput.responseStructure.whatItMeans,
        recommendedAction: pecrOutput.responseStructure.recommendedAction,
        caveats: pecrOutput.responseStructure.caveats,
      },
      followUps: chimmyOrchestrationMeta.followUps,
    })
    const answerContract = answerContractResult.contract
    if (answerContractResult.fallbackUsed) {
      persistChimmyAIAnalyticsEvent({
        event_name: 'formatter_fallback_used',
        user_id: userId ?? 'anonymous',
        league_id: leagueId ?? null,
        surface: 'chimmy_chat',
        mode: selectedAssistantMode,
        topic: null,
        action: 'fallback_triggered',
        timestamp: new Date().toISOString(),
        metadata: {
          fallbackReason: answerContractResult.fallbackReason ?? 'unknown',
          insightType: insightType ?? null,
          specialistAgent: specialistAgent ?? null,
        },
      }).catch(() => {})
    }
    const chimmyFeatureFlags = getChimmyFeatureFlags()

    /*
     * Every player the answer names, with a headshot. Drawn from the roster the
     * answer was grounded on rather than matched against the whole player table
     * — see chimmyPlayerCards for why a global name match is unsafe here.
     */
    const playerCards = buildChimmyPlayerCards({
      answer: modeAdjustedAnswer || '',
      rosters: leagueSportsGrounding?.packet.rosters ?? null,
      sport,
    })

    /*
     * A roster player carried under a synthetic `name:` id has no Sleeper id to
     * derive a headshot from, so the card comes back imageless. The NAME still
     * reaches the canonical row 89% of the time, and every row that matches has
     * an image — so this fills exactly the gap the id-based path cannot.
     */
    const cardsMissingImages = playerCards.filter((c) => !c.imageUrl)
    if (cardsMissingImages.length > 0) {
      const byName = await resolveImagesByPlayerName(
        cardsMissingImages.map((c) => c.name),
        sport,
      ).catch(() => new Map<string, string>())
      for (const card of cardsMissingImages) {
        card.imageUrl = byName.get(card.name.toLowerCase()) ?? null
      }
    }

    /*
     * 🛑 CHARGE ON DELIVERY. The spend above happens before any model runs, and the only refund
     * used to be the catch below — for a request that THREW. When every provider failed,
     * orchestration returned the deterministic fallback as a normal success and the user paid for
     * "AI explanation is temporarily unavailable". The turn is judged on what the models actually
     * returned; a non-answer is refunded here, before the response or the history row is written,
     * so the cost the drawer shows is the cost the user bore.
     */
    const delivery = judgeChimmyDelivery({ modelOutputs: pecrOutput.modelOutputs, answer: modeAdjustedAnswer })
    let chargeRefund: { balanceAfter: number; reason: string } | null = null
    if (!delivery.delivered && spendLedger?.id) {
      const refund = await spendService
        .refundSpendByLedger({
          userId,
          spendLedgerId: spendLedger.id,
          refundRuleCode: 'feature_execution_failed',
          sourceType: 'chimmy_chat_refund',
          sourceId: spendLedger.id,
          /* Same key as the catch-path refund: one ledger entry can only ever be refunded once. */
          idempotencyKey: `refund:chimmy_chat:${spendLedger.id}`,
          description: 'Auto refund: Chimmy could not deliver an answer.',
          metadata: { conversationId, leagueId: leagueId ?? null, reason: delivery.reason },
        })
        .catch((err: unknown) => {
          console.warn('[chimmy] charge-on-delivery refund failed', {
            ledgerId: spendLedger?.id,
            reason: delivery.reason,
            error: err instanceof Error ? err.message : String(err),
          })
          return null
        })
      if (refund) chargeRefund = { balanceAfter: refund.balanceAfter, reason: delivery.reason }
    }

    const meta = {
      assistant: 'Chimmy',
      conversationId,
      players: playerCards.length > 0 ? playerCards : undefined,
      /** The before/after the drawer renders; present only when the scenario resolved. */
      scenario: scenarioForMeta ?? undefined,
      /**
       * The advice this answer put on file, set below once it is recorded — the drawer's
       * "Did it / Not doing it" buttons send its key back. Absent when nothing was recorded.
       */
      advice: undefined as { key: string; type: 'add'; playerName: string } | undefined,
      /*
       * What this answer was actually grounded on. The drawer renders it, so a
       * "Chimmy is answering blind" state is VISIBLE rather than something you
       * can only detect by knowing the roster yourself and noticing it is wrong.
       */
      leagueGrounding: leagueId
        ? leagueGrounding.ok
          ? {
              grounded: true as const,
              leagueId: leagueGrounding.snapshot.id,
              leagueName: leagueGrounding.snapshot.name,
              platform: leagueGrounding.snapshot.platform,
              season: leagueGrounding.snapshot.season,
              lastSyncedAt: leagueGrounding.snapshot.lastSyncedAt?.toISOString() ?? null,
            }
          : {
              grounded: false as const,
              /*
               * 🛑 THE SAME ENUMERATION ORACLE AS THE REFUSAL PAYLOAD, IN THE 200
               * RESPONSE. `leagueId` here is the raw request field and `reason`
               * distinguishes "not yours" from "not real", so a caller could walk
               * ids and read which exist off a SUCCESSFUL answer, not only off a
               * refusal.
               *
               * ⚠ THE `grounded: false` FLAG STAYS. The drawer renders it, and
               * "Chimmy is answering without your league" is exactly the state a
               * user should see — it is the IDENTIFIERS beside it that were never
               * theirs to read. The message stays too: it is the same copy the
               * refusal shows, and that copy no longer distinguishes the two cases.
               */
              leagueId: null,
              message: describeLeagueGroundingFailure(leagueGrounding.reason),
            }
        : { grounded: false as const, leagueId: null, reason: 'no_league_selected' as const },
      connectedFranchise: connectedFranchise
        ? connectedFranchise.sides
            .filter((side) => side.leagueId && (!allowedConnectedLeagueIds || allowedConnectedLeagueIds.has(side.leagueId)))
            .map((side) => ({
              leagueId: side.leagueId as string,
              leagueName: side.name,
              rosterStatus: side.unavailableReason ? 'unavailable' as const : 'available' as const,
              playerCount: side.unavailableReason ? 0 : side.players?.length ?? 0,
            }))
        : undefined,
      mode: selectedAssistantMode,
      agent: specialistAgent,
      answerContract,
      featureFlags: chimmyFeatureFlags,
      confidencePct: pecrOutput.responseContract.confidence ?? undefined,
      providerStatus: pecrOutput.providerStatus,
      recommendedTool: pecrOutput.recommendedTool,
      orchestration: chimmyOrchestrationMeta,
      dataSources: dataSources.length ? dataSources : undefined,
      sourceLinks: sourceReferences.length > 0 ? sourceReferences : undefined,
      staleness: {
        staleMinutes: staleness.staleMinutes,
        thresholdMinutes: staleness.thresholdMinutes,
        warning: staleness.warning,
      },
      syncFreshness: chimmySportDigestFreshness
        ? {
            referenceTimezone: CHIMMY_REFERENCE_TIMEZONE,
            sportsDigest: chimmySportDigestFreshness,
          }
        : undefined,
      tokenSpend: spendLedger && tokenPreview
        ? {
            ruleCode: tokenPreview.ruleCode,
            /* What the user actually bore: nothing, when the charge was refunded for a non-answer. */
            tokenCost: chargeRefund ? 0 : tokenPreview.tokenCost,
            balanceAfter: chargeRefund ? chargeRefund.balanceAfter : spendLedger.balanceAfter,
            ledgerId: spendLedger.id,
            ...(chargeRefund ? { refunded: true as const, refundReason: chargeRefund.reason } : {}),
          }
        : undefined,
      quantData: pecrOutput.quantData,
      trendData: pecrOutput.trendData,
      responseStructure: pecrOutput.responseStructure,
      reliability: pecrOutput.responseContract.reliability ?? undefined,
      traceId: pecrOutput.responseContract.traceId ?? undefined,
      processingMs: pecrOutput.processingMs,
    }

    if (userId) {
      const assistantResponse = modeAdjustedAnswer || CHIMMY_GENERIC_ERROR_MESSAGE
      recordAIResponse(sessionId, userId, assistantResponse, 0.6).catch(() => {})
      if (/start|sit|accept|decline|add|drop/i.test(assistantResponse)) {
        recordDecision(sessionId, userId, assistantResponse.slice(0, 200), 0.8).catch(() => {})
      }
      const persistTasks: Promise<unknown>[] = [
        appendChatHistory({
          conversationId,
          role: 'user',
          content: message || '[image-only request]',
          userId,
          leagueId: leagueId ?? null,
        }),
        appendChatHistory({
          conversationId,
          role: 'assistant',
          content: assistantResponse,
          userId,
          leagueId: leagueId ?? null,
          meta: {
            recommendedTool: pecrOutput.recommendedTool,
            confidence: pecrOutput.responseContract.confidence ?? null,
            orchestration: chimmyOrchestrationMeta,
            /*
             * What the drawer needs to render this turn again after the tab is gone — read back
             * by `readStoredDisplay` in the GET above.
             *
             * 🛑 `grounding` IS THE LOAD-BEARING ONE. An answer given without being able to read
             * the user's league renders a "could not read your league" badge; restore the prose
             * without it and an ungrounded answer comes back indistinguishable from a grounded
             * one. Storing the text alone would have made the transcript quietly dishonest.
             *
             * ⚠ `evidence` IS NOT STORED, ON PURPOSE. The drawer derives it from the live
             * `meta` + `contract` pair via `readEvidence`; computing an equivalent here would be
             * a second implementation of one rule, and persisting the whole envelope per turn to
             * avoid that would bloat `chat_history` for a decoration. A rehydrated turn shows no
             * evidence block rather than a divergent one.
             */
            display: {
              grounding: meta.leagueGrounding ?? null,
              cost: meta.tokenSpend?.tokenCost ?? null,
              mode: meta.mode ?? null,
            },
          },
        }),
        rememberChimmyUserMessageMemory({
          userId,
          /*
           * The proven league, never the client's field: this row is listed BY LEAGUE NAME in
           * Settings, so writing under an arbitrary id would plant a league the user cannot read.
           * A declaration made with no provable league is remembered for all leagues.
           */
          leagueId: leagueSnapshot?.id ?? null,
          sport,
          message: message || '[image-only request]',
        }),
        rememberChimmyAssistantMemory({
          userId,
          leagueId: leagueId ?? null,
          answer: assistantResponse,
          recommendedTool: pecrOutput.recommendedTool,
          confidence: pecrOutput.responseContract.confidence ?? null,
        }),
      ]
      /*
       * Chimmy's waiver advice, for the home Receipts card and the outcome loop — recorded only now:
       * after the spend (this code is unreachable on the unconfirmed 409), only when the packet was
       * actually USED (`outcome === 'ok'`, never 'timeout'), with the confidence the user was SHOWN
       * (`meta.confidencePct`), and the writer refuses unless the answer the user saw names the
       * player. See the note on `onWaiverClaims`.
       */
      if (waiverClaimsSeen.claims && grounding.outcome === 'ok' && leagueSnapshot) {
        persistTasks.push(
          recordChatWaiverAdvice({
            userId,
            leagueId: leagueSnapshot.id,
            claims: waiverClaimsSeen.claims,
            confidencePct: pecrOutput.responseContract.confidence ?? null,
            answer: assistantResponse,
            onRecorded: (advice) => {
              meta.advice = { key: advice.key, type: 'add', playerName: advice.playerName }
            },
          }),
        )
      }
      await Promise.allSettled(persistTasks)
    }

    return NextResponse.json(
      {
        response: modeAdjustedAnswer || CHIMMY_GENERIC_ERROR_MESSAGE,
        sessionId,
        contract: answerContract,
        meta,
      },
      {
        headers: {
          'x-pecr-iterations': String(pecrResult.iterations),
          'x-pecr-passed': String(pecrResult.passed),
          'x-pecr-intent': pecrIntent,
        },
      }
    )
  } catch (error) {
    if (spendLedger?.id) {
      await spendService
        .refundSpendByLedger({
          userId,
          spendLedgerId: spendLedger.id,
          refundRuleCode: 'feature_execution_failed',
          sourceType: 'chimmy_chat_refund',
          sourceId: spendLedger.id,
          idempotencyKey: `refund:chimmy_chat:${spendLedger.id}`,
          description: 'Auto refund after failed Chimmy request.',
          metadata: { conversationId, leagueId: leagueId ?? null },
        })
        .catch(() => null)
    }
    if (error instanceof ChimmyPECRExecutionError) {
      return NextResponse.json(
        {
          error: error.userMessage,
          message: error.message,
          traceId: error.traceId,
        },
        { status: error.status }
      )
    }
    return NextResponse.json({ error: 'Unable to process Chimmy request.' }, { status: 500 })
  }
}
