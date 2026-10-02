// @vitest-environment node
/** /api/push/test — "Send a test" on the Game-day alerts card. */
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  subs: vi.fn(),
  send: vi.fn(),
  allowed: { value: true },
}))
vi.mock("next-auth", () => ({ getServerSession: mocks.session }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/rate-limit", () => ({ rateLimit: () => ({ success: mocks.allowed.value, remaining: 0 }) }))
vi.mock("@/lib/push-notifications", () => ({ getPushSubscriptions: mocks.subs, sendPushToUser: mocks.send }))

import { POST } from "@/app/api/push/test/route"
import { buildTestPush, explainPushFailure } from "@/lib/push-notifications/testPush"
import { verifyTradeCard } from "@/lib/push-notifications/tradeCard"

const IPHONE = { id: "s-ios", userId: "u1", endpoint: `apns:${"a".repeat(64)}`, p256dh: "", auth: "", createdAt: new Date() }
const BROWSER = { id: "s-web", userId: "u1", endpoint: "https://fcm.googleapis.com/x", p256dh: "k", auth: "a", createdAt: new Date() }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.allowed.value = true
  mocks.session.mockResolvedValue({ user: { id: "u1" } })
  mocks.subs.mockResolvedValue([IPHONE])
})

describe("/api/push/test", () => {
  it("sends the sample to the signed-in user and reports the iPhone as delivered", async () => {
    mocks.send.mockResolvedValue([{ ok: true, subscriptionId: "s-ios" }])
    const res = await POST()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, sent: 1, failed: 0, devices: [{ kind: "iphone", ok: true }] })
    expect(mocks.send).toHaveBeenCalledWith("u1", expect.objectContaining({ type: "test_push", tag: "af-test-push" }))
  })

  it("refuses a signed-out request and sends nothing", async () => {
    mocks.session.mockResolvedValue(null)
    expect((await POST()).status).toBe(401)
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it("says so when no device has alerts on, instead of reporting success for zero sends", async () => {
    mocks.subs.mockResolvedValue([])
    const res = await POST()
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe("NO_DEVICES")
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it("is rate limited", async () => {
    mocks.allowed.value = false
    expect((await POST()).status).toBe(429)
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it("names a key restricted to the wrong Apple environment — the failure that looks like silence", async () => {
    mocks.send.mockResolvedValue([{ ok: false, error: "APNs 403 BadEnvironmentKeyInToken", subscriptionId: "s-ios" }])
    const body = await (await POST()).json()
    expect(body.ok).toBe(false)
    expect(body.devices[0]).toMatchObject({ kind: "iphone", ok: false, code: "APNs 403 BadEnvironmentKeyInToken" })
    expect(body.devices[0].hint).toMatch(/Production/)
  })

  it("labels each device by its own kind when one works and one does not", async () => {
    mocks.subs.mockResolvedValue([IPHONE, BROWSER])
    mocks.send.mockResolvedValue([
      { ok: false, error: "APNs 403 InvalidProviderToken", subscriptionId: "s-ios" },
      { ok: true, subscriptionId: "s-web" },
    ])
    const body = await (await POST()).json()
    expect(body).toMatchObject({ ok: true, sent: 1, failed: 1 })
    expect(body.devices).toEqual([
      expect.objectContaining({ kind: "iphone", ok: false, code: "APNs 403 InvalidProviderToken" }),
      { kind: "browser", ok: true },
    ])
  })

  it("never echoes a raw exception to the client", async () => {
    mocks.send.mockResolvedValue([
      { ok: false, error: "APNs key unusable: Error: secretish -----BEGIN PRIVATE KEY----- abc", subscriptionId: "s-ios" },
      { ok: false, error: "APNs Error: connect ECONNREFUSED 10.0.0.1:443", subscriptionId: "s-ios" },
    ])
    const text = JSON.stringify(await (await POST()).json())
    expect(text).not.toMatch(/BEGIN PRIVATE KEY|secretish|ECONNREFUSED|10\.0\.0\.1/)
    expect(text).toContain('"code":"APNs key unusable"')
  })
})

describe("the sample alert", () => {
  it("carries a signed trade card the card route will accept", () => {
    const env = { NEXTAUTH_SECRET: "test-secret-for-push-card" }
    const payload = buildTestPush(env)
    expect(payload.href).toBe("/core/notifications")
    const url = new URL(payload.imageUrl!, "https://www.allfantasy.ai")
    expect(url.pathname).toBe("/api/push-card/trade")
    const verified = verifyTradeCard(url.searchParams.get("d"), url.searchParams.get("s"), env)
    expect(verified.ok).toBe(true)
  })

  it("still goes out as text when there is no signing key", () => {
    expect(buildTestPush({}).imageUrl).toBeNull()
  })

  it("keeps an unrecognised error generic", () => {
    expect(explainPushFailure("browser", "weird thing")).toEqual({
      kind: "browser",
      ok: false,
      code: undefined,
      hint: "Delivery failed. Try again in a minute.",
    })
  })
})
