import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The verification link and the browser that opens it can belong to two different
 * accounts, and /verify used to answer every question about the SIGNED-IN one.
 *
 * Reported 2026-09-15 and measured against production: an account that had never
 * been verified (`emailVerified` null, `updatedAt` untouched since signup) got
 * "This address is already verified" from the resend button three times — no token
 * was created by any of them — in a session signed in as a verified account, while
 * the import gate in another session kept refusing the unverified one. Both screens
 * were right, about different accounts, and neither said which.
 *
 * The route now says so with `account=other`, carrying the fact and nothing else.
 */

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  deleteToken: vi.fn(),
  transaction: vi.fn(),
  earlyAccessUpdateMany: vi.fn(),
  getServerSession: vi.fn(),
  appUserUpdateMany: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    emailVerifyToken: {
      findUnique: mocks.findUnique,
      delete: mocks.deleteToken,
    },
    earlyAccessSignup: { updateMany: mocks.earlyAccessUpdateMany },
    $transaction: mocks.transaction,
  },
}))
vi.mock("next-auth", () => ({ getServerSession: mocks.getServerSession }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))

const TOKEN_USER = "user-link-owner"
const OTHER_USER = "user-signed-in-elsewhere"
const TOKEN_EMAIL = "link-owner@example.com"

function click(query: string): Request {
  return new Request(`https://0.0.0.0:8080/verify/email${query}`)
}

function liveToken() {
  mocks.findUnique.mockResolvedValue({ userId: TOKEN_USER, expiresAt: new Date(Date.now() + 60_000) })
}

function expiredToken() {
  mocks.findUnique.mockResolvedValue({ userId: TOKEN_USER, expiresAt: new Date(Date.now() - 60_000) })
}

function signedInAs(id: string | null) {
  mocks.getServerSession.mockResolvedValue(id === null ? null : { user: { id } })
}

async function GET(query: string) {
  const { GET: handler } = await import("@/app/verify/email/route")
  return handler(click(query))
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.deleteToken.mockResolvedValue({})
  mocks.earlyAccessUpdateMany.mockResolvedValue({ count: 0 })
  mocks.appUserUpdateMany.mockResolvedValue({ count: 1 })
  mocks.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) =>
    fn({
      appUser: {
        findUnique: vi.fn().mockResolvedValue({ email: TOKEN_EMAIL }),
        updateMany: mocks.appUserUpdateMany,
      },
      userProfile: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      emailVerifyToken: { delete: vi.fn().mockResolvedValue({}) },
    })
  )
  signedInAs(null)
})

describe("a working link opened while signed in to ANOTHER account", () => {
  it("still verifies the account the link was issued for", async () => {
    liveToken()
    signedInAs(OTHER_USER)

    const res = await GET("?token=good&returnTo=%2Fonboarding")

    expect(res.status).toBe(307)
    expect(mocks.appUserUpdateMany).toHaveBeenCalledWith({
      where: { id: TOKEN_USER },
      data: { emailVerified: expect.any(Date) },
    })
  })

  it("tells the screen the browser belongs to someone else", async () => {
    liveToken()
    signedInAs(OTHER_USER)

    const res = await GET("?token=good&returnTo=%2Fonboarding")

    expect(res.headers.get("location")).toBe("/verify?verified=email&account=other&returnTo=%2Fonboarding")
  })

  it("puts only the fact in the URL — never either account's id or address", async () => {
    liveToken()
    signedInAs(OTHER_USER)

    const location = (await GET("?token=good&returnTo=%2Fonboarding")).headers.get("location") ?? ""

    expect(location).toContain("account=other") // positive control: this IS the flagged redirect
    for (const secret of [TOKEN_USER, OTHER_USER, TOKEN_EMAIL, "good"]) {
      expect(location).not.toContain(secret)
    }
  })
})

describe("no flag unless the session positively names a different account", () => {
  it("same account signed in: the plain success redirect", async () => {
    liveToken()
    signedInAs(TOKEN_USER)

    const res = await GET("?token=good&returnTo=%2Fonboarding")

    expect(res.headers.get("location")).toBe("/verify?verified=email&returnTo=%2Fonboarding")
  })

  it("signed out: the plain success redirect", async () => {
    liveToken()
    signedInAs(null)

    const res = await GET("?token=good&returnTo=%2Fonboarding")

    expect(res.headers.get("location")).toBe("/verify?verified=email&returnTo=%2Fonboarding")
  })

  it("a blank session id is not an account", async () => {
    liveToken()
    signedInAs("   ")

    const res = await GET("?token=good&returnTo=%2Fonboarding")

    expect(res.headers.get("location")).toBe("/verify?verified=email&returnTo=%2Fonboarding")
  })

  /*
   * The session is read AFTER the verification is written. A lookup that fails
   * must cost the reader a hint, never the verification itself.
   */
  it("a session read that throws still verifies and still redirects to success", async () => {
    liveToken()
    mocks.getServerSession.mockRejectedValue(new Error("jwt decode failed"))

    const res = await GET("?token=good&returnTo=%2Fonboarding")

    expect(mocks.appUserUpdateMany).toHaveBeenCalledTimes(1)
    expect(res.headers.get("location")).toBe("/verify?verified=email&returnTo=%2Fonboarding")
  })

  it("an unknown token never asks whose session it is — there is no account to compare", async () => {
    mocks.findUnique.mockResolvedValue(null)
    signedInAs(OTHER_USER)

    const res = await GET("?token=nope&returnTo=%2Fonboarding")

    expect(res.headers.get("location")).toBe("/verify?error=INVALID_LINK&returnTo=%2Fonboarding")
    expect(mocks.getServerSession).not.toHaveBeenCalled()
  })
})

describe("an expired link", () => {
  /*
   * ⚠ DELETING THE EXPIRED ROW TURNED THE SECOND CLICK INTO "INVALID". The first
   * click said "expired" and removed the token; every later click on the same link
   * found nothing and reported "It may already have been used" about a link that
   * never was. The row verifies nothing once expired, and the next send clears it.
   */
  it("is kept, so clicking it again still says expired", async () => {
    expiredToken()

    const first = await GET("?token=old&returnTo=%2Fonboarding")
    const second = await GET("?token=old&returnTo=%2Fonboarding")

    expect(mocks.deleteToken).not.toHaveBeenCalled()
    expect(first.headers.get("location")).toBe("/verify?error=EXPIRED_LINK&returnTo=%2Fonboarding")
    expect(second.headers.get("location")).toBe("/verify?error=EXPIRED_LINK&returnTo=%2Fonboarding")
  })

  it("verifies nothing", async () => {
    expiredToken()

    await GET("?token=old&returnTo=%2Fonboarding")

    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("says when it belongs to a different account than the one signed in", async () => {
    expiredToken()
    signedInAs(OTHER_USER)

    const res = await GET("?token=old&returnTo=%2Fonboarding")

    expect(res.headers.get("location")).toBe("/verify?error=EXPIRED_LINK&account=other&returnTo=%2Fonboarding")
  })

  it("carries no flag for the account's own session", async () => {
    expiredToken()
    signedInAs(TOKEN_USER)

    const res = await GET("?token=old&returnTo=%2Fonboarding")

    expect(res.headers.get("location")).toBe("/verify?error=EXPIRED_LINK&returnTo=%2Fonboarding")
  })
})
