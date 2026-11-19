import { beforeEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"

const requireUserMock = vi.hoisted(() => vi.fn())
const managerAccessMock = vi.hoisted(() => vi.fn())
const hasAiMock = vi.hoisted(() => vi.fn())
const hasCommissionerMock = vi.hoisted(() => vi.fn())
const prepareTokenFallbackMock = vi.hoisted(() => vi.fn())
const commitTokenSpendMock = vi.hoisted(() => vi.fn())
const buildRecapMock = vi.hoisted(() => vi.fn())
const generateLinesMock = vi.hoisted(() => vi.fn())
const emitEventMock = vi.hoisted(() => vi.fn())
const getSettingsMock = vi.hoisted(() => vi.fn())
const challengeFindUniqueMock = vi.hoisted(() => vi.fn())

vi.mock("@/app/api/brackets/world-cup/_utils", () => ({
  requireWorldCupApiUser: requireUserMock,
  assertWorldCupManager: managerAccessMock,
  worldCupChallengeParamsSchema: z.object({ challengeId: z.string().min(1) }),
}))

vi.mock("@/lib/bracket-brain/bracketBrainAccess", () => ({
  userHasBracketBrainAi: hasAiMock,
}))

vi.mock("@/lib/world-cup/worldCupCommissionerAccess", () => ({
  userHasWorldCupCommissionerAccess: hasCommissionerMock,
}))

vi.mock("@/lib/world-cup/worldCupAiTokenFallback", () => ({
  WORLD_CUP_AI_TOKEN_RULES: {
    commissionerReport: "world_cup_ai_commissioner_report",
  },
  prepareWorldCupAiTokenFallback: prepareTokenFallbackMock,
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    worldCupBracketChallenge: {
      findUnique: challengeFindUniqueMock,
    },
  },
}))

vi.mock("@/lib/world-cup/worldCupCommissionerBrainService", () => ({
  buildWorldCupAiPoolRecapLines: buildRecapMock,
  generateAiWrappedLines: generateLinesMock,
  getWorldCupCommissionerBrainSnapshot: vi.fn(),
}))

vi.mock("@/lib/world-cup/worldCupBracketEventService", () => ({
  emitWorldCupBracketChatEvent: emitEventMock,
  getWorldCupCommissionerSettings: getSettingsMock,
}))

vi.mock("@/lib/world-cup/worldCupBracketSettingsService", () => ({
  isWorldCupBracketBrainEnabledForChallenge: () => true,
}))

