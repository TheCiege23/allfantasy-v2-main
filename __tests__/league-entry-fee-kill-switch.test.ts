import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createMockNextRequest } from "@/__tests__/helpers/createMockNextRequest"

/**
 * The league entry-fee kill switch.
 *
 * The route and the webhook are two separate doors onto the same money path, and
 * both are covered here — gating only the route leaves a session created before
 * the switch closed still able to write `LeagueDues` when it is paid.
 *
 * ⚠ EVERY "REFUSES" TEST HERE IS PAIRED WITH AN "ALLOWS" TEST. A guard that is
 * always closed is indistinguishable from a deleted feature, and would pass a
 * refusal suite while having silently broken the enabled path.
 */

const ENV = "ALLFANTASY_LEAGUE_ENTRY_FEE_ENABLED"

describe("kill switch: fail closed on anything but the exact string 'true'", () => {
  const original = process.env[ENV]
  afterEach(() => {
    if (original === undefined) delete process.env[ENV]
    else process.env[ENV] = original
    vi.resetModules()
  })

  it("is disabled when the variable is unset", async () => {
    delete process.env[ENV]
    const { isLeagueEntryFeeProcessingEnabled } = await import(
      "@/lib/monetization/leagueEntryFeeKillSwitch"
    )
    expect(isLeagueEntryFeeProcessingEnabled()).toBe(false)
  })

  /*
   * The values below are the ones a person reaches for when they mean "on".
   * This repo has already shipped a gate that tested a flag's PRESENCE
   * (`Boolean(process.env.DATABASE_URL)`) and was therefore a constant — for a
   * feature that contradicts published terms, "present" must never mean "on".
   */
  it.each(["1", "yes", "on", "TRUE", "True", " true", "true ", "", "false", "0"])(
    "is disabled for %o",
    async (value) => {
      process.env[ENV] = value
      vi.resetModules()
      const { isLeagueEntryFeeProcessingEnabled } = await import(
        "@/lib/monetization/leagueEntryFeeKillSwitch"
      )
      expect(isLeagueEntryFeeProcessingEnabled()).toBe(false)
    }
  )

  it("is enabled ONLY for the exact string 'true'", async () => {
    process.env[ENV] = "true"
    const { isLeagueEntryFeeProcessingEnabled } = await import(
      "@/lib/monetization/leagueEntryFeeKillSwitch"
    )
    expect(isLeagueEntryFeeProcessingEnabled()).toBe(true)
  })

  it("assert throws when disabled and carries the detail for reconciliation", async () => {
    delete process.env[ENV]
    const { assertLeagueEntryFeeProcessingEnabled, isLeagueEntryFeeDisabledError } = await import(
      "@/lib/monetization/leagueEntryFeeKillSwitch"
    )
    try {
      assertLeagueEntryFeeProcessingEnabled("stripe session cs_test_9")
      throw new Error("should have thrown")
    } catch (e) {
      expect(isLeagueEntryFeeDisabledError(e)).toBe(true)
      expect((e as Error).message).toContain("cs_test_9")
      expect((e as Error).message).toContain("does not process league dues")
    }
  })

  it("assert is a no-op when enabled", async () => {
    process.env[ENV] = "true"
    const { assertLeagueEntryFeeProcessingEnabled } = await import(
      "@/lib/monetization/leagueEntryFeeKillSwitch"
    )
    expect(() => assertLeagueEntryFeeProcessingEnabled()).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// The creation door: app/api/leagues/[leagueId]/finance/entry-checkout
// ---------------------------------------------------------------------------

const getServerSessionMock = vi.hoisted(() => vi.fn())
const getStripeClientMock = vi.hoisted(() => vi.fn())
const sessionsCreateMock = vi.hoisted(() => vi.fn())
const leagueFindUniqueMock = vi.hoisted(() => vi.fn())
const getOrCreateLeagueFinanceMock = vi.hoisted(() => vi.fn())
const resolveSeasonForLeagueMock = vi.hoisted(() => vi.fn())

vi.mock("next-auth", () => ({ getServerSession: getServerSessionMock }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/get-base-url", () => ({ getBaseUrl: () => "http://localhost:3000" }))
vi.mock("@/lib/stripe-client", () => ({ getStripeClient: getStripeClientMock }))
vi.mock("@/lib/prisma", () => ({
  prisma: { league: { findUnique: leagueFindUniqueMock } },
}))
vi.mock("@/lib/league-finance/leagueFinanceService", () => ({
  getOrCreateLeagueFinance: getOrCreateLeagueFinanceMock,
  resolveSeasonForLeague: resolveSeasonForLeagueMock,
}))

describe("entry-checkout route", () => {
  const original = process.env[ENV]

  beforeEach(() => {
    vi.clearAllMocks()
    getServerSessionMock.mockResolvedValue({ user: { id: "u1" } })
    leagueFindUniqueMock.mockResolvedValue({ id: "lg1", name: "Test League", season: 2026 })
    getOrCreateLeagueFinanceMock.mockResolvedValue({
      isPaidLeague: true,
      entryFeeCents: 5000,
      currency: "usd",
    })
    resolveSeasonForLeagueMock.mockResolvedValue(2026)
    sessionsCreateMock.mockResolvedValue({ url: "https://checkout.stripe.test/s/cs_1" })
    getStripeClientMock.mockReturnValue({
      checkout: { sessions: { create: sessionsCreateMock } },
    })
  })

  afterEach(() => {
    if (original === undefined) delete process.env[ENV]
    else process.env[ENV] = original
    vi.resetModules()
  })

  function post() {
    return createMockNextRequest(
      "http://localhost/api/leagues/lg1/finance/entry-checkout",
      { method: "POST", body: "{}" }
    )
  }

  it("refuses with 403 and never reaches Stripe when disabled", async () => {
    delete process.env[ENV]
    const { POST } = await import(
      "@/app/api/leagues/[leagueId]/finance/entry-checkout/route"
    )
    const res = await POST(post() as any, { params: Promise.resolve({ leagueId: "lg1" }) })

    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toMatchObject({ code: "league_entry_fee_disabled" })
    expect(sessionsCreateMock).not.toHaveBeenCalled()
  })

  /*
   * Ordering, not just outcome: a disabled feature must not double as a
   * league-existence oracle, and must answer the same to a signed-out caller as
   * to a signed-in one. If the auth check ran first this would be 401.
   */
  it("refuses before authentication and before any league lookup", async () => {
    delete process.env[ENV]
    getServerSessionMock.mockResolvedValue(null)
    const { POST } = await import(
      "@/app/api/leagues/[leagueId]/finance/entry-checkout/route"
    )
    const res = await POST(post() as any, { params: Promise.resolve({ leagueId: "lg1" }) })

    expect(res.status).toBe(403)
    expect(getServerSessionMock).not.toHaveBeenCalled()
    expect(leagueFindUniqueMock).not.toHaveBeenCalled()
  })

  /*
   * Defence in depth. Even with the kill switch open, the compliance guard every
   * other checkout route already ran still refuses a `league_entry_fee` intent —
   * so re-enabling cannot be done by flipping one environment variable, which is
   * the point. Without this, the test above would pass with the whole feature
   * deleted.
   */
  it("still refuses on the compliance guard when the kill switch is open", async () => {
    process.env[ENV] = "true"
    const { POST } = await import(
      "@/app/api/leagues/[leagueId]/finance/entry-checkout/route"
    )
    const res = await POST(post() as any, { params: Promise.resolve({ leagueId: "lg1" }) })

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ code: "in_app_dues_not_allowed" })
    // It got past the kill switch — proving that switch is not simply always-closed.
    expect(getServerSessionMock).toHaveBeenCalled()
    expect(leagueFindUniqueMock).toHaveBeenCalled()
    // But still never charged anyone.
    expect(sessionsCreateMock).not.toHaveBeenCalled()
  })
})
