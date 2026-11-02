import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  profile: vi.fn(),
  user: vi.fn(),
  limit: vi.fn(),
  check: vi.fn(),
  restriction: vi.fn(),
}))

vi.mock("next-auth/providers/credentials", () => ({
  default: (options: unknown) => options,
}))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    userProfile: { findUnique: h.profile },
    appUser: { findUnique: h.user },
  },
}))
vi.mock("@/lib/security/sharedRateLimit", () => ({
  consumeSharedRateLimit: h.limit,
}))
vi.mock("@/lib/moderation/accountSuspension", () => ({
  activeAccountRestriction: h.restriction,
  ACCOUNT_SUSPENDED_ERROR: "ACCOUNT_SUSPENDED",
}))
vi.mock("@/lib/twilio-client", () => ({
  getTwilioClient: async () => ({
    verify: { v2: { services: () => ({ verificationChecks: { create: h.check } }) } },
  }),
}))

import { phoneOtpProvider } from "@/lib/auth/phoneOtpProvider"

const authorize = (phoneOtpProvider as unknown as {
  authorize: (credentials: { phone: string; code: string }) => Promise<{ id: string; email: string | null } | null>
}).authorize

beforeEach(() => {
  vi.clearAllMocks()
  process.env.TWILIO_VERIFY_SERVICE_SID = "service_sid"
  h.limit.mockResolvedValue({ success: true, count: 1 })
  h.profile.mockResolvedValue({ userId: "user-1", phoneVerifiedAt: new Date() })
  h.user.mockResolvedValue({
    id: "user-1",
    email: "phone-abc@phone.allfantasy.invalid",
    username: "player1",
    displayName: "Player",
    avatarUrl: null,
  })
  h.check.mockResolvedValue({ status: "approved" })
  h.restriction.mockResolvedValue(null)
})

describe("phone text-code credentials", () => {
  it("refuses an unverified number before checking a code", async () => {
    h.profile.mockResolvedValue({ userId: "user-1", phoneVerifiedAt: null })
    expect(await authorize({ phone: "+15551234567", code: "123456" })).toBeNull()
    expect(h.check).not.toHaveBeenCalled()
  })

  it("creates a session identity only after Twilio approves the code", async () => {
    const user = await authorize({ phone: "(555) 123-4567", code: "123456" })
    expect(h.check).toHaveBeenCalledWith({ to: "+15551234567", code: "123456" })
    expect(user).toMatchObject({ id: "user-1", email: null })
  })

  it("refuses wrong codes and exhausted attempt budgets", async () => {
    h.check.mockResolvedValueOnce({ status: "pending" })
    expect(await authorize({ phone: "+15551234567", code: "123456" })).toBeNull()
    h.limit.mockResolvedValueOnce({ success: false, count: 6 })
    expect(await authorize({ phone: "+15551234567", code: "123456" })).toBeNull()
    expect(h.check).toHaveBeenCalledTimes(1)
  })

  it("refuses suspended accounts even after a correct code", async () => {
    h.restriction.mockResolvedValue({ kind: "suspended" })
    await expect(authorize({ phone: "+15551234567", code: "123456" })).rejects.toThrow("ACCOUNT_SUSPENDED")
  })
})
