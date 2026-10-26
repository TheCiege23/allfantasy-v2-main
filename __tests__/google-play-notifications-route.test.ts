/**
 * The Play RTDN push endpoint must refuse anything not signed by Google for our
 * configured push service account, and route verified messages to the right
 * handler.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const refresh = vi.fn(async () => "applied")
const voided = vi.fn(async () => "voided")
const jwtVerify = vi.fn()

vi.mock("jose", () => ({ createRemoteJWKSet: () => ({}), jwtVerify: (...a: unknown[]) => jwtVerify(...a) }))
vi.mock("@/lib/google-play/playDeveloperApi", () => ({
  readPlayBillingConfig: () => ({ packageName: "ai.allfantasy.app", serviceAccount: {} }),
}))
vi.mock("@/lib/monetization/googlePlayPurchases", () => ({
  GooglePlayPurchaseError: class extends Error {},
  refreshGooglePlaySubscription: refresh,
  voidGooglePlayPurchase: voided,
}))

const PUSH_SA = "rtdn-push@allfantasy-reports.iam.gserviceaccount.com"

function push(payload: unknown, auth = "Bearer good") {
  return new Request("https://allfantasy.ai/api/monetization/google/notifications", {
    method: "POST",
    headers: { authorization: auth, "content-type": "application/json" },
    body: JSON.stringify({ message: { data: Buffer.from(JSON.stringify(payload)).toString("base64") } }),
  })
}

describe("POST /api/monetization/google/notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv("GOOGLE_PLAY_RTDN_AUDIENCE", "https://allfantasy.ai/api/monetization/google/notifications")
    vi.stubEnv("GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT", PUSH_SA)
    jwtVerify.mockImplementation(async (token: string) => {
      if (token !== "good") throw new Error("bad signature")
      return { payload: { email: PUSH_SA, email_verified: true } }
    })
  })
  afterEach(() => vi.unstubAllEnvs())

  it("refuses to run at all without the push authentication settings", async () => {
    vi.stubEnv("GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT", "")
    const { POST } = await import("@/app/api/monetization/google/notifications/route")
    const res = await POST(push({ packageName: "ai.allfantasy.app" }))
    expect(res.status).toBe(503)
    expect(refresh).not.toHaveBeenCalled()
  })

  it("rejects a request without a valid Google token", async () => {
    const { POST } = await import("@/app/api/monetization/google/notifications/route")
    expect((await POST(push({}, "Bearer forged"))).status).toBe(401)
    expect((await POST(push({}, ""))).status).toBe(401)
    expect(refresh).not.toHaveBeenCalled()
  })

  it("rejects a valid Google token issued to a different service account", async () => {
    jwtVerify.mockResolvedValue({ payload: { email: "someone-else@example.iam.gserviceaccount.com", email_verified: true } })
    const { POST } = await import("@/app/api/monetization/google/notifications/route")
    expect((await POST(push({ packageName: "ai.allfantasy.app" }))).status).toBe(401)
  })

  it("routes a subscription notification to a refresh and a voided purchase to a void", async () => {
    const { POST } = await import("@/app/api/monetization/google/notifications/route")
    await POST(push({ packageName: "ai.allfantasy.app", subscriptionNotification: { notificationType: 2, purchaseToken: "s1" } }))
    expect(refresh).toHaveBeenCalledWith("s1")
    await POST(push({ packageName: "ai.allfantasy.app", voidedPurchaseNotification: { purchaseToken: "v1", productType: 2 } }))
    expect(voided).toHaveBeenCalledWith("v1")
  })

  it("acknowledges and ignores another package's notification", async () => {
    const { POST } = await import("@/app/api/monetization/google/notifications/route")
    const res = await POST(push({ packageName: "com.example.other", subscriptionNotification: { purchaseToken: "s1" } }))
    expect(res.status).toBe(200)
    expect(refresh).not.toHaveBeenCalled()
  })

  it("asks Pub/Sub to retry when processing fails unexpectedly", async () => {
    refresh.mockRejectedValueOnce(new Error("db down"))
    const { POST } = await import("@/app/api/monetization/google/notifications/route")
    const res = await POST(push({ packageName: "ai.allfantasy.app", subscriptionNotification: { purchaseToken: "s1" } }))
    expect(res.status).toBe(503)
  })
})
