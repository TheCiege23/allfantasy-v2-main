import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { createMockNextRequest } from "@/__tests__/helpers/createMockNextRequest"
const getServerSessionMock = vi.hoisted(() => vi.fn())
const rateLimitMock = vi.hoisted(() => vi.fn(() => ({ success: true })))
const getClientIpMock = vi.hoisted(() => vi.fn(() => "127.0.0.1"))
const bcryptCompareMock = vi.hoisted(() => vi.fn())
const makeTokenMock = vi.hoisted(() => vi.fn(() => "raw-token"))
const sha256HexMock = vi.hoisted(() => vi.fn(() => "hashed-token"))
const getBaseUrlMock = vi.hoisted(() => vi.fn(() => "http://localhost:3000"))
const resendSendMock = vi.hoisted(() => vi.fn())

const appUserFindUniqueMock = vi.hoisted(() => vi.fn())
const appUserFindFirstMock = vi.hoisted(() => vi.fn())
const appUserUpdateMock = vi.hoisted(() => vi.fn())
const userProfileUpdateManyMock = vi.hoisted(() => vi.fn())
const emailVerifyTokenDeleteManyMock = vi.hoisted(() => vi.fn())
const emailVerifyTokenCreateMock = vi.hoisted(() => vi.fn())
const emailVerifyTokenDeleteMock = vi.hoisted(() => vi.fn())
const txAppUserUpdateMock = vi.hoisted(() => vi.fn())
const txUserProfileUpdateManyMock = vi.hoisted(() => vi.fn())
const txEmailVerifyTokenDeleteManyMock = vi.hoisted(() => vi.fn())
const transactionMock = vi.hoisted(() =>
  vi.fn(async (cb: (tx: any) => Promise<void>) =>
    cb({
      appUser: { update: txAppUserUpdateMock },
      userProfile: { updateMany: txUserProfileUpdateManyMock },
      emailVerifyToken: { deleteMany: txEmailVerifyTokenDeleteManyMock },
    })
  )
)

vi.mock("next-auth", () => ({
  getServerSession: getServerSessionMock,
}))

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}))

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: rateLimitMock,
  getClientIp: getClientIpMock,
}))

vi.mock("bcryptjs", () => ({
  default: {
    compare: bcryptCompareMock,
  },
}))

vi.mock("@/lib/tokens", () => ({
  makeToken: makeTokenMock,
  sha256Hex: sha256HexMock,
}))

vi.mock("@/lib/get-base-url", () => ({
  getBaseUrl: getBaseUrlMock,
}))

// The REAL resendSendError, so these tests read a rejection the way production does.
vi.mock("@/lib/resend-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/resend-client")>()
  return {
    ...actual,
    getResendClient: async () => ({
      client: {
        emails: {
          send: resendSendMock,
        },
      },
      fromEmail: "AllFantasy <noreply@allfantasy.ai>",
    }),
  }
})

vi.mock("@/lib/prisma", () => ({
  prisma: {
    appUser: {
      findUnique: appUserFindUniqueMock,
      findFirst: appUserFindFirstMock,
      update: appUserUpdateMock,
    },
    userProfile: {
      updateMany: userProfileUpdateManyMock,
    },
    emailVerifyToken: {
      deleteMany: emailVerifyTokenDeleteManyMock,
      create: emailVerifyTokenCreateMock,
      delete: emailVerifyTokenDeleteMock,
    },
    $transaction: transactionMock,
  },
}))

