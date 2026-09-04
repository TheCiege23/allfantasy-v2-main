import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const getServerSessionMock = vi.hoisted(() => vi.fn())
vi.mock("next-auth", () => ({ getServerSession: getServerSessionMock }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))

import {
  getDecisionOSTransportConfig,
  isDecisionOSConfigured,
  resolveDecisionOSAuthHeaders,
  callDecisionOS,
  type DecisionOSTransportConfig,
} from "@/lib/commissioner-ui/adapter/transport"

const ORIGINAL_ENV = { ...process.env }

function makeConfig(overrides: Partial<DecisionOSTransportConfig> = {}): DecisionOSTransportConfig {
  return { baseUrl: "https://decision-os.internal", apiKey: null, timeoutMs: 5000, ...overrides }
}

describe("commissioner-os transport — config", () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  it("reads baseUrl/apiKey/timeoutMs from the environment, defaulting timeout to 10000ms", () => {
    process.env.DECISION_OS_BASE_URL = "https://example.test"
    process.env.DECISION_OS_API_KEY = "secret"
    delete process.env.DECISION_OS_TIMEOUT_MS

    const config = getDecisionOSTransportConfig()
    expect(config.baseUrl).toBe("https://example.test")
    expect(config.apiKey).toBe("secret")
    expect(config.timeoutMs).toBe(10_000)
  })

  it("resolves baseUrl/apiKey to null when unset, and respects an explicit timeout override", () => {
    delete process.env.DECISION_OS_BASE_URL
    delete process.env.DECISION_OS_API_KEY
    process.env.DECISION_OS_TIMEOUT_MS = "3000"

    const config = getDecisionOSTransportConfig()
    expect(config.baseUrl).toBeNull()
    expect(config.apiKey).toBeNull()
    expect(config.timeoutMs).toBe(3000)
  })

  it("isDecisionOSConfigured is true only when a baseUrl is actually set", () => {
    expect(isDecisionOSConfigured(makeConfig({ baseUrl: null }))).toBe(false)
    expect(isDecisionOSConfigured(makeConfig({ baseUrl: "https://example.test" }))).toBe(true)
  })
})

describe("commissioner-os transport — auth header resolution", () => {
  beforeEach(() => {
    getServerSessionMock.mockReset()
  })

  it("prefers a configured API key over any session, as X-AllFantasy-API-Key (the ported Intelligence API gate's exact expectation)", async () => {
    const headers = await resolveDecisionOSAuthHeaders(makeConfig({ apiKey: "my-key" }))
    expect(headers).toEqual({ "X-AllFantasy-API-Key": "my-key" })
    expect(getServerSessionMock).not.toHaveBeenCalled()
  })

  it("falls back to forwarding the current session's user id when no API key is configured", async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: "user-123" } })
    const headers = await resolveDecisionOSAuthHeaders(makeConfig({ apiKey: null }))
    expect(headers).toEqual({ "X-Commissioner-User-Id": "user-123" })
  })

  it("resolves to an empty header set — never throws — when there is no API key and no session", async () => {
    getServerSessionMock.mockResolvedValue(null)
    const headers = await resolveDecisionOSAuthHeaders(makeConfig({ apiKey: null }))
    expect(headers).toEqual({})
  })

  it("resolves to an empty header set when reading the session itself throws (e.g. outside a request scope)", async () => {
    getServerSessionMock.mockRejectedValue(new Error("no request scope"))
    const headers = await resolveDecisionOSAuthHeaders(makeConfig({ apiKey: null }))
    expect(headers).toEqual({})
  })
})

describe("commissioner-os transport — callDecisionOS", () => {
  beforeEach(() => {
    getServerSessionMock.mockReset()
    getServerSessionMock.mockResolvedValue(null)
    vi.stubGlobal("fetch", vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("returns the honest not-yet-integrated placeholder, and never calls fetch, when no baseUrl is configured", async () => {
    const result = await callDecisionOS("league-health", "/health", {}, makeConfig({ baseUrl: null }))
    expect(result.data).toBeNull()
    expect(result.error).toMatchObject({ category: "upstream_unavailable", moduleId: "league-health", retryable: false })
    expect(fetch).not.toHaveBeenCalled()
  })

  it("returns real data with no error on a successful call", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ score: 91 }), { status: 200 }))
    const result = await callDecisionOS<{ score: number }>("league-health", "/health", {}, makeConfig())
    expect(result.error).toBeNull()
    expect(result.data).toEqual({ score: 91 })
  })

  it("categorizes a 401 as unauthorized and a 500 as upstream_unavailable", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ error: "nope" }), { status: 401 }))
    const unauthorized = await callDecisionOS("league-health", "/health", {}, makeConfig())
    expect(unauthorized.data).toBeNull()
    expect(unauthorized.error?.category).toBe("unauthorized")

    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ error: "boom" }), { status: 500 }))
    const serverError = await callDecisionOS("league-health", "/health", {}, makeConfig())
    expect(serverError.data).toBeNull()
    expect(serverError.error?.category).toBe("upstream_unavailable")
  })

  it("every error result is a well-formed CommissionerErrorContract carrying the caller's moduleId", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ error: "boom" }), { status: 503 }))
    const result = await callDecisionOS("activity", "/events", {}, makeConfig())
    expect(result.error).toMatchObject({ moduleId: "activity" })
    expect(typeof result.error?.message).toBe("string")
    expect(Number.isNaN(Date.parse(result.error!.timestamp))).toBe(false)
  })
})
