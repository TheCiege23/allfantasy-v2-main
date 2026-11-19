import { beforeEach, describe, expect, it, vi } from "vitest"

const entryFindFirstMock = vi.hoisted(() => vi.fn())
const openaiChatTextMock = vi.hoisted(() => vi.fn())

vi.mock("@/lib/prisma", () => ({
  prisma: {
    worldCupBracketEntry: {
      findFirst: entryFindFirstMock,
    },
  },
}))

vi.mock("@/lib/openai-client", () => ({
  openaiChatText: openaiChatTextMock,
}))

function makeEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: "e1",
    name: "Bracket 1",
    userId: "user-1",
    challengeId: "c1",
    championTeamId: null,
    championTeamName: null,
    challenge: {
      id: "c1",
      name: "Office Cup",
      seasonYear: 2026,
    },
    picks: [
      {
        id: "p-r32-1",
        matchId: "m-r32-1",
        round: "round_of_32",
        selectedTeamId: "team-arg",
        selectedSlotKey: "A1",
        selectedTeamName: "Argentina",
      },
      {
        id: "p-sf-1",
        matchId: "m-sf-1",
        round: "semifinal",
        selectedTeamId: "team-arg",
        selectedSlotKey: "A1",
        selectedTeamName: "Argentina",
      },
      {
        id: "p-final",
        matchId: "m-final",
        round: "final",
        selectedTeamId: "team-arg",
        selectedSlotKey: "A1",
        selectedTeamName: "Argentina",
      },
    ],
    ...overrides,
  }
}

