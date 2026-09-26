import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { CHIMMY_TOOL_SPECS, executeChimmyTool, type ChimmyToolContext } from './chimmyTools'
import { isAiSpendEnabled } from '@/lib/ai/aiSpendGuard'
import { reportProviderFailure } from '@/lib/ai-orchestration/providerOutageAlert'
import {
  CHIMMY_CLAUDE_EFFORT,
  CHIMMY_CLAUDE_FALLBACK_BETA,
  CHIMMY_CLAUDE_MAX_TOKENS,
  hasAnthropicKey,
  resolveChimmyClaudeModel,
} from '@/lib/ai/chimmyClaudeConfig'

/**
 * CLAUDE IS THE MAIN MODEL (2026-09-23, user's decision). When `ANTHROPIC_API_KEY` is set the
 * loop runs on Claude through the Anthropic SDK; Grok below is now only the fallback for a
 * deployment with no Anthropic key, or one that pins `CHIMMY_TOOL_LOOP_PROVIDER=grok`. This loop
 * answers first in the /core drawer, so it is where "which model is Chimmy" is decided.
 *
 * The notes below describe the original Grok-only loop and still hold for the Grok path.
 *
 * A BOUNDED TOOL LOOP FOR CHIMMY, GROK ONLY, OFF BY DEFAULT.
 *
 * The rest of this assistant assembles context up front and refuses when it is
 * missing. This lets the model ask for context instead. It exists behind
 * `CHIMMY_TOOL_LOOP_ENABLED` and returns null whenever it cannot run, so the
 * caller falls back to the push path rather than failing.
 *
 * ⚠ GROK, THROUGH THE OPENAI SDK AGAINST api.x.ai — NOT `lib/xai-client`. That
 * client's `tools` parameter is xAI's SERVER-SIDE search (`x_search`,
 * `web_search`), which is a different feature from function calling and cannot
 * express our tools. `/api/waiver-ai/grok` already proves this path works.
 *
 * ⚠ DEEPSEEK CANNOT DO THIS AT ALL, and that is why this is not wired into the
 * shared provider registry. Its adapter flattens the whole message array into a
 * single prompt string (`toDeepSeekUserPrompt`), so there is nowhere to put an
 * assistant message carrying `tool_calls` or a `role: 'tool'` reply. Supporting
 * it means rewriting the adapter and the client, which is a larger change than
 * this loop.
 *
 * ⚠ NO CACHE, ON PURPOSE. `cachedFetch` keys on (messages, model, temperature)
 * for 30 minutes and has NO single-flight — concurrent misses all call the
 * provider. Worse for a loop: the final answer depends on tool results that are
 * not in the key, so a cached hit would serve an answer built from stale tool
 * output. This calls the SDK directly.
 *
 * ⚠ IT COSTS SEVERAL PROVIDER CALLS FOR ONE CHARGED MESSAGE. The spend rule
 * charges `ai_chimmy_chat_message` once. `MAX_TOOL_TURNS` is the ceiling on
 * that exposure and is deliberately small.
 */

/**
 * Hard ceiling on provider calls per message. Raising this raises unit cost.
 *
 * ⚠ 4, AND THE LAST ONE MAY NOT CALL A TOOL (2026-09-24). At 3 with no forced answer, a question
 * that needed "select the league → run the analysis → answer" plus one follow-up lookup ended its
 * third turn still asking for data, returned null, and fell through to the PUSH path — which then
 * paid for a second full model journey. So the ceiling bought an answer from the WORSE path at the
 * HIGHER cost. The analyst tools (lineup optimizer, playoff simulator, trade evaluator) routinely
 * need the league lookup first, so the fourth turn exists, and on it `tool_choice` is `none`: the
 * model must answer from what it has already fetched. Worst case is now four calls and an answer,
 * where it used to be three calls, no answer, and a push-path journey on top.
 */
const MAX_TOOL_TURNS = 4

/** Below the 25s provider default, since several of these run in series. */
const TURN_TIMEOUT_MS = 20_000

const XAI_BASE_URL = 'https://api.x.ai/v1'
const DEFAULT_MODEL = 'grok-4-0709'

/*
 * Model, effort, token room and the refusal-fallback beta are shared with the push path's Claude
 * provider through `lib/ai/chimmyClaudeConfig.ts`, so both halves of Chimmy run the same Claude.
 */
const CLAUDE_EFFORT = CHIMMY_CLAUDE_EFFORT
const CLAUDE_MAX_TOKENS = CHIMMY_CLAUDE_MAX_TOKENS
const CLAUDE_FALLBACK_BETA = CHIMMY_CLAUDE_FALLBACK_BETA