function request(body: unknown) {
  return new Request("http://localhost/api/brackets/world-cup/c1/commissioner-brain", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("World Cup commissioner AI recap route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireUserMock.mockResolvedValue({
      ok: true,
      user: { id: "user-1", email: "owner@example.com", name: "Owner" },
    })
    managerAccessMock.mockResolvedValue({ ok: true })
    hasAiMock.mockResolvedValue(true)
    hasCommissionerMock.mockResolvedValue(true)
    commitTokenSpendMock.mockResolvedValue({ id: "ledger-commissioner-1", delta: -100 })
    prepareTokenFallbackMock.mockResolvedValue({
      ok: true,
      mode: "subscription",
      tokenPreview: null,
      commitTokenSpend: null,
    })
    challengeFindUniqueMock.mockResolvedValue({ sourcePayload: {} })
    buildRecapMock.mockResolvedValue([
      "Chimmy pool recap: Office Cup",
      "Finalized entries included: 1.",
      "Prediction and scoring complexity only.",
    ])
    generateLinesMock.mockResolvedValue(["Generated"])
    emitEventMock.mockResolvedValue({ ok: true })
    getSettingsMock.mockResolvedValue({
      enableSystemEvents: true,
      enableAiSummaries: true,
      enableUpsetAlerts: true,
      enableLeaderboardAlerts: true,
      enableChampionBustAlerts: true,
      enableLockReminders: true,
    })
  })

  it("previews a recap without posting a chat event", async () => {
    const { POST } = await import("@/app/api/brackets/world-cup/[challengeId]/commissioner-brain/route")

    const res = await POST(request({ action: "preview_recap", tone: "serious" }), { params: { challengeId: "c1" } })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toMatchObject({
      action: "preview_recap",
      posted: false,
      source: "deterministic_finalized_public",
    })
    expect(buildRecapMock).toHaveBeenCalledWith("c1", "serious")
    expect(emitEventMock).not.toHaveBeenCalled()
  })

  it("requires AF Commissioner or token confirmation for recap generation", async () => {
    hasAiMock.mockResolvedValue(false)
    hasCommissionerMock.mockResolvedValue(false)
    prepareTokenFallbackMock.mockResolvedValueOnce({
      ok: false,
      response: new Response(
        JSON.stringify({
          error: "Token spend confirmation required.",
          code: "token_confirmation_required",
          preview: { tokenCost: 100 },
        }),
        { status: 409 }
      ),
    })
    const { POST } = await import("@/app/api/brackets/world-cup/[challengeId]/commissioner-brain/route")

    const res = await POST(request({ action: "preview_recap", tone: "fun" }), { params: { challengeId: "c1" } })
    const json = await res.json()

    expect(res.status).toBe(409)
    expect(json.code).toBe("token_confirmation_required")
    expect(buildRecapMock).not.toHaveBeenCalled()
    expect(emitEventMock).not.toHaveBeenCalled()
  })

  it("returns token confirmation for drama recap users without AF Commissioner", async () => {
    hasAiMock.mockResolvedValue(false)
    hasCommissionerMock.mockResolvedValue(false)
    prepareTokenFallbackMock.mockResolvedValueOnce({
      ok: false,
      response: new Response(
        JSON.stringify({
          error: "Token spend confirmation required.",
          code: "token_confirmation_required",
          preview: { tokenCost: 100 },
        }),
        { status: 409 }
      ),
    })
    const { POST } = await import("@/app/api/brackets/world-cup/[challengeId]/commissioner-brain/route")

    const res = await POST(request({ action: "drama_recap", tone: "fun" }), { params: { challengeId: "c1" } })
    const json = await res.json()

    expect(res.status).toBe(409)
    expect(json.code).toBe("token_confirmation_required")
    expect(buildRecapMock).not.toHaveBeenCalled()
    expect(emitEventMock).not.toHaveBeenCalled()
  })

  it("posts a previewed recap as a public pool chat event", async () => {
    const lines = [
      "Chimmy pool recap: Office Cup",
      "Current leader: Finalized Entry with 20 points.",
      "Finalized entries included: 1.",
    ]
    const { POST } = await import("@/app/api/brackets/world-cup/[challengeId]/commissioner-brain/route")

    const res = await POST(request({ action: "post_recap", tone: "fun", lines }), { params: { challengeId: "c1" } })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.posted).toBe(true)
    expect(emitEventMock).toHaveBeenCalledWith(expect.objectContaining({
      challengeId: "c1",
      eventTitle: "Chimmy pool recap",
      eventBody: lines.join("\n"),
      isAiGenerated: true,
      metadata: expect.objectContaining({
        action: "post_recap",
        visibility: "public",
        messageType: "ai_recap",
        source: "deterministic_finalized_public",
      }),
    }))
  })

  it("posts a Pro drama recap as a public deterministic pool event", async () => {
    const { POST } = await import("@/app/api/brackets/world-cup/[challengeId]/commissioner-brain/route")

    const res = await POST(request({ action: "drama_recap", tone: "hype" }), { params: { challengeId: "c1" } })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toMatchObject({
      ok: true,
      action: "drama_recap",
      posted: true,
      source: "deterministic",
    })
    expect(buildRecapMock).toHaveBeenCalledWith("c1", "hype")
    expect(emitEventMock).toHaveBeenCalledWith(expect.objectContaining({
      eventTitle: "Pool Drama Report",
      metadata: expect.objectContaining({
        action: "drama_recap",
        source: "deterministic_finalized_public",
      }),
    }))
  })

  it("Generate Hype: requires manager + Pro, posts as Bracket hype message", async () => {
    generateLinesMock.mockResolvedValueOnce(["Pool is heating up — 12 brackets locked in."])
    const { POST } = await import("@/app/api/brackets/world-cup/[challengeId]/commissioner-brain/route")

    const res = await POST(request({ action: "hype" }), { params: { challengeId: "c1" } })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toMatchObject({ ok: true, action: "hype", posted: true })
    expect(generateLinesMock).toHaveBeenCalledWith("hype", "c1", expect.any(Object))
    expect(emitEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        challengeId: "c1",
        eventTitle: "Bracket hype",
        isAiGenerated: true,
        metadata: expect.objectContaining({
          action: "hype",
          visibility: "public",
          messageType: "commissioner_brain",
        }),
        force: true,
      })
    )
    // No emails or user IDs leak into the body.
    const event = emitEventMock.mock.calls[0][0] as { eventBody: string }
    expect(event.eventBody).not.toMatch(/@example\.com|user-1|owner@/i)
  })

  it("What To Watch: posts as the watch event with deterministic lines", async () => {
    generateLinesMock.mockResolvedValueOnce(["What to watch", "Argentina vs Brazil — scheduled"])
    const { POST } = await import("@/app/api/brackets/world-cup/[challengeId]/commissioner-brain/route")

    const res = await POST(request({ action: "watch" }), { params: { challengeId: "c1" } })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.action).toBe("watch")
    expect(json.posted).toBe(true)
    expect(generateLinesMock).toHaveBeenCalledWith("watch", "c1", expect.any(Object))
    expect(emitEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventTitle: "What to watch",
        eventBody: "What to watch\nArgentina vs Brazil — scheduled",
        metadata: expect.objectContaining({ action: "watch", messageType: "commissioner_brain" }),
      })
    )
  })

  it("Post Round Recap: forwards round param and posts as round-recap event", async () => {
    generateLinesMock.mockResolvedValueOnce(["round of 16 recap", "Leader: Bracket 1 (40 pts)"])
    const { POST } = await import("@/app/api/brackets/world-cup/[challengeId]/commissioner-brain/route")

    const res = await POST(
      request({ action: "recap", round: "round_of_16" }),
      { params: { challengeId: "c1" } }
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.action).toBe("recap")
    expect(generateLinesMock).toHaveBeenCalledWith(
      "recap",
      "c1",
      expect.objectContaining({ round: "round_of_16" })
    )
    expect(emitEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventTitle: "Round recap",
        metadata: expect.objectContaining({ action: "recap" }),
      })
    )
  })

  it("Summarize Standings: posts deterministic standings — does not bypass Pro gate", async () => {
    generateLinesMock.mockResolvedValueOnce(["Standings (Office Cup)", "1. Bracket 1 — 40 pts"])
    const { POST } = await import("@/app/api/brackets/world-cup/[challengeId]/commissioner-brain/route")

    const res = await POST(request({ action: "standings" }), { params: { challengeId: "c1" } })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.action).toBe("standings")
    expect(generateLinesMock).toHaveBeenCalledWith("standings", "c1", expect.any(Object))
    expect(emitEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventTitle: "Standings snapshot",
        metadata: expect.objectContaining({ action: "standings", visibility: "public" }),
      })
    )
  })

  it("blocks hype/watch/recap until token confirmation when user lacks AF Commissioner", async () => {
    hasAiMock.mockResolvedValue(false)
    hasCommissionerMock.mockResolvedValue(false)
    prepareTokenFallbackMock.mockImplementation(() =>
      Promise.resolve({
        ok: false,
        response: new Response(
          JSON.stringify({
            error: "Token spend confirmation required.",
            code: "token_confirmation_required",
            preview: { tokenCost: 100 },
          }),
          { status: 409 }
        ),
      })
    )
    const { POST } = await import("@/app/api/brackets/world-cup/[challengeId]/commissioner-brain/route")

    for (const action of ["hype", "watch", "recap", "standings"]) {
      const res = await POST(request({ action }), { params: { challengeId: "c1" } })
      const json = await res.json()
      expect(res.status).toBe(409)
      expect(json.code).toBe("token_confirmation_required")
    }
    // None of the non-AI actions should have posted to chat.
    expect(emitEventMock).not.toHaveBeenCalled()
    expect(generateLinesMock).not.toHaveBeenCalled()
  })

  it("blocks non-manager from any action (manager gate enforced before AI gate)", async () => {
    managerAccessMock.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
    })
    const { POST } = await import("@/app/api/brackets/world-cup/[challengeId]/commissioner-brain/route")

    const res = await POST(request({ action: "hype" }), { params: { challengeId: "c1" } })

    expect(res.status).toBe(403)
    // Critical: AI access check should not even run when manager gate fails first.
    expect(hasAiMock).not.toHaveBeenCalled()
    expect(generateLinesMock).not.toHaveBeenCalled()
    expect(emitEventMock).not.toHaveBeenCalled()
  })

  it("truncates extremely long AI output bodies to 4000 chars before posting", async () => {
    const longLine = "x".repeat(5000)
    generateLinesMock.mockResolvedValueOnce([longLine])
    const { POST } = await import("@/app/api/brackets/world-cup/[challengeId]/commissioner-brain/route")

    await POST(request({ action: "hype" }), { params: { challengeId: "c1" } })

    const event = emitEventMock.mock.calls[0][0] as { eventBody: string }
    expect(event.eventBody.length).toBeLessThanOrEqual(4000)
  })

  it("commits token spend only after commissioner report lines are generated", async () => {
    hasAiMock.mockResolvedValue(false)
    hasCommissionerMock.mockResolvedValue(false)
    prepareTokenFallbackMock.mockResolvedValueOnce({
      ok: true,
      mode: "tokens",
      tokenPreview: { tokenCost: 100, canSpend: true },
      commitTokenSpend: commitTokenSpendMock,
    })
    generateLinesMock.mockResolvedValueOnce(["Token-backed commissioner report"])
    const { POST } = await import("@/app/api/brackets/world-cup/[challengeId]/commissioner-brain/route")

    const res = await POST(
      request({ action: "hype", confirmTokenSpend: true }),
      { params: { challengeId: "c1" } }
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.tokenSpend).toMatchObject({ id: "ledger-commissioner-1" })
    expect(commitTokenSpendMock).toHaveBeenCalledTimes(1)
    expect(emitEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventTitle: "Bracket hype",
        eventBody: "Token-backed commissioner report",
      })
    )
  })
})
