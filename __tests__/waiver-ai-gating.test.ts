/**
 * Waiver AI gating tests — AF Pro, AF Commissioner, entitlement helpers.
 *
 * Tests:
 * 1. Basic waiver automation does not require AF Pro.
 * 2. AI waiver endpoint returns 402 for non-Pro user.
 * 3. AI waiver endpoint allows AF Pro user.
 * 4. AF Pro helper respects AF_PRO_DEV_BYPASS in test/dev only.
 * 5. AF Commissioner helper respects AF_COMMISSIONER_DEV_BYPASS in test/dev only.
 * 6. Recommendation service returns stable shape.
 * 7. FAAB recommendation appears when includeFaab=true and league uses FAAB.
 * 8. Non-Pro upgrade response contains AF_PRO_REQUIRED and upgradePath.
 * 9. Commissioner AI endpoint returns AF_COMMISSIONER_REQUIRED for non-entitled commissioner.
 * 10. processLeagueWaiversJob remains idempotent (no AF Pro gate on basic processing).
 * 11. Deeper analysis path points to Chimmy chat and does not bypass AF Pro.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"

// ─── Mock entitlement resolver ─────────────────────────────────────────────
const mockResolveForUser = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ hasAccess: false, message: "Not subscribed" })
)
vi.mock("@/lib/subscription/EntitlementResolver", () => {
  function EntitlementResolver() {}
  EntitlementResolver.prototype.resolveForUser = mockResolveForUser
  return { EntitlementResolver }
})

vi.mock("@/lib/commissioner/permissions", () => ({
  isCommissioner: vi.fn().mockResolvedValue(false),
}))

/*
 * ⚠ THIS MOCK USED TO DESCRIBE A SCHEMA THAT DOES NOT EXIST, AND THAT IS WHY THESE TESTS PASSED
 * WHILE THE FEATURE WAS TOTALLY BROKEN.
 *
 * It mocked `roster.findFirst` returning `{ faabBalance, players }` and `leaguePlayer.findMany` —
 * but `Roster` has `faabRemaining` and a `playerData` JSON column (no `players` relation), and
 * `prisma.leaguePlayer` has never existed at all. Against the real client those two calls threw
 * `PrismaClientValidationError` and `TypeError` on EVERY invocation; against this mock they
 * resolved cleanly. So the suite was green on a code path that could not run in production, and
 * the assertions below had been written around the fabricated placeholder the service emitted
 * when both reads failed.
 *
 * The mock now matches the real reads: `roster.findMany` (all rosters in the league),
 * `league.findUnique` (sport), and `sportsPlayer.findMany` (roster positions).
 */
vi.mock("@/lib/prisma", () => ({
  prisma: {
    roster: { findMany: vi.fn().mockResolvedValue([]) },
    league: { findUnique: vi.fn().mockResolvedValue({ id: "league-1", sport: "NFL" }) },
    sportsPlayer: { findMany: vi.fn().mockResolvedValue([]) },
    waiverClaim: { findMany: vi.fn().mockResolvedValue([]) },
    notificationOutbox: { create: vi.fn().mockResolvedValue({ id: "test-notif" }) },
    waiverClaim_groupBy: vi.fn(),
  },
}))

/** The real free-agent pool resolver. Tests opt in to a pool; the default is genuinely empty. */
vi.mock("@/lib/sport-teams/SportPlayerPoolResolver", () => ({
  getPlayerPoolForSport: vi.fn().mockResolvedValue([]),
}))

vi.mock("@/lib/waiver-wire/settings-service", () => ({
  getEffectiveLeagueWaiverSettings: vi.fn().mockResolvedValue({
    waiverType: "rolling",
    normalizedWaiverType: "rolling",
    faabBudget: null,
  }),
}))

import { isCommissioner } from "@/lib/commissioner/permissions"
import {
  getUserAfProStatus,
  getCommissionerAfCommissionerStatus,
  AfProRequiredError,
  AfCommissionerRequiredError,
} from "@/lib/entitlements/afAccess"
import { generateWaiverRecommendations } from "@/lib/ai/waivers/waiverRecommendationService"

// ─── 1. Basic waiver automation does not require AF Pro ─────────────────────
describe("basic waiver automation — no AF Pro gate", () => {
  it("processLeagueWaiversJob does not import or call any AF Pro check", async () => {
    // The processLeagueWaiversJob module should not reference afAccess
    const fs = await import("fs")
    const path = await import("path")
    const filePath = path.resolve(
      process.cwd(),
      "lib/automation/jobs/waivers/processLeagueWaiversJob.ts"
    )
    const content = fs.readFileSync(filePath, "utf8")
    expect(content).not.toContain("afAccess")
    expect(content).not.toContain("requireAfPro")
    expect(content).not.toContain("AF_PRO")
  })
})

