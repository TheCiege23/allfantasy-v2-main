import 'server-only'
import OpenAI from 'openai'
import { CHIMMY_TOOL_SPECS, executeChimmyTool, type ChimmyToolContext } from './chimmyTools'

/**
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

/** Hard ceiling on provider calls per message. Raising this raises unit cost. */
const MAX_TOOL_TURNS = 3

/** Below the 25s provider default, since several of these run in series. */
const TURN_TIMEOUT_MS = 20_000

const XAI_BASE_URL = 'https://api.x.ai/v1'
const DEFAULT_MODEL = 'grok-4-0709'

export type ChimmyToolLoopResult = {
  text: string
  /** Tool names actually invoked, in order — surfaced so the UI can show sourcing. */
  toolsUsed: string[]
  /** Provider round trips spent. 1 means the model answered without a tool. */
  turns: number
}

function grokClient(): OpenAI | null {
  const apiKey = process.env.XAI_API_KEY || process.env.GROK_API_KEY
  if (!apiKey?.trim()) return null
  return new OpenAI({ apiKey, baseURL: XAI_BASE_URL })
}

/** Whether the loop can run at all — flag on AND a key present. */
export function canRunChimmyToolLoop(enabled: boolean): boolean {
  return enabled && Boolean((process.env.XAI_API_KEY || process.env.GROK_API_KEY)?.trim())
}

/**
 * Let the model fetch its own grounding, within a fixed number of turns.
 *
 * Returns null — never throws, never a half answer — when the flag is off, no
 * key is configured, the provider fails, or the loop runs out of turns without
 * producing text. Every one of those means "use the push path instead".
 */
export async function runChimmyToolLoop(args: {
  question: string
  systemPrompt: string
  conversation?: Array<{ role: 'user' | 'assistant'; content: string }>
  context: ChimmyToolContext
  enabled: boolean
  model?: string
}): Promise<ChimmyToolLoopResult | null> {
  if (!canRunChimmyToolLoop(args.enabled)) return null
  const client = grokClient()
  if (!client) return null

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: 'system', content: args.systemPrompt },
    ...(args.conversation ?? []).map((t) => ({ role: t.role, content: t.content }) as const),
    { role: 'user', content: args.question },
  ]

  const toolsUsed: string[] = []

  try {
    for (let turn = 1; turn <= MAX_TOOL_TURNS; turn += 1) {
      const response = await client.chat.completions.create(
        {
          model: args.model?.trim() || DEFAULT_MODEL,
          messages,
          tools: CHIMMY_TOOL_SPECS as unknown as OpenAI.ChatCompletionTool[],
          /*
           * The model decides. Forcing a call would make it fetch on questions
           * that need nothing, and every forced call is a paid round trip.
           */
          tool_choice: 'auto',
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
        return text ? { text, toolsUsed, turns: turn } : null
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
  } catch {
    /* Timeout, rate limit, refusal — all mean "fall back", never "fail loudly". */
    return null
  }
}