/** Per round trip; thinking makes a Claude turn slower than a Grok one. */
const CLAUDE_TURN_TIMEOUT_MS = 40_000

/** Whole-loop ceiling, so three slow turns cannot hold a request for two minutes. */
const CLAUDE_LOOP_BUDGET_MS = 75_000

export type ChimmyToolLoopProvider = 'claude' | 'grok'

export type ChimmyToolLoopResult = {
  text: string
  /** Tool names actually invoked, in order — surfaced so the UI can show sourcing. */
  toolsUsed: string[]
  /** Provider round trips spent. 1 means the model answered without a tool. */
  turns: number
  /** Which provider answered. */
  provider?: ChimmyToolLoopProvider
  /** The model id the answering provider ran. */
  model?: string
}

function hasXaiKey(): boolean {
  return Boolean((process.env.XAI_API_KEY || process.env.GROK_API_KEY)?.trim())
}

/**
 * Claude when its key is present, Grok otherwise; null when neither can run. Read at call time,
 * never at import, so a key rotated into the environment takes effect without a rebuild.
 */
export function resolveChimmyToolLoopProvider(): ChimmyToolLoopProvider | null {
  const pinned = process.env.CHIMMY_TOOL_LOOP_PROVIDER?.trim().toLowerCase()
  if (pinned === 'grok') return hasXaiKey() ? 'grok' : null
  if (hasAnthropicKey()) return 'claude'
  return hasXaiKey() ? 'grok' : null
}

/**
 * The same tools, in Anthropic's shape. `CHIMMY_TOOL_SPECS` stays in the OpenAI function format
 * the Grok path sends; this is a mechanical rename (`parameters` → `input_schema`), not a second
 * list to keep in sync.
 */
export function chimmyToolsForClaude(): Anthropic.Tool[] {
  return CHIMMY_TOOL_SPECS.map((spec) => ({
    name: spec.function.name,
    description: spec.function.description,
    // The specs are `as const` (readonly arrays); the SDK type wants mutable ones. Same JSON.
    input_schema: spec.function.parameters as unknown as Anthropic.Tool.InputSchema,
  }))
}

function grokClient(): OpenAI | null {
  // Defence in depth. canRunChimmyToolLoop below is the real gate, but this is
  // a provider boundary in its own right and should not depend on a caller
  // having asked the right question first.
  if (!isAiSpendEnabled()) return null
  const apiKey = process.env.XAI_API_KEY || process.env.GROK_API_KEY
  if (!apiKey?.trim()) return null
  return new OpenAI({ apiKey, baseURL: XAI_BASE_URL })
}

/**
 * Whether the loop can run at all — feature flag on, spend allowed, key present.
 *
 * ⚠ THIS BOUNDARY WAS TRACKED NOWHERE. It appeared in neither the GUARDED list
 * nor the unguarded ratchet in __tests__/ai/ai-spend-guard.test.ts, because that
 * ratchet enumerates known lib/ paths rather than scanning for provider access.
 * Its caller, app/api/chat/chimmy/route.ts, WAS guarded — but on
 * getVisionClient(), a different client entirely. So the route read as protected
 * while a chimmy turn that ran the tool loop still reached xAI unmetered.
 *
 * Spend is checked here rather than only in grokClient because this is the
 * predicate callers consult, and returning false means the push path is used
 * instead — the same graceful degradation a missing key already produces.
 */
export function canRunChimmyToolLoop(enabled: boolean): boolean {
  return enabled && isAiSpendEnabled() && resolveChimmyToolLoopProvider() !== null
}

/**
 * Let the model fetch its own grounding, within a fixed number of turns.
 *
 * Returns null — never throws, never a half answer — when the flag is off, spend is
 * disabled, no key is configured, the provider fails, or the loop runs out of turns without
 * producing text. Every one of those means "use the push path instead".
 */
type ChimmyToolLoopArgs = {
  question: string
  /** The stable instructions. Kept byte-identical across turns so Claude can cache it. */
  systemPrompt: string
  /**
   * The user's clock ("today is …"). Separate from `systemPrompt` because it changes every
   * minute: sent AFTER the cached block on Claude so it does not invalidate the cache.
   */
  clockLine?: string | null
  /**
   * How THIS user likes answers (their saved Chimmy preferences). Per-user, so like the clock it is
   * sent after the cached block rather than inside it — one user's style must not bust the cache for
   * everyone, and must never be cached into anyone else's prompt.
   */
  styleLine?: string | null
  /** Membership-checked Decision OS evidence already assembled by the route. */
  groundingLine?: string | null
  conversation?: Array<{ role: 'user' | 'assistant'; content: string }>
  context: ChimmyToolContext
  enabled: boolean
  model?: string
}

