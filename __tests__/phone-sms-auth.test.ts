import { beforeEach, describe, expect, it, vi } from "vitest"
import { phoneOnlyAccountEmail, isPhoneOnlyAccountEmail } from "@/lib/auth/phoneOnlyAccountEmail"

const h = vi.hoisted(() => ({
  lookup: vi.fn(),
  send: vi.fn(),
  limit: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: { userProfile: { findUnique: h.lookup } },
}))
vi.mock("@/lib/rate-limit", () => ({
  getClientIp: () => "127.0.0.1",
}))
vi.mock("@/lib/security/sharedRateLimit", () => ({
  consumeSharedRateLimit: h.limit,
}))
vi.mock("@/lib/twilio-client", () => ({
  getTwilioClient: async () => ({
    verify: { v2: { services: () => ({ verifications: { create: h.send } }) } },
  }),
}))

function request(phone: string) {
  return new Request("http://localhost/api/auth/phone/signin/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phone }),
  })
}

describe("phone-only account identity", () => {
  it("uses a stable, reserved address without exposing the phone number", () => {
    const email = phoneOnlyAccountEmail("+15551234567")
    expect(email).toBe(phoneOnlyAccountEmail("+15551234567"))
    expect(email).toMatch(/@phone\.allfantasy\.invalid$/)
    expect(email).not.toContain("5551234567")
    expect(isPhoneOnlyAccountEmail(email)).toBe(true)
    expect(isPhoneOnlyAccountEmail("user@example.com")).toBe(false)
  })
})

describe("text-code sign-in start", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.TWILIO_VERIFY_SERVICE_SID = "service_sid"
    h.limit.mockResolvedValue({ success: true, count: 1 })
    h.send.mockResolvedValue({ sid: "verification_sid" })
  })

  it("sends only to a verified account and normalizes the number", async () => {
    h.lookup.mockResolvedValue({ phoneVerifiedAt: new Date() })
    const { POST } = await import("@/app/api/auth/phone/signin/start/route")
    const res = await POST(request("(555) 123-4567"))
    expect(res.status).toBe(200)
    expect(h.lookup).toHaveBeenCalledWith({
      where: { phone: "+15551234567" },
      select: { phoneVerifiedAt: true },
    })
    expect(h.send).toHaveBeenCalledWith({ to: "+15551234567", channel: "sms" })
  })

  it("gives the same answer for unknown and unverified numbers without texting either", async () => {
    const { POST } = await import("@/app/api/auth/phone/signin/start/route")
    h.lookup.mockResolvedValueOnce(null).mockResolvedValueOnce({ phoneVerifiedAt: null })
    const unknown = await POST(request("+15551234567"))
    const unverified = await POST(request("+15551234567"))
    expect(await unknown.json()).toEqual(await unverified.json())
    expect(h.send).not.toHaveBeenCalled()
  })

  it("spends rate limits before looking up an account", async () => {
    h.limit.mockResolvedValue({ success: false, count: 11 })
    const { POST } = await import("@/app/api/auth/phone/signin/start/route")
    const res = await POST(request("+15551234567"))
    expect(res.status).toBe(200)
    expect(h.lookup).not.toHaveBeenCalled()
    expect(h.send).not.toHaveBeenCalled()
  })

  it("rejects an invalid phone before any lookup", async () => {
    const { POST } = await import("@/app/api/auth/phone/signin/start/route")
    const res = await POST(request("bad"))
    expect(res.status).toBe(400)
    expect(h.lookup).not.toHaveBeenCalled()
  })
})

describe("phone signup code send", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.TWILIO_VERIFY_SERVICE_SID = "service_sid"
    h.limit.mockResolvedValue({ success: true, count: 1 })
    h.send.mockResolvedValue({ sid: "verification_sid" })
  })

  it("sends through Verify after spending all shared SMS budgets", async () => {
    const { POST } = await import("@/app/api/auth/phone/signup/start/route")
    const res = await POST(request("+15551234567"))
    expect(res.status).toBe(200)
    expect(h.limit).toHaveBeenCalledTimes(3)
    expect(h.send).toHaveBeenCalledWith({ to: "+15551234567", channel: "sms" })
  })

  it("does not send after any shared budget is exhausted", async () => {
    h.limit.mockResolvedValueOnce({ success: true, count: 1 })
      .mockResolvedValueOnce({ success: false, count: 11 })
      .mockResolvedValueOnce({ success: true, count: 1 })
    const { POST } = await import("@/app/api/auth/phone/signup/start/route")
    const res = await POST(request("+15551234567"))
    expect(res.status).toBe(429)
    expect(h.send).not.toHaveBeenCalled()
  })
})
