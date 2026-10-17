import { beforeEach, describe, expect, it, vi } from "vitest"

import { createMockNextRequest } from "@/__tests__/helpers/createMockNextRequest"
const blogArticleFindUniqueMock = vi.hoisted(() => vi.fn())
const getPublishLogMock = vi.hoisted(() => vi.fn())
const publishArticleMock = vi.hoisted(() => vi.fn())
const scheduleArticleMock = vi.hoisted(() => vi.fn())
const unpublishArticleMock = vi.hoisted(() => vi.fn())
const requireAdminOrBearerMock = vi.hoisted(() => vi.fn())

vi.mock("@/lib/adminAuth", () => ({
  requireAdminOrBearer: requireAdminOrBearerMock,
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    blogArticle: {
      findUnique: blogArticleFindUniqueMock,
    },
  },
}))

vi.mock("@/lib/automated-blog", () => ({
  getPublishLog: getPublishLogMock,
  publishArticle: publishArticleMock,
  scheduleArticle: scheduleArticleMock,
  unpublishArticle: unpublishArticleMock,
}))

describe("blog publish route contract", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireAdminOrBearerMock.mockResolvedValue({ ok: true, user: { role: "admin" } })
  })

  // An anonymous request could publish, unpublish or reschedule any article
  // before the admin gate existed.
  it("refuses a non-admin before touching any article", async () => {
    requireAdminOrBearerMock.mockResolvedValue({
      ok: false,
      res: Response.json({ error: "Unauthorized" }, { status: 401 }),
    })
    const { GET, POST } = await import("@/app/api/blog/[articleId]/publish/route")
    const ctx = { params: Promise.resolve({ articleId: "article-1" }) }

    const post = await POST(
      createMockNextRequest("http://localhost/api/blog/article-1/publish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "unpublish" }),
      }),
      ctx,
    )
    const get = await GET(createMockNextRequest("http://localhost/api/blog/article-1/publish"), ctx)

    expect(post.status).toBe(401)
    expect(get.status).toBe(401)
    expect(publishArticleMock).not.toHaveBeenCalled()
    expect(unpublishArticleMock).not.toHaveBeenCalled()
    expect(scheduleArticleMock).not.toHaveBeenCalled()
    expect(blogArticleFindUniqueMock).not.toHaveBeenCalled()
  })

  it("returns publish status and logs for GET", async () => {
    blogArticleFindUniqueMock.mockResolvedValueOnce({
      articleId: "article-1",
      publishStatus: "draft",
      publishedAt: null,
    })
    getPublishLogMock.mockResolvedValueOnce([
      {
        publishId: "publish-1",
        actionType: "save_draft",
        status: "success",
        createdAt: new Date("2026-03-25T12:00:00.000Z"),
      },
    ])

    const { GET } = await import("@/app/api/blog/[articleId]/publish/route")
    const res = await GET(createMockNextRequest("http://localhost/api/blog/article-1/publish"), {
      params: Promise.resolve({ articleId: "article-1" }),
    })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      article: { articleId: "article-1", publishStatus: "draft" },
      logs: [{ publishId: "publish-1", actionType: "save_draft", status: "success" }],
    })
  })

  it("schedules article for POST action=schedule", async () => {
    scheduleArticleMock.mockResolvedValueOnce({ ok: true })
    blogArticleFindUniqueMock.mockResolvedValueOnce({
      articleId: "article-1",
      publishStatus: "scheduled",
      publishedAt: new Date("2026-03-26T12:00:00.000Z"),
    })
    getPublishLogMock.mockResolvedValueOnce([])

    const { POST } = await import("@/app/api/blog/[articleId]/publish/route")
    const req = createMockNextRequest("http://localhost/api/blog/article-1/publish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "schedule",
        scheduledAt: "2026-03-26T12:00:00.000Z",
      }),
    })
    const res = await POST(req, { params: Promise.resolve({ articleId: "article-1" }) })

    expect(res.status).toBe(200)
    expect(scheduleArticleMock).toHaveBeenCalledWith("article-1", new Date("2026-03-26T12:00:00.000Z"))
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      article: { publishStatus: "scheduled" },
    })
  })

  it("publishes article for default POST action", async () => {
    publishArticleMock.mockResolvedValueOnce({ ok: true })
    blogArticleFindUniqueMock.mockResolvedValueOnce({
      articleId: "article-1",
      publishStatus: "published",
      publishedAt: new Date("2026-03-26T12:00:00.000Z"),
    })
    getPublishLogMock.mockResolvedValueOnce([])

    const { POST } = await import("@/app/api/blog/[articleId]/publish/route")
    const req = createMockNextRequest("http://localhost/api/blog/article-1/publish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    })
    const res = await POST(req, { params: Promise.resolve({ articleId: "article-1" }) })

    expect(res.status).toBe(200)
    expect(publishArticleMock).toHaveBeenCalledWith("article-1")
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      article: { publishStatus: "published" },
    })
  })
})