export async function runChimmyToolLoop(args: ChimmyToolLoopArgs): Promise<ChimmyToolLoopResult | null> {
  if (!canRunChimmyToolLoop(args.enabled)) return null
  return resolveChimmyToolLoopProvider() === 'claude' ? runClaudeToolLoop(args) : runGrokToolLoop(args)
}

/**
 * History as Claude requires it: must open on a user turn, and same-role neighbours are merged
 * by the API anyway, so an opening assistant turn (a greeting carried over) is dropped.
 */
function claudeHistory(conversation: ChimmyToolLoopArgs['conversation']): Anthropic.MessageParam[] {
  const turns = (conversation ?? []).filter((t) => t.content?.trim())
  while (turns.length > 0 && turns[0].role !== 'user') turns.shift()
  return turns.map((t) => ({ role: t.role, content: t.content }))
}

async function runClaudeToolLoop(args: ChimmyToolLoopArgs): Promise<ChimmyToolLoopResult | null> {
  // Defence in depth, as for grokClient: this is a provider boundary in its own right.
  if (!isAiSpendEnabled()) return null
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim()
  if (!apiKey) return null

  const client = new Anthropic({ apiKey, maxRetries: 1 })
  const model = resolveChimmyClaudeModel(args.model)
  const tools = chimmyToolsForClaude()
  const system: Anthropic.TextBlockParam[] = [
    // Tools render before system, so this one breakpoint caches tools + instructions together.
    { type: 'text', text: args.systemPrompt, cache_control: { type: 'ephemeral' } },
  ]
  if (args.clockLine?.trim()) system.push({ type: 'text', text: args.clockLine.trim() })
  if (args.styleLine?.trim()) system.push({ type: 'text', text: args.styleLine.trim() })
  if (args.groundingLine?.trim()) system.push({ type: 'text', text: args.groundingLine.trim() })

  const messages: Anthropic.MessageParam[] = [
    ...claudeHistory(args.conversation),
    { role: 'user', content: args.question },
  ]
  const toolsUsed: string[] = []
  const deadline = Date.now() + CLAUDE_LOOP_BUDGET_MS
  let useFallbacks = true

  const call = async (final: boolean): Promise<Anthropic.Message> => {
    const timeout = Math.max(5_000, Math.min(CLAUDE_TURN_TIMEOUT_MS, deadline - Date.now()))
    const params = {
      model,
      max_tokens: CLAUDE_MAX_TOKENS,
      system,
      // Still sent on the final turn: the history carries tool_use blocks, which require them.
      tools,
      /*
       * The model decides — forcing a call would fetch on questions that need nothing — except on
       * the LAST turn, where `none` makes it answer from the results it already has. `none` is
       * compatible with adaptive thinking; `any`/`tool` are not, and are not used.
       */
      tool_choice: final ? { type: 'none' as const } : { type: 'auto' as const },
      thinking: { type: 'adaptive' as const },
      output_config: { effort: CLAUDE_EFFORT },
      messages,
      /*
       * Not in this SDK version's types, so it is spread in; the SDK sends the body as given.
       * See CLAUDE_FALLBACK_BETA.
       */
      ...(useFallbacks ? { fallbacks: 'default' } : {}),
    } as Anthropic.MessageCreateParamsNonStreaming
    return client.messages.create(params, {
      timeout,
      headers: useFallbacks ? { 'anthropic-beta': CLAUDE_FALLBACK_BETA } : undefined,
    })
  }

  try {
    for (let turn = 1; turn <= MAX_TOOL_TURNS; turn += 1) {
      if (Date.now() >= deadline) return null
      const final = turn === MAX_TOOL_TURNS

      let response: Anthropic.Message
      try {
        response = await call(final)
      } catch (err) {
        /*
         * The refusal-fallback beta is an ADD-ON. If this account or model rejects it, a 400
         * would take the whole Claude path down with it — so retry once without it, and keep it
         * off for the rest of this loop.
         */
        if (useFallbacks && err instanceof Anthropic.BadRequestError) {
          useFallbacks = false
          response = await call(final)
        } else {
          throw err
        }
      }

      // A refusal or a truncated answer is not an answer: fall back to the push path.
      if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') return null

      // Keep the FULL content, thinking blocks included — they must go back unchanged.
      messages.push({ role: 'assistant', content: response.content })

      const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
      if (response.stop_reason !== 'tool_use' || toolUses.length === 0) {
        const text = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('')
          .trim()
        return text ? { text, toolsUsed, turns: turn, provider: 'claude', model: response.model || model } : null
      }

      // See the Grok loop: the last turn must not end on a tool call.
      if (turn === MAX_TOOL_TURNS) return null

      /*
       * Sequential on purpose: `find_league_by_name` rebinds `context.leagueId`, and the league
       * tools called after it in the same turn must read the rebound league. Every result goes
       * back in ONE user message — splitting them teaches the model to stop calling in parallel.
       */
      const results: Anthropic.ToolResultBlockParam[] = []
      for (const use of toolUses) {
        const result = await executeChimmyTool(use.name, use.input ?? {}, args.context)
        toolsUsed.push(use.name)
        results.push({ type: 'tool_result', tool_use_id: use.id, content: result })
      }
      messages.push({ role: 'user', content: results })
    }
    return null
  } catch (err) {
    // As for Grok: the user falls back quietly; the owner hears about billing/credential failures.
    const e = err as { status?: number; message?: string } | null
    reportProviderFailure({ provider: 'anthropic', status: e?.status, detail: e?.message, surface: 'chimmy_tool_loop' })
    return null
  }
}

