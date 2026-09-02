import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Regression: the verification link marked the address verified and then sent the
 * browser to `https://0.0.0.0:8080`.
 *
 * Next builds a route handler's `req.url` from the address the server was BOUND to
 * — `attachRequestMeta` in next-server.js returns
 * `${protocol}://${fetchHostname}:${port}${req.url}` whenever a hostname and port
 * were supplied — and Railway runs `next start -H 0.0.0.0 -p 8080`. So every
 * redirect built from `new URL(req.url).origin` pointed at a host no browser can
 * reach. Measured in production 2026-09-02:
 *
 *   location: https://0.0.0.0:8080/verify?error=INVALID_LINK&returnTo=%2Fonboarding
 *
 * These tests feed the handler the exact request Next hands it on Railway, so the
 * fixture reproduces the failing condition rather than a friendly localhost one.
 */

const BOUND_ORIGIN = "https://0.0.0.0:8080"

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  deleteToken: vi.fn(),
  transaction: vi.fn(),
  earlyAccessUpdateMany: vi.fn(),
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

function requestAsNextBuildsIt(query: string): Request {
  return new Request(`${BOUND_ORIGIN}/verify/email${query}`)
}

describe("verify/email redirects to the host the visitor reached", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.deleteToken.mockResolvedValue({})
    mocks.earlyAccessUpdateMany.mockResolvedValue({ count: 0 })
  })

  it("positive control: the fixture really does carry the bind address as its origin", () => {
    // If this ever fails, every assertion below is testing a condition that cannot
    // reproduce the bug, and a green run would mean nothing.
    expect(new URL(requestAsNextBuildsIt("?token=x").url).origin).toBe(BOUND_ORIGIN)
  })

  it("sends a missing token to the invalid-link screen without an absolute origin", async () => {
    const { GET } = await import("@/app/verify/email/route")
    const res = await GET(requestAsNextBuildsIt("?returnTo=%2Fonboarding"))

    const location = res.headers.get("location")
    expect(location).toBe("/verify?error=INVALID_LINK&returnTo=%2Fonboarding")
    expect(location).not.toContain("0.0.0.0")
  })

  it("sends an unknown token to the invalid-link screen without an absolute origin", async () => {
    mocks.findUnique.mockResolvedValue(null)

    const { GET } = await import("@/app/verify/email/route")
    const res = await GET(requestAsNextBuildsIt("?token=nope&returnTo=%2Fonboarding"))

    expect(res.headers.get("location")).toBe("/verify?error=INVALID_LINK&returnTo=%2Fonboarding")
  })

  it("sends an expired token to the expired-link screen without an absolute origin", async () => {
    mocks.findUnique.mockResolvedValue({
      userId: "user-1",
      expiresAt: new Date(Date.now() - 60_000),
    })

    const { GET } = await import("@/app/verify/email/route")
    const res = await GET(requestAsNextBuildsIt("?token=old&returnTo=%2Fonboarding"))

    expect(res.headers.get("location")).toBe("/verify?error=EXPIRED_LINK&returnTo=%2Fonboarding")
  })

  it("sends a SUCCESSFUL verification back to /verify, not to the bind address", async () => {
    // The path that actually hurt: the transaction below had already flipped
    // emailVerified and deleted the token, so a dead Location left the visitor
    // with a connection error and no second chance at the link.
    mocks.findUnique.mockResolvedValue({
      userId: "user-1",
      expiresAt: new Date(Date.now() + 60_000),
    })
    mocks.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) =>
      fn({
        appUser: {
          findUnique: vi.fn().mockResolvedValue({ email: "player@example.com" }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        userProfile: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        emailVerifyToken: { delete: vi.fn().mockResolvedValue({}) },
      })
    )

    const { GET } = await import("@/app/verify/email/route")
    const res = await GET(requestAsNextBuildsIt("?token=good&returnTo=%2Fonboarding"))

    const location = res.headers.get("location")
    expect(res.status).toBe(307)
    expect(location).toBe("/verify?verified=email&returnTo=%2Fonboarding")
    expect(location).not.toContain("0.0.0.0")
    expect(mocks.transaction).toHaveBeenCalledTimes(1)
  })

  it("keeps returnTo out of the URL when it is not a site-relative path", async () => {
    mocks.findUnique.mockResolvedValue(null)

    const { GET } = await import("@/app/verify/email/route")
    const res = await GET(
      requestAsNextBuildsIt("?token=nope&returnTo=https%3A%2F%2Fevil.example.com")
    )

    expect(res.headers.get("location")).toBe("/verify?error=INVALID_LINK&returnTo=%2Fdashboard")
  })
})

describe("the legacy /api/auth/verify-email entry point", () => {
  it("forwards to /verify/email relatively, with the token preserved", async () => {
    const { GET } = await import("@/app/api/auth/verify-email/route")
    const res = await GET(new Request(`${BOUND_ORIGIN}/api/auth/verify-email?token=abc%2Fdef`))

    expect(res.status).toBe(308)
    expect(res.headers.get("location")).toBe("/verify/email?token=abc%2Fdef")
  })

  it("forwards to /verify when there is no token", async () => {
    const { GET } = await import("@/app/api/auth/verify-email/route")
    const res = await GET(new Request(`${BOUND_ORIGIN}/api/auth/verify-email`))

    expect(res.headers.get("location")).toBe("/verify")
  })
})
