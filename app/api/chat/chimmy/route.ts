import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getServerSession } from 'next-auth'
import OpenAI from 'openai'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { parseHomeSignals, renderHomeSignalsPrompt } from '@/lib/core-app/homeSignals'
import { requireVerifiedUser } from '@/lib/auth-guard'
import { buildUserTemporalContextForAI } from '@/lib/preferences/userTemporalContextForAI'
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
import { appendChatHistory, buildChimmyConversationId } from '@/lib/ai-memory/chat-history-store'
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
import { buildPendingTradeDecisionContext } from '@/lib/chimmy-trade/pendingTradeDecisionGrounding'
import { buildLeagueTradeHistoryContext } from '@/lib/chimmy-trade/leagueTradeHistoryGrounding'
import { buildLeagueStandingsContext } from '@/lib/chimmy/leagueStandingsGrounding'
import { buildHeadToHeadGrounding } from '@/lib/chimmy/headToHeadGrounding'
import { buildDescribedTradeContext } from '@/lib/chimmy-trade/describedTradeEvaluator'
import { buildDraftContext } from '@/lib/chimmy/draftGrounding'
import { buildWaiverContext } from '@/lib/chimmy/waiverGrounding'
import { buildPlayerNewsContext } from '@/lib/chimmy/playerNewsGrounding'
import { buildCommissionerContext } from '@/lib/chimmy/commissionerGrounding'
import { buildLiveSlateContext } from '@/lib/chimmy/liveSlateGrounding'
import { applyGroundingBudget } from '@/lib/chimmy/groundingBudget'
import { buildChimmyPlayerCards } from '@/lib/chimmy/chimmyPlayerCards'
import { resolveImagesByPlayerName } from '@/lib/players/sleeperPlayerCrosswalk'
import { CHIMMY_GENERIC_ERROR_MESSAGE } from '@/lib/chimmy-chat/response-copy'
import {
  buildChimmyResponseForAssistantMode,
  normalizeChimmyAssistantMode,
} from '@/lib/chimmy-chat/assistant-mode'
import { getChimmyFeatureFlags } from '@/lib/chimmy-chat/feature-flags'
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
import { tryDeterministicAnswerDetailed, DETERMINISTIC_SOURCE } from '@/lib/ai/deterministic'

/** Provenance for an answer that came from the web, not from our rows. */
const LIVE_SEARCH_SOURCE = 'live_web_search' as const
import {
  buildLeagueDataUsageAnswer,
  buildLeagueSportsGroundingPacket,
  serializeLeagueGroundingForPrompt,
} from '@/lib/ai/leagueSportsGroundingPacket'
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
import {
  appendOrchestrationFooterIfMissing,
  buildOrchestrationMeta,
  buildOrchestrationPromptSection,
  buildMemorySummaryLine,
  classifyChimmyIntent,
  parseOrchestrationResponseSections,
} from '@/lib/chimmy-orchestration'

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
const CHIMMY_REFERENCE_TIMEZONE = 'America/New_York'
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
  /**
   * The /core home's own signals — a validated id/count payload, never prose.
   * See lib/core-app/homeSignals.ts for why nothing free-text crosses this
   * boundary: @chimmy answers are posted publicly in the league tab.
   */
  homeSignals: optionalTrimmedStringField(2000),
  conversation: z.array(ConversationTurnSchema).max(MAX_CONVERSATION_TURNS),
  hasImage: z.boolean(),
})

/**
 * The tool loop's system prompt.
 *
 * ⚠ IT CARRIES THE SAME REFUSAL RULES AS THE PUSH PATH. When the model fetches
 * its own context, nothing upstream can guarantee the context is there — so the
 * instruction not to invent has to travel with the tools, or the loop quietly
 * becomes the one path in this assistant that guesses.
 */
