import { NextRequest, NextResponse } from "next/server"
import { generateAndSaveDraft } from "@/lib/automated-blog"
import { prisma } from "@/lib/prisma"
import { normalizeToSupportedSport } from "@/lib/sport-scope"
import { BLOG_CATEGORIES } from "@/lib/automated-blog/types"
import { getBlogProviderStatus } from "@/lib/automated-blog/BlogGenerationService"
import { requireAdminOrBearer } from "@/lib/adminAuth"

/** POST /api/blog/generate-and-save — generate and save as draft in one step. Body: sport, category, topicHint?. */
export async function POST(req: NextRequest) {
  const gate = await requireAdminOrBearer(req)
  if (!gate.ok) return gate.res
  try {
    const body = await req.json()
    const sport = body?.sport ?? ""
    const category = body?.category ?? ""
    if (!sport || !category || !BLOG_CATEGORIES.includes(category as any)) {
      return NextResponse.json(
        { error: "Missing or invalid sport/category" },
        { status: 400 }
      )
    }
    const result = await generateAndSaveDraft({
      sport: normalizeToSupportedSport(sport),
      category: category as any,
      topicHint: body.topicHint,
      contentType: category as any,
    })
    if (!result.ok) {
      return NextResponse.json({ error: result.error ?? "Failed" }, { status: 400 })
    }
    const article =
      result.articleId
        ? await prisma.blogArticle.findUnique({ where: { articleId: result.articleId } })
        : null
    return NextResponse.json({
      articleId: result.articleId,
      slug: result.slug,
      providerStatus: getBlogProviderStatus(),
      article: article
        ? {
            articleId: article.articleId,
            slug: article.slug,
            publishStatus: article.publishStatus,
            updatedAt: article.updatedAt.toISOString(),
          }
        : null,
    })
  } catch (e) {
    console.error("[blog/generate-and-save]", e)
    return NextResponse.json({ error: "Failed to generate and save" }, { status: 500 })
  }
}
