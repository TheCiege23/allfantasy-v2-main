import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getPublishLog, publishArticle, scheduleArticle, unpublishArticle } from "@/lib/automated-blog"
import { requireAdminOrBearer } from "@/lib/adminAuth"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ articleId: string }> }
) {
  const gate = await requireAdminOrBearer(req)
  if (!gate.ok) return gate.res
  try {
    const { articleId } = await params
    const article = await prisma.blogArticle.findUnique({ where: { articleId } })
    if (!article) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const logs = await getPublishLog(articleId, 30)
    return NextResponse.json({
      article: {
        articleId: article.articleId,
        publishStatus: article.publishStatus,
        publishedAt: article.publishedAt?.toISOString() ?? null,
      },
      logs: logs.map((log) => ({
        publishId: log.publishId,
        actionType: log.actionType,
        status: log.status,
        createdAt: log.createdAt.toISOString(),
      })),
    })
  } catch (e) {
    console.error("[blog publish GET]", e)
    return NextResponse.json({ error: "Failed to load publish status" }, { status: 500 })
  }
}

/** POST /api/blog/[articleId]/publish — publish now. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ articleId: string }> }
) {
  const gate = await requireAdminOrBearer(req)
  if (!gate.ok) return gate.res
  try {
    const { articleId } = await params
    const body = await req.json().catch(() => ({}))
    const action = typeof body.action === "string" ? body.action.toLowerCase() : "publish"

    const result =
      action === "schedule"
        ? await scheduleArticle(articleId, new Date(String(body.scheduledAt ?? "")))
        : action === "unpublish"
          ? await unpublishArticle(articleId)
          : await publishArticle(articleId)
    if (!result.ok) {
      return NextResponse.json({ error: result.error ?? "Failed" }, { status: 400 })
    }
    const article = await prisma.blogArticle.findUnique({ where: { articleId } })
    const logs = await getPublishLog(articleId, 30)
    return NextResponse.json({
      ok: true,
      article: article
        ? {
            articleId: article.articleId,
            publishStatus: article.publishStatus,
            publishedAt: article.publishedAt?.toISOString() ?? null,
          }
        : null,
      logs: logs.map((log) => ({
        publishId: log.publishId,
        actionType: log.actionType,
        status: log.status,
        createdAt: log.createdAt.toISOString(),
      })),
    })
  } catch (e) {
    console.error("[blog publish]", e)
    return NextResponse.json({ error: "Failed to publish" }, { status: 500 })
  }
}
