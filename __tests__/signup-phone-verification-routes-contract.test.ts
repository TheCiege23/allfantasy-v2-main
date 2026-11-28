import { beforeEach, describe, expect, it, vi } from "vitest"

const rateLimitMock = vi.hoisted(() => vi.fn(() => ({ success: true })))
const getClientIpMock = vi.hoisted(() => vi.fn(() => "127.0.0.1"))
const verificationCreateMock = vi.hoisted(() => vi.fn())
const verificationChecksCreateMock = vi.hoisted(() => vi.fn())

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: rateLimitMock,
  getClientIp: getClientIpMock,
}))

vi.mock("@/lib/twilio-client", () => ({
  getTwilioClient: async () => ({
    verify: {
      v2: {
        services: () => ({
          verifications: {
            create: verificationCreateMock,
          },
          verificationChecks: {
            create: verificationChecksCreateMock,
          },
        }),
      },
    },
  }),
}))

describe("Signup phone verification route contracts", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.TWILIO_VERIFY_SERVICE_SID = "service_sid"
  })

  it("validates phone on start route", async () => {
    const { POST } = await import("@/app/api/auth/phone/signup/start/route")
    const res = await POST(
      new Request("http://localhost/api/auth/phone/signup/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone: "" }),
      }) as any
    )
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: "MISSING_PHONE" })
  })

  it("sends sms code on start route", async () => {
    verificationCreateMock.mockResolvedValueOnce({ sid: "v-1" })
    const { POST } = await import("@/app/api/auth/phone/signup/start/route")
    const res = await POST(
      new Request("http://localhost/api/auth/phone/signup/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone: "2015550123" }), // a real NANP shape: exchange cannot start with 1 (lib/phone/smsRegion)
      }) as any
    )
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true })
    expect(verificationCreateMock).toHaveBeenCalled()
  })

  it("rejects invalid code on check route", async () => {
    verificationChecksCreateMock.mockResolvedValueOnce({ status: "pending" })
    const { POST } = await import("@/app/api/auth/phone/signup/check/route")
    const res = await POST(
      new Request("http://localhost/api/auth/phone/signup/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone: "+15551234567", code: "123456" }),
      }) as any
    )
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: "INVALID_CODE" })
  })

  it("accepts valid code on check route", async () => {
    verificationChecksCreateMock.mockResolvedValueOnce({ status: "approved" })
    const { POST } = await import("@/app/api/auth/phone/signup/check/route")
    const res = await POST(
      new Request("http://localhost/api/auth/phone/signup/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone: "+15551234567", code: "123456" }),
      }) as any
    )
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true })
  })
})
