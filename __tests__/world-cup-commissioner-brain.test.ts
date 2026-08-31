import { beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "fs"

const challengeFindUniqueMock = vi.hoisted(() => vi.fn())

vi.mock("@/lib/prisma", () => ({
  prisma: {
    worldCupBracketChallenge: {
      findUnique: challengeFindUniqueMock,
    },
  },
}))

const resolveForUser = vi.fn()

vi.mock("@/lib/subscription/EntitlementResolver", () => ({
  EntitlementResolver: class {
    resolveForUser = resolveForUser
  },
}))

describe("Bracket Brain access path", () => {
  beforeEach(() => {
    resolveForUser.mockReset()
    challengeFindUniqueMock.mockReset()
  })

  it("exports AF Pro feature id for bracket brain", async () => {
    const { BRACKET_BRAIN_AI_FEATURE } = await import(
      "@/lib/bracket-brain/bracketBrainAccess"
    )
    expect(BRACKET_BRAIN_AI_FEATURE).toBe("league_ai_coaching")
  })

  it("userHasBracketBrainAi reads league_ai_coaching entitlement", async () => {
    resolveForUser.mockResolvedValue({
      hasAccess: true,
      message: "ok",
      entitlement: { plans: ["pro"], status: "active", currentPeriodEnd: null, gracePeriodEnd: null },
    })
    vi.resetModules()
    const { userHasBracketBrainAi } = await import(
      "@/lib/bracket-brain/bracketBrainAccess"
    )
    await expect(userHasBracketBrainAi("user-1", null)).resolves.toBe(true)
    expect(resolveForUser).toHaveBeenCalled()
    const featureArg = resolveForUser.mock.calls[0]?.[1]
    expect(featureArg).toBe("league_ai_coaching")
  })
})

describe("buildStandingsSummaryLines — finalized-only privacy filter", () => {
  beforeEach(() => {
    challengeFindUniqueMock.mockReset()
    vi.resetModules()
  })

  it("queries Prisma with isComplete:true and submittedAt:not-null filter", async () => {
    challengeFindUniqueMock.mockResolvedValue({
      id: "c1",
      name: "Office Cup",
      matches: [],
      scoringProfile: {
        roundOf32Points: 10, roundOf16Points: 20, quarterFinalPoints: 40,
        semiFinalPoints: 80, finalPoints: 160, championBonusPoints: 320, thirdPlacePoints: 4,
      },
      entries: [
        {
          id: "e-fin", name: "Alice Bracket", isComplete: true,
          submittedAt: new Date("2026-06-01T00:00:00.000Z"),
          createdAt: new Date(), updatedAt: new Date(),
          totalScore: 20, maxPossibleScore: 200, correctPicks: 2, incorrectPicks: 0,
          roundBreakdown: {}, championTeamName: "Brazil",
          participant: { id: "p1", userId: "u1", displayName: "Alice" },
          picks: [],
        },
      ],
    })

    const { buildStandingsSummaryLines } = await import("@/lib/world-cup/worldCupCommissionerBrainService")
    await buildStandingsSummaryLines("c1")

    expect(challengeFindUniqueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          entries: expect.objectContaining({
            where: { isComplete: true, submittedAt: { not: null } },
          }),
        }),
      })
    )
  })

  it("returns only the finalized entry names and scores in lines", async () => {
    // Prisma returns only the already-filtered finalized entry (the where clause
    // prevents unfinalized rows from reaching the service logic).
    challengeFindUniqueMock.mockResolvedValue({
      id: "c1",
      name: "Office Cup",
      matches: [],
      scoringProfile: {
        roundOf32Points: 10, roundOf16Points: 20, quarterFinalPoints: 40,
        semiFinalPoints: 80, finalPoints: 160, championBonusPoints: 320, thirdPlacePoints: 4,
      },
      entries: [
        {
          id: "e-fin", name: "Alice Bracket", isComplete: true,
          submittedAt: new Date("2026-06-01T00:00:00.000Z"),
          createdAt: new Date(), updatedAt: new Date(),
          totalScore: 20, maxPossibleScore: 200, correctPicks: 2, incorrectPicks: 0,
          roundBreakdown: {}, championTeamName: "Brazil",
          participant: { id: "p1", userId: "u1", displayName: "Alice" },
          picks: [],
        },
      ],
    })

    const { buildStandingsSummaryLines } = await import("@/lib/world-cup/worldCupCommissionerBrainService")
    const lines = await buildStandingsSummaryLines("c1")
    const text = lines.join("\n")

    expect(text).toContain("Standings (Office Cup)")
    expect(text).toContain("Alice Bracket")
    // Must not contain any user emails or secret identifiers
    expect(text).not.toMatch(/u1|p1|example\.com/)
  })

  it("returns a safe fallback message when no finalized entries exist", async () => {
    challengeFindUniqueMock.mockResolvedValue({
      id: "c1",
      name: "Office Cup",
      matches: [],
      scoringProfile: {
        roundOf32Points: 10, roundOf16Points: 20, quarterFinalPoints: 40,
        semiFinalPoints: 80, finalPoints: 160, championBonusPoints: 320, thirdPlacePoints: 4,
      },
      entries: [], // Prisma returned zero finalized entries
    })

    const { buildStandingsSummaryLines } = await import("@/lib/world-cup/worldCupCommissionerBrainService")
    const lines = await buildStandingsSummaryLines("c1")

    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/No finalized brackets/i)
    expect(lines[0]).toMatch(/submit/i)
  })

  it("returns empty array when challenge does not exist", async () => {
    challengeFindUniqueMock.mockResolvedValue(null)

    const { buildStandingsSummaryLines } = await import("@/lib/world-cup/worldCupCommissionerBrainService")
    const lines = await buildStandingsSummaryLines("nonexistent")

    expect(lines).toEqual([])
  })
})

