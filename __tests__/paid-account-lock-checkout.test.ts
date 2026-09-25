/**
 * A card-locked account (lib/geo/accountGeoLock → `card_paid_block`) is refused
 * by every checkout route BEFORE any Stripe call — so it never reaches a charge
 * the webhook would then have to refund. Read from the database, not the session
 * token, because a buyer refunded a minute ago can hold a token that predates it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

import { createMockNextRequest } from "@/__tests__/helpers/createMockNextRequest"

const getServerSessionMock = vi.hoisted(() => vi.fn())
const appUserFindUniqueMock = vi.hoisted(() => vi.fn())
const buildSessionMock = vi.hoisted(() => vi.fn())
const stripeSessionsCreateMock = vi.hoisted(() => vi.fn())

vi.mock("next-auth", () => ({ getServerSession: getServerSessionMock }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({
  prisma: { appUser: { findUnique: appUserFindUniqueMock } },
}))
// The IP gate is tested elsewhere; here the request is from a permitted state.
vi.mock("@/lib/geo/enforcePaidSubscriptionGeo", () => ({ enforcePaidSubscriptionGeo: vi.fn(async () => null) }))
vi.mock("@/lib/monetization/StripeCheckoutSession", () => ({ buildStripeCheckoutSessionForSku: buildSessionMock }))
vi.mock("@/lib/stripe-client", () => ({
  getStripeClient: () => ({ checkout: { sessions: { create: stripeSessionsCreateMock } } }),
}))

const IMPORTERS: Record<string, () => Promise<{ POST: (req: never) => Promise<Response> }>> = {
  "monetization/checkout/subscription": () => import("@/app/api/monetization/checkout/subscription/route"),
  "monetization/checkout/tokens": () => import("@/app/api/monetization/checkout/tokens/route"),
}

async function postTo(route: string, body: object) {
  const mod = await IMPORTERS[route]()
  const req = createMockNextRequest(`http://localhost/api/${route}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  return mod.POST(req as never)
}

const ROUTES = [
  ["monetization/checkout/subscription", { sku: "af_pro_monthly" }],
  ["monetization/checkout/tokens", { sku: "af_tokens_5" }],
] as const

describe("checkout refuses a card-locked account before Stripe", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getServerSessionMock.mockResolvedValue({ user: { id: "user-1", email: "buyer@example.com" } })
  })

  for (const [route, body] of ROUTES) {
    it(`${route}: 451 billing_address, and no checkout session is created`, async () => {
      appUserFindUniqueMock.mockResolvedValue({ stateRestrictionLevel: "card_paid_block" })
      const res = await postTo(route, body)

      expect(res.status).toBe(451)
      expect(await res.json()).toMatchObject({
        error: "PAID_GEO_BLOCKED",
        reason: "billing_address",
        redirectTo: "/paid-restricted?reason=billing",
      })
      expect(buildSessionMock).not.toHaveBeenCalled()
      expect(stripeSessionsCreateMock).not.toHaveBeenCalled()
      expect(appUserFindUniqueMock).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "user-1" } }))
    })

    it(`${route}: a Washington-locked account is refused too`, async () => {
      appUserFindUniqueMock.mockResolvedValue({ stateRestrictionLevel: "full_block" })
      const res = await postTo(route, body)
      expect(res.status).toBe(403)
      expect(buildSessionMock).not.toHaveBeenCalled()
      expect(stripeSessionsCreateMock).not.toHaveBeenCalled()
    })
  }
})

describe("the lock check does not refuse anyone else", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getServerSessionMock.mockResolvedValue({ user: { id: "user-1", email: "buyer@example.com" } })
  })

  it.each([
    ["no lock", { stateRestrictionLevel: null }],
    ["the signup flag the owner chose not to use", { stateRestrictionLevel: "paid_block" }],
  ])("passes %s through to checkout", async (_label, row) => {
    const { enforcePaidAccountLock } = await import("@/lib/geo/enforcePaidAccountLock")
    appUserFindUniqueMock.mockResolvedValue(row)
    await expect(enforcePaidAccountLock("user-1")).resolves.toBeNull()
  })

  it("fails OPEN when the lock cannot be read — the webhook's card check still stands behind it", async () => {
    const { enforcePaidAccountLock } = await import("@/lib/geo/enforcePaidAccountLock")
    appUserFindUniqueMock.mockRejectedValue(new Error("db down"))
    await expect(enforcePaidAccountLock("user-1")).resolves.toBeNull()
  })
})