async function runGrokToolLoop(args: ChimmyToolLoopArgs): Promise<ChimmyToolLoopResult | null> {
  const client = grokClient()
  if (!client) return null
  const model = args.model?.trim() || DEFAULT_MODEL

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: 'system', content: [args.clockLine, args.systemPrompt, args.styleLine, args.groundingLine].filter((s) => s?.trim()).join('\n\n') },
    ...(args.conversation ?? []).map((t) => ({ role: t.role, content: t.content }) as const),
    { role: 'user', content: args.question },
  ]

  const toolsUsed: string[] = []

  try {
    for (let turn = 1; turn <= MAX_TOOL_TURNS; turn += 1) {
      const response = await client.chat.completions.create(
        {
          model,
          messages,
          tools: CHIMMY_TOOL_SPECS as unknown as OpenAI.ChatCompletionTool[],
          /*
           * The model decides. Forcing a call would make it fetch on questions
           * that need nothing, and every forced call is a paid round trip. On the
           * LAST turn it must answer instead — see MAX_TOOL_TURNS.
           */
          tool_choice: turn === MAX_TOOL_TURNS ? 'none' : 'auto',
          temperature: 0.4,
          max_tokens: 1200,
        },
        { signal: AbortSignal.timeout(TURN_TIMEOUT_MS) },
      )

      const message = response.choices?.[0]?.message
      if (!message) return null

      messages.push(message)

      const calls = message.tool_calls ?? []
      if (calls.length === 0) {
        const text = typeof message.content === 'string' ? message.content.trim() : ''
        return text ? { text, toolsUsed, turns: turn, provider: 'grok', model } : null
      }

      /*
       * ⚠ THE LAST TURN MUST NOT END ON A TOOL CALL. If the model asks for more
       * on the final turn there is no turn left to read the answer, so the loop
       * would return nothing at all after paying for every call. Bail to the
       * push path instead of burning another request.
       */
      if (turn === MAX_TOOL_TURNS) return null

      for (const call of calls) {
        const fn = (call as { function?: { name?: string; arguments?: string } }).function
        const name = fn?.name ?? 'unknown'

        let parsed: unknown = {}
        try {
          parsed = fn?.arguments ? JSON.parse(fn.arguments) : {}
        } catch {
          /* Malformed arguments are the model's error; the executor defaults. */
        }

        const result = await executeChimmyTool(name, parsed, args.context)
        toolsUsed.push(name)

        messages.push({
          role: 'tool',
          tool_call_id: (call as { id: string }).id,
          content: result,
        })
      }
    }

    return null
  } catch (err) {
    /*
     * Timeout, rate limit, refusal — all mean "fall back", never "fail loudly" to the USER.
     * But an exhausted xAI account also lands here, and this loop only runs on xAI, so
     * swallowing it silently is how the tool loop sat dead for days with nothing reported.
     * The owner hears about billing/credential failures; the user still just falls back.
     */
    const e = err as { status?: number; message?: string } | null
    reportProviderFailure({ provider: 'grok', status: e?.status, detail: e?.message, surface: 'chimmy_tool_loop' })
    return null
  }
}
