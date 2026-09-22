import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const KEYS = vi.hoisted(() => ({
  openai: ["sk", "test", "O".repeat(40)].join("-"),
  xai: ["xai", "X".repeat(60)].join("-"),
  deepseek: ["sk", "D".repeat(32)].join("-"),
}))
const cfg = vi.hoisted(() => ({ openaiConfigured: true }))

vi.mock("@/lib/provider-config", () => ({
  getOpenAIConfigFromEnv: () =>
    cfg.openaiConfigured ? { apiKey: KEYS.openai, baseUrl: "https://openai.test/v1", model: "gpt-4o" } : null,
  getXaiConfigFromEnv: () => ({ apiKey: KEYS.xai, baseUrl: "https://xai.test/v1/", model: "grok-4.5" }),
  getDeepSeekConfigFromEnv: () => ({ apiKey: KEYS.deepseek, baseUrl: "https://deepseek.test/v1", model: "deepseek-chat" }),
}))

import { probeAiProviders, __resetAiProviderProbeForTests } from "@/lib/admin-dashboard/aiProviderEntitlementProbe"

/* The 2026-09-22 production responses, verbatim in substance. */
function respond(url: string): Response {
  if (url.startsWith("https://openai.test"))
    return new Response(`{"error":{"message":"Your account is not active","code":"billing_not_active"},"key":"${KEYS.openai}"}`, { status: 429 })
  if (url.startsWith("https://xai.test"))
    return new Response('{"code":"permission-denied","error":"Your team has either used all available credits or reached its monthly spending limit."}', { status: 403 })
  return new Response('{"choices":[{"message":{"content":"Hi"}}]}', { status: 200 })
}

const fetchMock = vi.fn(async (url: RequestInfo | URL) => respond(String(url)))

beforeEach(() => {
  fetchMock.mockClear()
  cfg.openaiConfigured = true
  __resetAiProviderProbeForTests(fetchMock as unknown as typeof fetch)
})

describe("probeAiProviders", () => {
  it("classifies each account from a REAL completion, not from a key being set", async () => {
    const byId = Object.fromEntries((await probeAiProviders()).map((r) => [r.id, r]))
    expect(byId.openai.state).toBe("billing")
    expect(byId.openai.httpStatus).toBe(429)
    /* xAI reports exhausted credits as a 403 — that is billing, not a bad key. */
    expect(byId.xai.state).toBe("billing")
    expect(byId.deepseek.state).toBe("answering")

    const [url, init] = fetchMock.mock.calls.find(([u]) => String(u).startsWith("https://xai.test"))!
    expect(String(url)).toBe("https://xai.test/v1/chat/completions")
    expect(JSON.parse(String((init as RequestInit).body)).max_tokens).toBe(1)
  })

  it("never returns a key, even when the provider echoes it", async () => {
    const out = JSON.stringify(await probeAiProviders())
    for (const key of Object.values(KEYS)) expect(out).not.toContain(key)
  })

  it("caches, so an admin page reload does not re-bill", async () => {
    await probeAiProviders()
    await probeAiProviders()
    expect(fetchMock).toHaveBeenCalledTimes(3)
    await probeAiProviders({ force: true })
    expect(fetchMock).toHaveBeenCalledTimes(6)
  })

  it("shares one probe between concurrent callers", async () => {
    await Promise.all([probeAiProviders(), probeAiProviders(), probeAiProviders()])
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it("reports an unconfigured provider as such, without calling it", async () => {
    cfg.openaiConfigured = false
    const openai = (await probeAiProviders()).find((r) => r.id === "openai")!
    expect(openai.state).toBe("not_configured")
    expect(fetchMock.mock.calls.some(([u]) => String(u).startsWith("https://openai.test"))).toBe(false)
  })

  it("reports a network failure as unreachable, never as answering", async () => {
    __resetAiProviderProbeForTests((async () => {
      throw new Error("ECONNRESET")
    }) as unknown as typeof fetch)
    const states = (await probeAiProviders()).map((r) => r.state)
    expect(states).toEqual(["unreachable", "unreachable", "unreachable"])
  })
})
