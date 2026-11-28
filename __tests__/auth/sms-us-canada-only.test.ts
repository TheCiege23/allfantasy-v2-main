/**
 * Texts go to US and Canadian numbers only (lib/phone/smsRegion) — the SMS-pumping guard. The
 * routes are driven for real with Twilio mocked, and each refusal must happen BEFORE Twilio is
 * called: a refused number that still reached `verifications.create` would still be billed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

import { isSmsAllowedNumber } from "@/lib/phone/smsRegion"

const sends = vi.hoisted(() => [] as Array<{ to: string }>)
vi.mock("@/lib/rate-limit", () => ({ rateLimit: () => ({ success: true }), getClientIp: () => "127.0.0.1" }))
vi.mock("@/lib/twilio-client", () => ({
  getTwilioClient: async () => ({
    verify: {
      v2: {
        services: () => ({
          verifications: { create: async (args: { to: string }) => (sends.push(args), { sid: "v" }) },
        }),
      },
    },
  }),
}))
vi.mock("@/lib/auth-guard", () => ({
  getSessionAndProfile: async () => ({ userId: "u1", profile: { phone: null } }),
}))
const profileUpdates = vi.hoisted(() => [] as unknown[])
vi.mock("@/lib/prisma", () => ({
  prisma: {
    userProfile: {
      findUnique: async () => null,
      update: async (args: unknown) => (profileUpdates.push(args), {}),
    },
  },
}))

const post = (url: string, body: unknown) =>
  new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })

beforeEach(() => {
  sends.length = 0
  profileUpdates.length = 0
  process.env.TWILIO_VERIFY_SERVICE_SID = "service_sid"
})

describe("isSmsAllowedNumber", () => {
  it.each([
    ["+12015550123", "New Jersey"],
    ["+14165550123", "Toronto"],
    ["+16045550123", "Vancouver"],
    ["+17875550123", "Puerto Rico (US)"],
    ["+16715550123", "Guam (US)"],
  ])("allows %s (%s)", (n) => expect(isSmsAllowedNumber(n)).toBe(true))

  it.each([
    ["+18765550123", "Jamaica — +1, but not the US or Canada"],
    ["+18095550123", "Dominican Republic"],
    ["+12425550123", "Bahamas"],
    ["+14415550123", "Bermuda"],
    ["+19005550123", "900 premium rate"],
    ["+19115550123", "N11 service code"],
    ["+447700900123", "United Kingdom"],
    ["+2348012345678", "Nigeria"],
    ["+11235550123", "area code starting with 1"],
    ["+12010550123", "exchange starting with 0"],
    ["+1201555012", "too short"],
    ["2015550123", "not E.164"],
  ])("refuses %s (%s)", (n) => expect(isSmsAllowedNumber(n)).toBe(false))
})

describe("every route that texts a code", () => {
  it("sign-up: refuses a Jamaican number before Twilio, with a message people can read", async () => {
    const { POST } = await import("@/app/api/auth/phone/signup/start/route")
    const res = await POST(post("http://localhost/api/auth/phone/signup/start", { phone: "+18765550123" }) as any)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: "PHONE_REGION_NOT_SUPPORTED",
      message: "We can only text US and Canadian phone numbers right now.",
    })
    expect(sends).toEqual([])

    const ok = await POST(post("http://localhost/api/auth/phone/signup/start", { phone: "(201) 555-0123" }) as any)
    expect(ok.status).toBe(200)
    expect(sends).toEqual([expect.objectContaining({ to: "+12015550123" })])
  })

  it("add-a-phone: refuses before the number is written to the profile or texted", async () => {
    const { POST } = await import("@/app/api/verify/phone/start/route")
    const res = await POST(post("http://localhost/api/verify/phone/start", { phone: "+447700900123", smsConsent: true }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("PHONE_REGION_NOT_SUPPORTED")
    expect(profileUpdates).toEqual([])
    expect(sends).toEqual([])
  })

  it("sign-in by text: says so for the number alone, without looking up an account", async () => {
    const { startPhoneCodeSignIn } = await import("@/lib/auth/phoneCodeSignIn")
    expect(await startPhoneCodeSignIn("+18095550123")).toEqual({ ok: false, error: "PHONE_REGION_NOT_SUPPORTED" })
    expect(sends).toEqual([])
  })
})