describe("generateWorldCupBracketExplanation — ownership + privacy", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    entryFindFirstMock.mockResolvedValue(makeEntry())
    openaiChatTextMock.mockResolvedValue({
      ok: true,
      text: [
        "Bracket 1: chalk lean with Argentina as anchor.",
        "Style: balanced bracket with mainstream champion pick.",
        "Safest picks: Argentina in early rounds.",
        "Riskiest picks: minimal upset exposure.",
        "Champion path: Argentina runs through the bracket.",
        "What could go right: champion holds.",
        "What could go wrong: Argentina exits early.",
        "Recommendation: keep Argentina and finalize.",
      ].join("\n"),
      model: "gpt-4o-mini",
      baseUrl: "https://api.openai.com",
    })
  })

  it("queries Prisma filtering by id + challengeId + userId (ownership gate)", async () => {
    const { generateWorldCupBracketExplanation } = await import(
      "@/lib/world-cup/worldCupExplainBracketService"
    )

    await generateWorldCupBracketExplanation({
      challengeId: "c1",
      entryId: "e1",
      userId: "user-1",
    })

    expect(entryFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "e1", challengeId: "c1", userId: "user-1" },
      })
    )
  })

  it("returns entry_not_found when Prisma returns null (non-owner path)", async () => {
    entryFindFirstMock.mockResolvedValue(null)

    const { generateWorldCupBracketExplanation } = await import(
      "@/lib/world-cup/worldCupExplainBracketService"
    )

    const result = await generateWorldCupBracketExplanation({
      challengeId: "c1",
      entryId: "e1",
      userId: "non-owner",
    })

    expect(result).toEqual({ ok: false, reason: "entry_not_found" })
    expect(openaiChatTextMock).not.toHaveBeenCalled()
  })

  it("returns internal_error when Prisma throws", async () => {
    entryFindFirstMock.mockRejectedValue(new Error("DB unreachable"))

    const { generateWorldCupBracketExplanation } = await import(
      "@/lib/world-cup/worldCupExplainBracketService"
    )

    const result = await generateWorldCupBracketExplanation({
      challengeId: "c1",
      entryId: "e1",
      userId: "user-1",
    })

    expect(result).toEqual({ ok: false, reason: "internal_error" })
  })

  it("OpenAI prompt never contains emails or user IDs", async () => {
    const { generateWorldCupBracketExplanation } = await import(
      "@/lib/world-cup/worldCupExplainBracketService"
    )

    await generateWorldCupBracketExplanation({
      challengeId: "c1",
      entryId: "e1",
      userId: "user-1",
    })

    const call = openaiChatTextMock.mock.calls[0][0]
    const allContent = call.messages.map((m: any) => m.content).join("\n")
    expect(allContent).not.toMatch(/user-1|@example\.com|owner@/i)
    // Whitelist what we expect to see — team names + pool name only.
    expect(allContent).toContain("Argentina")
    expect(allContent).toContain("Office Cup")
  })

  it("returns generative explanation when OpenAI succeeds", async () => {
    const { generateWorldCupBracketExplanation } = await import(
      "@/lib/world-cup/worldCupExplainBracketService"
    )

    const result = await generateWorldCupBracketExplanation({
      challengeId: "c1",
      entryId: "e1",
      userId: "user-1",
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.generative).toBe(true)
    expect(result.summary).toMatch(/Bracket 1/)
    expect(result.lines.length).toBeGreaterThan(0)
    expect(result.lines.length).toBeLessThanOrEqual(8)
  })

  it("falls back to deterministic explanation when OpenAI is unavailable (missing key)", async () => {
    openaiChatTextMock.mockResolvedValue({
      ok: false,
      status: 503,
      details: "OpenAI provider unavailable. Set OPENAI_API_KEY.",
      model: "unavailable",
      baseUrl: "",
    })

    const { generateWorldCupBracketExplanation } = await import(
      "@/lib/world-cup/worldCupExplainBracketService"
    )

    const result = await generateWorldCupBracketExplanation({
      challengeId: "c1",
      entryId: "e1",
      userId: "user-1",
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.generative).toBe(false)
    // Deterministic explanation mentions champion derived from final pick.
    expect(result.summary).toMatch(/Argentina/)
    // Provider error message must not leak through to user copy.
    expect(JSON.stringify(result)).not.toMatch(/OPENAI_API_KEY|OpenAI provider/i)
    // Must surface a friendly note about deterministic fallback.
    expect(result.lines.some((l) => /Chimmy narrative is temporarily unavailable/i.test(l))).toBe(true)
  })

  it("sanitizes wagering/betting terms from AI output", async () => {
    openaiChatTextMock.mockResolvedValue({
      ok: true,
      text: "Style: chalk lean. Place your wagers carefully — sportsbook odds favor Argentina with strong betting value.",
      model: "gpt-4o-mini",
      baseUrl: "https://api.openai.com",
    })

    const { generateWorldCupBracketExplanation } = await import(
      "@/lib/world-cup/worldCupExplainBracketService"
    )

    const result = await generateWorldCupBracketExplanation({
      challengeId: "c1",
      entryId: "e1",
      userId: "user-1",
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const text = result.lines.join(" ").toLowerCase()
    expect(text).not.toMatch(/\bdfs\b|\bbetting\b|\bwager|\bsportsbook\b|\bodds\b/)
  })

  it("strips markdown table characters and truncates long lines", async () => {
    const longLine = "x".repeat(800)
    openaiChatTextMock.mockResolvedValue({
      ok: true,
      text: `| Style | description |\n${longLine}`,
      model: "gpt-4o-mini",
      baseUrl: "https://api.openai.com",
    })

    const { generateWorldCupBracketExplanation } = await import(
      "@/lib/world-cup/worldCupExplainBracketService"
    )

    const result = await generateWorldCupBracketExplanation({
      challengeId: "c1",
      entryId: "e1",
      userId: "user-1",
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    // No pipe characters in user-facing copy.
    expect(result.lines.every((l) => !l.includes("|"))).toBe(true)
    // Each line capped to 280 chars max.
    expect(result.lines.every((l) => l.length <= 280)).toBe(true)
  })

  it("does not call OpenAI when entry is not found (no wasted tokens)", async () => {
    entryFindFirstMock.mockResolvedValue(null)

    const { generateWorldCupBracketExplanation } = await import(
      "@/lib/world-cup/worldCupExplainBracketService"
    )

    await generateWorldCupBracketExplanation({
      challengeId: "c1",
      entryId: "e1",
      userId: "user-1",
    })

    expect(openaiChatTextMock).not.toHaveBeenCalled()
  })

  it("Prisma query never selects emails, hashed passwords, or sensitive participant fields", async () => {
    const { generateWorldCupBracketExplanation } = await import(
      "@/lib/world-cup/worldCupExplainBracketService"
    )

    await generateWorldCupBracketExplanation({
      challengeId: "c1",
      entryId: "e1",
      userId: "user-1",
    })

    const call = entryFindFirstMock.mock.calls[0][0]
    const callJson = JSON.stringify(call)
    // None of these should appear in select/include clauses.
    expect(callJson).not.toMatch(/email|password|hashed|session|userAgent/i)
  })
})