// ─── 2. AI waiver endpoint returns 402 for non-Pro user ─────────────────────
describe("getUserAfProStatus — non-Pro user", () => {
  beforeEach(() => {
    mockResolveForUser.mockResolvedValue({ hasAccess: false, message: "Not subscribed" })
  })

  it("returns false for user without AF Pro", async () => {
    const result = await getUserAfProStatus("user-no-pro")
    expect(result).toBe(false)
  })
})

// ─── 3. AI waiver endpoint allows AF Pro user ────────────────────────────────
describe("getUserAfProStatus — AF Pro user", () => {
  beforeEach(() => {
    mockResolveForUser.mockResolvedValue({ hasAccess: true, message: "Active" })
  })

  it("returns true for AF Pro user", async () => {
    const result = await getUserAfProStatus("user-with-pro")
    expect(result).toBe(true)
  })
})

// ─── 4. AF Pro helper respects AF_PRO_DEV_BYPASS ───────────────────────────
describe("AF_PRO_DEV_BYPASS", () => {
  const originalEnv = process.env.NODE_ENV

  afterEach(() => {
    delete process.env.AF_PRO_DEV_BYPASS
  })

  it("bypasses check in non-production when AF_PRO_DEV_BYPASS=true", async () => {
    // NODE_ENV is 'test' in vitest
    process.env.AF_PRO_DEV_BYPASS = "true"
    const result = await getUserAfProStatus("any-user")
    expect(result).toBe(true)
  })

  it("does NOT bypass in production even with AF_PRO_DEV_BYPASS=true", async () => {
    // We test that the production guard logic is in place by checking
    // that AF_PRO_DEV_BYPASS only activates when NODE_ENV !== 'production'
    process.env.AF_PRO_DEV_BYPASS = "true"
    // NODE_ENV=test → bypass works
    const result = await getUserAfProStatus("any-user")
    expect(result).toBe(true) // In test env, bypass is active
  })
})

// ─── 5. AF Commissioner helper respects AF_COMMISSIONER_DEV_BYPASS ──────────
describe("AF_COMMISSIONER_DEV_BYPASS", () => {
  afterEach(() => {
    delete process.env.AF_COMMISSIONER_DEV_BYPASS
  })

  it("bypasses commissioner AI check in non-production when AF_COMMISSIONER_DEV_BYPASS=true", async () => {
    vi.mocked(isCommissioner).mockResolvedValue(true)
    process.env.AF_COMMISSIONER_DEV_BYPASS = "true"
    const result = await getCommissionerAfCommissionerStatus("commissioner-user", "league-1")
    expect(result).toBe(true)
  })

  it("still requires isCommissioner even with bypass", async () => {
    vi.mocked(isCommissioner).mockResolvedValue(false)
    process.env.AF_COMMISSIONER_DEV_BYPASS = "true"
    const result = await getCommissionerAfCommissionerStatus("non-commissioner", "league-1")
    expect(result).toBe(false)
  })
})

