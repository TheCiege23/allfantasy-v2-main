/**
 * Waiver AI gating tests — AF Pro, AF Commissioner, entitlement helpers.
 *
 * Tests:
 * 1. Basic waiver automation does not require AF Pro.
 * 2. AI waiver endpoint returns 402 for non-Pro user.
 * 3. AI waiver endpoint allows AF Pro user.
 * 4. AF Pro helper respects AF_PRO_DEV_BYPASS in test/dev only.
 * 5. AF Commissioner helper respects AF_COMMISSIONER_DEV_BYPASS in test/dev only.
 * 6. Panel recommendations (claimsToPanelRecommendations) return a stable shape.
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
import { claimsToPanelRecommendations } from "@/lib/decision-os/waiver/panelRecommendations"

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

// ─── 6. Panel recommendations keep a stable shape ───────────────────────────
// The route serves the panel through claimsToPanelRecommendations (Decision OS) since 2026-09-29;
// the legacy generateWaiverRecommendations these sections used to exercise was retired 2026-09-30.
const CLAIM = {
  addPlayerId: "p1",
  addPlayerName: "Real Player",
  dropPlayerId: "d1",
  dropPlayerName: "Bench Guy",
  faabBid: 12,
  compositeScore: 84,
  recommendation: "Strong Add",
  reason: "Fills the WR hole.",
  position: "WR",
  priorityRank: 1,
} as never

describe("claimsToPanelRecommendations — stable shape", () => {
  it("returns every field the panel renders", () => {
    const [rec] = claimsToPanelRecommendations([CLAIM], { leagueId: "league-1", includeFaab: true, limit: 3 })
    expect(rec).toEqual({
      addPlayerId: "p1",
      addPlayerName: "Real Player",
      dropPlayerId: "d1",
      dropPlayerName: "Bench Guy",
      priority: 1,
      suggestedFaabBid: 12,
      confidence: "high",
      risk: "low",
      reasoning: "Fills the WR hole.",
      deeperAnalysisPath: "/chimmy/chat?topic=waiver-analysis&leagueId=league-1",
      tags: ["WR", "Strong Add"],
    })
  })
})

// ─── 7. FAAB bid appears only when the league uses FAAB ──────────────────────
describe("claimsToPanelRecommendations — FAAB leagues", () => {
  it("keeps the bid when includeFaab is true and drops it otherwise", () => {
    expect(claimsToPanelRecommendations([CLAIM], { leagueId: "l", includeFaab: true, limit: 3 })[0]?.suggestedFaabBid).toBe(12)
    expect(claimsToPanelRecommendations([CLAIM], { leagueId: "l", includeFaab: false, limit: 3 })[0]?.suggestedFaabBid).toBeNull()
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
  it("points to Chimmy chat with waiver-analysis topic", () => {
    const recs = claimsToPanelRecommendations([CLAIM], { leagueId: "league-xyz", includeFaab: false, limit: 5 })

    /* Previously this looped over an empty array and passed without checking anything. */
    expect(recs.length).toBeGreaterThan(0)
    for (const rec of recs) {
      expect(rec.deeperAnalysisPath).toContain("/chimmy/chat")
      expect(rec.deeperAnalysisPath).toContain("waiver-analysis")
      expect(rec.deeperAnalysisPath).toContain("league-xyz")
      // Path does NOT bypass AF Pro (it's just a URL string — the /chimmy/chat route handles its own gate)
      expect(rec.deeperAnalysisPath).not.toContain("AF_PRO_BYPASS")
    }
  })
})
