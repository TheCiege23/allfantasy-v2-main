import { beforeEach, describe, expect, it, vi } from "vitest"

import { createMockNextRequest } from "@/__tests__/helpers/createMockNextRequest"

const requireAdminOrBearerMock = vi.hoisted(() => vi.fn())
const createDraftMock = vi.hoisted(() => vi.fn())
const updateDraftMock = vi.hoisted(() => vi.fn())
const blogFindManyMock = vi.hoisted(() => vi.fn())
const blogFindUniqueMock = vi.hoisted(() => vi.fn())
const userProfileFindUniqueMock = vi.hoisted(() => vi.fn())
const appUserFindUniqueMock = vi.hoisted(() => vi.fn())
const resetFindFirstMock = vi.hoisted(() => vi.fn())
const resetDeleteManyMock = vi.hoisted(() => vi.fn())
const transactionMock = vi.hoisted(() => vi.fn())
const revokeAllSessionsForUserMock = vi.hoisted(() => vi.fn())

vi.mock("@/lib/adminAuth", () => ({
  requireAdminOrBearer: requireAdminOrBearerMock,
  getAdminAccessState: vi.fn(async () => ({ status: "unauthenticated", source: "none" })),
}))

vi.mock("@/lib/automated-blog", () => ({
  createDraft: createDraftMock,
  updateDraft: updateDraftMock,
}))

vi.mock("@/lib/auth/sessionRevocation", () => ({
  revokeAllSessionsForUser: revokeAllSessionsForUserMock,
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    blogArticle: { findMany: blogFindManyMock, findUnique: blogFindUniqueMock },
    userProfile: { findUnique: userProfileFindUniqueMock },
    appUser: { findUnique: appUserFindUniqueMock },
    passwordResetToken: { findFirst: resetFindFirstMock, deleteMany: resetDeleteManyMock },
    $transaction: transactionMock,
  },
}))

const DENIED = () => ({ ok: false, res: Response.json({ error: "Unauthorized" }, { status: 401 }) })

beforeEach(async () => {
  vi.clearAllMocks()
  delete process.env.UPSTASH_REDIS_REST_URL
  delete process.env.UPSTASH_REDIS_REST_TOKEN
  requireAdminOrBearerMock.mockResolvedValue(DENIED())
  blogFindManyMock.mockResolvedValue([])
  resetDeleteManyMock.mockResolvedValue({ count: 1 })
  revokeAllSessionsForUserMock.mockResolvedValue(undefined)
  transactionMock.mockImplementation(async (fn: any) =>
    fn({ appUser: { update: vi.fn() }, passwordResetToken: { deleteMany: vi.fn(), delete: vi.fn() } }),
  )
  const { __resetPasswordResetAttemptsForTests } = await import("@/lib/auth/passwordResetAttempts")
  __resetPasswordResetAttemptsForTests()
})

describe("blog body rendering", () => {
  it("escapes markup so a stored body cannot run script", async () => {
    const { renderBlogBodyHtml } = await import("@/lib/automated-blog/renderBlogBody")
    const html = renderBlogBodyHtml(
      '## Week 7 <script>alert(1)</script>\n<img src=x onerror="fetch(1)">\n**bold** & "quoted"',
    )
    expect(html).not.toContain("<script")
    expect(html).not.toContain("<img")
    expect(html).toContain("&lt;img src=x onerror=&quot;fetch(1)&quot;&gt;")
    // The markdown-lite formatting still works on the escaped text.
    expect(html).toContain('<h2 class="text-xl font-semibold mt-8 mb-2">Week 7 &lt;script&gt;')
    expect(html).toContain("<strong>bold</strong> &amp; &quot;quoted&quot;")
  })
})

describe("blog API admin gate", () => {
  it("refuses an anonymous create without writing", async () => {
    const { POST } = await import("@/app/api/blog/route")
    const res = await POST(
      createMockNextRequest("http://localhost/api/blog", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sport: "NFL", category: "weekly_strategy", draft: { title: "x", body: "<img>" } }),
      }) as any,
    )
    expect(res.status).toBe(401)
    expect(createDraftMock).not.toHaveBeenCalled()
  })

  it("refuses an anonymous edit and an anonymous draft read", async () => {
    const { PATCH, GET } = await import("@/app/api/blog/[articleId]/route")
    const ctx = { params: Promise.resolve({ articleId: "a-1" }) }
    const patch = await PATCH(
      createMockNextRequest("http://localhost/api/blog/a-1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: "<img src=x onerror=alert(1)>" }),
      }) as any,
      ctx,
    )
    const get = await GET(createMockNextRequest("http://localhost/api/blog/a-1") as any, ctx)
    expect(patch.status).toBe(401)
    expect(get.status).toBe(401)
    expect(updateDraftMock).not.toHaveBeenCalled()
    expect(blogFindUniqueMock).not.toHaveBeenCalled()
  })

  it("lists only published articles to a non-admin, whatever status is asked for", async () => {
    const { GET } = await import("@/app/api/blog/route")
    await GET(createMockNextRequest("http://localhost/api/blog?status=draft") as any)
    expect(blogFindManyMock.mock.calls[0][0].where.publishStatus).toBe("published")
  })

  it("lets a Next.js dynamic-render signal through, but degrades an ordinary failure to non-admin", async () => {
    const { isBlogAdminRequest } = await import("@/lib/automated-blog/blogAdminGate")
    const req = createMockNextRequest("http://localhost/api/blog") as any

    const signal = Object.assign(new Error("Dynamic server usage"), { digest: "DYNAMIC_SERVER_USAGE" })
    requireAdminOrBearerMock.mockRejectedValueOnce(signal)
    await expect(isBlogAdminRequest(req)).rejects.toBe(signal)

    requireAdminOrBearerMock.mockRejectedValueOnce(new Error("db down"))
    await expect(isBlogAdminRequest(req)).resolves.toBe(false)
  })

  it("still honours the status filter for an admin", async () => {
    requireAdminOrBearerMock.mockResolvedValue({ ok: true, user: { role: "admin" } })
    const { GET } = await import("@/app/api/blog/route")
    await GET(createMockNextRequest("http://localhost/api/blog?status=draft") as any)
    expect(blogFindManyMock.mock.calls[0][0].where.publishStatus).toBe("draft")
  })
})

