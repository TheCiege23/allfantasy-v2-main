/**
 * Tests for the AI Provider Fallback Router.
 *
 * Provider client modules are mocked so no real network calls are made.
 * The rateLimitManager and Anthropic SDK are also mocked out.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"

// Mock all external provider clients and the rate limit manager
vi.mock("@/lib/openai-client", () => ({
  openaiChatText: vi.fn(),
  openaiChatTextStream: vi.fn(),
}))
vi.mock("@/lib/xai-client", () => ({
  xaiChatJson: vi.fn(),
  parseTextFromXaiChatCompletion: vi.fn((json: any) => json?.choices?.[0]?.message?.content ?? null),
}))
vi.mock("@/lib/deepseek-client", () => ({
  deepseekChat: vi.fn(),
}))
vi.mock("@/lib/workers/rate-limit-manager", () => ({
  rateLimitManager: {
    canCall: vi.fn().mockResolvedValue(true),
    recordCall: vi.fn().mockResolvedValue(undefined),
  },
}))
// Mock Anthropic SDK (dynamic import). The spies are hoisted so they survive `vi.resetModules()`:
// the spend-guard tests below re-import the router to pick up ANTHROPIC_API_KEY, which it reads once
// at module load, and must still see whether the SDK was constructed or called.
const anthropicSdk = vi.hoisted(() => {
  const create = vi.fn()
  const stream = vi.fn()
  // A `class`, not an arrow: the router calls `new mod.default(...)`, and vitest 4 refuses `new` on an
  // arrow implementation — the router's `.catch(() => null)` would swallow that and read as "unavailable".
  const ctor = vi.fn(
    class {
      messages = { create, stream }
    },
  )
  return { ctor, create, stream }
})
vi.mock("@anthropic-ai/sdk", () => ({ default: anthropicSdk.ctor }))

import { openaiChatText, openaiChatTextStream } from "@/lib/openai-client"
import { xaiChatJson } from "@/lib/xai-client"
import { deepseekChat } from "@/lib/deepseek-client"
import { getProviderOrder, routeTextCall, routeStreamCall } from "@/lib/ai/providerRouter"

const mockOpenaiText = openaiChatText as ReturnType<typeof vi.fn>
const mockOpenaiStream = openaiChatTextStream as ReturnType<typeof vi.fn>
const mockXai = xaiChatJson as ReturnType<typeof vi.fn>
const mockDeepseek = deepseekChat as ReturnType<typeof vi.fn>

// Helpers
const openaiSuccess = (text = "hello from openai") => ({
  ok: true,
  text,
  model: "gpt-4o",
  baseUrl: "https://api.openai.com",
})
const openaiFailure = (status = 503, details = "OpenAI unavailable") => ({
  ok: false,
  status,
  details,
  model: "unavailable",
  baseUrl: "",
})
const xaiSuccess = (content = "hello from xai") => ({
  ok: true,
  status: 200,
  json: { choices: [{ message: { content } }], model: "grok-2-latest" },
})
const xaiFailure = (status = 503, details = "xAI unavailable") => ({
  ok: false,
  status,
  details,
})
const deepseekSuccess = (content = "hello from deepseek") => ({
  content,
  model: "deepseek-chat",
})
const deepseekFailure = () => ({
  content: "",
  error: "DeepSeek unavailable (missing DEEPSEEK_API_KEY)",
})

// ─── Provider ordering ─────────────────────────────────────────────────────────

describe("getProviderOrder", () => {
  const originalEnv = process.env.AI_PROVIDER_ORDER

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.AI_PROVIDER_ORDER
    } else {
      process.env.AI_PROVIDER_ORDER = originalEnv
    }
  })

  it("returns default order when env var is not set", () => {
    delete process.env.AI_PROVIDER_ORDER
    expect(getProviderOrder()).toEqual(["openai", "anthropic", "xai", "deepseek"])
  })

  it("parses AI_PROVIDER_ORDER env var", () => {
    process.env.AI_PROVIDER_ORDER = "deepseek,xai,openai"
    expect(getProviderOrder()).toEqual(["deepseek", "xai", "openai"])
  })

  it("ignores unknown provider names", () => {
    process.env.AI_PROVIDER_ORDER = "openai,fakeai,xai"
    expect(getProviderOrder()).toEqual(["openai", "xai"])
  })

  it("falls back to default if all entries are invalid", () => {
    process.env.AI_PROVIDER_ORDER = "fakeai,alsoFake"
    expect(getProviderOrder()).toEqual(["openai", "anthropic", "xai", "deepseek"])
  })
})

// ─── routeTextCall — success on first provider ────────────────────────────────

describe("routeTextCall — first provider succeeds", () => {
  beforeEach(() => {
    delete process.env.AI_PROVIDER_ORDER
    process.env.AI_PROVIDER_ORDER = "openai,xai,deepseek"
    mockOpenaiText.mockResolvedValue(openaiSuccess("OpenAI answer"))
  })

  afterEach(() => {
    vi.clearAllMocks()
    delete process.env.AI_PROVIDER_ORDER
  })

  it("returns ok:true with the first provider's text", async () => {
    const result = await routeTextCall({
      messages: [{ role: "user", content: "hello" }],
    })
    expect(result).toMatchObject({ ok: true, text: "OpenAI answer", provider: "openai" })
  })

  it("does not call downstream providers when first succeeds", async () => {
    await routeTextCall({ messages: [{ role: "user", content: "hello" }] })
    expect(mockXai).not.toHaveBeenCalled()
    expect(mockDeepseek).not.toHaveBeenCalled()
  })
})

// ─── routeTextCall — fallback chain ──────────────────────────────────────────

describe("routeTextCall — fallback chain", () => {
  beforeEach(() => {
    process.env.AI_PROVIDER_ORDER = "openai,xai,deepseek"
  })

  afterEach(() => {
    vi.clearAllMocks()
    delete process.env.AI_PROVIDER_ORDER
  })

  it("falls back to xAI when OpenAI returns 429", async () => {
    mockOpenaiText.mockResolvedValue(openaiFailure(429, "rate limit"))
    mockXai.mockResolvedValue(xaiSuccess("xAI answer"))
    const result = await routeTextCall({ messages: [{ role: "user", content: "test" }] })
    expect(result).toMatchObject({ ok: true, text: "xAI answer", provider: "xai" })
  })

  it("falls back to DeepSeek when OpenAI and xAI both fail", async () => {
    mockOpenaiText.mockResolvedValue(openaiFailure(503))
    mockXai.mockResolvedValue(xaiFailure(503))
    mockDeepseek.mockResolvedValue(deepseekSuccess("DeepSeek answer"))
    const result = await routeTextCall({ messages: [{ role: "user", content: "test" }] })
    expect(result).toMatchObject({ ok: true, text: "DeepSeek answer", provider: "deepseek" })
  })

  it("returns ok:false when all providers fail", async () => {
    mockOpenaiText.mockResolvedValue(openaiFailure(503))
    mockXai.mockResolvedValue(xaiFailure(503))
    mockDeepseek.mockResolvedValue(deepseekFailure())
    const result = await routeTextCall({ messages: [{ role: "user", content: "test" }] })
    expect(result).toMatchObject({ ok: false })
  })

  it("falls back through billing errors", async () => {
    mockOpenaiText.mockResolvedValue(openaiFailure(402, "billing issue"))
    mockXai.mockResolvedValue(xaiSuccess("xAI ok"))
    const result = await routeTextCall({ messages: [{ role: "user", content: "test" }] })
    expect(result).toMatchObject({ ok: true, provider: "xai" })
  })
})

// ─── routeTextCall — content filter stops fallback ───────────────────────────

describe("routeTextCall — content filter stops fallback", () => {
  beforeEach(() => {
    process.env.AI_PROVIDER_ORDER = "openai,xai,deepseek"
  })

  afterEach(() => {
    vi.clearAllMocks()
    delete process.env.AI_PROVIDER_ORDER
  })

  it("does NOT fall back to xAI when OpenAI returns content filter 400", async () => {
    mockOpenaiText.mockResolvedValue(openaiFailure(400, "Your request was rejected as a result of a content filter."))
    const result = await routeTextCall({ messages: [{ role: "user", content: "test" }] })
    // Content filter is NOT fallback eligible — should stop immediately
    expect(result).toMatchObject({ ok: false })
    expect(mockXai).not.toHaveBeenCalled()
    expect(mockDeepseek).not.toHaveBeenCalled()
  })
})

// ─── routeStreamCall — fallback chain ────────────────────────────────────────

describe("routeStreamCall — fallback chain", () => {
  beforeEach(() => {
    process.env.AI_PROVIDER_ORDER = "openai,xai,deepseek"
  })

  afterEach(() => {
    vi.clearAllMocks()
    delete process.env.AI_PROVIDER_ORDER
  })

  it("streams from first available provider (OpenAI)", async () => {
    async function* makeStream() { yield "hello "; yield "world" }
    mockOpenaiStream.mockResolvedValue({ ok: true, stream: makeStream(), model: "gpt-4o", baseUrl: "" })

    const chunks: string[] = []
    const result = await routeStreamCall({
      messages: [{ role: "user", content: "test" }],
      onText: (delta) => chunks.push(delta),
    })

    expect(result).toMatchObject({ ok: true, provider: "openai" })
    expect(chunks).toEqual(["hello ", "world"])
  })

  it("falls back to xAI (non-streaming) when OpenAI stream fails", async () => {
    mockOpenaiStream.mockResolvedValue({ ok: false, status: 503, details: "OpenAI unavailable", model: "unavailable", baseUrl: "" })
    mockXai.mockResolvedValue(xaiSuccess("xAI response"))

    const chunks: string[] = []
    const result = await routeStreamCall({
      messages: [{ role: "user", content: "test" }],
      onText: (_, snapshot) => chunks.push(snapshot),
    })

    expect(result).toMatchObject({ ok: true, provider: "xai" })
    // Non-streaming provider calls onText once with full text
    expect(chunks).toContain("xAI response")
  })

  it("falls back to DeepSeek when OpenAI and xAI fail", async () => {
    mockOpenaiStream.mockResolvedValue({ ok: false, status: 503, details: "fail", model: "unavailable", baseUrl: "" })
    mockXai.mockResolvedValue(xaiFailure())
    mockDeepseek.mockResolvedValue(deepseekSuccess("DeepSeek stream sim"))

    const chunks: string[] = []
    const result = await routeStreamCall({
      messages: [{ role: "user", content: "test" }],
      onText: (_, snapshot) => chunks.push(snapshot),
    })

    expect(result).toMatchObject({ ok: true, provider: "deepseek" })
    expect(chunks).toContain("DeepSeek stream sim")
  })

  it("returns ok:false when all streaming providers fail", async () => {
    mockOpenaiStream.mockResolvedValue({ ok: false, status: 503, details: "fail", model: "unavailable", baseUrl: "" })
    mockXai.mockResolvedValue(xaiFailure())
    mockDeepseek.mockResolvedValue(deepseekFailure())

    const result = await routeStreamCall({
      messages: [{ role: "user", content: "test" }],
      onText: () => {},
    })
    expect(result).toMatchObject({ ok: false })
  })
})

// ─── Message passthrough ──────────────────────────────────────────────────────

describe("routeTextCall — message passthrough", () => {
  beforeEach(() => {
    process.env.AI_PROVIDER_ORDER = "openai"
  })

  afterEach(() => {
    vi.clearAllMocks()
    delete process.env.AI_PROVIDER_ORDER
  })

  it("passes system and user messages to OpenAI", async () => {
    mockOpenaiText.mockResolvedValue(openaiSuccess("ok"))
    await routeTextCall({
      messages: [
        { role: "system", content: "You are Chimmy." },
        { role: "user", content: "Who should I start?" },
      ],
    })
    expect(mockOpenaiText).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          { role: "system", content: "You are Chimmy." },
          { role: "user", content: "Who should I start?" },
        ]),
      })
    )
  })

  it("passes maxTokens and temperature to OpenAI", async () => {
    mockOpenaiText.mockResolvedValue(openaiSuccess("ok"))
    await routeTextCall({
      messages: [{ role: "user", content: "test" }],
      maxTokens: 300,
      temperature: 0.3,
    })
    expect(mockOpenaiText).toHaveBeenCalledWith(
      expect.objectContaining({ maxTokens: 300, temperature: 0.3 })
    )
  })
})

// ─── Sports schedule guardrail survives provider switch ───────────────────────

describe("sports schedule guardrail — guardrail content preserved across providers", () => {
  afterEach(() => {
    vi.clearAllMocks()
    delete process.env.AI_PROVIDER_ORDER
  })

  it("passes guardrail system prompt to fallback provider unchanged", async () => {
    process.env.AI_PROVIDER_ORDER = "openai,xai"
    mockOpenaiText.mockResolvedValue(openaiFailure(503))
    mockXai.mockResolvedValue(xaiSuccess("xAI schedule answer"))

    const guardrailSystem =
      "Only answer using provided schedule context. Do NOT guess game times or scores."

    await routeTextCall({
      messages: [
        { role: "system", content: guardrailSystem },
        { role: "user", content: "what games are on tonight?" },
      ],
    })

    // xAI must have received the same system prompt
    expect(mockXai).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({ role: "system", content: guardrailSystem }),
        ]),
      })
    )
  })
})

// ─── skipCache behaviour ──────────────────────────────────────────────────────

describe("routeTextCall — skipCache", () => {
  beforeEach(() => {
    process.env.AI_PROVIDER_ORDER = "openai"
  })

  afterEach(() => {
    vi.clearAllMocks()
    delete process.env.AI_PROVIDER_ORDER
  })

  it("passes skipCache:true to OpenAI when requested", async () => {
    mockOpenaiText.mockResolvedValue(openaiSuccess())
    await routeTextCall({
      messages: [{ role: "user", content: "test" }],
      skipCache: true,
    })
    expect(mockOpenaiText).toHaveBeenCalledWith(expect.objectContaining({ skipCache: true }))
  })

  it("passes skipCache:false by default", async () => {
    mockOpenaiText.mockResolvedValue(openaiSuccess())
    await routeTextCall({ messages: [{ role: "user", content: "test" }] })
    expect(mockOpenaiText).toHaveBeenCalledWith(expect.objectContaining({ skipCache: false }))
  })
})

// ─── Anthropic adapter — the AI spend kill switch ─────────────────────────────
//
// The Anthropic adapter is INLINE in the router and builds its own SDK client, so no guarded client
// module ever sees it. These tests pin that with spend OFF it never constructs or calls that client,
// and that a spend refusal from ANY provider ends the chain instead of falling through to the next.

describe("Anthropic adapter — AI spend kill switch", () => {
  const saved = {
    order: process.env.AI_PROVIDER_ORDER,
    key: process.env.ANTHROPIC_API_KEY,
    spend: process.env.AI_FEATURES_ENABLED,
  }
  const restore = (name: string, value: string | undefined) => {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  const messages = [{ role: "user" as const, content: "grade this trade" }]

  /** Fresh router, so its module-scope ANTHROPIC_API_KEY read and cached client start clean. */
  async function loadRouter() {
    vi.resetModules()
    return import("@/lib/ai/providerRouter")
  }
  /** The guarded OpenAI client's real behaviour with spend off: `getOpenAIClient()` throws. */
  async function openaiRefusesSpend() {
    const { AiSpendDisabledError } = await import("@/lib/ai/aiSpendGuard")
    const client = await import("@/lib/openai-client")
    ;(client.openaiChatText as ReturnType<typeof vi.fn>).mockRejectedValue(
      new AiSpendDisabledError("openai-client"),
    )
    return client
  }

  beforeEach(() => {
    vi.clearAllMocks()
    // A real-looking key, so the missing-key branch cannot be what stops the call.
    process.env.ANTHROPIC_API_KEY = "placeholder-anthropic-key-for-tests"
    anthropicSdk.create.mockResolvedValue({
      content: [{ type: "text", text: "hello from anthropic" }],
      model: "claude-test",
      usage: { input_tokens: 3, output_tokens: 4 },
    })
  })

  afterEach(() => {
    restore("AI_PROVIDER_ORDER", saved.order)
    restore("ANTHROPIC_API_KEY", saved.key)
    restore("AI_FEATURES_ENABLED", saved.spend)
  })

  it("positive control: with spend ON the harness DOES see the SDK constructed and called", async () => {
    // Without this, the refusals below could be passing because the mock is unreachable.
    process.env.AI_FEATURES_ENABLED = "true"
    process.env.AI_PROVIDER_ORDER = "anthropic"
    const router = await loadRouter()

    const result = await router.routeTextCall({ messages })

    expect(result).toMatchObject({ ok: true, provider: "anthropic", text: "hello from anthropic" })
    expect(anthropicSdk.ctor).toHaveBeenCalledTimes(1)
    expect(anthropicSdk.create).toHaveBeenCalledTimes(1)
  })

  it("text: with spend OFF an Anthropic-routed call never constructs or calls the SDK", async () => {
    process.env.AI_FEATURES_ENABLED = "false"
    process.env.AI_PROVIDER_ORDER = "anthropic"
    const router = await loadRouter()

    const result = await router.routeTextCall({ messages })

    expect(result).toEqual({ ok: false })
    expect(anthropicSdk.ctor).not.toHaveBeenCalled()
    expect(anthropicSdk.create).not.toHaveBeenCalled()
  })

  it("stream: with spend OFF an Anthropic-routed stream never constructs or calls the SDK", async () => {
    process.env.AI_FEATURES_ENABLED = "false"
    process.env.AI_PROVIDER_ORDER = "anthropic"
    const router = await loadRouter()
    const onText = vi.fn()

    const result = await router.routeStreamCall({ messages, onText })

    expect(result).toEqual({ ok: false })
    expect(anthropicSdk.ctor).not.toHaveBeenCalled()
    expect(anthropicSdk.stream).not.toHaveBeenCalled()
    expect(onText).not.toHaveBeenCalled()
  })

  it("the refusal STOPS the chain — later providers are not tried", async () => {
    process.env.AI_FEATURES_ENABLED = "false"
    process.env.AI_PROVIDER_ORDER = "anthropic,xai,deepseek"
    const router = await loadRouter()
    const xai = await import("@/lib/xai-client")
    const deepseek = await import("@/lib/deepseek-client")

    const result = await router.routeTextCall({ messages })

    expect(result).toEqual({ ok: false })
    expect(xai.xaiChatJson).not.toHaveBeenCalled()
    expect(deepseek.deepseekChat).not.toHaveBeenCalled()
  })

  it("default order: OpenAI's spend refusal does not fall through to Anthropic", async () => {
    // The leak as it was reachable in production: the guarded OpenAI client refused, the router
    // read that as an ordinary failure, fell back to Anthropic, and Anthropic spent.
    process.env.AI_FEATURES_ENABLED = "false"
    delete process.env.AI_PROVIDER_ORDER
    const router = await loadRouter()
    const openai = await openaiRefusesSpend()
    const xai = await import("@/lib/xai-client")

    const result = await router.routeTextCall({ messages })

    expect(result).toEqual({ ok: false })
    expect(openai.openaiChatText).toHaveBeenCalledTimes(1)
    expect(anthropicSdk.ctor).not.toHaveBeenCalled()
    expect(anthropicSdk.create).not.toHaveBeenCalled()
    expect(xai.xaiChatJson).not.toHaveBeenCalled()
  })

  it("an ordinary OpenAI outage still falls back — and with spend OFF, Anthropic still refuses", async () => {
    // A 503 is not a spend refusal, so fallback is right; the Anthropic adapter's own guard is what
    // must hold here, with no help from the classifier.
    process.env.AI_FEATURES_ENABLED = "false"
    process.env.AI_PROVIDER_ORDER = "openai,anthropic"
    const router = await loadRouter()
    const openai = await import("@/lib/openai-client")
    ;(openai.openaiChatText as ReturnType<typeof vi.fn>).mockResolvedValue(openaiFailure(503))

    const result = await router.routeTextCall({ messages })

    expect(result).toEqual({ ok: false })
    expect(openai.openaiChatText).toHaveBeenCalledTimes(1)
    expect(anthropicSdk.ctor).not.toHaveBeenCalled()
    expect(anthropicSdk.create).not.toHaveBeenCalled()
  })
})