describe("User contact email route contracts", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getServerSessionMock.mockResolvedValue({ user: { id: "u1" } })
    rateLimitMock.mockReturnValue({ success: true })
    appUserFindUniqueMock.mockResolvedValue({
      id: "u1",
      email: "old@example.com",
      passwordHash: "hashed-current-password",
    })
    appUserFindFirstMock.mockResolvedValue(null)
    bcryptCompareMock.mockResolvedValue(true)
    txAppUserUpdateMock.mockResolvedValue(undefined)
    txUserProfileUpdateManyMock.mockResolvedValue(undefined)
    txEmailVerifyTokenDeleteManyMock.mockResolvedValue({ count: 0 })
    emailVerifyTokenDeleteManyMock.mockResolvedValue(undefined)
    /*
     * ⚠ THIS WAS `mockResolvedValue(undefined)`, AND IT HAD STOPPED DOUBLING ANYTHING.
     * Prisma's create returns the row; the route reads `tokenRecord.id` for the
     * idempotency key, so `undefined` threw a TypeError before Resend was ever called.
     * The two send-path tests below were RED on main for exactly that reason (measured
     * 2026-09-15: "expected verificationEmailSent true, got false", "send called 0
     * times") — neither had been exercising the send at all.
     */
    emailVerifyTokenCreateMock.mockResolvedValue({ id: "token-1" })
    emailVerifyTokenDeleteMock.mockResolvedValue({ id: "token-1" })
    resendSendMock.mockResolvedValue({ id: "email_1" })
  })

  it("returns 401 when unauthenticated", async () => {
    getServerSessionMock.mockResolvedValueOnce(null)
    const { POST } = await import("@/app/api/user/contact/email/route")
    const res = await POST(
      createMockNextRequest("http://localhost/api/user/contact/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "new@example.com" }),
      }) as any
    )

    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toEqual({ error: "UNAUTHORIZED" })
  })

  it("returns 429 when rate limited", async () => {
    rateLimitMock.mockReturnValueOnce({ success: false })
    const { POST } = await import("@/app/api/user/contact/email/route")
    const res = await POST(
      createMockNextRequest("http://localhost/api/user/contact/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "new@example.com" }),
      }) as any
    )

    expect(res.status).toBe(429)
    await expect(res.json()).resolves.toMatchObject({ error: "RATE_LIMITED" })
  })

  it("validates email format", async () => {
    const { POST } = await import("@/app/api/user/contact/email/route")
    const res = await POST(
      createMockNextRequest("http://localhost/api/user/contact/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "bad-email" }),
      }) as any
    )

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: "INVALID_EMAIL" })
  })

  it("requires current password for password accounts", async () => {
    const { POST } = await import("@/app/api/user/contact/email/route")
    const res = await POST(
      createMockNextRequest("http://localhost/api/user/contact/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "new@example.com" }),
      }) as any
    )

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: "CURRENT_PASSWORD_REQUIRED" })
  })

  it("rejects wrong current password", async () => {
    bcryptCompareMock.mockResolvedValueOnce(false)
    const { POST } = await import("@/app/api/user/contact/email/route")
    const res = await POST(
      createMockNextRequest("http://localhost/api/user/contact/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "new@example.com", currentPassword: "wrong-pass" }),
      }) as any
    )

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: "WRONG_PASSWORD" })
  })

  it("returns duplicate email conflict", async () => {
    appUserFindFirstMock.mockResolvedValueOnce({ id: "u2" })
    const { POST } = await import("@/app/api/user/contact/email/route")
    const res = await POST(
      createMockNextRequest("http://localhost/api/user/contact/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "taken@example.com", currentPassword: "Password123!" }),
      }) as any
    )

    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toEqual({ error: "EMAIL_ALREADY_IN_USE" })
  })

  it("returns unchanged when email matches current value", async () => {
    const { POST } = await import("@/app/api/user/contact/email/route")
    const res = await POST(
      createMockNextRequest("http://localhost/api/user/contact/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "OLD@example.com", currentPassword: "Password123!" }),
      }) as any
    )

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      ok: true,
      unchanged: true,
      verificationEmailSent: false,
    })
    expect(transactionMock).not.toHaveBeenCalled()
    expect(resendSendMock).not.toHaveBeenCalled()
  })

  it("updates email, resets verification, and sends verify email", async () => {
    appUserFindUniqueMock.mockResolvedValueOnce({
      id: "u1",
      email: "old@example.com",
      passwordHash: null,
    })
    const { POST } = await import("@/app/api/user/contact/email/route")
    const res = await POST(
      createMockNextRequest("http://localhost/api/user/contact/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "NewEmail@Example.com",
          returnTo: "/settings?tab=security",
        }),
      }) as any
    )

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      ok: true,
      email: "newemail@example.com",
      verificationEmailSent: true,
    })

    expect(transactionMock).toHaveBeenCalledTimes(1)
    expect(txAppUserUpdateMock).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { email: "newemail@example.com", emailVerified: null },
    })
    expect(txUserProfileUpdateManyMock).toHaveBeenCalledWith({
      where: { userId: "u1" },
      data: { emailVerifiedAt: null },
    })
    // Old-address links die INSIDE the address-change transaction, not afterwards.
    expect(txEmailVerifyTokenDeleteManyMock).toHaveBeenCalledWith({ where: { userId: "u1" } })
    expect(emailVerifyTokenDeleteManyMock).not.toHaveBeenCalled()
    expect(emailVerifyTokenCreateMock).toHaveBeenCalled()
    expect(resendSendMock).toHaveBeenCalledTimes(1)
    expect(emailVerifyTokenDeleteMock).not.toHaveBeenCalled() // a delivered link is kept
  })

  it("still succeeds when verification email dispatch fails", async () => {
    appUserFindUniqueMock.mockResolvedValueOnce({
      id: "u1",
      email: "old@example.com",
      passwordHash: null,
    })
    resendSendMock.mockRejectedValueOnce(new Error("resend unavailable"))

    const { POST } = await import("@/app/api/user/contact/email/route")
    const res = await POST(
      createMockNextRequest("http://localhost/api/user/contact/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "fallback@example.com",
          returnTo: "/settings?tab=security",
        }),
      }) as any
    )

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      ok: true,
      email: "fallback@example.com",
      verificationEmailSent: false,
    })
    expect(transactionMock).toHaveBeenCalledTimes(1)
    expect(emailVerifyTokenCreateMock).toHaveBeenCalledTimes(1)
    expect(resendSendMock).toHaveBeenCalledTimes(1)
    expect(emailVerifyTokenDeleteMock).toHaveBeenCalledWith({ where: { id: "token-1" } }) // undelivered link dropped
  })
})