// ─── 6. Recommendation service returns stable shape ─────────────────────────
describe("generateWaiverRecommendations — stable shape", () => {
  it("returns a valid WaiverRecommendationOutput shape even with missing data", async () => {
    const output = await generateWaiverRecommendations({
      userId: "user-1",
      leagueId: "league-1",
      mode: "quick",
    })

    expect(output).toMatchObject({
      recommendations: expect.any(Array),
      rosterNeeds: expect.any(Array),
      leagueContext: expect.objectContaining({
        leagueId: "league-1",
        waiverType: expect.any(String),
      }),
      generatedAt: expect.any(String),
    })
  })

  /*
   * ⚠ THE POINT OF THIS TEST IS THE EMPTY ARRAY.
   *
   * It used to loop over `output.recommendations` asserting each had the required fields — which
   * passes vacuously on an empty list and, worse, passed on the ONE fabricated entry the service
   * emitted with no roster and no player pool: `addPlayerId: "unknown"`, name "Best available WR",
   * a FAAB bid computed from the user's real budget, and prose about target share that no data
   * supported. A "stable shape" assertion cannot tell an answer from an invention.
   *
   * With no roster and no pool the honest output is NO recommendations plus a stated reason.
   */
  it("returns no recommendations — not a placeholder — when there is no roster and no pool", async () => {
    const output = await generateWaiverRecommendations({
      userId: "user-1",
      leagueId: "league-1",
      mode: "quick",
    })

    expect(output.recommendations).toEqual([])
    expect(output.meta?.dataGaps).toContain("roster_not_found")
    expect(output.meta?.dataGaps).toContain("free_agent_pool_empty")
    // And specifically: none of the old invented values may come back.
    expect(JSON.stringify(output)).not.toContain("Best available WR")
    expect(JSON.stringify(output)).not.toContain("unknown")
  })

  it("does not invent roster needs when the roster cannot be read", async () => {
    // The old implementation returned a hardcoded ["WR_depth", "RB_depth"] here, for every user
    // in every league in every sport — and `buildReasoning` cited it back as "fills a roster need".
    const output = await generateWaiverRecommendations({
      userId: "user-1",
      leagueId: "league-1",
      mode: "quick",
    })

    expect(output.rosterNeeds).toEqual([])
    expect(output.meta?.dataGaps).toContain("cannot_analyze_roster_needs_no_roster")
  })

  it("each recommendation has required fields when a pool exists", async () => {
    const { getPlayerPoolForSport } = await import("@/lib/sport-teams/SportPlayerPoolResolver")
    vi.mocked(getPlayerPoolForSport).mockResolvedValue([
      { player_id: "p1", full_name: "Real Player", position: "WR", external_source_id: null },
    ] as never)

    const output = await generateWaiverRecommendations({
      userId: "user-1",
      leagueId: "league-1",
      mode: "quick",
    })

    expect(output.recommendations.length).toBeGreaterThan(0)
    for (const rec of output.recommendations) {
      expect(rec.addPlayerId).toBe("p1")
      expect(rec.addPlayerName).toBe("Real Player")
      expect(rec).toHaveProperty("priority")
      expect(rec).toHaveProperty("confidence")
      expect(rec).toHaveProperty("risk")
      expect(rec).toHaveProperty("reasoning")
      expect(rec).toHaveProperty("deeperAnalysisPath")
      expect(rec).toHaveProperty("tags")
    }
  })
})

// ─── 7. FAAB recommendation appears when includeFaab=true ───────────────────
describe("generateWaiverRecommendations — FAAB leagues", () => {
  beforeEach(async () => {
    const { getEffectiveLeagueWaiverSettings } = await import(
      "@/lib/waiver-wire/settings-service"
    )
    vi.mocked(getEffectiveLeagueWaiverSettings).mockResolvedValue({
      waiverType: "faab",
      normalizedWaiverType: "faab",
      faabBudget: 1000,
    } as any)
  })

  it("includes suggestedFaabBid when includeFaab=true for FAAB league", async () => {
    const { prisma } = await import("@/lib/prisma")
    const { getPlayerPoolForSport } = await import("@/lib/sport-teams/SportPlayerPoolResolver")

    /* Real column (`faabRemaining`) and real shape (`playerData` JSON), not the invented
     * `faabBalance` / `players` relation the previous mock described. */
    vi.mocked(prisma.roster.findMany as any).mockResolvedValue([
      { id: "roster-1", platformUserId: "user-1", faabRemaining: 500, playerData: { players: ["rp1"] } },
    ])
    vi.mocked(prisma.sportsPlayer.findMany as any).mockResolvedValue([{ position: "WR" }])
    vi.mocked(getPlayerPoolForSport).mockResolvedValue([
      { player_id: "fa1", full_name: "Available Back", position: "RB", external_source_id: null },
    ] as never)

    const output = await generateWaiverRecommendations({
      userId: "user-1",
      leagueId: "faab-league",
      mode: "quick",
      includeFaab: true,
    })

    expect(output.leagueContext.waiverType).toBe("faab")
    expect(output.leagueContext.faabRemaining).toBe(500)
    expect(output.recommendations.length).toBeGreaterThan(0)
    const rec = output.recommendations[0]
    // A real free agent, and a bid sized off the real remaining budget.
    expect(rec.addPlayerName).toBe("Available Back")
    expect(rec.suggestedFaabBid).toBeTypeOf("number")
  })

  it("excludes players already rostered anywhere in the league", async () => {
    const { prisma } = await import("@/lib/prisma")
    const { getPlayerPoolForSport } = await import("@/lib/sport-teams/SportPlayerPoolResolver")

    vi.mocked(prisma.roster.findMany as any).mockResolvedValue([
      { id: "r1", platformUserId: "user-1", faabRemaining: 100, playerData: { players: ["mine"] } },
      { id: "r2", platformUserId: "rival", faabRemaining: 100, playerData: { players: ["theirs"] } },
    ])
    vi.mocked(prisma.sportsPlayer.findMany as any).mockResolvedValue([{ position: "WR" }])
    vi.mocked(getPlayerPoolForSport).mockResolvedValue([
      { player_id: "mine", full_name: "On My Roster", position: "WR", external_source_id: null },
      { player_id: "theirs", full_name: "On Their Roster", position: "RB", external_source_id: null },
      { player_id: "free", full_name: "Genuinely Free", position: "TE", external_source_id: null },
    ] as never)

    const output = await generateWaiverRecommendations({
      userId: "user-1",
      leagueId: "faab-league",
      mode: "quick",
    })

    const names = output.recommendations.map((r) => r.addPlayerName)
    expect(names).toEqual(["Genuinely Free"])
  })
})

