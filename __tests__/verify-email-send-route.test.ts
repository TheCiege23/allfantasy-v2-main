import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Launch-hardening: the resend-verification endpoint must not report success when the provider
 * rejects the email, must drop the undelivered token, and must keep its auth / cooldown / rate
 * limits intact. Never leak the token, verification URL, recipient, or secrets.
 */
const mocks = vi.hoisted(() => ({
  getSessionAndProfile: vi.fn(),
  rateLimit: vi.fn(),
  getResendClient: vi.fn(),
  send: vi.fn(),
  userFindUnique: vi.fn(),
  tokenFindFirst: vi.fn(),
  tokenDeleteMany: vi.fn(),
  tokenCreate: vi.fn(),
  tokenDelete: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    appUser: { findUnique: mocks.userFindUnique },
    emailVerifyToken: {
      findFirst: mocks.tokenFindFirst,
      deleteMany: mocks.tokenDeleteMany,
      create: mocks.tokenCreate,
      delete: mocks.tokenDelete,
    },
  },
}))
vi.mock("@/lib/auth-guard", () => ({ getSessionAndProfile: mocks.getSessionAndProfile }))
vi.mock("@/lib/rate-limit", () => ({ rateLimit: mocks.rateLimit, getClientIp: () => "127.0.0.1" }))
vi.mock("@/lib/site-public-origin", () => ({ getDeploymentLinkOrigin: () => "https://preview.example" }))
vi.mock("@/lib/auth/user-facing-site-origin", () => ({ USER_FACING_SITE_ORIGIN: "https://www.allfantasy.ai" }))
vi.mock("@/lib/email/verification-email-html", () => ({ buildVerificationEmailHtml: () => "<html></html>" }))
vi.mock("@/lib/email/idempotency", () => ({ buildEmailIdempotencyKey: () => "idem-key" }))
vi.mock("@/lib/resend-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/resend-client")>()
  return { ...actual, getResendClient: mocks.getResendClient } // real resendSendError, mocked client
})

async function route() {
  return import("@/app/api/auth/verify-email/send/route")
}
function req(body: unknown = { returnTo: "/dashboard" }) {
  return new Request("https://preview.example/api/auth/verify-email/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

const RECIPIENT = "manager+beta2@gmail.com"
let errorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.clearAllMocks()
  // authed, unverified user; no cooldown; rate limit ok
  mocks.getSessionAndProfile.mockResolvedValue({ userId: "user-1", email: RECIPIENT })
  mocks.rateLimit.mockReturnValue({ success: true })
  mocks.userFindUnique.mockResolvedValue({ emailVerified: null, email: RECIPIENT })
  mocks.tokenFindFirst.mockResolvedValue(null)
  mocks.tokenDeleteMany.mockResolvedValue({ count: 0 })
  mocks.tokenCreate.mockResolvedValue({ id: "token-1" })
  mocks.tokenDelete.mockResolvedValue({ id: "token-1" })
  mocks.getResendClient.mockResolvedValue({
    client: { emails: { send: mocks.send } },
    fromEmail: "AllFantasy <noreply@allfantasy.ai>",
  })
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  errorSpy.mockRestore()
})

describe("verify-email/send — provider error handling", () => {
  it("returns { ok: true } on a successful send and keeps the token", async () => {
    mocks.send.mockResolvedValue({ data: { id: "email-1" }, error: null })
    const res = await (await route()).POST(req())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(mocks.tokenDelete).not.toHaveBeenCalled()
  })

  it("does NOT report success when Resend returns { error } without throwing", async () => {
    mocks.send.mockResolvedValue({ data: null, error: { name: "validation_error", message: "domain not verified" } })
    const res = await (await route()).POST(req())
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.ok).toBeUndefined()
    expect(body.error).toBe("EMAIL_SEND_FAILED")
    expect(mocks.tokenDelete).toHaveBeenCalledWith({ where: { id: "token-1" } }) // undelivered token dropped
  })

  it("treats a thrown provider/client exception as a failed send (502)", async () => {
    mocks.send.mockRejectedValue(new Error("network down"))
    const res = await (await route()).POST(req())
    expect(res.status).toBe(502)
    expect((await res.json()).ok).toBeUndefined()
    expect(mocks.tokenDelete).toHaveBeenCalledWith({ where: { id: "token-1" } })
  })

  it("never leaks the token, verification URL, or recipient in the response or logs", async () => {
    mocks.send.mockResolvedValue({ data: null, error: { name: "x", message: "domain not verified" } })
    const res = await (await route()).POST(req())
    const body = JSON.stringify(await res.json())
    expect(body).not.toContain("token-1")
    expect(body).not.toContain(RECIPIENT)
    expect(body).not.toContain("/verify/email?token=")

    const logged = errorSpy.mock.calls.map((c) => c.join(" ")).join("\n")
    expect(logged).toContain("domain not verified") // sanitized provider message is allowed
    expect(logged).not.toContain("token-1")
    expect(logged).not.toContain(RECIPIENT)
    expect(logged).not.toContain("/verify/email?token=")
  })
})

