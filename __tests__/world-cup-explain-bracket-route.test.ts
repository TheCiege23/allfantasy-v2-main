import { beforeEach, describe, expect, it, vi } from "vitest"

const ownedEntryMock = vi.hoisted(() => vi.fn())
vi.mock("@/lib/prisma", () => ({ prisma: { worldCupBracketEntry: { findFirst: ownedEntryMock } } }))

const requireUserMock = vi.hoisted(() => vi.fn())
const getAdminStateMock = vi.hoisted(() => vi.fn())
const hasAiMock = vi.hoisted(() => vi.fn())
const generateMock = vi.hoisted(() => vi.fn())
const cookiesGetMock = vi.hoisted(() => vi.fn())
const prepareTokenFallbackMock = vi.hoisted(() => vi.fn())
const commitTokenSpendMock = vi.hoisted(() => vi.fn())
const checkCapMock = vi.hoisted(() => vi.fn())
const incrementCapMock = vi.hoisted(() => vi.fn())
const resolveTierMock = vi.hoisted(() => vi.fn())

vi.mock("@/app/api/brackets/world-cup/_utils", () => ({
  requireWorldCupApiUser: requireUserMock,
  getWorldCupAdminState: getAdminStateMock,
}))

vi.mock("@/lib/bracket-brain/bracketBrainAccess", () => ({
  userHasBracketBrainAi: hasAiMock,
}))

vi.mock("@/lib/world-cup/worldCupExplainBracketService", () => ({
  generateWorldCupBracketExplanation: generateMock,
}))

vi.mock("@/lib/world-cup/worldCupAiUsageLimits", () => ({
  checkWcAiCap: checkCapMock,
  incrementWcAiCap: incrementCapMock,
  resolveWcCapTier: resolveTierMock,
}))

vi.mock("@/lib/world-cup/worldCupAiTokenFallback", () => ({
  WORLD_CUP_AI_TOKEN_RULES: {
    bracketExplanation: "world_cup_ai_bracket_explanation",
  },
  prepareWorldCupAiTokenFallback: prepareTokenFallbackMock,
}))

vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    get: cookiesGetMock,
  }),
}))

function request() {
  return new Request(
    "http://localhost/api/brackets/world-cup/c1/entries/e1/explain",
    { method: "POST" }
  )
}

const params = { params: { challengeId: "c1", entryId: "e1" } }