describe("User contact email route — what a failed send may and may not leave behind", () => {
  function changeEmailTo(email: string) {
    return createMockNextRequest("http://localhost/api/user/contact/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, returnTo: "/settings?tab=security" }),
    }) as any
  }

  let errorSpy: ReturnType<typeof vi.spyOn>

  afterEach(() => {
    errorSpy.mockRestore()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    getServerSessionMock.mockResolvedValue({ user: { id: "u1" } })
    rateLimitMock.mockReturnValue({ success: true })
    appUserFindUniqueMock.mockResolvedValue({ id: "u1", email: "old@example.com", passwordHash: null })
    appUserFindFirstMock.mockResolvedValue(null)
    txAppUserUpdateMock.mockResolvedValue(undefined)
    txUserProfileUpdateManyMock.mockResolvedValue(undefined)
    txEmailVerifyTokenDeleteManyMock.mockResolvedValue({ count: 1 })
    emailVerifyTokenCreateMock.mockResolvedValue({ id: "token-1" })
    emailVerifyTokenDeleteMock.mockResolvedValue({ id: "token-1" })
    resendSendMock.mockResolvedValue({ data: { id: "email_1" }, error: null })
  })

  /*
   * ⚠ THE SEND RESULT WAS NEVER READ. Resend resolves `{ data, error }` without throwing
   * when it rejects, so Settings said "check your inbox" for an email that was never
   * sent — every email change while production's key was rejected (2026-09-15).
   */
  it("reports a Resend REJECTION as not sent, and drops the undelivered link", async () => {
    resendSendMock.mockResolvedValueOnce({ data: null, error: { name: "validation_error", message: "API key is invalid" } })
    const { POST } = await import("@/app/api/user/contact/email/route")

    const res = await POST(changeEmailTo("new@example.com"))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true, email: "new@example.com", verificationEmailSent: false })
    expect(resendSendMock).toHaveBeenCalledTimes(1)
    expect(emailVerifyTokenDeleteMock).toHaveBeenCalledWith({ where: { id: "token-1" } })

    const logged = errorSpy.mock.calls.map((call) => call.join(" ")).join("\n")
    expect(logged).toContain("API key is invalid") // the provider message is allowed
    for (const secret of ["raw-token", "hashed-token", "/verify/email?token=", "new@example.com"]) {
      expect(logged).not.toContain(secret)
    }
  })

  /*
   * ⚠ THE OPPOSITE OF verify-email/send, ON PURPOSE. A token names the account, not the
   * address, and /verify/email verifies whatever address the account holds now — so a
   * live link mailed to the OLD address would verify the NEW one. Those links must die
   * with the change whether or not the new email goes out.
   */
  it("kills links mailed to the old address even when the new email cannot be sent", async () => {
    resendSendMock.mockResolvedValueOnce({ data: null, error: { message: "API key is invalid" } })
    const { POST } = await import("@/app/api/user/contact/email/route")

    await POST(changeEmailTo("new@example.com"))

    expect(txEmailVerifyTokenDeleteManyMock).toHaveBeenCalledWith({ where: { userId: "u1" } })
    // Inside the change, before the new link exists — not a best-effort step afterwards.
    expect(txAppUserUpdateMock.mock.invocationCallOrder[0]).toBeLessThan(
      txEmailVerifyTokenDeleteManyMock.mock.invocationCallOrder[0],
    )
    expect(txEmailVerifyTokenDeleteManyMock.mock.invocationCallOrder[0]).toBeLessThan(
      emailVerifyTokenCreateMock.mock.invocationCallOrder[0],
    )
  })

  it("does not change the address when the old links cannot be invalidated", async () => {
    txEmailVerifyTokenDeleteManyMock.mockRejectedValueOnce(new Error("connection reset"))
    const { POST } = await import("@/app/api/user/contact/email/route")

    const res = await POST(changeEmailTo("new@example.com"))

    // The deletion runs through the transaction client, so in Postgres the address update
    // above it rolls back with it. Nothing is mailed for a change that did not happen.
    expect(res.status).toBe(500)
    await expect(res.json()).resolves.toEqual({ error: "UPDATE_FAILED" })
    expect(emailVerifyTokenCreateMock).not.toHaveBeenCalled()
    expect(resendSendMock).not.toHaveBeenCalled()
  })
})