describe("verify-email/send — auth, cooldown, and rate limits remain intact", () => {
  it("still returns 401 without a session (no send attempted)", async () => {
    mocks.getSessionAndProfile.mockResolvedValue({ userId: null, email: null })
    const res = await (await route()).POST(req())
    expect(res.status).toBe(401)
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it("still returns 429 when the rate limiter says stop (no token created, no send)", async () => {
    mocks.rateLimit.mockReturnValue({ success: false })
    const res = await (await route()).POST(req())
    expect(res.status).toBe(429)
    expect(mocks.tokenCreate).not.toHaveBeenCalled()
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it("still enforces the 60s cooldown (a recent token → 429, no send)", async () => {
    mocks.tokenFindFirst.mockResolvedValue({ createdAt: new Date() })
    const res = await (await route()).POST(req())
    expect(res.status).toBe(429)
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it("short-circuits an already-verified user without sending", async () => {
    mocks.userFindUnique.mockResolvedValue({ emailVerified: new Date(), email: RECIPIENT })
    const res = await (await route()).POST(req())
    expect(res.status).toBe(200)
    expect((await res.json()).alreadyVerified).toBe(true)
    expect(mocks.send).not.toHaveBeenCalled()
  })
})

/*
 * ⚠ A FAILED RESEND USED TO DESTROY THE LINK ALREADY IN THE USER'S INBOX.
 *
 * The route ran `deleteMany({ where: { userId } })` BEFORE creating and sending the new
 * link. When the send then failed, it dropped the new token and answered 502 "try again"
 * — with the user's previous, perfectly good link already gone. Every resend failed that
 * way in production on 2026-09-15, while Resend was rejecting the API key.
 *
 * These tests run against an in-memory email_verify_tokens table and assert what is LEFT
 * in it, because that is what decides whether a link in an inbox still works. Call shapes
 * alone would pass for code that deletes the right rows at the wrong moment.
 */
describe("verify-email/send — a failed resend never costs the user the link they already have", () => {
  type TokenRow = { id: string; userId: string; tokenHash: string; expiresAt: Date; createdAt: Date }
  let table: TokenRow[]
  let seq: number
  /** When false, create() hands back a record without `createdAt` (the row itself still has one). */
  let createReturnsCreatedAt: boolean

  const EARLIER_LINK = "earlier-link"

  /*
   * Only the operators the route uses, and anything else THROWS. A fake that quietly
   * matched every row for an unrecognised filter would turn a wrong query into a green
   * "deleted the other tokens" test.
   */
  function matches(row: TokenRow, where: Record<string, unknown>): boolean {
    for (const [key, cond] of Object.entries(where)) {
      if (key === "userId") {
        if (row.userId !== cond) return false
      } else if (key === "id") {
        const ops = cond as Record<string, unknown>
        for (const op of Object.keys(ops)) if (op !== "not") throw new Error(`fake table: id.${op} unsupported`)
        if (ops.not !== undefined && row.id === ops.not) return false
      } else if (key === "createdAt") {
        const ops = cond as Record<string, unknown>
        for (const op of Object.keys(ops)) if (op !== "lt") throw new Error(`fake table: createdAt.${op} unsupported`)
        // Prisma drops an undefined filter; it does not match nothing.
        if (ops.lt !== undefined && !(row.createdAt < (ops.lt as Date))) return false
      } else {
        throw new Error(`fake table: where.${key} unsupported`)
      }
    }
    return true
  }

  const ids = () => table.map((row) => row.id).sort()

  function failWith(message: string) {
    mocks.send.mockResolvedValue({ data: null, error: { name: "validation_error", message } })
  }

  beforeEach(() => {
    seq = 0
    createReturnsCreatedAt = true
    table = [
      {
        id: EARLIER_LINK,
        userId: "user-1",
        tokenHash: "earlier-hash",
        expiresAt: new Date(Date.now() + 50 * 60_000),
        createdAt: new Date(Date.now() - 10 * 60_000), // mailed ten minutes ago; outside the cooldown
      },
    ]
    mocks.tokenFindFirst.mockImplementation(async ({ where }: { where: { userId: string } }) => {
      const mine = table.filter((row) => row.userId === where.userId)
      mine.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      return mine[0] ? { createdAt: mine[0].createdAt } : null
    })
    mocks.tokenCreate.mockImplementation(async ({ data }: { data: Omit<TokenRow, "id" | "createdAt"> }) => {
      seq += 1
      const row: TokenRow = { ...data, id: `new-link-${seq}`, createdAt: new Date(Date.now() + seq) }
      table.push(row)
      return createReturnsCreatedAt ? { ...row } : { id: row.id, userId: row.userId }
    })
    mocks.tokenDelete.mockImplementation(async ({ where }: { where: { id: string } }) => {
      table = table.filter((row) => row.id !== where.id)
      return { id: where.id }
    })
    mocks.tokenDeleteMany.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
      const before = table.length
      table = table.filter((row) => !matches(row, where))
      return { count: before - table.length }
    })
  })

  it("positive control: the fake table really deletes what a matching filter names", async () => {
    // Without this, every "the earlier link survived" assertion below could be green
    // because deleteMany did nothing at all.
    await mocks.tokenDeleteMany({ where: { userId: "user-1" } })
    expect(ids()).toEqual([])
  })

  it("a REJECTED send leaves the earlier link working", async () => {
    failWith("API key is invalid")

    const res = await (await route()).POST(req())

    expect(res.status).toBe(502)
    expect(ids()).toEqual([EARLIER_LINK]) // the undelivered new token is gone; the earlier one is not
    expect(mocks.tokenDeleteMany).not.toHaveBeenCalled()
  })

  it("a THROWN send leaves the earlier link working", async () => {
    mocks.send.mockRejectedValue(new Error("network down"))

    const res = await (await route()).POST(req())

    expect(res.status).toBe(502)
    expect(ids()).toEqual([EARLIER_LINK])
    expect(mocks.tokenDeleteMany).not.toHaveBeenCalled()
  })

  it("a delivered send retires the earlier link, keeps the new one, and only AFTER sending", async () => {
    mocks.send.mockResolvedValue({ data: { id: "email-1" }, error: null })

    const res = await (await route()).POST(req())

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(ids()).toEqual(["new-link-1"])
    // Deleting first and then sending also ends with this table on success — the order is
    // the whole fix, so it is asserted directly.
    expect(mocks.send.mock.invocationCallOrder[0]).toBeLessThan(mocks.tokenDeleteMany.mock.invocationCallOrder[0])
  })

  /*
   * Two resends racing (two tabs, a double click past the button's guard). If each
   * success deleted "every token except mine", each would delete the other's freshly
   * emailed link and BOTH emails would be dead. The newest must survive.
   */
  it("two delivered resends racing leave the newest link standing", async () => {
    let signalFirstRead!: () => void
    const firstRequestReadCooldown = new Promise<void>((resolve) => (signalFirstRead = resolve))
    let releaseCooldownReads!: () => void
    const bothReadCooldown = new Promise<void>((resolve) => (releaseCooldownReads = resolve))
    let releaseSends!: () => void
    const bothSending = new Promise<void>((resolve) => (releaseSends = resolve))

    const readCooldown = mocks.tokenFindFirst.getMockImplementation()!
    let cooldownReads = 0
    mocks.tokenFindFirst.mockImplementation(async (args: { where: { userId: string } }) => {
      const answer = await readCooldown(args) // both requests read the table before either writes
      cooldownReads += 1
      if (cooldownReads === 1) signalFirstRead()
      if (cooldownReads === 2) releaseCooldownReads()
      await bothReadCooldown
      return answer
    })
    let sends = 0
    mocks.send.mockImplementation(async () => {
      if (++sends === 2) releaseSends()
      await bothSending // both tokens exist before either request cleans up
      return { data: { id: `email-${sends}` }, error: null }
    })

    const { POST } = await route()
    /*
     * Started one after the other, not with one Promise.all. Firing both at once made one
     * request load the REAL lib/auth-guard despite vi.mock — observed twice, alone and in
     * the full file — most likely two concurrent first dynamic imports of a mocked module
     * racing in the mocker. The race under test is later, between the cooldown read and
     * the cleanup, and the gates above still interleave both requests across all of it.
     */
    const firstRequest = POST(req())
    await firstRequestReadCooldown
    const secondRequest = POST(req())
    const [first, second] = await Promise.all([firstRequest, secondRequest])

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(sends).toBe(2)
    expect(ids()).toEqual(["new-link-2"])
  })

  it("keeps the new link even when the created record comes back without createdAt", async () => {
    createReturnsCreatedAt = false
    mocks.send.mockResolvedValue({ data: { id: "email-1" }, error: null })

    const res = await (await route()).POST(req())

    expect(res.status).toBe(200)
    expect(ids()).toEqual(["new-link-1"])
  })

  it("a failed send does not start the 60s cooldown — the user can retry at once", async () => {
    failWith("API key is invalid")
    expect((await (await route()).POST(req())).status).toBe(502)

    mocks.send.mockResolvedValue({ data: { id: "email-2" }, error: null })
    const retry = await (await route()).POST(req())

    expect(retry.status).toBe(200)
    expect(ids()).toEqual(["new-link-2"])
  })
})
