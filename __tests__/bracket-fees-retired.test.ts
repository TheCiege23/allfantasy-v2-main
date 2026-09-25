/**
 * In-app bracket fees are retired (owner's decision, 2026-09-25).
 *
 * A paid bracket league used to answer 402 on copying a bracket until the member
 * bought a $2 "first bracket fee" — a fee compliance-guardrails had refused as
 * in-app league dues since 2026-03-30, and whose Stripe products never existed.
 * The gate could only ever say no. A paid league is a commissioner-run pool paid
 * outside AllFantasy; the league's own entry limit is the only cap.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

import { createMockNextRequest } from "@/__tests__/helpers/createMockNextRequest"
import { assertNoLeagueSettlementIntent, MonetizationComplianceError } from "@/lib/monetization/compliance-guardrails"

const db = vi.hoisted(() => ({
  entryFindUnique: vi.fn(),
  entryCount: vi.fn(),
  entryCreate: vi.fn(),
  pickCreateMany: vi.fn(),
  tournamentFindUnique: vi.fn(),
  paymentFindMany: vi.fn(),
}))

vi.mock("@/lib/auth-guard", () => ({ requireVerifiedUser: vi.fn(async () => ({ ok: true, userId: "user-1" })) }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    bracketEntry: { findUnique: db.entryFindUnique, count: db.entryCount, create: db.entryCreate },
    bracketPick: { createMany: db.pickCreateMany },
    bracketTournament: { findUnique: db.tournamentFindUnique },
    bracketPayment: { findMany: db.paymentFindMany },
  },
}))

function source(rules: Record<string, unknown>) {
  return {
    id: "entry-1",
    userId: "user-1",
    leagueId: "lg-1",
    name: "My bracket",
    tiebreakerPoints: null,
    picks: [{ nodeId: "n1", pickedTeamName: "Team A" }],
    league: { id: "lg-1", tournamentId: "t-1", scoringRules: rules },
  }
}

async function copy() {
  const { POST } = await import("@/app/api/bracket/entries/copy/route")
  const req = createMockNextRequest("http://localhost/api/bracket/entries/copy", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ entryId: "entry-1" }),
  })
  return POST(req as never)
}

describe("copying a bracket in a paid league", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.tournamentFindUnique.mockResolvedValue({ lockAt: null })
    db.entryCreate.mockResolvedValue({ id: "entry-2", name: "My bracket (Copy)" })
    db.pickCreateMany.mockResolvedValue({ count: 1 })
    // No payments, as in production: zero BracketPayment rows have ever existed.
    db.paymentFindMany.mockResolvedValue([])
  })

  it("is not asked for a fee — the old gate answered 402 to every member", async () => {
    db.entryFindUnique.mockResolvedValue(source({ isPaidLeague: true }))
    db.entryCount.mockResolvedValue(1)
    const res = await copy()

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, entryId: "entry-2" })
    expect(db.paymentFindMany).not.toHaveBeenCalled()
  })

  it("past three entries needs no unlock either", async () => {
    db.entryFindUnique.mockResolvedValue(source({ isPaidLeague: true, maxEntriesPerUser: 10 }))
    db.entryCount.mockResolvedValue(5)
    expect((await copy()).status).toBe(200)
  })

  it("still stops at the league's own entry limit", async () => {
    db.entryFindUnique.mockResolvedValue(source({ isPaidLeague: true, maxEntriesPerUser: 3 }))
    db.entryCount.mockResolvedValue(3)
    const res = await copy()
    expect(res.status).toBe(409)
    expect(db.entryCreate).not.toHaveBeenCalled()
  })
})

describe("the fee stays refused if anyone tries to reintroduce it", () => {
  it("compliance still classes the first-bracket fee as in-app league dues", () => {
    expect(() => assertNoLeagueSettlementIntent("first_bracket_fee")).toThrow(MonetizationComplianceError)
  })
})