describe("password reset code guess budget", () => {
  it("admits exactly the budget from a parallel burst, then burns the codes", async () => {
    const { consumeResetCodeAttempt, RESET_CODE_MAX_ATTEMPTS } = await import("@/lib/auth/passwordResetAttempts")
    const results = await Promise.all(Array.from({ length: 50 }, () => consumeResetCodeAttempt("victim")))
    expect(results.filter(Boolean)).toHaveLength(RESET_CODE_MAX_ATTEMPTS)
    expect(resetDeleteManyMock).toHaveBeenCalledWith({ where: { userId: "victim" } })
  })

  it("keeps one user's budget separate from another's", async () => {
    const { consumeResetCodeAttempt, RESET_CODE_MAX_ATTEMPTS } = await import("@/lib/auth/passwordResetAttempts")
    for (let i = 0; i < RESET_CODE_MAX_ATTEMPTS + 1; i++) await consumeResetCodeAttempt("attacked")
    await expect(consumeResetCodeAttempt("bystander")).resolves.toBe(true)
  })

  it("stops comparing codes on confirm once the budget is spent", async () => {
    const { RESET_CODE_MAX_ATTEMPTS } = await import("@/lib/auth/passwordResetAttempts")
    const { POST } = await import("@/app/api/auth/password/reset/confirm/route")
    userProfileFindUniqueMock.mockResolvedValue({ userId: "u-1" })
    resetFindFirstMock.mockResolvedValue(null)

    const guess = (code: string) =>
      POST(
        createMockNextRequest("http://localhost/api/auth/password/reset/confirm", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ phone: "+15551234567", code, newPassword: "Str0ngPassw0rd!" }),
        }) as any,
      )

    for (let i = 0; i < RESET_CODE_MAX_ATTEMPTS; i++) {
      expect((await guess(String(100000 + i))).status).toBe(400)
    }
    const blocked = await guess("999999")
    expect(blocked.status).toBe(429)
    await expect(blocked.json()).resolves.toEqual({ error: "TOO_MANY_ATTEMPTS" })
    expect(resetFindFirstMock).toHaveBeenCalledTimes(RESET_CODE_MAX_ATTEMPTS)
  })

  it("shares the budget with the email+code branch, which accepts the SMS code too", async () => {
    const { RESET_CODE_MAX_ATTEMPTS, consumeResetCodeAttempt } = await import("@/lib/auth/passwordResetAttempts")
    for (let i = 0; i < RESET_CODE_MAX_ATTEMPTS; i++) await consumeResetCodeAttempt("u-2")
    appUserFindUniqueMock.mockResolvedValue({ id: "u-2" })
    const { POST } = await import("@/app/api/auth/password/reset/confirm/route")
    const res = await POST(
      createMockNextRequest("http://localhost/api/auth/password/reset/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "v@example.com", code: "123456", newPassword: "Str0ngPassw0rd!" }),
      }) as any,
    )
    expect(res.status).toBe(429)
    expect(resetFindFirstMock).not.toHaveBeenCalled()
  })

  it("signs out every existing session after a successful reset", async () => {
    userProfileFindUniqueMock.mockResolvedValue({ userId: "u-3" })
    resetFindFirstMock.mockResolvedValue({ userId: "u-3", expiresAt: new Date(Date.now() + 60_000) })
    const { POST } = await import("@/app/api/auth/password/reset/confirm/route")
    const res = await POST(
      createMockNextRequest("http://localhost/api/auth/password/reset/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone: "+15551234567", code: "123456", newPassword: "Str0ngPassw0rd!" }),
      }) as any,
    )
    expect(res.status).toBe(200)
    expect(revokeAllSessionsForUserMock).toHaveBeenCalledWith("u-3")
  })
})
