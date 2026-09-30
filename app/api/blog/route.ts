import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { createDraft } from "@/lib/automated-blog"
import { normalizeToSupportedSport } from "@/lib/sport-scope"
import { BLOG_CATEGORIES } from "@/lib/automated-blog/types"
import { requireAdminOrBearer } from "@/lib/adminAuth"
import { isBlogAdminRequest } from "@/lib/automated-blog/blogAdminGate"

const DEFAULT_LIMIT = 50

/** GET /api/blog — list articles (query: status, sport, category, limit). */
export async function GET(req: NextRequest) {
  try {
    const u = new URL(req.url)
    const status = u.searchParams?.get("status") ?? undefined
    const sport = u.searchParams?.get("sport") ?? undefined
    const category = u.searchParams?.get("category") ?? undefined
    const limit = Math.min(Number(u.searchParams?.get("limit")) || DEFAULT_LIMIT, 100)

    const where: Record<string, unknown> = {}
    // Drafts and scheduled articles are admin-only; everyone else sees published.
    if (await isBlogAdminRequest(req)) {
      if (status) where.publishStatus = status
    } else {
      where.publishStatus = "published"
    }
    if (sport) where.sport = normalizeToSupportedSport(sport)
    if (category && BLOG_CATEGORIES.includes(category as any)) where.category = category

    const list = await prisma.blogArticle.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: limit,
    })

    const articles = list.map((r) => ({
      articleId: r.articleId,
      title: r.title,
      slug: r.slug,
      sport: r.sport,
      category: r.category,
      excerpt: r.excerpt,
      publishStatus: r.publishStatus,
      publishedAt: r.publishedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }))
    return NextResponse.json({ articles })
  } catch (e) {
    console.error("[blog GET]", e)
    return NextResponse.json({ error: "Failed to list articles" }, { status: 500 })
  }
}

/** POST /api/blog — create draft from pre-generated content (body: sport, category, draft). */
export async function POST(req: NextRequest) {
  const gate = await requireAdminOrBearer(req)
  if (!gate.ok) return gate.res
  try {
    const body = await req.json()
    const sport = body?.sport ?? ""
    const category = body?.category ?? ""
    const draft = body?.draft
    if (!draft || !sport || !category) {
      return NextResponse.json(
        { error: "Missing sport, category, or draft" },
        { status: 400 }
      )
    }
    const result = await createDraft({
      sport: normalizeToSupportedSport(sport),
      category,
      draft: {
        title: draft.title ?? "Untitled",
        slug: draft.slug ?? draft.title?.toLowerCase().replace(/\s+/g, "-") ?? "article",
        excerpt: draft.excerpt ?? "",
        body: draft.body ?? "",
        seoTitle: draft.seoTitle ?? draft.title ?? "",
        seoDescription: draft.seoDescription ?? draft.excerpt ?? "",
        tags: Array.isArray(draft.tags) ? draft.tags : [],
      },
    })
    if (!result) {
      return NextResponse.json({ error: "Failed to create draft" }, { status: 400 })
    }
    const article = await prisma.blogArticle.findUnique({ where: { articleId: result.articleId } })
    return NextResponse.json({
      articleId: result.articleId,
      slug: result.slug,
      article: article
        ? {
            articleId: article.articleId,
            title: article.title,
            slug: article.slug,
            publishStatus: article.publishStatus,
            updatedAt: article.updatedAt.toISOString(),
          }
        : null,
    })
  } catch (e) {
    console.error("[blog POST]", e)
    return NextResponse.json({ error: "Failed to create draft" }, { status: 500 })
  }
}