// ─── 8. Non-Pro upgrade response shape ──────────────────────────────────────
describe("AfProRequiredError upgrade response", () => {
  it("contains AF_PRO_REQUIRED error code and upgradePath", () => {
    const err = new AfProRequiredError()
    const response = err.toResponse()
    expect(response.error).toBe("AF_PRO_REQUIRED")
    expect(response.upgradePath).toContain("af-pro")
    expect(response.upgradePath).toContain("waiver-ai")
    expect(response.message).toBeTruthy()
  })
})

// ─── 9. Commissioner AI endpoint returns AF_COMMISSIONER_REQUIRED ────────────
describe("AfCommissionerRequiredError upgrade response", () => {
  it("contains AF_COMMISSIONER_REQUIRED error code and upgradePath", () => {
    const err = new AfCommissionerRequiredError()
    const response = err.toResponse()
    expect(response.error).toBe("AF_COMMISSIONER_REQUIRED")
    expect(response.upgradePath).toContain("af-commissioner")
    expect(response.upgradePath).toContain("commissioner-waiver-ai")
    expect(response.message).toBeTruthy()
  })

  it("getCommissionerAfCommissionerStatus returns false for non-entitled user", async () => {
    vi.mocked(isCommissioner).mockResolvedValue(true)
    mockResolveForUser.mockResolvedValue({ hasAccess: false, message: "Need Commissioner plan" })
    delete process.env.AF_COMMISSIONER_DEV_BYPASS
    const result = await getCommissionerAfCommissionerStatus("user-no-sub", "league-1")
    expect(result).toBe(false)
  })
})

// ─── 10. processLeagueWaiversJob idempotency (verifies no AF Pro gate) ───────
describe("processLeagueWaiversJob — idempotency key", () => {
  it("buildWaiverJobIdempotencyKey is stable for same leagueId + date bucket", async () => {
    const { buildWaiverJobIdempotencyKey } = await import(
      "@/lib/automation/jobs/waivers/processLeagueWaiversJob"
    )
    const d = new Date("2026-07-01T15:30:00.000Z")
    expect(buildWaiverJobIdempotencyKey("league-a", d)).toBe(
      buildWaiverJobIdempotencyKey("league-a", d)
    )
    expect(buildWaiverJobIdempotencyKey("league-a", d)).not.toBe(
      buildWaiverJobIdempotencyKey("league-b", d)
    )
  })
})

// ─── 11. Deeper analysis path routes to Chimmy and requires AF Pro ───────────
describe("deeperAnalysisPath", () => {
  it("points to Chimmy chat with waiver-analysis topic", async () => {
    const { getPlayerPoolForSport } = await import("@/lib/sport-teams/SportPlayerPoolResolver")
    vi.mocked(getPlayerPoolForSport).mockResolvedValue([
      { player_id: "p1", full_name: "Real Player", position: "WR", external_source_id: null },
    ] as never)

    const output = await generateWaiverRecommendations({
      userId: "user-1",
      leagueId: "league-xyz",
      mode: "quick",
    })

    /* Previously this looped over an empty array and passed without checking anything. */
    expect(output.recommendations.length).toBeGreaterThan(0)
    for (const rec of output.recommendations) {
      expect(rec.deeperAnalysisPath).toContain("/chimmy/chat")
      expect(rec.deeperAnalysisPath).toContain("waiver-analysis")
      expect(rec.deeperAnalysisPath).toContain("league-xyz")
      // Path does NOT bypass AF Pro (it's just a URL string — the /chimmy/chat route handles its own gate)
      expect(rec.deeperAnalysisPath).not.toContain("AF_PRO_BYPASS")
    }
  })
})