describe("POST /api/brackets/world-cup/[challengeId]/entries/[entryId]/explain", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ownedEntryMock.mockResolvedValue({ id: "e1" })
    cookiesGetMock.mockReturnValue(undefined)
    getAdminStateMock.mockResolvedValue(false)
    resolveTierMock.mockReturnValue("pro")
    checkCapMock.mockResolvedValue({
      allowed: true,
      used: 0,
      limit: 50,
      resetsAt: new Date("2026-06-05T00:00:00.000Z"),
    })
    incrementCapMock.mockResolvedValue(undefined)
    requireUserMock.mockResolvedValue({
      ok: true,
      user: { id: "user-1", email: "owner@example.com", name: "Owner" },
    })
    hasAiMock.mockResolvedValue(true)
    commitTokenSpendMock.mockResolvedValue({ id: "ledger-explain-1", delta: -50 })
    prepareTokenFallbackMock.mockResolvedValue({
      ok: true,
      mode: "subscription",
      tokenPreview: null,
      commitTokenSpend: null,
    })
    generateMock.mockResolvedValue({
      ok: true,
      summary: "Bracket 1 is anchored around Argentina as your champion.",
      lines: [
        "Bracket 1 is anchored around Argentina as your champion.",
        "Style: chalk-leaning with one upset call.",
        "Recommendation: keep Argentina as your champion.",
      ],
      generative: true,
    })
  })

  it("returns 401 when unauthenticated", async () => {
    requireUserMock.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "UNAUTHENTICATED" }), {
        status: 401,
      }),
    })

    const { POST } = await import(
      "@/app/api/brackets/world-cup/[challengeId]/entries/[entryId]/explain/route"
    )

    const res = await POST(request() as any, params)

    expect(res.status).toBe(401)
    expect(hasAiMock).not.toHaveBeenCalled()
    expect(generateMock).not.toHaveBeenCalled()
  })

  it("returns token confirmation when user lacks AF Pro but may have tokens", async () => {
    hasAiMock.mockResolvedValue(false)
    prepareTokenFallbackMock.mockResolvedValueOnce({
      ok: false,
      response: new Response(
        JSON.stringify({
          error: "Token spend confirmation required.",
          code: "token_confirmation_required",
          preview: { tokenCost: 50 },
        }),
        { status: 409 }
      ),
    })

    const { POST } = await import(
      "@/app/api/brackets/world-cup/[challengeId]/entries/[entryId]/explain/route"
    )

    const res = await POST(request() as any, params)
    const json = await res.json()

    expect(res.status).toBe(409)
    expect(json.code).toBe("token_confirmation_required")
    expect(generateMock).not.toHaveBeenCalled()
  })

  it("returns 404 when entry is not owned by user (silent non-owner via entry_not_found)", async () => {
    generateMock.mockResolvedValue({ ok: false, reason: "entry_not_found" })

    const { POST } = await import(
      "@/app/api/brackets/world-cup/[challengeId]/entries/[entryId]/explain/route"
    )

    const res = await POST(request() as any, params)
    const json = await res.json()

    expect(res.status).toBe(404)
    expect(json.error).toMatch(/Entry not found/i)
  })

  it("returns 500 with safe friendly message on internal error (no secret/error dump)", async () => {
    generateMock.mockResolvedValue({ ok: false, reason: "internal_error" })

    const { POST } = await import(
      "@/app/api/brackets/world-cup/[challengeId]/entries/[entryId]/explain/route"
    )

    const res = await POST(request() as any, params)
    const json = await res.json()

    expect(res.status).toBe(500)
    expect(json.error).toMatch(/try again/i)
    // Critical: no provider/error details should leak through.
    expect(JSON.stringify(json)).not.toMatch(/OPENAI|stack|trace|prisma/i)
  })

  it("returns 200 with summary, lines, generative flag for Pro owner", async () => {
    const { POST } = await import(
      "@/app/api/brackets/world-cup/[challengeId]/entries/[entryId]/explain/route"
    )

    const res = await POST(request() as any, params)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(json.summary).toMatch(/Argentina/)
    expect(json.lines).toHaveLength(3)
    expect(json.generative).toBe(true)
    // Owner gate: ensure userId and locale are passed to service for the ownership check.
    expect(generateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        challengeId: "c1",
        entryId: "e1",
        userId: "user-1",
        locale: "en",
      })
    )
  })

  it("commits token spend only after a successful generative explanation", async () => {
    hasAiMock.mockResolvedValue(false)
    prepareTokenFallbackMock.mockResolvedValueOnce({
      ok: true,
      mode: "tokens",
      tokenPreview: { tokenCost: 50, canSpend: true },
      commitTokenSpend: commitTokenSpendMock,
    })

    const { POST } = await import(
      "@/app/api/brackets/world-cup/[challengeId]/entries/[entryId]/explain/route"
    )

    const res = await POST(
      new Request("http://localhost/api/brackets/world-cup/c1/entries/e1/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmTokenSpend: true }),
      }) as any,
      params
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.tokenSpend).toMatchObject({ id: "ledger-explain-1" })
    expect(commitTokenSpendMock).toHaveBeenCalledTimes(1)
  })

  it("response never contains emails or user IDs", async () => {
    const { POST } = await import(
      "@/app/api/brackets/world-cup/[challengeId]/entries/[entryId]/explain/route"
    )

    const res = await POST(request() as any, params)
    const json = await res.json()
    const responseText = JSON.stringify(json)

    expect(responseText).not.toMatch(/owner@example\.com/i)
    expect(responseText).not.toMatch(/user-1/i)
  })

  it("returns 400 when challengeId or entryId is missing from params", async () => {
    const { POST } = await import(
      "@/app/api/brackets/world-cup/[challengeId]/entries/[entryId]/explain/route"
    )

    const res = await POST(request() as any, {
      params: { challengeId: "", entryId: "e1" },
    })

    expect(res.status).toBe(400)
    expect(generateMock).not.toHaveBeenCalled()
  })

  it("forwards locale=es when af_lang cookie is 'es'", async () => {
    cookiesGetMock.mockReturnValue({ value: "es" })

    const { POST } = await import(
      "@/app/api/brackets/world-cup/[challengeId]/entries/[entryId]/explain/route"
    )

    await POST(request() as any, params)

    expect(generateMock).toHaveBeenCalledWith(
      expect.objectContaining({ locale: "es" })
    )
  })

  it("forwards locale=zh when af_lang cookie is 'zh'", async () => {
    cookiesGetMock.mockReturnValue({ value: "zh" })

    const { POST } = await import(
      "@/app/api/brackets/world-cup/[challengeId]/entries/[entryId]/explain/route"
    )

    await POST(request() as any, params)

    expect(generateMock).toHaveBeenCalledWith(
      expect.objectContaining({ locale: "zh" })
    )
  })

  it("falls back to locale=en for unknown cookie values", async () => {
    cookiesGetMock.mockReturnValue({ value: "xx" })

    const { POST } = await import(
      "@/app/api/brackets/world-cup/[challengeId]/entries/[entryId]/explain/route"
    )

    await POST(request() as any, params)

    expect(generateMock).toHaveBeenCalledWith(
      expect.objectContaining({ locale: "en" })
    )
  })
})

it('rejects a former entry owner before requesting or replaying a paid result', async () => {
 vi.clearAllMocks()
 requireUserMock.mockResolvedValue({ok:true,user:{id:'user-1',email:'owner@example.com'}})
 ownedEntryMock.mockResolvedValueOnce(null)
 const {POST}=await import('@/app/api/brackets/world-cup/[challengeId]/entries/[entryId]/explain/route')
 expect((await POST(request() as any, params)).status).toBe(404)
 expect(prepareTokenFallbackMock).not.toHaveBeenCalled()
})
