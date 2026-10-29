/**
 * One answer to "is this user a paying AF Commissioner?" (lib/entitlements/afCommissionerPlan.ts).
 *
 * The playoff challenge used the TEST-ACCOUNT ALLOWLIST (`isAfCommissioner`) as if it were a plan
 * check, so a real subscriber's AF Commissioner pool options (spread / over-under / series-length
 * picks, play-in) were dropped when they created the pool and hidden from every member who viewed
 * it. These pin the shared check and the playoff paths that now use it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const resolveForUser = vi.hoisted(() => vi.fn())
vi.mock("@/lib/subscription/EntitlementResolver", () => ({
  EntitlementResolver: class {
    resolveForUser = resolveForUser
  },
}))

const challengeFindUnique = vi.hoisted(() => vi.fn())
vi.mock("@/lib/prisma", () => ({
  prisma: {
    playoffBracketChallenge: { findUnique: challengeFindUnique },
    playoffBracketEntry: { findMany: vi.fn(), create: vi.fn(), findUnique: vi.fn() },
    playoffBracketSeries: { count: vi.fn(), findUnique: vi.fn(), findMany: vi.fn().mockResolvedValue([]), createMany: vi.fn() },
    playoffBracketPick: { count: vi.fn(), findMany: vi.fn().mockResolvedValue([]), deleteMany: vi.fn(), upsert: vi.fn() },
    $transaction: vi.fn(),
  },
}))

import { hasAfCommissionerPlan } from "@/lib/entitlements/afCommissionerPlan"

const PAYING = { id: "u-paying", email: "paying@example.com", username: "payer" }
const FREE = { id: "u-free", email: "free@example.com", username: "freebie" }

beforeEach(() => {
  resolveForUser.mockReset()
  resolveForUser.mockImplementation(async (userId: string) => ({ hasAccess: userId === PAYING.id }))
  challengeFindUnique.mockReset()
})

describe("hasAfCommissionerPlan", () => {
  it("answers from the real plan, not the test-account allowlist", async () => {
    expect(await hasAfCommissionerPlan(PAYING)).toBe(true)
    expect(await hasAfCommissionerPlan(FREE)).toBe(false)
    expect(resolveForUser).toHaveBeenCalledWith("u-paying", "commissioner_ai_tools", "paying@example.com")
  })

  it("still lets AllFantasy's own test accounts in without a subscription", async () => {
    expect(await hasAfCommissionerPlan({ id: "u-test", email: "cjabar.henson@gmail.com" })).toBe(true)
    expect(resolveForUser).not.toHaveBeenCalled()
  })

  it("locks rather than grants when the plan cannot be read", async () => {
    resolveForUser.mockRejectedValue(new Error("db down"))
    expect(await hasAfCommissionerPlan(PAYING)).toBe(false)
    expect(await hasAfCommissionerPlan(null)).toBe(false)
    expect(await hasAfCommissionerPlan({ id: null })).toBe(false)
  })
})

describe("playoff challenge AF Commissioner options", () => {
  const OPTIONS = { pickSpread: true, pickOverUnder: true, pickSeriesLength: true, includePlayIn: true }

  function challengeRow(ownerUserId: string) {
    return {
      id: "c1",
      name: "Pool",
      ownerUserId,
      owner: { id: ownerUserId, displayName: "Commish", username: null },
      sport: "nba",
      isTestMode: false,
      config: OPTIONS,
      entries: [],
      series: [],
    }
  }

  it("a member WITHOUT the plan sees the options a paying owner set up", async () => {
    challengeFindUnique.mockResolvedValue(challengeRow(PAYING.id))
    const { getPlayoffBracketView } = await import("@/lib/playoffs/playoffService")
    const view = await getPlayoffBracketView({ challengeId: "c1", user: FREE as never })
    expect(view!.challenge.config).toMatchObject(OPTIONS)
  })

  it("a pool whose owner has no plan keeps none of them, whoever is looking", async () => {
    challengeFindUnique.mockResolvedValue(challengeRow(FREE.id))
    const { getPlayoffBracketView } = await import("@/lib/playoffs/playoffService")
    const view = await getPlayoffBracketView({ challengeId: "c1", user: PAYING as never })
    expect(view!.challenge.config).toMatchObject({ pickSpread: false, pickOverUnder: false, pickSeriesLength: false, includePlayIn: false })
  })
})