describe("World Cup AI recap builder", () => {
  beforeEach(() => {
    challengeFindUniqueMock.mockReset()
  })

  it("uses finalized submitted entries only and avoids wagering language", async () => {
    challengeFindUniqueMock.mockResolvedValue({
      id: "c1",
      name: "Office Cup",
      includeThirdPlace: true,
      matches: [
        { id: "g1", round: "group", status: "final", winnerTeamId: "arg" },
        { id: "g2", round: "group", status: "scheduled", winnerTeamId: null },
        { id: "f1", round: "final", status: "scheduled", winnerTeamId: null },
      ],
      scoringProfile: {
        roundOf32Points: 10,
        roundOf16Points: 20,
        quarterFinalPoints: 40,
        semiFinalPoints: 80,
        finalPoints: 160,
        championBonusPoints: 320,
        thirdPlacePoints: 4,
      },
      entries: [
        {
          id: "entry-final",
          name: "Finalized Entry",
          createdAt: new Date("2026-05-01T00:00:00.000Z"),
          updatedAt: new Date("2026-05-02T00:00:00.000Z"),
          isComplete: true,
          submittedAt: new Date("2026-06-01T00:00:00.000Z"),
          championTeamName: "Argentina",
          totalScore: 10,
          maxPossibleScore: 100,
          correctPicks: 1,
          incorrectPicks: 0,
          roundBreakdown: {},
          participant: { id: "p1", userId: "u1", displayName: "Final User", joinedAt: new Date() },
          picks: [
            { id: "pick-1", round: "final", matchId: "f1", selectedTeamId: "arg", selectedTeamName: "Argentina", isCorrect: null, pointsAwarded: 0 },
          ],
        },
      ],
    })
    const { buildWorldCupAiPoolRecapLines } = await import("@/lib/world-cup/worldCupCommissionerBrainService")

    const lines = await buildWorldCupAiPoolRecapLines("c1", "fun")
    const text = lines.join("\n").toLowerCase()

    expect(challengeFindUniqueMock).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({
        entries: expect.objectContaining({
          where: { isComplete: true, submittedAt: { not: null } },
        }),
      }),
    }))
    expect(text).toContain("finalized entries included: 1")
    expect(text).toContain("argentina")
    expect(text).not.toContain("unfinalized")
    expect(text).not.toMatch(/\bdfs\b|\bbetting\b|\bwager|\bsportsbook\b|\bodds\b/)
  })

  it("grounds the optional OpenAI wrapper to stored pool facts only", () => {
    const source = readFileSync("lib/world-cup/worldCupCommissionerBrainService.ts", "utf8")

    expect(source).toContain("Rewrite only the provided World Cup pool facts")
    expect(source).toContain("Do not add scores, schedules, match minutes, player stats, injuries, odds, lineups, or standings")
    expect(source).toContain("Source: stored AllFantasy pool data only; no external live feed is included")
    /*
     * ⚠ PINNED TO A LOCAL VARIABLE NAME, WHICH IS NOT THE BEHAVIOUR IT MEANT TO
     * GUARD. This read `sanitizeRecapLine(text)`; the local was renamed to
     * `rawText` and the assertion went red while the sanitizing it exists to
     * protect never stopped happening — sanitizeRecapLine is applied at ten
     * sites in this file, including both model-output paths.
     *
     * Asserted as the CHAIN instead, which is the actual guarantee: whatever the
     * model returns is sanitized and then run through the validation contract
     * before it can reach a user. A future rename of the local cannot break this;
     * removing the sanitizer still does.
     */
    expect(source).toContain("sanitizeRecapLine(rawText)")
    expect(source).toContain("applyValidationPipeline(sanitized, COMMISSIONER_VALIDATION_CONTRACT)")
  })
})