const CHIMMY_TOOL_LOOP_SYSTEM_PROMPT = [
  'You are Chimmy, the calm, analytical fantasy sports assistant for AllFantasy.',
  "You have tools that read this app's own data. Call them when a question needs league, schedule or live-stat facts.",
  'NEVER invent player stats, scores, standings, records or schedules. If a tool says it has no data, say that plainly and stop — do not fall back on general knowledge.',
  'A tool reporting an empty live feed means no games were polled, NOT that nobody scored. Never report that as a zero.',
  /*
   * ⚠ ADDED AFTER THE MODEL TURNED "NO LEAGUE SELECTED" INTO "YOUR LEAGUE HAS NO
   * RECORDS". Observed in production on a 32-team league, alongside an invented
   * "all 18 teams begin at 0-0 with equal FAAB budgets". The tool result already
   * spells this out; the rule is repeated here because that failure is a
   * paraphrase, and a paraphrase is exactly what a system prompt is for.
   */
  'If the question names a league — "KBFL", "my dynasty league" — call find_league_by_name FIRST, then the league tools. Without it nothing is selected and they read nothing.',
  'CRITICAL: "no league is selected" means NOTHING WAS CHECKED. It is never evidence that a league is empty. Never turn it into "no records/standings/roster are stored" for a named league, and never state a team count, scoring rule or FAAB figure you did not receive from a tool. Ask the user to pick a league instead.',
  'When a tool says its list is truncated, do not count from it, do not say who is last, and do not say anyone is missing.',
  'Answer in a few sentences. Name the data you used.',
].join(' ')

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
]

