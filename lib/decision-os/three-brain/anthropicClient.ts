/**
 * Anthropic (Claude) adapter for the three-brain service. Anthropic is NOT in the openai/deepseek/grok
 * provider registry, so this thin adapter wraps `@anthropic-ai/sdk` directly (same pattern as
 * `lib/ai/providerRouter.ts`'s internal Anthropic call) and exposes the `ThreeBrainProviderClient` surface.
 * Server-side only — the API key never leaves the server. It honors an AbortSignal, so a timeout CANCELS
 * the underlying request (the SDK supports request cancellation), and it never browses or fetches anything.
 */
import { resolveAnthropicModel } from '@/lib/ai/providerProfiles'
import { isAiSpendEnabled } from '@/lib/ai/aiSpendGuard'
import { rateLimitManager } from '@/lib/workers/rate-limit-manager'
import type { ProviderChatRequest, ProviderChatResult } from '@/lib/ai-orchestration/types'
import type { ThreeBrainChatOptions, ThreeBrainProviderClient } from './providerClient'

// The three-brain result's `provider` field is unused by orchestration logic (the role is tracked
// separately); Anthropic is not in AIModelRole, so we tag it honestly via a narrow cast.
const ANTHROPIC_PROVIDER = 'anthropic' as unknown as ProviderChatResult['provider']

type AnthropicSdkModule = typeof import('@anthropic-ai/sdk')
type AnthropicClient = InstanceType<AnthropicSdkModule['default']>
let _clientPromise: Promise<AnthropicClient | null> | null = null

const apiKey = (): string => process.env.ANTHROPIC_API_KEY?.trim() ?? ''

async function getClient(): Promise<AnthropicClient | null> {
  if (!apiKey()) return null
  if (!_clientPromise) {
    _clientPromise = import('@anthropic-ai/sdk')
      .then((mod) => new mod.default({ apiKey: apiKey() }))
      .catch(() => null)
  }
  return _clientPromise
}

function splitMessages(messages: ProviderChatRequest['messages']): { system: string; user: string } {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n')
  const user = messages.filter((m) => m.role !== 'system').map((m) => m.content).join('\n\n')
  return { system, user }
}

function tryJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
    if (fenced) {
      try {
        return JSON.parse(fenced[1])
      } catch {
        /* fall through */
      }
    }
    return undefined
  }
}

const failure = (model: string, error: string, timedOut = false): ProviderChatResult => ({
  text: '',
  model,
  provider: ANTHROPIC_PROVIDER,
  status: timedOut ? 'timeout' : 'failed',
  timedOut,
  error: error.slice(0, 200),
})

export function createAnthropicThreeBrainClient(): ThreeBrainProviderClient {
  return {
    /*
     * PROVIDER BOUNDARY. Reported, never thrown: `chat` returns a
     * ProviderChatResult on every path and the orchestrator selects between
     * brains on `isAvailable`, so throwing here would turn a configured state
     * into an exception inside a fan-out that expects a result object.
     *
     * Declaring it unavailable is the stronger half — the orchestrator then
     * never picks this brain at all, rather than picking it and failing. The
     * check inside `chat` is defence in depth for anything constructing the
     * client directly through three-brain/index.ts.
     *
     * Its sibling orchestrator.ts has enforced the guard for a while; this file
     * did not, so the two halves of one subsystem disagreed about whether spend
     * was checked.
     */
    isAvailable: () => Boolean(apiKey()) && isAiSpendEnabled(),
    async chat(request: ProviderChatRequest, opts?: ThreeBrainChatOptions): Promise<ProviderChatResult> {
      const model = resolveAnthropicModel('standard')
      // Above the key check: when both are true the switch is the more
      // actionable answer. Also above rateLimitManager, which does real work.
      if (!isAiSpendEnabled()) return failure(model, 'AI spend disabled.')
      if (!apiKey()) return failure(model, 'Anthropic not configured.')
      const canCall = await rateLimitManager.canCall('anthropic', '/v1/messages').catch(() => true)
      if (!canCall) return failure(model, 'Anthropic safety rate limit reached.')
      const client = await getClient()
      if (!client) return failure(model, 'Anthropic client unavailable.')

      const { system, user } = splitMessages(request.messages)
      const startedAt = Date.now()
      try {
        const response = await client.messages.create(
          {
            model,
            max_tokens: request.maxTokens ?? 1500,
            temperature: request.temperature,
            system,
            messages: [{ role: 'user', content: user }],
          },
          { signal: opts?.signal },
        )
        await rateLimitManager.recordCall('anthropic', '/v1/messages', 200, Date.now() - startedAt).catch(() => {})
        const text = response.content
          .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
          .map((b) => b.text)
          .join('\n')
          .trim()
        return {
          text,
          json: request.responseFormat === 'json_object' ? tryJson(text) : undefined,
          model: response.model || model,
          provider: ANTHROPIC_PROVIDER,
          tokensPrompt: response.usage?.input_tokens,
          tokensCompletion: response.usage?.output_tokens,
          status: 'ok',
        }
      } catch (error: unknown) {
        const aborted = (error as { name?: string })?.name === 'AbortError' || Boolean(opts?.signal?.aborted)
        await rateLimitManager.recordCall('anthropic', '/v1/messages', 500, Date.now() - startedAt).catch(() => {})
        return failure(model, error instanceof Error ? error.message : 'anthropic error', aborted)
      }
    },
  }
}