function hasSportsContent(text: string, hasImage: boolean): boolean {
  if (hasImage) return true
  const lower = text.toLowerCase()
  return SPORTS_KEYWORDS.some((keyword) => lower.includes(keyword))
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

function classifyPecrIntent(message: string): string {
  if (/trade|swap|offer|deal|give|receiv/i.test(message)) return 'trade'
  if (/waiver|wire|pickup|drop|add|free.?agent/i.test(message)) return 'waiver'
  if (/roster|lineup|start|sit|bench|flex/i.test(message)) return 'roster'
  if (/draft|pick|adp|tier|rank/i.test(message)) return 'draft'
  return 'general'
}

function requiresLeagueGrounding(args: {
  message: string
  intent: string
  source?: string
  teamId?: string
  leagueId?: string
  insightType?: InsightType
}): boolean {
  const message = args.message.toLowerCase()
  const source = String(args.source ?? '').toLowerCase()
  const hasGlobalSportContext = /\b(nfl|nba|mlb|nhl|ncaaf|ncaab|soccer|world\s+cup|champions\s+league|fifa|ncaa)\b/.test(
    message
  )

  if (args.teamId) return true
  if (args.insightType === 'trade' || args.insightType === 'waiver' || args.insightType === 'dynasty') {
    return true
  }
  if (source.includes('trade') || source.includes('waiver') || source.includes('lineup')) {
    return true
  }
  if (['trade', 'waiver', 'roster'].includes(args.intent)) return true
  /*
   * ⚠ `in\s+.+\s+league` USED TO 412 EVERY QUESTION ABOUT A REAL COMPETITION.
   * It was written for "in my dynasty league", but `.+` happily spans "the
   * champions", so "who scored in the Champions League last night?" was
   * rejected as a team-specific planning request. Premier League, Major League
   * Baseball and "best team in the league this year" all failed the same way.
   *
   * The `hasGlobalSportContext` escape hatch below DOES list `champions league`
   * — it just sits underneath this branch and never got the chance. Rather than
   * reorder (which would drop grounding from "draft order in my NFL league",
   * since that reads as global too), the pattern now requires the POSSESSIVE it
   * always meant: my / our / this. No competition on earth is called "my
   * league", so this keeps every real one out while still catching the phrasing
   * the rule exists for.
   */
  const inTheirOwnLeague = /\bin\s+(?:my|our|this)\s+[\w\s]*league\b/
  if (args.intent === 'draft' && (/\b(draft order|draft time|my\s+draft|our\s+draft)\b/.test(message) || inTheirOwnLeague.test(message))) {
    return true
  }
  if (/\b(draft order|draft time|waiver|trade)\b/.test(message) || inTheirOwnLeague.test(message)) {
    return true
  }
  if (/\b(my team|my roster|my lineup|our team|future|next season|for my team)\b/.test(message)) {
    return true
  }

  // Global sports Q&A (schedule/scores/standings/historic facts) should not hard-require
  // a league context, even when terms like "draft" are present (e.g. "when is the NFL draft?").
  if (hasGlobalSportContext) return false

  return false
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
    case 'not_member':
      return 'I can see that league exists, but your account is not a member of it, so I cannot read its rosters. If you just imported it, claim your team and ask again.'
    case 'not_found':
      return 'I could not find that league. If you picked it from the league list, it may be a tournament or a legacy board rather than a synced league — pick a synced league and ask again.'
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
    parts.push(`SCREENSHOT SUMMARY:\n${input.screenshotSummary}`)
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
}): string | undefined {
  if (args.leagueSnapshot) {
    const s = args.leagueSnapshot
    return [
      `League: ${s.name ?? s.id}`,
      `id=${s.id}`,
      `sport=${s.sport}`,
      `season=${s.season}`,
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

  const verifiedAuth = await requireVerifiedUser()
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
    homeSignals: formData.get('homeSignals'),
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
    homeSignals: rawHomeSignals,
    conversation: parsedConversation,
    hasImage,
  } = parseResult.data
  const homeSignals = parseHomeSignals(rawHomeSignals)
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
    leagueId: leagueId ?? undefined,
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
   * The user named a league and we cannot see it. If the question needs league
   * facts, refusing is the answer — a wrong lineup call on someone's real roster
   * costs more trust than an empty one. Deliberately BEFORE the token spend
   * below: a refusal must not bill.
   */
  if (leagueId && !leagueGrounding.ok && leagueGroundingRequired) {
    return NextResponse.json(
      {
        ...buildLeagueGroundingErrorPayload(),
        details: {
          message: describeLeagueGroundingFailure(leagueGrounding.reason),
          leagueId,
          groundingReason: leagueGrounding.reason,
        },
      },
      { status: leagueGrounding.reason === 'error' ? 503 : 412 }
    )
  }

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

  const sport: SupportedSport = sportExplicit ?? leagueSnapshot?.sport ?? DEFAULT_SPORT
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

  const requestLocale = resolveLanguage(req.cookies.get('af_lang')?.value)
  const deterministic = await tryDeterministicAnswerDetailed(message, requestLocale)
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
            providerStatus: { openai: 'skipped', deepseek: 'skipped', grok: 'ok' },
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

  if (leagueId && userId && isLeagueDataUsageQuestion(message)) {
    try {
      const packet = await buildLeagueSportsGroundingPacket({
        leagueId,
        userId,
        sport: sport ?? undefined,
        season: season ?? undefined,
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
    leagueId && insightType
      ? getInsightBundle(leagueId, insightType, {
          teamId,
          season,
          week,
          sport,
        })
          .then((bundle) => ({
            summary: bundle.contextText || undefined,
            sources: bundle.sources.map((source) => `ai_${source}`),
          }))
          .catch(() => undefined)
      : Promise.resolve(undefined)
  const memoryTask: Promise<string | undefined> =
    userId
      ? getChimmyMemoryContext({
          userId,
          leagueId: leagueId ?? null,
          conversationId,
          sleeperUsername: sleeperUsername ?? null,
        })
          .then((ctx) => (ctx.promptSection?.trim().length ? ctx.promptSection : undefined))
          .catch(() => undefined)
      : Promise.resolve(undefined)

  const leagueSportsGroundingTask: Promise<{ serialized: string; packet: Awaited<ReturnType<typeof buildLeagueSportsGroundingPacket>> } | null> =
    leagueId && userId
      ? buildLeagueSportsGroundingPacket({
          leagueId,
          userId,
          sport: sport ?? undefined,
          season: season ?? undefined,
        })
          .then((packet) => ({
            packet,
            serialized: serializeLeagueGroundingForPrompt(packet),
          }))
          .catch(() => null)
      : Promise.resolve(null)

  const [screenshotResult, insightResult, memoryResult, leagueSportsGroundingResult] = await Promise.allSettled([
    screenshotTask,
    insightTask,
    memoryTask,
    leagueSportsGroundingTask,
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

  const recentUserSnippet = conversation
    .filter((t) => t.role === 'user')
    .slice(-2)
    .map((t) => t.content)
    .join('\n')
  const chimmyOrchestrationClassification = classifyChimmyIntent(message, recentUserSnippet)
  let coachingProfileForOrchestration: Record<string, unknown> | null = null
  if (userId) {
    coachingProfileForOrchestration = (await getAiMemory(userId, 'user_preferences', {
      leagueId: leagueId ?? null,
      key: 'coaching_profile',
    })) as Record<string, unknown> | null
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
    memorySection,
    leagueSportsGrounding
      ? `## NFL/NCAAF LEAGUE SPORTS GROUNDING\n${leagueSportsGrounding.serialized}`
      : undefined,
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
  if (leagueSportsGrounding) dataSources.push('league_sports_grounding_packet')
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
      }),
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
      teamId,
      sport,
      season,
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
      ? compactRecord({ leagueId, teamId, week, season, summary: insightSummary })
      : undefined,
    projections: insightType === 'playoff' || /projection|projected|win probability/i.test(message)
      ? compactRecord({ season, week, summary: insightSummary })
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
    season,
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

  const specialistAgent = inferAgentFromMessage(
    [message, effectiveStrategyMode, leagueFormat, insightType].filter(Boolean).join('\n')
  )
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
   * ⚠ TOOL LOOP: OPTIONAL, GROK-ONLY, AND SILENT WHEN IT DOES NOT RUN.
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
    const loop = await runChimmyToolLoop({
      question: message,
      systemPrompt: CHIMMY_TOOL_LOOP_SYSTEM_PROMPT,
      conversation: conversation.slice(-6).map((turn) => ({
        role: turn.role === 'assistant' ? ('assistant' as const) : ('user' as const),
        content: turn.content,
      })),
      context: { leagueId: leagueId ?? null, userId: userId ?? null },
      enabled: true,
    }).catch(() => null)

    if (loop?.text) {
      return NextResponse.json({
        response: loop.text,
        result: loop.text,
        source: 'chimmy_tool_loop',
        sessionId,
        meta: {
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
          providerStatus: { openai: 'skipped', deepseek: 'skipped', grok: 'ok' },
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
  try {
    const pecrResult = await runPECR(
      {
        message,
        userId,
        leagueId: leagueId ?? undefined,
        sleeperUsername: sleeperUsername ?? undefined,
        teamId: teamId ?? undefined,
      },
      {
        feature: 'chimmy',
        plan: async (planInput) => {
          const intent = classifyPecrIntent(planInput.message)
          pecrIntent = intent

          const [legacyEnrichment, legacyMemory] = await Promise.allSettled([
            enrichChatWithData(planInput.message, {
              leagueId: planInput.leagueId,
              sleeperUsername: planInput.sleeperUsername,
            }),
            getFullAIContext({
              userId: planInput.userId,
              sleeperUsername: planInput.sleeperUsername,
              leagueId: planInput.leagueId,
              teamId: planInput.teamId,
            }),
          ])

          let legacyEnrichmentContext =
            legacyEnrichment.status === 'fulfilled' ? legacyEnrichment.value.context : ''

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
          if (planInput.leagueId && planInput.userId) {
            try {
              const tournamentCtx = await buildTournamentContextForChimmy(planInput.leagueId, planInput.userId)
              if (tournamentCtx) {
                legacyEnrichmentContext = legacyEnrichmentContext
                  ? `${legacyEnrichmentContext}\n\n${tournamentCtx}`
                  : tournamentCtx
              }
            } catch { /* non-fatal */ }
            try {
              const bbCtx = await buildBigBrotherContextForChimmy(planInput.leagueId, planInput.userId)
              if (bbCtx) {
                legacyEnrichmentContext = legacyEnrichmentContext
                  ? `${legacyEnrichmentContext}\n\n${bbCtx}`
                  : bbCtx
              }
            } catch { /* non-fatal */ }
            try {
              const idpCtx = await buildIdpContextForChimmy(planInput.leagueId, planInput.userId)
              if (idpCtx) {
                legacyEnrichmentContext = legacyEnrichmentContext
                  ? `${legacyEnrichmentContext}\n\n${idpCtx}`
                  : idpCtx
              }
            } catch { /* non-fatal */ }
            try {
              const survivorCtx = await buildSurvivorContextForChimmy(planInput.leagueId, planInput.userId)
              if (survivorCtx) {
                legacyEnrichmentContext = legacyEnrichmentContext
                  ? `${legacyEnrichmentContext}\n\n${survivorCtx}`
                  : survivorCtx
              }
            } catch { /* non-fatal */ }
            try {
              const zombieCtx = await buildZombieContextForChimmy(planInput.leagueId, planInput.userId)
              if (zombieCtx) {
                legacyEnrichmentContext = legacyEnrichmentContext
                  ? `${legacyEnrichmentContext}\n\n${zombieCtx}`
                  : zombieCtx
              }
            } catch { /* non-fatal */ }
            try {
              const devyCtx = await buildDevyContextForChimmy(planInput.leagueId, planInput.userId)
              if (devyCtx) {
                legacyEnrichmentContext = legacyEnrichmentContext
                  ? `${legacyEnrichmentContext}\n\n${devyCtx}`
                  : devyCtx
              }
            } catch { /* non-fatal */ }
            try {
              const guillotineCtx = await buildGuillotineContextForChimmy(planInput.leagueId, planInput.userId)
              if (guillotineCtx) {
                legacyEnrichmentContext = legacyEnrichmentContext
                  ? `${legacyEnrichmentContext}\n\n${guillotineCtx}`
                  : guillotineCtx
              }
            } catch { /* non-fatal */ }
            try {
              const c2cCtx = await buildC2CContextForChimmy(planInput.leagueId, planInput.userId)
              if (c2cCtx) {
                legacyEnrichmentContext = legacyEnrichmentContext
                  ? `${legacyEnrichmentContext}\n\n${c2cCtx}`
                  : c2cCtx
              }
            } catch { /* non-fatal */ }
            try {
              const salaryCapCtx = await buildSalaryCapContextForChimmy(planInput.leagueId, planInput.userId)
              if (salaryCapCtx) {
                legacyEnrichmentContext = legacyEnrichmentContext
                  ? `${legacyEnrichmentContext}\n\n${salaryCapCtx}`
                  : salaryCapCtx
              }
            } catch { /* non-fatal */ }
            try {
              const dynastyCtx = await buildDynastyContextForChimmy(planInput.leagueId, planInput.userId)
              if (dynastyCtx) {
                legacyEnrichmentContext = legacyEnrichmentContext
                  ? `${legacyEnrichmentContext}\n\n${dynastyCtx}`
                  : dynastyCtx
              }
            } catch { /* non-fatal */ }
            try {
              const dynastyWarRoomCtx = await buildDynastyWarRoomContextForChimmy(planInput.leagueId, planInput.userId)
              if (dynastyWarRoomCtx) {
                legacyEnrichmentContext = legacyEnrichmentContext
                  ? `${legacyEnrichmentContext}\n\n${dynastyWarRoomCtx}`
                  : dynastyWarRoomCtx
              }
            } catch { /* non-fatal */ }
            try {
              const redraftCtx = await buildRedraftContextForChimmy(planInput.leagueId, planInput.userId)
              if (redraftCtx) {
                legacyEnrichmentContext = legacyEnrichmentContext
                  ? `${legacyEnrichmentContext}\n\n${redraftCtx}`
                  : redraftCtx
              }
            } catch { /* non-fatal */ }
            try {
              const keeperCtx = await buildKeeperContextForChimmy(planInput.leagueId, planInput.userId)
              if (keeperCtx) {
                legacyEnrichmentContext = legacyEnrichmentContext
                  ? `${legacyEnrichmentContext}\n\n${keeperCtx}`
                  : keeperCtx
              }
            } catch { /* non-fatal */ }
            try {
              const bestBallCtx = await buildBestBallContextForChimmy(planInput.leagueId, planInput.userId)
              if (bestBallCtx) {
                legacyEnrichmentContext = legacyEnrichmentContext
                  ? `${legacyEnrichmentContext}\n\n${bestBallCtx}`
                  : bestBallCtx
              }
            } catch { /* non-fatal */ }
            try {
              const guillotineWarRoomCtx = await buildGuillotineWarRoomContextForChimmy(planInput.leagueId, planInput.userId)
              if (guillotineWarRoomCtx) {
                legacyEnrichmentContext = legacyEnrichmentContext
                  ? `${legacyEnrichmentContext}\n\n${guillotineWarRoomCtx}`
                  : guillotineWarRoomCtx
              }
            } catch { /* non-fatal */ }
            try {
              // T10 — grounded trade intelligence (deterministic T2–T9; reuses this route, no new route).
              const tradeCtx = await buildTradeContextForChimmy(planInput.leagueId, planInput.userId)
              if (tradeCtx) {
                legacyEnrichmentContext = legacyEnrichmentContext
                  ? `${legacyEnrichmentContext}\n\n${tradeCtx}`
                  : tradeCtx
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
                planInput.leagueId,
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
              const tradeHistoryCtx = await buildLeagueTradeHistoryContext(
                planInput.leagueId,
                planInput.userId,
              )
              if (tradeHistoryCtx) {
                legacyEnrichmentContext = legacyEnrichmentContext
                  ? `${legacyEnrichmentContext}

${tradeHistoryCtx}`
                  : tradeHistoryCtx
              }
            } catch { /* non-fatal */ }
            try {
              /*
               * Who is actually winning this league, and which team is the
               * user's. The grounding packet reports only that a standings table
               * EXISTS — its rowCount and sync time — so none of it reached the
               * answer.
               */
              const standingsCtx = await buildLeagueStandingsContext(
                planInput.leagueId,
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
              const h2h = await buildHeadToHeadGrounding(planInput.leagueId)
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
              const draftCtx = await buildDraftContext(planInput.leagueId, planInput.userId)
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
              const waiverCtx = await buildWaiverContext(planInput.leagueId, planInput.userId)
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
                planInput.leagueId,
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
              season: season ?? null,
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
             */
            const describedTradeCtx = await buildDescribedTradeContext({
              message: planInput.message,
              leagueId: planInput.leagueId ?? null,
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
              `[chimmy] grounding truncated: dropped ${budgeted.droppedBlocks} of ${budgeted.droppedBlocks + budgeted.keptBlocks} blocks (${budgeted.originalLength} chars)`,
            )
          }
          legacyEnrichmentContext = budgeted.text

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
    const modeAdjustedAnswer = buildChimmyResponseForAssistantMode({
      mode: selectedAssistantMode,
      fullResponse: guardedAnswer,
      shortAnswer: pecrOutput.responseStructure.shortAnswer,
    })

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

    const answerContractResult = buildChimmyAnswerContract({
      message,
      insightType: insightType ?? null,
      specialistAgent,
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

    const meta = {
      assistant: 'Chimmy',
      conversationId,
      players: playerCards.length > 0 ? playerCards : undefined,
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
              leagueId,
              reason: leagueGrounding.reason,
              message: describeLeagueGroundingFailure(leagueGrounding.reason),
            }
        : { grounded: false as const, leagueId: null, reason: 'no_league_selected' as const },
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
            tokenCost: tokenPreview.tokenCost,
            balanceAfter: spendLedger.balanceAfter,
            ledgerId: spendLedger.id,
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
      const persistTasks = [
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
          },
        }),
        rememberChimmyUserMessageMemory({
          userId,
          leagueId: leagueId ?? null,
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
